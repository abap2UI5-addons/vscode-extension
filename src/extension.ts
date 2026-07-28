import * as vscode from "vscode";
import * as path from "path";
import { URL } from "url";
import { SapProxy } from "./proxy";
import { createNonce, previewHtml, shortUrl, welcomeHtml } from "./webview";

const CONFIG_SECTION = "abap2ui5";
const TEMPLATE_KEY = "launchUrlTemplate";
const OPEN_MODE_KEY = "openMode";

const SECRET_USER = "abap2ui5.user";
const SECRET_PASS = "abap2ui5.pass";

/** Must appear in the class for F9 to launch the app. */
const APP_INTERFACE_RE = /interfaces\s+z2ui5_if_app/i;

/** Collapses duplicate slashes in the path but leaves `://` in the protocol intact. */
function normalizeUrl(url: string): string {
  return url.replace(/(?<!:)\/{2,}/g, "/");
}

/** Everything needed to show (and later reload) one app. */
interface AppTarget {
  className: string;
  frameUrl: string;
  externalUrl: string;
}

/** Message posted into a preview webview to (re)load an app. */
function loadMessage(target: AppTarget, reason?: string) {
  return {
    type: "load" as const,
    className: target.className,
    frameUrl: target.frameUrl,
    externalUrl: target.externalUrl,
    shortUrl: shortUrl(target.externalUrl),
    reason,
  };
}

function hasLaunchUrl(): boolean {
  return !!vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>(TEMPLATE_KEY, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Panel view (bottom)
// ---------------------------------------------------------------------------

class PreviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "abap2ui5.preview";

  private view?: vscode.WebviewView;
  private target?: AppTarget;
  private previewRendered = false;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.previewRendered = false;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((msg) => handleWebviewMessage(msg, this.target));
    this.render();
  }

  async show(target: AppTarget, reason?: string): Promise<void> {
    this.target = target;
    await vscode.commands.executeCommand(`${PreviewViewProvider.viewId}.focus`);
    this.render(reason);
  }

  /** Reloads the app already shown, without stealing the focus. */
  reload(reason?: string): void {
    if (this.view && this.previewRendered && this.target) {
      void this.view.webview.postMessage(loadMessage(this.target, reason));
    }
  }

  get isShowing(): boolean {
    return !!this.view && this.previewRendered;
  }

  /** Re-renders the empty state, e.g. after the launch URL was configured. */
  refreshWelcome(): void {
    if (this.view && !this.previewRendered) {
      this.render();
    }
  }

  private render(reason?: string): void {
    const view = this.view;
    if (!view) {
      return;
    }
    if (!this.target) {
      view.webview.html = welcomeHtml({
        nonce: createNonce(),
        hasLaunchUrl: hasLaunchUrl(),
      });
      this.previewRendered = false;
      return;
    }
    if (!this.previewRendered) {
      view.webview.html = previewHtml({ ...this.target, nonce: createNonce() });
      this.previewRendered = true;
    } else {
      void view.webview.postMessage(loadMessage(this.target, reason));
    }
  }
}

// ---------------------------------------------------------------------------
// Tab (editor area)
// ---------------------------------------------------------------------------

let appPanel: vscode.WebviewPanel | undefined;

/** App currently shown (tab or panel) — the target of reload-on-save. */
let currentTarget: AppTarget | undefined;

let statusItem: vscode.StatusBarItem | undefined;

function updateStatusItem(): void {
  if (!statusItem) {
    return;
  }
  if (!currentTarget) {
    statusItem.hide();
    return;
  }
  statusItem.text = `$(play-circle) ${currentTarget.className}`;
  statusItem.tooltip = new vscode.MarkdownString(
    `**abap2UI5 preview**\n\n${currentTarget.externalUrl}\n\nClick to reload.`
  );
  statusItem.show();
}

/** Reloads the app shown in tab or panel without moving the focus. */
function reloadShownApp(provider: PreviewViewProvider, reason?: string): void {
  if (!currentTarget) {
    return;
  }
  if (appPanel) {
    void appPanel.webview.postMessage(loadMessage(currentTarget, reason));
  }
  provider.reload(reason);
}

