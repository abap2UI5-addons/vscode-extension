import * as vscode from "vscode";
import { SapProxy } from "./proxy";

/*
 * "Which UI5 does this system actually run?" - answered by the system.
 *
 * `abap2ui5.viewCheck.minUi5` and `.distribution` decide what the property
 * gate reports, and both are usually guessed. The system can answer: the UI5
 * distribution it serves ships `sap-ui-version.json`, and the proxy already
 * holds credentials for the host. So after the first launch against a system
 * the extension looks once, and when the answer disagrees with the settings
 * it offers - once per system and answer - to adopt it. Silence on every
 * failure path: a system not serving the file simply keeps the settings.
 */

/** Where the served UI5 publishes its version - the ABAP paths first. */
const VERSION_PATHS = [
  "/sap/public/bc/ui5_ui5/resources/sap-ui-version.json",
  "/sap/bc/ui5_ui5/resources/sap-ui-version.json",
  "/resources/sap-ui-version.json",
];

interface Ui5VersionInfo {
  /** `major.minor`, e.g. `1.120` - the granularity minUi5 works in. */
  minor: string;
  /** Only claimed when the libraries list is present to judge from. */
  distribution?: "sapui5" | "openui5";
}

function parseVersionJson(body: string): Ui5VersionInfo | undefined {
  try {
    const json = JSON.parse(body) as {
      version?: string;
      libraries?: Array<{ name?: string }>;
    };
    const m = /^(\d+)\.(\d+)/.exec(String(json.version ?? ""));
    if (!m) {
      return undefined;
    }
    const libraries = Array.isArray(json.libraries) ? json.libraries : [];
    return {
      minor: `${m[1]}.${m[2]}`,
      // sap.ui.comp is the marker: SAPUI5 ships it, OpenUI5 does not.
      distribution: libraries.length
        ? libraries.some((lib) => lib.name === "sap.ui.comp")
          ? "sapui5"
          : "openui5"
        : undefined,
    };
  } catch {
    return undefined;
  }
}

/** The detected version, kept visible - guessing it once was the problem. */
let statusItem: vscode.StatusBarItem | undefined;

function showStatus(
  context: vscode.ExtensionContext,
  origin: string,
  info: Ui5VersionInfo
): void {
  if (!statusItem) {
    statusItem = vscode.window.createStatusBarItem(
      "abap2ui5.ui5version",
      vscode.StatusBarAlignment.Left,
      49 // right next to the running-app item
    );
    statusItem.name = "abap2UI5 UI5 version";
    context.subscriptions.push(statusItem);
  }
  statusItem.text = `UI5 ${info.minor}`;
  statusItem.tooltip = new vscode.MarkdownString(
    `**${origin}** serves UI5 ${info.minor}` +
      (info.distribution ? ` (${info.distribution})` : "") +
      `\n\nClick to open the view-check settings.`
  );
  statusItem.command = {
    title: "Open settings",
    command: "workbench.action.openSettings",
    arguments: ["abap2ui5.viewCheck"],
  };
  statusItem.show();
}

/**
 * Looks up the system's UI5 version and, when it disagrees with the
 * settings, offers once to adopt it. Fire-and-forget from the launch path.
 */
export async function suggestSystemUi5(
  context: vscode.ExtensionContext,
  proxy: SapProxy,
  origin: string,
  log: (m: string) => void
): Promise<void> {
  let info: Ui5VersionInfo | undefined;
  for (const path of VERSION_PATHS) {
    try {
      const { status, body } = await proxy.fetchFromSystem(
        path,
        "application/json, */*"
      );
      if (status === 200) {
        info = parseVersionJson(body);
        if (info) {
          break;
        }
      }
    } catch {
      // network trouble - the launch already surfaces that where it matters
    }
  }
  if (!info) {
    return;
  }
  log(
    `ui5-detect: ${origin} serves UI5 ${info.minor}` +
      (info.distribution ? ` (${info.distribution})` : "")
  );
  showStatus(context, origin, info);

  const cfg = vscode.workspace.getConfiguration("abap2ui5");
  const setMin = cfg.get<string>("viewCheck.minUi5", "1.71");
  const setDist = cfg.get<string>("viewCheck.distribution", "sapui5");
  const mismatches: string[] = [];
  if (info.minor !== setMin) {
    mismatches.push(`minUi5 ${setMin} → ${info.minor}`);
  }
  if (info.distribution && info.distribution !== setDist) {
    mismatches.push(`distribution ${setDist} → ${info.distribution}`);
  }
  if (!mismatches.length) {
    return;
  }

  // One offer per system and answer - a decline is not asked again.
  const stateKey = `abap2ui5.ui5detect:${origin}:${info.minor}:${info.distribution ?? "?"}`;
  if (context.globalState.get<boolean>(stateKey)) {
    return;
  }
  const pick = await vscode.window.showInformationMessage(
    `abap2UI5: this system serves UI5 ${info.minor}` +
      (info.distribution ? ` (${info.distribution})` : "") +
      `, but the view check is set to ${setMin} (${setDist}). ` +
      "Check against what the system runs?",
    "Adopt",
    "Keep settings"
  );
  if (!pick) {
    return; // dismissed - ask again another session
  }
  await context.globalState.update(stateKey, true);
  if (pick !== "Adopt") {
    return;
  }
  if (info.minor !== setMin) {
    await cfg.update(
      "viewCheck.minUi5",
      info.minor,
      vscode.ConfigurationTarget.Global
    );
  }
  if (info.distribution && info.distribution !== setDist) {
    await cfg.update(
      "viewCheck.distribution",
      info.distribution,
      vscode.ConfigurationTarget.Global
    );
  }
  log(`ui5-detect: settings updated (${mismatches.join(", ")})`);
}
