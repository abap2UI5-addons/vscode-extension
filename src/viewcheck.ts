import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { checkAbapRules } from "@abap2ui5/linter/abap-rules";
import { prepareAbap } from "@abap2ui5/linter/reconstruct";
import { checkNodes, parseXml, PropertyFinding } from "@abap2ui5/linter/properties";
import {
  annotate,
  applyDirectives,
  applyRules,
  describe,
  RULES,
  severityOf,
} from "@abap2ui5/linter/findings";
import { installRenderGate, renderGateBrowsers, renderGateCli } from "./rendergate";
import { snapshot, snapshotError, snapshotUi5Version } from "./snapshot";
import { usesBuilder } from "./abap";
import {
  CheckOptions,
  clearConfigCache,
  describeOptions,
  resolveOptions,
} from "./lintconfig";

/*
 * Static view validation through abap2UI5-linter
 * (https://github.com/abap2UI5/linter).
 *
 * The property gate runs INSIDE the extension: the checker library and its
 * UI5 metadata snapshot are bundled, so unknown controls (typos), controls
 * or properties introduced after the configured target UI5 version and
 * deprecations already in effect there show up as diagnostics with zero
 * setup - no node, npx or network involved. Being in-process is also what
 * makes checking while typing affordable.
 *
 * Only the optional render gate (a real XMLView.create in headless
 * Chromium) needs the external linter CLI, because it serves the
 * OpenUI5 runtime from its own node_modules and drives a browser. It never
 * runs on a keystroke - only on save and on demand.
 */

const CONFIG_SECTION = "abap2ui5";
const DIAG_SOURCE = "abap2UI5-linter";

/** The published rule reference - one anchor per rule id, which is what makes
 *  every diagnostic's code clickable. */
const RULES_PAGE = "https://abap2ui5.github.io/linter/";

const VIEW_XML_RE = /\.(view|fragment)\.xml$/i;

/** How long to wait after the last keystroke before checking. Long enough
 *  that typing a control name does not flash three different errors, short
 *  enough to feel immediate. */
const LIVE_DEBOUNCE_MS = 400;

interface RenderResult {
  renderErrors: string[];
  skippedRender: boolean;
}

/** Set when spawning the external render checker failed once - avoids a
 *  warning on every save. */
let spawnFailed = false;

/** The target/metadata versions are logged once per session, and again
 *  whenever they change (a different config file governs the document). */
let lastVersionLine = "";

/** Set by registerViewCheck - checkerCommand needs the extension's global
 *  storage to find a self-installed render gate. */
let extContext: vscode.ExtensionContext | undefined;

function config() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
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
  return usesBuilder(doc.getText());
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

/** The directory the repo config is discovered from: the document's own
 *  folder, so a multi-root workspace resolves per file, exactly like the CLI
 *  invoked in that directory would. */