function handleWebviewMessage(msg: unknown, target: AppTarget | undefined): void {
  const message = msg as { type?: string; command?: string } | undefined;
  if (message?.type === "openExternal" && target) {
    void vscode.env.openExternal(vscode.Uri.parse(target.externalUrl));
    return;
  }
  if (message?.type === "command" && message.command?.startsWith(`${CONFIG_SECTION}.`)) {
    void vscode.commands.executeCommand(message.command);
  }
}

// Editor position the focus should return to after F9.
let sourceDoc: vscode.TextDocument | undefined;
let sourceSelection: vscode.Selection | undefined;
let sourceColumn: vscode.ViewColumn | undefined;
// Time window (ms timestamp) in which a focus switch to the app counts as
// the app stealing focus automatically, and is handed back.
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

function showInTab(context: vscode.ExtensionContext, target: AppTarget): void {
  const title = `${target.className} · abap2UI5`;
  if (appPanel) {
    // Existing tab: just reload (or switch to the new class).
    appPanel.title = title;
    appPanel.reveal(vscode.ViewColumn.Beside, true);
    void appPanel.webview.postMessage(loadMessage(target));
    return;
  }
  appPanel = vscode.window.createWebviewPanel(
    "abap2ui5.app",
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  appPanel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "media", "icon-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "media", "icon-dark.svg"),
  };
  appPanel.onDidDispose(() => {
    appPanel = undefined;
    currentTarget = undefined;
    updateStatusItem();
  });
  // If the loading app grabs focus shortly after F9, hand it back to the code.
  appPanel.onDidChangeViewState((e) => {
    if (e.webviewPanel.active && Date.now() < bounceFocusUntil) {
      void restoreSourceFocus();
    }
  });
  appPanel.webview.onDidReceiveMessage((msg) =>
    handleWebviewMessage(msg, currentTarget)
  );
  appPanel.webview.html = previewHtml({ ...target, nonce: createNonce() });
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

/** Asks for the launch URL and stores it. Returns the stored template. */
async function askForTemplate(current: string): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const answer = (
    (await vscode.window.showInputBox({
      title: "abap2UI5: Set launch URL",
      prompt: "URL template with {class} as the placeholder",
      value:
        current ||
        "https://host:44300/sap/bc/z2ui5?app_start={class}&sap-client=100",
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return "The launch URL must not be empty.";
        }
        if (!/\{class\}/i.test(trimmed)) {
          return "The URL needs the {class} placeholder.";
        }
        try {
          new URL(trimmed);
        } catch {
          return "That is not a valid URL.";
        }
        return undefined;
      },
    })) ?? ""
  ).trim();
  if (!answer) {
    return undefined;
  }
  await cfg.update(TEMPLATE_KEY, answer, vscode.ConfigurationTarget.Global);
  return answer;
}

async function ensureTemplate(): Promise<string | undefined> {
  const tpl = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>(TEMPLATE_KEY, "")
    .trim();
  return tpl || (await askForTemplate(""));
}

