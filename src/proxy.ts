import * as http from "http";
import * as https from "https";
import { URL } from "url";

/** Non-2xx answer from the ADT class lookup, with the status to decide on. */
export class AdtStatusError extends Error {
  constructor(public readonly status: number) {
    super(`ADT answered ${status}`);
  }
}

/** What the ADT metadata of a class says about its current state. */
export interface AdtClassState {
  version?: "active" | "inactive";
  /** Timestamp of the last change, e.g. `2026-07-29T23:28:37Z`. */
  changedAt?: string;
}

/**
 * Small local reverse proxy: accepts requests on 127.0.0.1 and forwards them
 * to the SAP system, injecting the basic-auth header into EVERY request. That
 * way the embedded browser (webview iframe) needs no login of its own and does
 * not run into a 401.
 *
 * All paths are forwarded transparently (UI5 resources under /sap/public,
 * /sap/bc/ui5_ui5 and so on), since the iframe sends root-relative paths to
 * the proxy automatically.
 */
/** What the system answered to one forwarded request. */
export interface ProxyResponse {
  status: number;
  /** Request path, for the log line. */
  path: string;
}

export class SapProxy {
  private server?: http.Server;
  private port?: number;
  private target?: URL;
  private authHeader?: string;

  /**
   * Called for every answer the system gives. The proxy is the only place
   * that sees them: inside the iframe a 401 is just a blank or unhelpful
   * page, and the extension used to have nothing to say about it. The host
   * uses this to turn a rejected logon into an actionable message.
   */
  onResponse?: (response: ProxyResponse) => void;

  /** Starts the proxy (or just refreshes auth if the target stays the same). */
  async start(targetOrigin: string, user: string, pass: string): Promise<number> {
    const target = new URL(targetOrigin);
    this.authHeader = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

    if (this.server && this.target && this.target.origin === target.origin) {
      return this.port!;
    }

    await this.stop();
    this.target = target;
    this.server = http.createServer((req, res) => this.handle(req, res));

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", resolve);
    });

    const addr = this.server.address();
    this.port = typeof addr === "object" && addr ? addr.port : 0;
    return this.port;
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** True once start() succeeded, i.e. target and credentials are known. */
  get isRunning(): boolean {
    return !!this.server && !!this.target && !!this.authHeader;
  }

  /**
   * Reads the activation state of a class from the system's ADT service
   * (`/sap/bc/adt/oo/classes/<name>`), using the credentials the proxy already
   * injects. The root element's `adtcore:version` attribute is `inactive`
   * while a saved-but-not-activated version exists and flips back to `active`
   * on activation, and `adtcore:changedAt` moves with every change — together
   * the only way to notice an activation done outside this extension, since
   * VS Code has no event for it.
   *
   * Resolves to whatever of the two the answer carried. Rejects with an
   * {@link AdtStatusError} on a non-2xx status.
   */
  fetchClassState(
    className: string,
    sapClient?: string
  ): Promise<AdtClassState> {
    const target = this.target;
    const auth = this.authHeader;
    if (!target || !auth) {
      return Promise.reject(new Error("proxy not started"));
    }
    const isHttps = target.protocol === "https:";
    const mod = isHttps ? https : http;
    const path =
      "/sap/bc/adt/oo/classes/" +
      encodeURIComponent(className.toLowerCase()) +
      (sapClient ? `?sap-client=${encodeURIComponent(sapClient)}` : "");

    return new Promise((resolve, reject) => {
      const req = mod.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (isHttps ? 443 : 80),
          method: "GET",
          path,
          headers: {
            authorization: auth,
            accept: "application/xml, */*",
          },
          rejectUnauthorized: false,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            // The attribute sits on the root element; cap just in case.
            if (body.length < 64 * 1024) {
              body += chunk;
            }
          });
          res.on("end", () => {
            if (status < 200 || status >= 300) {
              reject(new AdtStatusError(status));
              return;
            }
            // First occurrences in document order sit on the root element.
            const version = body.match(/adtcore:version="(active|inactive)"/);
            const changedAt = body.match(/adtcore:changedAt="([^"]+)"/);
            resolve({
              version: version
                ? (version[1] as "active" | "inactive")
                : undefined,
              changedAt: changedAt ? changedAt[1] : undefined,
            });
          });
        }
      );
      req.setTimeout(8000, () => req.destroy(new Error("ADT request timed out")));
      req.on("error", reject);
      req.end();
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const target = this.target!;
    const isHttps = target.protocol === "https:";
    const mod = isHttps ? https : http;

    // Take over the incoming headers, overwrite host + auth
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    headers.host = target.host;
    headers.authorization = this.authHeader;

    // The browser addresses the proxy, so it sends 127.0.0.1 as Origin and
    // Referer while the forwarded Host is the SAP host. Origin-validating
    // CSRF checks reject that mismatch on every POST ("CSRF validation
    // failed - cross-origin POST rejected") - make the request look
    // same-origin to the system again.
    if (headers.origin) {
      headers.origin = target.origin;
    }
    if (headers.referer) {
      headers.referer = String(headers.referer).replace(
        this.origin,
        target.origin
      );
    }

    const options: https.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
      rejectUnauthorized: false, // dev systems often have self-signed certificates
    };

    const proxyReq = mod.request(options, (proxyRes) => {
      this.onResponse?.({
        status: proxyRes.statusCode ?? 0,
        path: String(req.url ?? ""),
      });
      const outHeaders: http.OutgoingHttpHeaders = { ...proxyRes.headers };

      // Allow framing: otherwise the server forbids embedding via
      // X-Frame-Options / CSP frame-ancestors -> the iframe would stay blank.
      delete outHeaders["x-frame-options"];
      for (const key of [
        "content-security-policy",
        "content-security-policy-report-only",
      ]) {
        const csp = outHeaders[key];
        if (typeof csp === "string") {
          const cleaned = csp
            .split(";")
            .filter((d) => !/^\s*frame-ancestors/i.test(d))
            .join(";")
            .trim();
          if (cleaned) {
            outHeaders[key] = cleaned;
          } else {
            delete outHeaders[key];
          }
        }
      }

      // Rewrite redirects from the SAP host to the proxy
      if (outHeaders.location) {
        outHeaders.location = String(outHeaders.location).replace(
          target.origin,
          this.origin
        );
      }

      // Make cookies valid on localhost: strip Domain + Secure
      const setCookie = proxyRes.headers["set-cookie"];
      if (setCookie) {
        outHeaders["set-cookie"] = setCookie.map((c) =>
          c.replace(/;\s*Domain=[^;]+/i, "").replace(/;\s*Secure/i, "")
        );
      }

      res.writeHead(proxyRes.statusCode || 502, outHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      }
      res.end("abap2UI5 proxy error: " + err.message);
    });

    req.pipe(proxyReq);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    this.target = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  dispose(): void {
    void this.stop();
  }
}
