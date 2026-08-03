/*
 * The repo-level linter config, `abap2ui5lint.jsonc`.
 *
 * The linter's CLI and its GitHub Action honour that file, so CI checks a
 * repository against the UI5 floor, the distribution and the rule overrides
 * that repository pins. The editor used to read only the VS Code settings,
 * which meant the same file could be clean here and red in CI — the drift
 * AGENTS.md warned about. The config wins wherever it says something, because
 * CI is what has to pass; the settings fill in the rest.
 *
 * `vscode`-free: the settings come in as plain data, so the merge is a pure
 * function the test suite can drive.
 */

import * as fs from "fs";
import { findConfigFrom, loadConfig } from "@abap2ui5/linter/config";

/** The knobs both the config file and the VS Code settings can set. */
export interface CheckOptions {
  minUi5: string;
  distribution: string;
  allow: string[];
  /** Per-rule severity overrides / switch-offs, as the linter interprets it. */
  rules?: Record<string, unknown>;
  /** The config file the values came from, for the output channel. */
  configFile?: string;
  /** Set when a config file was found but could not be read. */
  error?: string;
}

/** What the extension's own settings contribute. */
export interface SettingsOptions {
  minUi5: string;
  distribution: string;
  allow: string[];
}

interface CacheEntry {
  mtimeMs: number;
  loaded: Record<string, unknown>;
  error?: string;
}

const cache = new Map<string, CacheEntry>();

/** Forget everything — the config file changed on disk. */
export function clearConfigCache(): void {
  cache.clear();
}

/**
 * Reads a config file, memoised on its mtime: the check runs on every
 * keystroke once live checking is on, and re-parsing JSONC that often would
 * be the one avoidable cost in the whole path.
 */
function readConfig(file: string): CacheEntry {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    // gone since discovery — fall through and let loadConfig report it
  }
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached;
  }
  let entry: CacheEntry;
  try {
    entry = { mtimeMs, loaded: loadConfig(file) as Record<string, unknown> };
  } catch (err) {
    // A broken config is reported, never silently ignored: the linter itself
    // refuses to run on one, and pretending it is not there would mean the
    // editor checks against something CI does not.
    entry = {
      mtimeMs,
      loaded: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
  cache.set(file, entry);
  return entry;
}

/** The config file governing `dir`, searching upward — the linter's own
 *  discovery, so editor and CLI find the same file. */
export function findConfigFile(dir: string | undefined): string | undefined {
  if (!dir) {
    return undefined;
  }
  try {
    return findConfigFrom(dir) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The options one document is checked with: the repo config where it speaks,
 * the VS Code settings everywhere else. `allow` is the exception — the two
 * lists merge, because a repo-wide allowance and a personal one are both
 * meant. That is how the CLI treats it too.
 */
export function resolveOptions(
  dir: string | undefined,
  settings: SettingsOptions
): CheckOptions {
  const file = findConfigFile(dir);
  if (!file) {
    return { ...settings };
  }
  const { loaded, error } = readConfig(file);
  if (error) {
    return { ...settings, configFile: file, error };
  }
  return {
    minUi5: (loaded.minUi5 as string) ?? settings.minUi5,
    distribution: (loaded.distribution as string) ?? settings.distribution,
    allow: [...new Set([...(loaded.allow as string[] | undefined ?? []), ...settings.allow])],
    rules: loaded.rules as Record<string, unknown> | undefined,
    configFile: file,
  };
}

/** One line for the output channel describing where the check's settings came
 *  from — the first question when the editor and CI disagree. */
export function describeOptions(options: CheckOptions): string {
  const dist = options.distribution === "openui5" ? "OpenUI5" : "SAPUI5";
  const from = options.configFile
    ? options.error
      ? `${options.configFile} (unreadable: ${options.error}) - using the VS Code settings`
      : options.configFile
    : "VS Code settings";
  return `target ${dist} ${options.minUi5}, from ${from}`;
}
