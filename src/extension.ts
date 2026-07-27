import * as vscode from "vscode";
import * as path from "path";
import { URL } from "url";
import { SapProxy } from "./proxy";

const CONFIG_SECTION = "abap2ui5";
const TEMPLATE_KEY = "launchUrlTemplate";
const OPEN_MODE_KEY = "openMode";

const SECRET_USER = "abap2ui5.user";
const SECRET_PASS = "abap2ui5.pass";

/** Muss in der Klasse vorkommen, damit F9 die App startet. */
const APP_INTERFACE_RE = /interfaces\s+z2ui5_if_app/i;

/** Kollabiert doppelte Slashes im Pfad, lässt aber `://` im Protokoll intakt. */
function normalizeUrl(url: string): string {
  return url.replace(/(?<!:)\/{2,}/g, "/");
}

// ---------------------------------------------------------------------------
// Webview-HTML
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function placeholderHtml(): string {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 12px; }
</style></head>
<body>
  <p>Öffne eine ABAP-Klasse, die <code>z2ui5_if_app</code> implementiert,
     und drücke <b>F9</b>.</p>
</body></html>`;
}

/**
 * @param frameUrl    URL, die im iframe geladen wird (i. d. R. der Proxy).
 * @param externalUrl echte SAP-URL für den "Extern öffnen"-Button.
 */
function htmlForUrl(frameUrl: string, externalUrl: string): string {
  const safeFrame = escapeHtml(frameUrl);
  const safeExternal = escapeHtml(externalUrl);
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; frame-src http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body { display: flex; flex-direction: column;
         font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
  .bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px;
         border-bottom: 1px solid var(--vscode-panel-border);
         background: var(--vscode-panel-background); font-size: 12px; }
  .bar .url { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
              opacity: 0.8; }
  .bar button { font: inherit; cursor: pointer;
                color: var(--vscode-button-foreground);
                background: var(--vscode-button-background);
                border: none; padding: 2px 10px; border-radius: 2px; }
  .frame-wrap { flex: 1; position: relative; }
  iframe { border: 0; width: 100%; height: 100%; background: #fff; }
</style></head>
<body>
  <div class="bar">
    <span class="url" id="url" title="${safeExternal}">${safeExternal}</span>
    <button onclick="openExt()">Extern öffnen</button>
  </div>
  <div class="frame-wrap">
    <iframe id="app" src="${safeFrame}"
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"></iframe>
  </div>
  <script>
    const vscodeApi = acquireVsCodeApi();
    const iframe = document.getElementById('app');
    const urlEl = document.getElementById('url');
    function openExt() { vscodeApi.postMessage({ type: 'openExternal' }); }
    // F9 erneut -> Host schickt 'load'; gleiche URL = Reload, neue URL = Wechsel.
    window.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'load') {
        if (urlEl) { urlEl.textContent = m.externalUrl; urlEl.title = m.externalUrl; }
        iframe.src = m.frameUrl; // Neuzuweisung erzwingt das Neuladen des iframes
      }
    });
  </script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Panel-View (unten)
// ---------------------------------------------------------------------------

class PreviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "abap2ui5.preview";

  private view?: vscode.WebviewView;
  private frameUrl?: string;
  private externalUrl?: string;
  private htmlSet = false;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.htmlSet = false;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "openExternal" && this.externalUrl) {
        vscode.env.openExternal(vscode.Uri.parse(this.externalUrl));
      }
    });
    this.renderOrReload();
  }

  async show(frameUrl: string, externalUrl: string): Promise<void> {
    this.frameUrl = frameUrl;
    this.externalUrl = externalUrl;
    await vscode.commands.executeCommand(`${PreviewViewProvider.viewId}.focus`);
    this.renderOrReload();
  }

  private renderOrReload(): void {
    const view = this.view;
    if (!view) {
      return;
    }
    if (!this.frameUrl || !this.externalUrl) {
      view.webview.html = placeholderHtml();
      this.htmlSet = false;
      return;
    }
    if (!this.htmlSet) {
      view.webview.html = htmlForUrl(this.frameUrl, this.externalUrl);
      this.htmlSet = true;
    } else {
      void view.webview.postMessage({
        type: "load",
        frameUrl: this.frameUrl,
        externalUrl: this.externalUrl,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tab (Editor-Bereich)
// ---------------------------------------------------------------------------

let appPanel: vscode.WebviewPanel | undefined;
let appPanelExternalUrl: string | undefined;

// Aktuell im Tab gezeigte App (für Auto-Reload beim Aktivieren/Speichern).
let currentClassName: string | undefined;
let currentFrameUrl: string | undefined;
let currentExternalUrl: string | undefined;

/** Lädt die im Tab gezeigte App neu, ohne den Fokus zu verschieben. */
function reloadShownApp(): void {
  if (!appPanel || !currentFrameUrl || !currentExternalUrl) {
    return;
  }
  void appPanel.webview.postMessage({
    type: "load",
    frameUrl: currentFrameUrl,
    externalUrl: currentExternalUrl,
  });
}

// Editor-Position, an die der Fokus nach F9 zurückkehren soll.
let sourceDoc: vscode.TextDocument | undefined;
let sourceSelection: vscode.Selection | undefined;
let sourceColumn: vscode.ViewColumn | undefined;
// Zeitfenster (ms-Timestamp), in dem ein Fokus-Wechsel zur App als
// automatischer Fokus-Klau gilt und zurückgegeben wird.
let bounceFocusUntil = 0;

function rememberSource(editor: vscode.TextEditor): void {
  sourceDoc = editor.document;
  sourceSelection = editor.selection;
  sourceColumn = editor.viewColumn;
}

async function restoreSourceFocus(): Promise<void> {
  if (!sourceDoc) {
    return;
  }
  await vscode.window.showTextDocument(sourceDoc, {
    viewColumn: sourceColumn,
    selection: sourceSelection,
    preserveFocus: false,
  });
}

function showInTab(frameUrl: string, externalUrl: string, title: string): void {
  appPanelExternalUrl = externalUrl;
  if (appPanel) {
    // Bestehender Tab: nur neu laden (bzw. auf neue Klasse wechseln).
    appPanel.title = title;
    appPanel.reveal(vscode.ViewColumn.Beside, true);
    void appPanel.webview.postMessage({ type: "load", frameUrl, externalUrl });
    return;
  }
  appPanel = vscode.window.createWebviewPanel(
    "abap2ui5.app",
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  appPanel.onDidDispose(() => {
    appPanel = undefined;
  });
  // Wenn die ladende App kurz nach F9 den Fokus an sich reißt, zurück in den Code.
  appPanel.onDidChangeViewState((e) => {
    if (e.webviewPanel.active && Date.now() < bounceFocusUntil) {
      void restoreSourceFocus();
    }
  });
  appPanel.webview.onDidReceiveMessage((msg) => {
    if (msg?.type === "openExternal" && appPanelExternalUrl) {
      vscode.env.openExternal(vscode.Uri.parse(appPanelExternalUrl));
    }
  });
  appPanel.webview.html = htmlForUrl(frameUrl, externalUrl);
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function resolveClassName(doc: vscode.TextDocument): string {
  const match = doc.getText().match(/class\s+(\S+)\s+definition/i);
  const raw = match
    ? match[1]
    : path
        .basename(doc.fileName)
        .replace(/\.clas\.abap$/i, "")
        .replace(/\.abap$/i, "");
  return raw.toUpperCase();
}

async function ensureTemplate(): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  let tpl = cfg.get<string>(TEMPLATE_KEY, "").trim();
  if (tpl) {
    return tpl;
  }
  tpl = (
    (await vscode.window.showInputBox({
      title: "abap2UI5: Launch-URL festlegen",
      prompt: "URL-Vorlage mit {class} als Platzhalter",
      value: "https://host:44300/sap/bc/z2ui5?app_start={class}&sap-client=100",
      ignoreFocusOut: true,
    })) ?? ""
  ).trim();
  if (tpl) {
    await cfg.update(TEMPLATE_KEY, tpl, vscode.ConfigurationTarget.Global);
  }
  return tpl || undefined;
}

async function ensureCredentials(
  context: vscode.ExtensionContext
): Promise<{ user: string; pass: string } | undefined> {
  const secrets = context.secrets;
  let user = await secrets.get(SECRET_USER);
  let pass = await secrets.get(SECRET_PASS);

  if (!user) {
    user = await vscode.window.showInputBox({
      title: "abap2UI5: SAP-Benutzer",
      prompt: "Benutzer für die Anmeldung am SAP-System (wie in ADT)",
      ignoreFocusOut: true,
    });
    if (!user) {
      return undefined;
    }
    await secrets.store(SECRET_USER, user);
  }

  if (!pass) {
    pass = await vscode.window.showInputBox({
      title: "abap2UI5: SAP-Passwort",
      prompt: "Passwort (wird sicher im VS Code SecretStorage abgelegt)",
      password: true,
      ignoreFocusOut: true,
    });
    if (!pass) {
      return undefined;
    }
    await secrets.store(SECRET_PASS, pass);
  }

  return { user, pass };
}

// ---------------------------------------------------------------------------
// Kommando
// ---------------------------------------------------------------------------

async function runApp(
  context: vscode.ExtensionContext,
  proxy: SapProxy,
  provider: PreviewViewProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  // Kein ABAP-Editor oder keine z2ui5-App: normales F9-Verhalten beibehalten.
  if (
    !editor ||
    editor.document.languageId !== "abap" ||
    !APP_INTERFACE_RE.test(editor.document.getText())
  ) {
    await vscode.commands.executeCommand("editor.debug.action.toggleBreakpoint");
    return;
  }

  const className = resolveClassName(editor.document);
  const template = await ensureTemplate();
  if (!template) {
    return;
  }

  const externalUrl = normalizeUrl(
    template.replace(/\{class\}/gi, encodeURIComponent(className))
  );

  const openMode = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>(OPEN_MODE_KEY, "tab");

  if (openMode === "external") {
    await vscode.env.openExternal(vscode.Uri.parse(externalUrl));
    return;
  }

  // tab / panel: über den Auth-Proxy laden, damit die Anmeldung greift.
  const creds = await ensureCredentials(context);
  if (!creds) {
    return;
  }

  let frameUrl: string;
  try {
    const origin = new URL(externalUrl).origin;
    await proxy.start(origin, creds.user, creds.pass);
    frameUrl = externalUrl.replace(origin, proxy.origin);
  } catch (err) {
    vscode.window.showErrorMessage(
      "abap2UI5: Proxy konnte nicht gestartet werden – " +
        (err instanceof Error ? err.message : String(err))
    );
    return;
  }

  // Cursor-Position merken; Fenster öffnen, in dem ein Fokus-Klau der
  // ladenden App zurückgegeben wird (der Inhalt lädt asynchron).
  rememberSource(editor);
  bounceFocusUntil = Date.now() + 2500;

  // Für Auto-Reload beim Aktivieren/Speichern merken.
  currentClassName = className;
  currentFrameUrl = frameUrl;
  currentExternalUrl = externalUrl;

  if (openMode === "panel") {
    await provider.show(frameUrl, externalUrl);
  } else {
    showInTab(frameUrl, externalUrl, `abap2UI5: ${className}`);
  }

  // Fokus sofort zurück in den Quelltext an dieselbe Stelle.
  await restoreSourceFocus();
}

// ---------------------------------------------------------------------------
// Aktivierung
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PreviewViewProvider();
  const proxy = new SapProxy();

  context.subscriptions.push(
    { dispose: () => proxy.dispose() },
    vscode.window.registerWebviewViewProvider(
      PreviewViewProvider.viewId,
      provider
    ),
    vscode.commands.registerCommand("abap2ui5.run", () =>
      runApp(context, proxy, provider)
    ),
    // Auto-Reload: Klasse der gezeigten App aktiviert/gespeichert -> Tab neu laden.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!appPanel || doc.languageId !== "abap") {
        return;
      }
      const on = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>("reloadOnSave", true);
      if (!on) {
        return;
      }
      if (!APP_INTERFACE_RE.test(doc.getText())) {
        return;
      }
      if (currentClassName && resolveClassName(doc) !== currentClassName) {
        return;
      }
      // Fokus im Code halten, falls die neu ladende App ihn greifen will.
      const ed = vscode.window.activeTextEditor;
      if (ed && ed.document === doc) {
        rememberSource(ed);
        bounceFocusUntil = Date.now() + 2500;
      }
      reloadShownApp();
    }),
    vscode.commands.registerCommand("abap2ui5.resetCredentials", async () => {
      await context.secrets.delete(SECRET_USER);
      await context.secrets.delete(SECRET_PASS);
      vscode.window.showInformationMessage(
        "abap2UI5: gespeicherte SAP-Zugangsdaten gelöscht."
      );
    }),
    vscode.commands.registerCommand("abap2ui5-demokit.newApp", newApp),
    vscode.commands.registerCommand("abap2ui5-demokit.openDemokit", () =>
      vscode.env.openExternal(
        vscode.Uri.parse("https://github.com/abap2UI5/abap2UI5")
      )
    )
  );
}

const APP_TEMPLATE = `CLASS zcl_my_app DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
ENDCLASS.

CLASS zcl_my_app IMPLEMENTATION.
  METHOD z2ui5_if_app~main.

    DATA(view) = z2ui5_cl_xml_view=>factory( ).
    view->label( 'Hello abap2UI5' ).
    client->view_display( view->stringify( ) ).

  ENDMETHOD.
ENDCLASS.
`;

async function newApp(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Bitte zuerst eine ABAP-Datei öffnen.");
    return;
  }
  await editor.edit((b) => b.insert(editor.selection.active, APP_TEMPLATE));
}

export function deactivate(): void {
  // Proxy wird über context.subscriptions disposed
}