function discoveryDir(doc: vscode.TextDocument): string | undefined {
  if (doc.uri.scheme === "file") {
    return path.dirname(doc.uri.fsPath);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function optionsFor(doc: vscode.TextDocument): CheckOptions {
  const cfg = config();
  return resolveOptions(discoveryDir(doc), {
    minUi5: cfg.get<string>("viewCheck.minUi5", "1.71"),
    distribution: cfg.get<string>("viewCheck.distribution", "sapui5"),
    allow: cfg.get<string[]>("viewCheck.allow", []),
  });
}

// ---------------------------------------------------------------------------
// Findings -> diagnostics
// ---------------------------------------------------------------------------

/** What to underline: the member name, the control's local name, or - for
 *  the findings that are about a value rather than a member - that value. */
function needleOf(f: PropertyFinding): string {
  if (f.type === "unknown-binding-path" || f.type === "event-without-handler") {
    return String(f.value ?? "").replace(/^\//, "");
  }
  return f.member || (f.control ?? "").split(".").pop() || "";
}

/** The linter records where each finding came from, so the diagnostic goes
 *  exactly there: the recorded line, and on it the first occurrence of the
 *  name at or after the recorded column - the a( ) call carries the name a
 *  few characters further right than the token the gate matched. Findings
 *  the linter could not place (a view part inlined from a helper method)
 *  keep the old best-effort search: the first textual match in the file. */
function findingRange(doc: vscode.TextDocument, f: PropertyFinding): vscode.Range {
  const needle = needleOf(f);
  if (typeof f.line === "number" && f.line >= 1 && f.line <= doc.lineCount) {
    const lineNo = f.line - 1;
    const line = doc.lineAt(lineNo);
    const col = Math.max(0, Math.min((f.column ?? 1) - 1, line.text.length));
    const ix = needle ? line.text.indexOf(needle, col) : -1;
    if (ix >= 0) {
      return new vscode.Range(lineNo, ix, lineNo, ix + needle.length);
    }
    return new vscode.Range(new vscode.Position(lineNo, col), line.range.end);
  }
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

/* The linter owns the severity of every finding type and the wording that
 * goes with it (@abap2ui5/linter/findings) - both used to be kept a second
 * time here, which is how the two drifted apart. `hint` becomes
 * Information rather than DiagnosticSeverity.Hint: Hint diagnostics stay
 * out of the Problems panel, and a finding nobody can see is not a hint. */
const DIAGNOSTIC_SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  hint: vscode.DiagnosticSeverity.Information,
} as const;

/** The rules whose subject really is a deprecation - VS Code strikes the
 *  underlined text through for them, which says it better than any wording. */
const DEPRECATION_RULES = new Set(["control-deprecated", "member-deprecated"]);

/** The diagnostic code: the rule id, linked to its section on the published
 *  rule reference. Ctrl+click in the Problems panel then explains what the
 *  rule means and what the fix looks like - the paragraph that never fits in
 *  a one-line message. */
function diagnosticCode(
  type: string
): string | { value: string; target: vscode.Uri } {
  if (!RULES.includes(type)) {
    return type;
  }
  return { value: type, target: vscode.Uri.parse(`${RULES_PAGE}#${type}`) };
}

function toDiagnostics(
  doc: vscode.TextDocument,
  findings: PropertyFinding[],
  renderErrors: string[]
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  for (const f of findings) {
    const d = new vscode.Diagnostic(
      findingRange(doc, f),
      f.message ?? describe(f),
      DIAGNOSTIC_SEVERITY[f.severity ?? severityOf(f)]
    );
    d.source = DIAG_SOURCE;
    d.code = diagnosticCode(f.type);
    if (DEPRECATION_RULES.has(f.type)) {
      d.tags = [vscode.DiagnosticTag.Deprecated];
    }
    diagnostics.push(d);
  }
  for (const e of renderErrors) {
    const d = new vscode.Diagnostic(
      doc.lineAt(0).range,
      `render: ${e.slice(0, 300)}`,
      vscode.DiagnosticSeverity.Error
    );
    d.source = DIAG_SOURCE;
    d.code = "render-error";
    diagnostics.push(d);
  }
  return diagnostics;
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
    // `linter` is the checker's own repository name; the two after it are what
    // a clone made under its earlier names is called (see ai-mcp lib/repos.mjs)
    for (const dir of ["linter", "abap2UI5-linter", "ai-view-check"]) {
      const cli = path.join(root, dir, "cli.mjs");
      if (fs.existsSync(cli)) {
        return { cmd: "node", args: [cli], env: {}, installed: true };
      }
    }
  }
  return {
    cmd: "npx",
    args: ["--yes", "github:abap2UI5/linter"],
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
// The property gate itself - in-process, no I/O, safe to run on a keystroke
// ---------------------------------------------------------------------------

interface GateResult {
  findings: PropertyFinding[];
  /** True when the source is one the render gate could load as a whole. */
  renderable: boolean;
  /** Set when nothing was validated - the caller must not claim a pass. */
  nothingChecked?: string;
  helperNote: string;
}

/**
 * Runs every in-process rule over one source and returns the surviving
 * findings: after the repo config's `rules` block (severity overrides and
 * switch-offs) and after the source's own `abap2ui5lint-disable…` directives.
 * Both of those are what the CLI and the GitHub Action apply, and leaving
 * them out here is what used to make a waived line squiggle in the editor
 * anyway.
 */
function runGate(
  text: string,
  fileName: string,
  isXml: boolean,
  options: CheckOptions
): GateResult {
  const { minUi5, distribution, allow } = options;
  const data = snapshot();
  let findings: PropertyFinding[] = [];
  let renderable = true;
  let helperNote = "";

  if (isXml) {
    findings.push(
      ...checkNodes(parseXml(text), { data, minUi5, allow, distribution })
    );
  } else {
    const prep = prepareAbap(text);
    if (!prep.usesBuilder) {
      return {
        findings: [],
        renderable: false,
        helperNote: "",
        nothingChecked: "no z2ui5_cl_ai_xml=>factory call found",
      };
    }
    if (prep.nodes.length === 0) {
      // usesBuilder matched, but nothing was reconstructable - saying
      // "passed" here would claim a validation that never happened
      return {
        findings: [],
        renderable: false,
        helperNote: "",
        nothingChecked: "builder call found but no view could be reconstructed",
      };
    }
    for (const node of prep.nodes) {
      // the model derived from the class is what makes the binding-path
      // rules possible - a path nothing in the model has stays silently
      // empty at runtime, and without passing it those rules never run
      findings.push(
        ...checkNodes(node, {
          data,
          minUi5,
          allow,
          distribution,
          model: prep.model,
          shape: prep.modelShape,
        })
      );
    }
    // rules that need the class itself, not just the view tree
    findings.push(...checkAbapRules(text));
    renderable = prep.docs.length > 0 && prep.helperTokens === 0;
    if (prep.helperTokens > 0) {
      helperNote = " (render gate skipped - view built in helper methods)";
    }
  }

  // severity, wording and the line/column behind each recorded offset - the
  // directives are keyed by line, so this has to happen before they are
  // applied
  annotate(findings, text);
  findings = applyRules(findings, options.rules, fileName);
  findings = applyDirectives(findings, text);
  return { findings, renderable, helperNote };
}

/**
 * The findings of a document as it stands right now, memoised on its version.
 *
 * The quick-fix provider needs them, and it must not work off the findings
 * behind the diagnostics currently shown: a fix carries character offsets into
 * the source it was computed from, and between the last check and the moment
 * the lightbulb is opened the buffer may have moved. Recomputing is a few
 * milliseconds - applying a stale offset would corrupt the file.
 */
let memo: { key: string; version: number; findings: PropertyFinding[] } | undefined;

export function findingsNow(doc: vscode.TextDocument): PropertyFinding[] {
  const key = doc.uri.toString();
  if (memo && memo.key === key && memo.version === doc.version) {
    return memo.findings;
  }
  if (!isCheckable(doc)) {
    // Code actions are requested for every ABAP file the cursor moves in;
    // reconstructing a view from one that builds none is pure cost.
    return [];
  }
  const text = doc.getText();
  const isXml = VIEW_XML_RE.test(doc.fileName) || /^\s*</.test(text);
  const gate = runGate(text, doc.uri.fsPath || doc.fileName, isXml, optionsFor(doc));
  memo = { key, version: doc.version, findings: gate.findings };
  return gate.findings;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

interface CheckRequest {
  /** Allow the external render gate (never on a keystroke). */
  render: boolean;
  /** Say the result out loud - only the on-demand command does. */
  announce: boolean;
}

/** Debounce timers and run generations, both per document. The old global
 *  "one check at a time" flag silently dropped the second of two quick saves;
 *  a generation per URI supersedes only the run it replaces. */
const timers = new Map<string, NodeJS.Timeout>();
const generations = new Map<string, number>();

function schedule(
  doc: vscode.TextDocument,
  delay: number,
  request: CheckRequest,
  diagnostics: vscode.DiagnosticCollection,
  log: (m: string) => void
): void {
  const key = doc.uri.toString();
  const existing = timers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void checkDocument(doc, diagnostics, log, request);
    }, delay)
  );
}

function cancelScheduled(uri: vscode.Uri): void {
  const key = uri.toString();
  const timer = timers.get(key);
  if (timer) {
    clearTimeout(timer);
    timers.delete(key);
  }
  // Any run still in flight for this document is now stale.
  generations.set(key, (generations.get(key) ?? 0) + 1);
}

async function checkDocument(
  doc: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection,
  log: (m: string) => void,
  request: CheckRequest
): Promise<void> {
  const key = doc.uri.toString();
  const gen = (generations.get(key) ?? 0) + 1;
  generations.set(key, gen);
  const superseded = () => generations.get(key) !== gen;

  const options = optionsFor(doc);
  const versionLine = describeOptions(options);
  if (versionLine !== lastVersionLine) {
    lastVersionLine = versionLine;
    log(
      `view-check: ${versionLine}, metadata from ${snapshotUi5Version() ?? "unknown"}`
    );
    const broken = snapshotError();
    if (broken) {
      log(
        `view-check: the bundled UI5 metadata could not be read (${broken}) - ` +
          "the property gate has nothing to check against"
      );
    }
  }
  if (options.error && request.announce) {
    vscode.window.showWarningMessage(
      `abap2UI5: ${path.basename(options.configFile ?? "abap2ui5lint.jsonc")} ` +
        `could not be read (${options.error}) - checking with the VS Code settings instead.`
    );
  }

  const text = doc.getText();
  const name = path.basename(doc.fileName);
  const isXml = VIEW_XML_RE.test(doc.fileName) || /^\s*</.test(text);
  const gate = runGate(text, doc.uri.fsPath || name, isXml, options);

  if (gate.nothingChecked) {
    diagnostics.delete(doc.uri);
    log(`view-check: ${name} - nothing checkable (${gate.nothingChecked})`);
    if (request.announce) {
      vscode.window.showInformationMessage(
        `abap2UI5: nothing to check in ${name} - ${gate.nothingChecked}.`
      );
    }
    return;
  }

  let helperNote = gate.helperNote;
  let renderErrors: string[] = [];
  if (
    request.render &&
    config().get<boolean>("viewCheck.render", false) &&
    gate.renderable &&
    !spawnFailed
  ) {
    const render = await runRenderGate(doc, log);
    if (superseded()) {
      return; // the document moved on while Chromium was busy
    }
    renderErrors = render?.renderErrors ?? [];
    if (render?.skippedRender) {
      helperNote = " (render gate skipped - view built in helper methods)";
    }
  }

  const diags = toDiagnostics(doc, gate.findings, renderErrors);
  diagnostics.set(doc.uri, diags);
  log(
    `view-check: ${name} - ${gate.findings.length} finding(s), ` +
      `${renderErrors.length} render error(s)${helperNote}`
  );
  if (request.announce) {
    if (diags.length === 0) {
      vscode.window.showInformationMessage(
        `abap2UI5: view check passed for ${name}${helperNote}.`
      );
    } else {
      vscode.window.showWarningMessage(
        `abap2UI5: view check found ${diags.length} problem(s) in ` +
          `${name} - see the Problems panel.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Whole workspace
// ---------------------------------------------------------------------------

/** File patterns the workspace sweep looks at - the same shapes the CLI
 *  collects. */
const WORKSPACE_GLOB = "**/*.{abap,view.xml,fragment.xml}";

/**
 * Checks every checkable file in the workspace, the way CI does, and fills
 * the Problems panel with the result. The on-save check only ever sees what
 * someone happened to open; this is the answer to "will the linter gate pass
 * before I push?".
 */
async function checkWorkspace(
  diagnostics: vscode.DiagnosticCollection,
  log: (m: string) => void
): Promise<void> {
  const files = await vscode.workspace.findFiles(
    WORKSPACE_GLOB,
    "**/{node_modules,.git,dist,out}/**"
  );
  if (!files.length) {
    vscode.window.showInformationMessage(
      "abap2UI5: no ABAP or view files found in this workspace."
    );
    return;
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "abap2UI5: checking views",
      cancellable: true,
    },
    async (progress, token) => {
      let checked = 0;
      let problems = 0;
      for (const [index, uri] of files.entries()) {
        if (token.isCancellationRequested) {
          break;
        }
        progress.report({
          message: `${index + 1}/${files.length} - ${path.basename(uri.fsPath)}`,
          increment: 100 / files.length,
        });
        let text: string;
        try {
          text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
        } catch {
          continue;
        }
        const isXml = VIEW_XML_RE.test(uri.fsPath);
        if (!isXml && !usesBuilder(text)) {
          continue;
        }
        const options = resolveOptions(path.dirname(uri.fsPath), {
          minUi5: config().get<string>("viewCheck.minUi5", "1.71"),
          distribution: config().get<string>("viewCheck.distribution", "sapui5"),
          allow: config().get<string[]>("viewCheck.allow", []),
        });
        const gate = runGate(text, uri.fsPath, isXml, options);
        if (gate.nothingChecked) {
          continue;
        }
        checked++;
        // The file is opened as a text document so the finding ranges are
        // computed against real lines, exactly like the on-save check does.
        const doc = await vscode.workspace.openTextDocument(uri);
        const diags = toDiagnostics(doc, gate.findings, []);
        diagnostics.set(uri, diags);
        problems += diags.length;
      }
      log(`view-check: workspace sweep - ${checked} file(s), ${problems} problem(s)`);
      vscode.window.showInformationMessage(
        problems
          ? `abap2UI5: ${problems} problem(s) in ${checked} file(s) - see the Problems panel.`
          : `abap2UI5: ${checked} file(s) checked, nothing found.`
      );
    }
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerViewCheck(
  context: vscode.ExtensionContext,
  log: (m: string) => void
): void {
  extContext = context;
  const diagnostics =
    vscode.languages.createDiagnosticCollection("abap2ui5-view-check");

  const check = (doc: vscode.TextDocument, delay: number, request: CheckRequest) =>
    schedule(doc, delay, request, diagnostics, log);

  /** Re-checks everything currently open - after a setting, a config file or
   *  the linter's own opinion changed. */
  const recheckOpen = () => {
    for (const editor of vscode.window.visibleTextEditors) {
      if (isCheckable(editor.document)) {
        check(editor.document, 0, { render: false, announce: false });
      }
    }
  };

  // A config file is part of the answer for every file it governs, so a
  // change to one invalidates the cache and re-checks what is open.
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    "**/abap2ui5lint.{json,jsonc}"
  );
  const configChanged = () => {
    clearConfigCache();
    lastVersionLine = "";
    recheckOpen();
  };

  context.subscriptions.push(
    diagnostics,
    configWatcher,
    configWatcher.onDidChange(configChanged),
    configWatcher.onDidCreate(configChanged),
    configWatcher.onDidDelete(configChanged),
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },

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
      cancelScheduled(doc.uri);
      await checkDocument(doc, diagnostics, log, { render: true, announce: true });
    }),

    vscode.commands.registerCommand("abap2ui5.checkWorkspace", () =>
      checkWorkspace(diagnostics, log)
    ),

    // Saving is the moment the expensive gate is allowed to run.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!config().get<boolean>("viewCheck.onSave", true) || !isCheckable(doc)) {
        return;
      }
      check(doc, 0, { render: true, announce: false });
    }),

    // Typing: the property gate only, debounced. It is in-process and needs
    // no I/O, so the cost is a few milliseconds per pause.
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!config().get<boolean>("viewCheck.live", true)) {
        return;
      }
      if (!e.contentChanges.length || !isCheckable(e.document)) {
        return;
      }
      check(e.document, LIVE_DEBOUNCE_MS, { render: false, announce: false });
    }),

    // Opening a file should show what is wrong with it, without a save first.
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isCheckable(doc)) {
        check(doc, 0, { render: false, announce: false });
      }
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      cancelScheduled(doc.uri);
      diagnostics.delete(doc.uri);
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.viewCheck`)) {
        lastVersionLine = "";
        recheckOpen();
      }
    })
  );

  // Whatever is already open when the extension activates.
  recheckOpen();
}
