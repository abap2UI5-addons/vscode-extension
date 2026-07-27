import * as http from "http";
import * as https from "https";
import { URL } from "url";

/**
 * Kleiner lokaler Reverse-Proxy: nimmt Requests auf 127.0.0.1 entgegen und
 * leitet sie an das SAP-System weiter – dabei wird bei JEDEM Request der
 * Basic-Auth-Header injiziert. Dadurch braucht der eingebettete Browser
 * (Webview-iframe) keine eigene Anmeldung und läuft nicht in den 401.
 *
 * Alle Pfade werden transparent weitergereicht (UI5-Ressourcen unter
 * /sap/public, /sap/bc/ui5_ui5 usw.), da der iframe root-relative Pfade
 * automatisch an den Proxy schickt.
 */
export class SapProxy {
  private server?: http.Server;
  private port?: number;
  private target?: URL;
  private authHeader?: string;

  /** Startet den Proxy (oder aktualisiert Auth, wenn Ziel gleich bleibt). */
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

    // eingehende Header übernehmen, Host + Auth überschreiben
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
      rejectUnauthorized: false, // Dev-Systeme haben oft selbst-signierte Zertifikate
    };

    const proxyReq = mod.request(options, (proxyRes) => {
      const outHeaders: http.OutgoingHttpHeaders = { ...proxyRes.headers };

      // Framing erlauben: der Server verbietet das Einbetten sonst per
      // X-Frame-Options / CSP frame-ancestors -> iframe bliebe weiß.
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

      // Redirects vom SAP-Host auf den Proxy umschreiben
      if (outHeaders.location) {
        outHeaders.location = String(outHeaders.location).replace(
          target.origin,
          this.origin
        );
      }

      // Cookies auf localhost gültig machen: Domain + Secure entfernen
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
      res.end("abap2UI5 Proxy-Fehler: " + err.message);
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
