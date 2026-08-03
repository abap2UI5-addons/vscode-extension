import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { clearConfigCache, describeOptions, resolveOptions } from "../lintconfig";

const SETTINGS = { minUi5: "1.71", distribution: "sapui5", allow: ["sap.m.X.y"] };

/** A throwaway workspace with one config file in it. */
function workspace(config?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abap2ui5-lintconfig-"));
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, "abap2ui5lint.jsonc"), config);
  }
  clearConfigCache();
  return dir;
}

test("without a config file the VS Code settings are used as they are", () => {
  const options = resolveOptions(workspace(), SETTINGS);
  assert.equal(options.minUi5, "1.71");
  assert.equal(options.configFile, undefined);
  assert.match(describeOptions(options), /VS Code settings/);
});

test("the repo config wins - that is what CI checks against", () => {
  const dir = workspace(`{
    // the floor this repository pins
    "ui5": "1.120",
    "distribution": "openui5",
  }`);
  const options = resolveOptions(dir, SETTINGS);
  assert.equal(options.minUi5, "1.120");
  assert.equal(options.distribution, "openui5");
  assert.match(describeOptions(options), /OpenUI5 1\.120/);
});

test("the allow lists merge, because both allowances are meant", () => {
  const dir = workspace('{ "allow": ["sap.m.GenericTile.systemInfo"] }');
  const options = resolveOptions(dir, SETTINGS);
  assert.deepEqual(options.allow.sort(), [
    "sap.m.GenericTile.systemInfo",
    "sap.m.X.y",
  ]);
});

test("a rules block is handed through for the severity overrides", () => {
  const dir = workspace('{ "rules": { "missing-accessibility": false } }');
  const options = resolveOptions(dir, SETTINGS);
  assert.deepEqual(options.rules, { "missing-accessibility": false });
});

test("the config is discovered from a subdirectory upward", () => {
  const dir = workspace('{ "ui5": "1.108" }');
  const nested = path.join(dir, "src", "z2ui5");
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(resolveOptions(nested, SETTINGS).minUi5, "1.108");
});

test("a broken config is reported, not silently ignored", () => {
  const dir = workspace('{ "ui5": "not-a-version" }');
  const options = resolveOptions(dir, SETTINGS);
  assert.ok(options.error, "expected the parse error to be carried");
  assert.equal(options.minUi5, "1.71", "falls back to the settings");
  assert.match(describeOptions(options), /unreadable/);
});