async function ensureCredentials(
  context: vscode.ExtensionContext
): Promise<{ user: string; pass: string } | undefined> {
  const secrets = context.secrets;
  let user = await secrets.get(SECRET_USER);
  let pass = await secrets.get(SECRET_PASS);

  if (!user) {
    user = await vscode.window.showInputBox({
      title: "abap2UI5: SAP user",
      prompt: "User for logging on to the SAP system (same as in ADT)",
      ignoreFocusOut: true,
    });
    if (!user) {
      return undefined;
    }
    await secrets.store(SECRET_USER, user);
  }

  if (!pass) {
    pass = await vscode.window.showInputBox({
      title: "abap2UI5: SAP password",
      prompt: "Password (stored securely in the VS Code SecretStorage)",
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
// Command
// ---------------------------------------------------------------------------

async function runApp(
  context: vscode.ExtensionContext,
  proxy: SapProxy,
  provider: PreviewViewProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  // Not an ABAP editor or not a z2ui5 app: keep the normal F9 behaviour.
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

  // tab / panel: load through the auth proxy so the login takes effect.
  const creds = await ensureCredentials(context);
  if (!creds) {
    return;
  }

  let frameUrl: string;
  try {
    const origin = new URL(externalUrl).origin;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `abap2UI5: starting ${className}`,
      },
      () => proxy.start(origin, creds.user, creds.pass)
    );
    frameUrl = externalUrl.replace(origin, proxy.origin);
  } catch (err) {
    vscode.window.showErrorMessage(
      "abap2UI5: could not start the proxy - " +
        (err instanceof Error ? err.message : String(err))
    );
    return;
  }

  // Remember the cursor position; open the window in which focus stolen by
  // the loading app is handed back (the content loads asynchronously).
  rememberSource(editor);
  bounceFocusUntil = Date.now() + 2500;

  // Remember for auto-reload on save and for the status bar.
  currentTarget = { className, frameUrl, externalUrl };
  updateStatusItem();

  if (openMode === "panel") {
    await provider.show(currentTarget);
  } else {
    showInTab(context, currentTarget);
  }

  // Focus straight back to the same spot in the source.
  await restoreSourceFocus();
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PreviewViewProvider();
  const proxy = new SapProxy();

  statusItem = vscode.window.createStatusBarItem(
    "abap2ui5.status",
    vscode.StatusBarAlignment.Left,
    50
  );
  statusItem.name = "abap2UI5";
  statusItem.command = "abap2ui5.reload";
  updateStatusItem();

  context.subscriptions.push(
    statusItem,
    { dispose: () => proxy.dispose() },
    vscode.window.registerWebviewViewProvider(
      PreviewViewProvider.viewId,
      provider
    ),
    vscode.commands.registerCommand("abap2ui5.run", () =>
      runApp(context, proxy, provider)
    ),
    vscode.commands.registerCommand("abap2ui5.reload", () => {
      if (!currentTarget) {
        vscode.window.showInformationMessage(
          "abap2UI5: no app is running yet - press F9 in an app class."
        );
        return;
      }
      appPanel?.reveal(vscode.ViewColumn.Beside, true);
      reloadShownApp(provider);
    }),
    vscode.commands.registerCommand("abap2ui5.setLaunchUrl", async () => {
      const current = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<string>(TEMPLATE_KEY, "");
      if (await askForTemplate(current)) {
        vscode.window.showInformationMessage("abap2UI5: launch URL saved.");
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.${TEMPLATE_KEY}`)) {
        provider.refreshWelcome();
      }
    }),
    // Auto-reload: shown app's class saved -> reload the preview.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId !== "abap" || !currentTarget) {
        return;
      }
      if (!appPanel && !provider.isShowing) {
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
      if (resolveClassName(doc) !== currentTarget.className) {
        return;
      }
      // Keep focus in the code in case the reloading app tries to grab it.
      const ed = vscode.window.activeTextEditor;
      if (ed && ed.document === doc) {
        rememberSource(ed);
        bounceFocusUntil = Date.now() + 2500;
      }
      reloadShownApp(provider, "Reloaded after save");
    }),
    vscode.commands.registerCommand("abap2ui5.resetCredentials", async () => {
      await context.secrets.delete(SECRET_USER);
      await context.secrets.delete(SECRET_PASS);
      vscode.window.showInformationMessage(
        "abap2UI5: stored SAP credentials deleted."
      );
    }),
    vscode.commands.registerCommand("abap2ui5.newApp", newApp),
    vscode.commands.registerCommand("abap2ui5.openHomepage", () =>
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
    vscode.window.showWarningMessage("Please open an ABAP file first.");
    return;
  }
  await editor.edit((b) => b.insert(editor.selection.active, APP_TEMPLATE));
}

export function deactivate(): void {
  // The proxy is disposed via context.subscriptions
}
