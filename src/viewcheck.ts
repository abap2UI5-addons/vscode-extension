import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

/*
 * Static view validation through ai-view-check
 * (https://github.com/abap2UI5/ai-view-check): every control and property
 * written in a view is resolved against a UI5 metadata snapshot (the
 * property gate), optionally followed by a headless XMLView.create render.
 * Findings are surfaced as editor diagnostics - a typo'd property or a
 * control newer than the UI5 floor shows up before the app ever reaches a
 * system.
 */

const CONFIG_SECTION = "abap2ui5";
const DIAG_SOURCE = "abap2UI5 view-check";

/** ABAP classes are only checkable when they build views with the generic builder. */
const BUILDER_RE = /z2ui5_cl_ai_xml/i;

const VIEW_XML_RE = /\.(view|fragment)\.xml$/i;

interface Finding {
  type: string;
  control?: string;
  member?: string;
  since?: string;
  minUi5?: string;
  deprecated?: string | boolean;
}

interface CheckResult {
  file: string;
  kind: string;
  usesBuilder: boolean;
  findings: Finding[];
  renderErrors: string[];
  skippedRender: boolean;
  helperTokens: number;
  notes: string[];
}

interface CheckReport {
  files: number;
  failing: number;
  skipped: number;
  results: CheckResult[];
}

/** Set when spawning the checker failed once - avoids a warning on every save. */
let spawnFailed = false;

let running = false;

function config() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/**
 * The command used to run the checker. An explicit setting wins; otherwise a
 * local `ai-view-check` checkout next to the configured repos root is
 * preferred (fast, no download), falling back to npx fetching the published
 * source from GitHub.
 */
function checkerCommand(): string[] {
  const explicit = config().get<string>("viewCheck.command", "").trim();
  if (explicit) {
    return explicit.split(/\s+/);
  }
  const root = config().get<string>("mcp.reposRoot", "").trim();
  if (root) {
    const cli = path.join(root, "ai-view-check", "cli.mjs");
    if (fs.existsSync(cli)) {
      return ["node", cli];
    }
  }
  return ["npx", "--yes", "github:abap2UI5/ai-view-check"];
}

function isCheckable(doc: vscode.TextDocument): boolean {
  if (VIEW_XML_RE.test(doc.fileName)) {
    return true;
  }
  return doc.languageId === "abap" && BUILDER_RE.test(doc.getText());
}

/** Best-effort mapping of a finding to a source position: the member (or the
 *  control's local name) appears literally in the checked file - in raw XML
 *  and equally in the string literals of a builder class. */
function findingRange(doc: vscode.TextDocument, needle: string): vscode.Range {
  if (needle) {
    const text = doc.getText();
    const ix = text.search(
      new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
    );
    if (ix >= 0) {
      const start = doc.positionAt(ix);
      return new vscode.Range(start, doc.positionAt(ix + needle.length));
    }
  }
  return doc.lineAt(0).range;
}

function findingMessage(f: Finding): string {
  if (f.type === "control-too-new") {
    return `${f.control} is @since ${f.since} - newer than the ${f.minUi5} UI5 floor`;
  }
  if (f.type === "control-deprecated") {
    return `${f.control} is deprecated${f.deprecated ? ` (${String(f.deprecated).slice(0, 120)})` : ""}`;
  }
  return `${f.control} ${f.member} is @since ${f.since} - newer than the ${f.minUi5} UI5 floor`;
}

function toDiagnostics(
  doc: vscode.TextDocument,
  result: CheckResult
): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];
  for (const f of result.findings) {
    const local = (f.control ?? "").split(".").pop() ?? "";
    const d = new vscode.Diagnostic(
      findingRange(doc, f.member || local),
      findingMessage(f),
      vscode.DiagnosticSeverity.Warning
    );
    d.source = DIAG_SOURCE;
    d.code = f.member ? `${f.control}.${f.member}` : f.control;
    diags.push(d);
  }
  for (const e of result.renderErrors) {
    const d = new vscode.Diagnostic(
      doc.lineAt(0).range,
      `render: ${e.slice(0, 300)}`,
      vscode.DiagnosticSeverity.Error
    );
    d.source = DIAG_SOURCE;
    diags.push(d);
  }
  return diags;
}

