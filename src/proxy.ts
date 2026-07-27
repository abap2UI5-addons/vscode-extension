import * as http from "http";
import * as https from "https";
import { URL } from "url";

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
export class SapProxy {
  private server?: http.Server;
  private port?: number;
  private target?: URL;
  private authHeader?: string;

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

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const target = this.target!;
    const isHttps = target.protocol === "https:";
    const mod = isHttps ? https : http;

    // Take over the incoming headers, overwrite host + auth
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    headers.host = target.host;
    headers.authorization = this.authHeader;

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
