import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { prepareAbap } from "@abap2ui5/linter/reconstruct";
import {
  checkNodes,
  loadSnapshot,
  parseXml,
  PropertyFinding,
} from "@abap2ui5/linter/properties";
import { installRenderGate, renderGateBrowsers, renderGateCli } from "./rendergate";

/*
 * Static view validation through abap2UI5-linter
 * (https://github.com/abap2UI5/abap2UI5-linter).
 *
 * The property gate runs INSIDE the extension: the checker library and its
 * UI5 metadata snapshot are bundled, so unknown controls (typos), controls
 * or properties newer than the configured UI5 floor and deprecations show
 * up as diagnostics with zero setup - no node, npx or network involved.
 *
 * Only the optional render gate (a real XMLView.create in headless
 * Chromium) needs the external linter CLI, because it serves the
 * OpenUI5 runtime from its own node_modules and drives a browser.
 */

const CONFIG_SECTION = "abap2ui5";
const DIAG_SOURCE = "abap2UI5-linter";

/** ABAP classes are only checkable when they build views with the generic
 *  builder - the same signal the checker itself uses. */
const FACTORY_RE = /z2ui5_cl_ai_xml=>factory/i;

const VIEW_XML_RE = /\.(view|fragment)\.xml$/i;

interface RenderResult {
  renderErrors: string[];
  skippedRender: boolean;
}

/** Set when spawning the external render checker failed once - avoids a
 *  warning on every save. */
let spawnFailed = false;

let running = false;

let snapshotCache: unknown;

/** Set by registerViewCheck - checkerCommand needs the extension's global
 *  storage to find a self-installed render gate. */
let extContext: vscode.ExtensionContext | undefined;

function config() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/** The bundled UI5 metadata snapshot - copied next to the bundle by the
 *  build (see esbuild.js). */
function snapshot(): unknown {
  if (snapshotCache === undefined) {
    snapshotCache = loadSnapshot(path.join(__dirname, "properties.json"));
  }
  return snapshotCache;
}

/** Checkable = a view/fragment XML, or an ABAP source calling the generic
 *  builder's factory. "ABAP source" means the abap language id or an *.abap
 *  file name - ABAP extensions differ in what they register, but a log or
 *  markdown file merely QUOTING builder code must not qualify. */
function isCheckable(doc: vscode.TextDocument): boolean {
  if (VIEW_XML_RE.test(doc.fileName)) {
    return true;
  }
  if (doc.languageId !== "abap" && !/\.abap$/i.test(doc.fileName)) {
    return false;
  }
  return FACTORY_RE.test(doc.getText());
}

/** The document to check on demand: the active editor when it is checkable,
 *  otherwise the first checkable visible editor - the command should work
 *  even when the focus sits in the preview or another non-text tab. */
