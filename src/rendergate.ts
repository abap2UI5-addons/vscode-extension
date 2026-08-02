import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import * as tar from "tar";

/*
 * Self-installing render gate: downloads the self-contained checker bundle
 * (CLI + OpenUI5 runtime + playwright, published as a rolling release by
 * ai-view-check's CI) into the extension's global storage and fetches
 * Chromium through playwright's own CLI - everything runs with VS Code's
 * bundled Node.js, so no node, npm or PATH setup is required on the
 * machine.
 */

const BUNDLE_URL =
  "https://github.com/abap2UI5/ai-view-check/releases/download/render-gate-bundle/view-check-bundle.tgz";

let installing = false;

function baseDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "render-gate");
}

/** Path of the installed checker CLI, or undefined when not installed. */
export function renderGateCli(
  context: vscode.ExtensionContext
): string | undefined {
  const cli = path.join(baseDir(context), "cli.mjs");
  return fs.existsSync(cli) ? cli : undefined;
}

/** The browsers directory the installed gate uses (PLAYWRIGHT_BROWSERS_PATH). */
export function renderGateBrowsers(context: vscode.ExtensionContext): string {
  return path.join(baseDir(context), "browsers");
}

function runWithVsCodeNode(
  args: string[],
  extraEnv: Record<string, string>,
  log: (m: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...extraEnv },
    });
    let stderr = "";
    child.stdout.on("data", (c) => {
      const line = String(c).trim();
      if (line) {
        log(`render-gate: ${line.slice(0, 200)}`);
      }
    });
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`exit code ${code}${stderr ? `: ${stderr.slice(0, 300)}` : ""}`))
    );
  });
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed - HTTP ${res.status} for ${url}`);
  }
  await pipeline(
    Readable.fromWeb(res.body as import("stream/web").ReadableStream),
    fs.createWriteStream(dest)
  );
}

/** Download the checker bundle and Chromium into global storage. Returns
 *  true when the gate is ready afterwards. */
export async function installRenderGate(
  context: vscode.ExtensionContext,
  log: (m: string) => void
): Promise<boolean> {
  if (installing) {
    return false;
  }
  installing = true;
  const dir = baseDir(context);
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "abap2UI5: installing the render gate",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "downloading the checker bundle (~30 MB)..." });
        log(`render-gate: installing to ${dir}`);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        const tgz = path.join(dir, "bundle.tgz");
        await download(BUNDLE_URL, tgz);

        progress.report({ message: "extracting..." });
        await tar.x({ file: tgz, cwd: dir });
        fs.rmSync(tgz, { force: true });
        if (!fs.existsSync(path.join(dir, "cli.mjs"))) {
          throw new Error("bundle did not contain cli.mjs");
        }

        progress.report({
          message: "downloading Chromium for headless rendering (one time)...",
        });
        await runWithVsCodeNode(
          [
            path.join(dir, "node_modules", "playwright", "cli.js"),
            "install",
            "chromium",
          ],
          { PLAYWRIGHT_BROWSERS_PATH: renderGateBrowsers(context) },
          log
        );

        log("render-gate: installed");
        await vscode.workspace
          .getConfiguration("abap2ui5")
          .update("viewCheck.render", true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          "abap2UI5: render gate installed - from now on view checks also " +
            "render the view in headless Chromium."
        );
        return true;
      }
    );
  } catch (err) {
    log(`render-gate: install failed - ${String(err)}`);
    fs.rmSync(dir, { recursive: true, force: true });
    vscode.window.showErrorMessage(
      `abap2UI5: render gate install failed (${String(err).slice(0, 120)}). ` +
        "Details in the abap2UI5 output channel."
    );
    return false;
  } finally {
    installing = false;
  }
}

/** One-time offer to install the gate; shown when the render gate is wanted
 *  (or would be useful) but nothing is installed. */
export async function offerInstall(
  context: vscode.ExtensionContext,
  log: (m: string) => void,
  reason: string
): Promise<void> {
  const pick = await vscode.window.showInformationMessage(
    `abap2UI5: ${reason}`,
    "Install render gate",
    "Not now"
  );
  if (pick === "Install render gate") {
    await installRenderGate(context, log);
  }
}

export function registerRenderGate(
  context: vscode.ExtensionContext,
  log: (m: string) => void
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("abap2ui5.installRenderGate", () =>
      installRenderGate(context, log)
    )
  );
}
