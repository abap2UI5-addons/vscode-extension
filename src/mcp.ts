import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/*
 * MCP server registration: exposes the abap2UI5 MCP server
 * (https://github.com/abap2UI5/ai-mcp) to every MCP client in this VS Code
 * window - Copilot agent mode, Claude Code, or any other extension speaking
 * MCP. The server gives agents the full abap2UI5 dev loop without an SAP
 * system: capability queries, static view validation, deploy, transpiled
 * build, headless run with screenshot.
 *
 * The server orchestrates sibling checkouts (abap2UI5, ai-demokit,
 * abap2UI5-linter). Point `abap2ui5.mcp.reposRoot` at the folder containing
 * them and the matching *_HOME environment variables are passed along.
 */

const CONFIG_SECTION = "abap2ui5";
const PROVIDER_ID = "abap2ui5.mcp";

/** Repo-name -> env var the server resolves it with (see ai-mcp lib/repos.mjs,
 *  whose VIEW_CHECK_DIRS this mirrors). `linter` is the checker's own
 *  repository name; the two after it are what a clone made under its earlier
 *  names is called. */
const HOME_VARS: ReadonlyArray<readonly [string, string]> = [
  ["abap2UI5", "A2UI5_HOME"],
  ["ai-demokit", "AI_DEMOKIT_HOME"],
  ["linter", "AI_VIEW_CHECK_HOME"],
  ["abap2UI5-linter", "AI_VIEW_CHECK_HOME"],
  ["ai-view-check", "AI_VIEW_CHECK_HOME"],
];

function config() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/** The command that starts the server: an explicit setting wins; a local
 *  checkout under the repos root is preferred; npx from GitHub is the
 *  fallback. */
function serverCommand(): string[] {
  const explicit = config().get<string>("mcp.command", "").trim();
  if (explicit) {
    return explicit.split(/\s+/);
  }
  const root = config().get<string>("mcp.reposRoot", "").trim();
  if (root) {
    const server = path.join(root, "ai-mcp", "server.mjs");
    if (fs.existsSync(server)) {
      return ["node", server];
    }
  }
  return ["npx", "--yes", "github:abap2UI5/ai-mcp"];
}

function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const root = config().get<string>("mcp.reposRoot", "").trim();
  if (root) {
    for (const [repo, envVar] of HOME_VARS) {
      if (env[envVar]) {
        continue; // first match wins - the new directory name over the legacy one
      }
      const dir = path.join(root, repo);
      if (fs.existsSync(dir)) {
        env[envVar] = dir;
      }
    }
  }
  return env;
}

export function registerMcp(
  context: vscode.ExtensionContext,
  log: (m: string) => void
): void {
  // The MCP API arrived in VS Code 1.101 - keep working (minus MCP) on older
  // builds instead of failing activation.
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== "function") {
    log("mcp: this VS Code has no MCP server definition API - skipping");
    return;
  }

  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(
    changed,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.mcp`)) {
        changed.fire();
      }
    }),
    vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => {
        if (!config().get<boolean>("mcp.enabled", true)) {
          return [];
        }
        const [command, ...args] = serverCommand();
        const definition = new vscode.McpStdioServerDefinition(
          "abap2UI5",
          command,
          args,
          serverEnv()
        );
        log(`mcp: providing server definition - ${command} ${args.join(" ")}`);
        return [definition];
      },
    })
  );
  log("mcp: server definition provider registered");
}