function pickDocument(): vscode.TextDocument | undefined {
  const active = vscode.window.activeTextEditor?.document;
  if (active && isCheckable(active)) {
    return active;
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (isCheckable(editor.document)) {
      return editor.document;
    }
  }
  return active;
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

function findingMessage(f: PropertyFinding): string {
  if (f.type === "unknown-control") {
    return `${f.control} does not exist in UI5 - typo?`;
  }
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
  findings: PropertyFinding[],
  renderErrors: string[]
): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];
  for (const f of findings) {
    const local = (f.control ?? "").split(".").pop() ?? "";
    const d = new vscode.Diagnostic(
      findingRange(doc, f.member || local),
      findingMessage(f),
      f.type === "unknown-control"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning
    );
    d.source = DIAG_SOURCE;
    d.code = f.member ? `${f.control}.${f.member}` : f.control;
    diags.push(d);
  }
  for (const e of renderErrors) {
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

// ---------------------------------------------------------------------------
// External render gate (optional)
// ---------------------------------------------------------------------------

interface CheckerCommand {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  /** true when there is a real local installation to run - false means the
   *  npx fallback, which needs npm on the machine */
  installed: boolean;
}

/** The command used to run the external checker CLI for the render gate. An
 *  explicit setting wins; then a gate installed via "Install Render Gate";
 *  then a local linter checkout under the repos root (both run
 *  with VS Code's own Node.js); npx fetching from GitHub is the last
 *  resort. */
function checkerCommand(): CheckerCommand {
  const explicit = config().get<string>("viewCheck.command", "").trim();
  if (explicit) {
    const [cmd, ...args] = explicit.split(/\s+/);
    return { cmd, args, env: {}, installed: true };
  }
  if (extContext) {
    const cli = renderGateCli(extContext);
    if (cli) {
      return {
        cmd: "node",
        args: [cli],
        env: { PLAYWRIGHT_BROWSERS_PATH: renderGateBrowsers(extContext) },
        installed: true,
      };
    }
  }
  const root = config().get<string>("mcp.reposRoot", "").trim();
  if (root) {
    // ai-view-check is the checkout's pre-rename directory name
    for (const dir of ["abap2UI5-linter", "ai-view-check"]) {
      const cli = path.join(root, dir, "cli.mjs");
      if (fs.existsSync(cli)) {
        return { cmd: "node", args: [cli], env: {}, installed: true };
      }
    }
  }
  return {
    cmd: "npx",
    args: ["--yes", "github:abap2UI5/abap2UI5-linter"],
    env: {},
    installed: false,
  };
}

/** The extension host often runs with a minimal PATH (a GUI-launched VS Code
 *  on macOS misses /usr/local/bin and the Homebrew prefix) - the usual reason
 *  spawning npx fails. */
function spawnEnv(): NodeJS.ProcessEnv {
  if (process.platform === "win32") {
    return process.env;
  }
  const parts = (process.env.PATH ?? "").split(path.delimiter);
  for (const p of ["/usr/local/bin", "/opt/homebrew/bin"]) {
    if (!parts.includes(p)) {
      parts.push(p);
    }
  }
  return { ...process.env, PATH: parts.join(path.delimiter) };
}

/** The checker is a CLI working on files, but the document may be unsaved or
 *  not a file on disk at all (the `adt` scheme of the ABAP remote
 *  filesystem) - so the buffer is written to a scratch file first. The name
 *  matters: the checker only looks at `*.clas.abap` and view/fragment XML. */
function scratchFileFor(doc: vscode.TextDocument, dir: string): string {
  const base = path.basename(doc.fileName);
  if (VIEW_XML_RE.test(base) || base.endsWith(".clas.abap")) {
    return path.join(dir, base);
  }
  return path.join(dir, `${path.parse(base).name}.clas.abap`);
}

function runRenderGate(
  doc: vscode.TextDocument,
  log: (m: string) => void
): Promise<RenderResult | undefined> {
  const scratchDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "abap2ui5-viewcheck-")
  );
  const scratch = scratchFileFor(doc, scratchDir);
  fs.writeFileSync(scratch, doc.getText());

  const checker = checkerCommand();
  const args = [...checker.args, scratch, "--json", "--advisory", "--no-properties"];
  const cwd =
    vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? os.homedir();
  log(`view-check: render gate - ${checker.cmd} ${args.join(" ")}`);

  return new Promise((resolve) => {
    const done = (result: RenderResult | undefined) => {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      resolve(result);
    };
    const child =
      checker.cmd === "node"
        ? // run with the Node.js inside VS Code itself - works without any
          // node installation on the PATH
          spawn(process.execPath, args, {
            cwd,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...checker.env },
          })
        : spawn(checker.cmd, args, {
            cwd,
            env: { ...spawnEnv(), ...checker.env },
            shell: process.platform === "win32",
          });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("error", (err) => {
      log(`view-check: render gate failed to start - ${String(err)}`);
      if (!spawnFailed) {
        spawnFailed = true;
        void vscode.window
          .showWarningMessage(
            "abap2UI5: the render gate is enabled but its checker could not " +
              `be started (${checker.cmd} not found). Install it once - ` +
              "everything runs with VS Code's own runtime. The property " +
              "gate keeps working either way.",
            "Install render gate"
          )
          .then(async (pick) => {
            if (pick === "Install render gate" && extContext) {
              if (await installRenderGate(extContext, log)) {
                spawnFailed = false;
              }
            }
          });
      }
      done(undefined);
    });
    child.on("close", () => {
      const start = stdout.indexOf("{");
      if (start < 0) {
        log(
          `view-check: render gate produced no JSON` +
            (stderr ? ` - stderr: ${stderr.slice(0, 400)}` : "")
        );
        done(undefined);
        return;
      }
      try {
        const report = JSON.parse(stdout.slice(start)) as {
          results?: Array<{ renderErrors?: string[]; skippedRender?: boolean }>;
        };
        const r = report.results?.[0];
        done({
          renderErrors: r?.renderErrors ?? [],
          skippedRender: r?.skippedRender ?? false,
        });
      } catch (err) {
        log(`view-check: render gate returned broken JSON - ${String(err)}`);
        done(undefined);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// The check itself
// ---------------------------------------------------------------------------

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
    const minUi5 = cfg.get<string>("viewCheck.minUi5", "1.71");
    const allow = cfg.get<string[]>("viewCheck.allow", []);
    const text = doc.getText();
    const isXml = VIEW_XML_RE.test(doc.fileName) || /^\s*</.test(text);

    // property gate - in-process, instant
    const findings: PropertyFinding[] = [];
    let renderable = true;
    let helperNote = "";
    if (isXml) {
      findings.push(
        ...checkNodes(parseXml(text), { data: snapshot(), minUi5, allow })
      );
    } else {
      const prep = prepareAbap(text);
      if (!prep.usesBuilder) {
        diagnostics.delete(doc.uri);
        log(
          `view-check: ${path.basename(doc.fileName)} - nothing checkable ` +
            "(no z2ui5_cl_ai_xml=>factory call found)"
        );
        if (announce) {
          vscode.window.showInformationMessage(
            `abap2UI5: nothing to check in ${path.basename(doc.fileName)} - ` +
              "the checker looks for views built with z2ui5_cl_ai_xml=>factory."
          );
        }
        return;
      }
      if (prep.nodes.length === 0) {
        // usesBuilder matched, but nothing was reconstructable - saying
        // "passed" here would claim a validation that never happened
        diagnostics.delete(doc.uri);
        log(
          `view-check: ${path.basename(doc.fileName)} - builder call found ` +
            "but no view could be reconstructed, nothing was validated"
        );
        if (announce) {
          vscode.window.showInformationMessage(
            `abap2UI5: no view could be reconstructed from ` +
              `${path.basename(doc.fileName)} - nothing was validated.`
          );
        }
        return;
      }
      for (const node of prep.nodes) {
        findings.push(...checkNodes(node, { data: snapshot(), minUi5, allow }));
      }
      renderable = prep.docs.length > 0 && prep.helperTokens === 0;
      if (prep.helperTokens > 0) {
        helperNote =
          " (render gate skipped - view built in helper methods)";
      }
    }

    // render gate - optional, external
    let renderErrors: string[] = [];
    if (cfg.get<boolean>("viewCheck.render", false) && renderable && !spawnFailed) {
      const render = await runRenderGate(doc, log);
      renderErrors = render?.renderErrors ?? [];
      if (render?.skippedRender) {
        helperNote = " (render gate skipped - view built in helper methods)";
      }
    }

    const diags = toDiagnostics(doc, findings, renderErrors);
    diagnostics.set(doc.uri, diags);
    log(
      `view-check: ${path.basename(doc.fileName)} - ` +
        `${findings.length} finding(s), ${renderErrors.length} render error(s)${helperNote}`
    );
    if (announce) {
      if (diags.length === 0) {
        vscode.window.showInformationMessage(
          `abap2UI5: view check passed for ${path.basename(doc.fileName)}${helperNote}.`
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
  extContext = context;
  const diagnostics =
    vscode.languages.createDiagnosticCollection("abap2ui5-view-check");

  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand("abap2ui5.checkViews", async () => {
      const doc = pickDocument();
      if (!doc || !isCheckable(doc)) {
        log(
          doc
            ? `view-check: ${path.basename(doc.fileName)} is not checkable - ` +
                "not an ABAP source calling z2ui5_cl_ai_xml=>factory and " +
                "not a *.view.xml"
            : "view-check: no text editor open"
        );
        vscode.window.showInformationMessage(
          "abap2UI5: open an ABAP class that builds views with " +
            "z2ui5_cl_ai_xml (or a *.view.xml file) to check it."
        );
        return;
      }
      await checkDocument(doc, diagnostics, log, true);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!config().get<boolean>("viewCheck.onSave", true)) {
        return;
      }
      if (!isCheckable(doc)) {
        return;
      }
      void checkDocument(doc, diagnostics, log, false);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri))
  );
}
