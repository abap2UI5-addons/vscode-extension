import { test } from "node:test";
import assert from "node:assert/strict";
import { previewHtml, welcomeHtml } from "../webview";

const BASE = { nonce: "n0nce", hasLaunchUrl: true } as const;

test("the preview carries the runtime-error badge, reset on every load", () => {
  const html = previewHtml({
    frameUrl: "http://127.0.0.1:1234/sap/bc/z2ui5?app_start=ZCL_X",
    externalUrl: "https://host:44300/sap/bc/z2ui5?app_start=ZCL_X",
    className: "ZCL_X",
    theme: "",
    language: "",
    modelRoots: ["MT_ITEMS"],
    nonce: "n0nce",
  });
  assert.ok(html.includes('id="errors"'));
  // The roundtrip badge and the traffic log behind it.
  assert.ok(html.includes('id="rt"'));
  assert.ok(html.includes("showTraffic"));
  // Stateful reload: the pin, the capture command and the restore.
  assert.ok(html.includes('id="pin"'));
  assert.ok(html.includes("model-restore"));
  assert.ok(html.includes("'restore'"));
  assert.ok(html.includes('["MT_ITEMS"]'));
  // The screenshot button relays to the host command.
  assert.ok(html.includes('id="shot"'));
  assert.ok(html.includes("screenshot"));
  // The relay: the marked iframe messages reach the host as runtimeError.
  assert.ok(html.includes("__abap2ui5Runtime"));
  assert.ok(html.includes("runtimeError"));
  // A reload starts a clean count.
  assert.ok(html.includes("setErrorCount(0)"));
  // Inspect and model talk INTO the iframe and relay the answers out.
  assert.ok(html.includes('id="inspect"'));
  assert.ok(html.includes('id="model"'));
  assert.ok(html.includes("__abap2ui5Cmd"));
  assert.ok(html.includes("inspected"));
  assert.ok(html.includes("appModel"));
});

test("in panel mode the empty state promises the app right here", () => {
  const html = welcomeHtml({ ...BASE, openMode: "panel" });
  assert.ok(html.includes("Your app runs here"));
  assert.ok(html.includes("the app opens here"));
  // Nothing to move: the panel is already where F9 opens.
  assert.ok(!html.includes("abap2ui5.previewInPanel"));
});

test("in tab mode it says where the app really opens, and offers the move", () => {
  const html = welcomeHtml({ ...BASE, openMode: "tab" });
  assert.ok(html.includes("F9 opens your app in an editor tab"));
  assert.ok(html.includes("abap2ui5.previewInPanel"));
});

test("external mode names the browser, not a tab", () => {
  const html = welcomeHtml({ ...BASE, openMode: "external" });
  assert.ok(html.includes("F9 opens your app in your browser"));
  assert.ok(html.includes("abap2ui5.previewInPanel"));
});

test("a running app replaces the first-run steps with where it is", () => {
  const html = welcomeHtml({
    ...BASE,
    openMode: "tab",
    runningClass: "ZCL_MY_APP",
  });
  assert.ok(html.includes("ZCL_MY_APP"));
  assert.ok(html.includes("is running in an editor tab"));
  assert.ok(html.includes("abap2ui5.revealApp"));
  // The steps are for starting an app - one is already running.
  assert.ok(!html.includes("<ol>"));
});

test("without a launch URL the first step is still the launch URL", () => {
  const html = welcomeHtml({ ...BASE, hasLaunchUrl: false, openMode: "tab" });
  assert.ok(html.includes("abap2ui5.setLaunchUrl"));
  assert.ok(!html.includes("abap2ui5.selectSystem"));
});

test("the class name is escaped, not injected", () => {
  const html = welcomeHtml({
    ...BASE,
    openMode: "tab",
    runningClass: "<img src=x onerror=alert(1)>",
  });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});
