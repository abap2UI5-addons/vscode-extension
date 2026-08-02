import * as vscode from "vscode";
import * as path from "path";
import { URL } from "url";
import { AdtClassState, AdtStatusError, SapProxy } from "./proxy";
import { createNonce, previewHtml, shortUrl, welcomeHtml } from "./webview";
import { registerMcp } from "./mcp";
import { registerRenderGate } from "./rendergate";
import { registerViewCheck } from "./viewcheck";

const CONFIG_SECTION = "abap2ui5";
const TEMPLATE_KEY = "launchUrlTemplate";
const OPEN_MODE_KEY = "openMode";
const RELOAD_KEY = "reloadOn";
/** Replaced by `reloadOn` in 0.9.0, still honoured while it is set. */
const LEGACY_RELOAD_KEY = "reloadOnSave";

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

/**
 * Message posted when the shown class was saved but not activated: the preview
 * still shows the active version, so it says so instead of reloading.
 */
function staleMessage(reason: string) {
  return { type: "stale" as const, reason };
}

/** When the preview reloads by itself. */
type ReloadTrigger = "activation" | "save" | "never";

function reloadTrigger(): ReloadTrigger {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const chosen = cfg.inspect<string>(RELOAD_KEY);
  const explicit =
    chosen?.workspaceFolderValue ?? chosen?.workspaceValue ?? chosen?.globalValue;
  if (explicit === "activation" || explicit === "save" || explicit === "never") {
    return explicit;
  }
  // Nothing set: keep honouring an explicit `reloadOnSave` from an older version.
  const legacy = cfg.inspect<boolean>(LEGACY_RELOAD_KEY);
  const legacyValue =
    legacy?.workspaceFolderValue ?? legacy?.workspaceValue ?? legacy?.globalValue;
  if (legacyValue === false) {
    return "never";
  }
  if (legacyValue === true) {
    return "save";
  }
  return "activation";
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
    if (this.target) {
      this.post(loadMessage(this.target, reason));
    }
  }

  /** Posts to the rendered preview; ignored while the welcome screen is up. */
  post(message: unknown): void {
    if (this.view && this.previewRendered) {
      void this.view.webview.postMessage(message);
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

let output: vscode.OutputChannel | undefined;

/** Writes to the "abap2UI5" output channel (View → Output). */
function log(message: string): void {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  output?.appendLine(`${stamp}  ${message}`);
}

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

/** Sends a message to whichever preview is showing (tab and/or panel). */
function postToShownApp(provider: PreviewViewProvider, message: unknown): void {
  if (appPanel) {
    void appPanel.webview.postMessage(message);
  }
  provider.post(message);
}

/** Reloads the app shown in tab or panel without moving the focus. */
function reloadShownApp(provider: PreviewViewProvider, reason?: string): void {
  if (!currentTarget) {
    return;
  }
  stopActivationWatch(); // whatever loads now is current, the badge clears
  postToShownApp(provider, loadMessage(currentTarget, reason));
  captureActivationBaseline(); // remember which state is shown from now on
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
  stopActivationWatch();
  currentTarget = { className, frameUrl, externalUrl };
  updateStatusItem();

  if (openMode === "panel") {
    await provider.show(currentTarget);
  } else {
    showInTab(context, currentTarget);
  }
  captureActivationBaseline();

  // Focus straight back to the same spot in the source.
  await restoreSourceFocus();
}

// ---------------------------------------------------------------------------
// Activate the ABAP object, then reload
// ---------------------------------------------------------------------------

/**
 * Activation commands of the ABAP extensions we know about, in the order they
 * are tried. Ctrl+F3 delegates to the first one that is actually installed.
 *
 * `abapfs.activate` is the ABAP remote filesystem extension; it activates the
 * object of the active editor and saves it first if it is dirty.
 */
const ABAP_ACTIVATE_COMMANDS = ["abapfs.activate"];

async function findAbapActivateCommand(): Promise<string | undefined> {
  const available = new Set(await vscode.commands.getCommands(true));
  return ABAP_ACTIVATE_COMMANDS.find((command) => available.has(command));
}

/**
 * Saves, activates through the installed ABAP tooling and reloads the preview.
 * Only the activation puts the new source on the server, which is why this -
 * and not a plain save - is what the preview reloads on.
 */
async function activateAndReload(provider: PreviewViewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const isAbap = editor?.document.languageId === "abap";
  const activateCommand = await findAbapActivateCommand();

  if (!activateCommand) {
    // Nothing to delegate to (the key binding is not active in this case, so
    // this is a deliberate call from the palette): reload what is shown and
    // say why nothing was activated.
    vscode.window.showInformationMessage(
      "abap2UI5: no ABAP extension with an activation command found - activate the class in your ABAP tooling, the preview only reloads."
    );
    if (currentTarget) {
      reloadShownApp(provider, "Reloaded");
    }
    return;
  }

  if (editor && isAbap && editor.document.isDirty) {
    await editor.document.save();
  }

  if (editor && isAbap) {
    rememberSource(editor);
  }

  try {
    // Hand over the exact document instead of relying on the tooling's
    // active-editor fallback. Note that at least abapfs.activate reports its
    // own failures and resolves anyway, so reaching the reload below does not
    // guarantee the activation worked — the server watch (see below) covers a
    // late activation after a failed first try.
    await vscode.commands.executeCommand(
      activateCommand,
      editor && isAbap && editor.document.uri.scheme === "adt"
        ? editor.document.uri
        : undefined
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      "abap2UI5: activation failed - " +
        (err instanceof Error ? err.message : String(err))
    );
    return;
  }

  if (!currentTarget) {
    return;
  }
  // Keep focus in the code in case the reloading app tries to grab it. The
  // window starts here: activating can take a moment.
  if (editor && isAbap) {
    bounceFocusUntil = Date.now() + 2500;
  }
  reloadShownApp(provider, "Reloaded after activation");
}

// ---------------------------------------------------------------------------
// Watch the server for the activation
// ---------------------------------------------------------------------------

// Ctrl+F3 reloads by itself, but an activation done any other way — the ABAP
// extension's own button or shortcut, even Eclipse — is invisible here:
// VS Code has no event for it and the ABAP extensions expose none. So while
// the preview is stale, the class is watched on the server instead. Two
// signals say the activation happened:
//
// - the ADT metadata's version flips from "inactive" back to "active", or
// - the class is "active" with a change timestamp NEWER than the version the
//   preview shows. This is what catches a save+activate done as one action:
//   on a fast system that can be finished before the first poll ever sees
//   the inactive state, so waiting for the flip alone would wait forever.
//
// The timestamp of the shown version (the baseline) is captured whenever the
// preview (re)loads. A source that never reaches the server changes neither
// signal, so nothing reloads for purely local files.

// The first look happens right after the save: the saved source is already
// on the server as an inactive version at that point (the save event fires
// once the filesystem write went through), while the activation - even one
// kicked off together with the save - still takes its server roundtrips.
// Looking early is what guarantees the inactive state is seen at all; an
// activation that finishes before the first look would otherwise be waited
// for forever.
const ACTIVATION_POLL_FIRST_MS = 250;
const ACTIVATION_POLL_MS = 1500;
const ACTIVATION_POLL_TIMEOUT_MS = 10 * 60 * 1000;

let activationWatchTimer: NodeJS.Timeout | undefined;
/** Bumped on every stop, so an in-flight poll of an old watch goes stale. */
let activationWatchGen = 0;
/** ADT answered 4xx: this system will not tell us, stop asking for good. */
let adtWatchUnavailable = false;

/** The proxy of this session, for baseline fetches outside command scope. */
let proxyRef: SapProxy | undefined;
/** Server changedAt of the version the preview currently shows. */
let baselineClass: string | undefined;
let baselineChangedAt: string | undefined;

function sapClientOf(externalUrl: string): string | undefined {
  try {
    return new URL(externalUrl).searchParams.get("sap-client") ?? undefined;
  } catch {
    return undefined;
  }
}

/** True when timestamp `a` is later than `b` (same-format fallback: differs). */
function isNewer(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!isNaN(ta) && !isNaN(tb)) {
    return ta > tb;
  }
  return a !== b;
}

/**
 * Remembers the server's change timestamp of the class the preview shows
 * right now. Fire-and-forget: without a baseline the watch still reloads on
 * an observed inactive→active flip, just not on a too-fast-to-see one.
 */
function captureActivationBaseline(): void {
  const proxy = proxyRef;
  if (!currentTarget || !proxy || !proxy.isRunning || adtWatchUnavailable) {
    return;
  }
  const className = currentTarget.className;
  void proxy
    .fetchClassState(className, sapClientOf(currentTarget.externalUrl))
    .then(
      (state) => {
        baselineClass = className;
        baselineChangedAt = state.changedAt;
        log(
          `activation watch: shown ${className} was last changed ` +
            `${state.changedAt ?? "at an unknown time"}`
        );
      },
      () => {
        // No baseline; the inactive→active flip still triggers the reload.
      }
    );
}

function stopActivationWatch(): void {
  activationWatchGen++;
  if (activationWatchTimer) {
    clearTimeout(activationWatchTimer);
    activationWatchTimer = undefined;
  }
}

function startActivationWatch(
  proxy: SapProxy,
  provider: PreviewViewProvider
): void {
  stopActivationWatch();
  if (!currentTarget) {
    return;
  }
  if (adtWatchUnavailable) {
    log("activation watch: not started - ADT already refused earlier this session");
    return;
  }
  if (!proxy.isRunning) {
    log("activation watch: not started - no auth proxy (openMode external?)");
    return;
  }
  const gen = activationWatchGen;
  const className = currentTarget.className;
  const deadline = Date.now() + ACTIVATION_POLL_TIMEOUT_MS;
  const sapClient = sapClientOf(currentTarget.externalUrl);
  log(
    `activation watch: started for ${className}` +
      (sapClient ? ` (client ${sapClient})` : "")
  );
  let sawInactive = false;
  let lastSeen: string | undefined; // last logged answer, to log changes only

  const tick = async (): Promise<void> => {
    activationWatchTimer = undefined;
    if (gen !== activationWatchGen) {
      return;
    }
    if (!currentTarget || currentTarget.className !== className) {
      return; // preview gone or showing another app
    }
    let state: AdtClassState | undefined;
    try {
      state = await proxy.fetchClassState(className, sapClient);
    } catch (err) {
      if (err instanceof AdtStatusError && err.status >= 400 && err.status < 500) {
        // Not authorized / not exposed: it will not start answering later.
        adtWatchUnavailable = true;
        log(
          `activation watch: ADT answered ${err.status} - giving up for this ` +
            "session (is /sap/bc/adt active on the launch-URL host?)"
        );
        return;
      }
      // network hiccup or 5xx: try again
      const reason = err instanceof Error ? err.message : String(err);
      if (lastSeen !== `error:${reason}`) {
        lastSeen = `error:${reason}`;
        log(`activation watch: request failed (${reason}) - retrying`);
      }
    }
    if (gen !== activationWatchGen) {
      return;
    }
    if (state) {
      const version = state.version;
      if (version === undefined) {
        log(
          "activation watch: the ADT answer contained no version - stopping " +
            "(unexpected service behind /sap/bc/adt?)"
        );
        return;
      }
      if (version === "inactive" && !sawInactive) {
        sawInactive = true;
        log(`activation watch: ${className} is inactive on the server`);
      }
      if (version === "active") {
        // Newer change timestamp than the shown version = the save arrived
        // AND was activated, even when both were too fast to ever observe
        // the inactive state.
        const baseline =
          baselineClass === className ? baselineChangedAt : undefined;
        const changedSinceShown =
          !!state.changedAt && !!baseline && isNewer(state.changedAt, baseline);
        if (sawInactive || changedSinceShown) {
          log(
            `activation watch: ${className} is active ` +
              (sawInactive ? "again" : `with a newer change (${state.changedAt})`) +
              " - reloading"
          );
          reloadShownApp(provider, "Reloaded after activation");
          return;
        }
        if (lastSeen !== "active") {
          log(
            `activation watch: ${className} still shows no change on the ` +
              "server - waiting" +
              (baseline ? ` (shown state: ${baseline})` : " (no baseline)")
          );
        }
      }
      lastSeen = version;
    }
    if (Date.now() < deadline) {
      activationWatchTimer = setTimeout(() => void tick(), ACTIVATION_POLL_MS);
    } else {
      log("activation watch: no activation within 10 minutes - giving up, reload manually");
    }
  };
  activationWatchTimer = setTimeout(() => void tick(), ACTIVATION_POLL_FIRST_MS);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PreviewViewProvider();
  const proxy = new SapProxy();
  proxyRef = proxy;

  output = vscode.window.createOutputChannel("abap2UI5");
  context.subscriptions.push(output);
  // First line of every session: which build is actually running.
  log(
    `extension ${String(context.extension.packageJSON.version ?? "?")} activated`
  );

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
    { dispose: () => stopActivationWatch() },
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
    vscode.commands.registerCommand("abap2ui5.activate", () =>
      activateAndReload(provider)
    ),
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
    // Shown app's class saved. A save alone does not change anything on the
    // server - the object has to be activated - so by default the preview only
    // says so instead of reloading.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId !== "abap" || !currentTarget) {
        return;
      }
      if (!appPanel && !provider.isShowing) {
        return;
      }
      const trigger = reloadTrigger();
      if (trigger === "never") {
        return;
      }
      if (!APP_INTERFACE_RE.test(doc.getText())) {
        return;
      }
      if (resolveClassName(doc) !== currentTarget.className) {
        return;
      }
      if (trigger === "activation") {
        postToShownApp(provider, staleMessage("Saved - activate to update"));
        // Notice the activation itself — however it is done — and reload
        // then. Deliberately not limited to a URI scheme: whichever way the
        // source reaches the server, the server knows whether an inactive
        // version exists.
        startActivationWatch(proxy, provider);
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

  registerViewCheck(context, log);
  registerRenderGate(context, log);
  registerMcp(context, log);
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