function runChecker(
  args: string[],
  cwd: string,
  log: (m: string) => void
): Promise<CheckReport | undefined> {
  const [cmd, ...rest] = checkerCommand();
  const full = [...rest, ...args];
  log(`view-check: ${cmd} ${full.join(" ")}`);
  return new Promise((resolve) => {
    const child = spawn(cmd, full, { cwd, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("error", (err) => {
      log(`view-check: failed to start - ${String(err)}`);
      if (!spawnFailed) {
        spawnFailed = true;
        vscode.window.showWarningMessage(
          `abap2UI5: could not start the view checker (${cmd}). ` +
            "Set abap2ui5.viewCheck.command to a working command - " +
            "see the abap2UI5 output channel for details."
        );
      }
      resolve(undefined);
    });
    child.on("close", () => {
      // --advisory keeps the exit code at 0; findings live in the JSON
      const start = stdout.indexOf("{");
      if (start < 0) {
        log(`view-check: no JSON in output${stderr ? ` - stderr: ${stderr.slice(0, 400)}` : ""}`);
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(stdout.slice(start)) as CheckReport);
      } catch (err) {
        log(`view-check: broken JSON output - ${String(err)}`);
        resolve(undefined);
      }
    });
  });
}

async function checkDocument(
  doc: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection,
  log: (m: string) => void,
  announce: boolean
): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    const cfg = config();
    const args = [doc.fileName, "--json", "--advisory"];
    args.push("--min-ui5", cfg.get<string>("viewCheck.minUi5", "1.71"));
    if (!cfg.get<boolean>("viewCheck.render", false)) {
      args.push("--no-render");
    }
    for (const allow of cfg.get<string[]>("viewCheck.allow", [])) {
      args.push("--allow", allow);
    }
    const cwd =
      vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ??
      path.dirname(doc.fileName);
    const report = await runChecker(args, cwd, log);
    if (!report) {
      return;
    }
    const result = report.results[0];
    if (!result) {
      diagnostics.delete(doc.uri);
      return;
    }
    const diags = toDiagnostics(doc, result);
    diagnostics.set(doc.uri, diags);
    const skipNote = result.skippedRender
      ? " (render gate skipped - view built in helper methods)"
      : "";
    log(
      `view-check: ${path.basename(doc.fileName)} - ` +
        `${result.findings.length} finding(s), ${result.renderErrors.length} render error(s)${skipNote}`
    );
    if (announce) {
      if (diags.length === 0) {
        vscode.window.showInformationMessage(
          `abap2UI5: view check passed for ${path.basename(doc.fileName)}${skipNote}.`
        );
      } else {
        vscode.window.showWarningMessage(
          `abap2UI5: view check found ${diags.length} problem(s) in ` +
            `${path.basename(doc.fileName)} - see the Problems panel.`
        );
      }
    }
  } finally {
    running = false;
  }
}

export function registerViewCheck(
  context: vscode.ExtensionContext,
  log: (m: string) => void
): void {
  const diagnostics =
    vscode.languages.createDiagnosticCollection("abap2ui5-view-check");

  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand("abap2ui5.checkViews", async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || !isCheckable(doc)) {
        vscode.window.showInformationMessage(
          "abap2UI5: open an ABAP class that builds views with " +
            "z2ui5_cl_ai_xml (or a *.view.xml file) to check it."
        );
        return;
      }
      if (doc.isDirty) {
        await doc.save();
      }
      await checkDocument(doc, diagnostics, log, true);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!config().get<boolean>("viewCheck.onSave", true)) {
        return;
      }
      if (spawnFailed || !isCheckable(doc)) {
        return;
      }
      void checkDocument(doc, diagnostics, log, false);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri))
  );
}
