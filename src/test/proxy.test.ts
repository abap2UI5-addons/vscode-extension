import { test } from "node:test";
import assert from "node:assert/strict";
import { injectRuntimeHook } from "../proxy";

test("the hook lands right after <head>, before the UI5 bootstrap", () => {
  const html =
    `<!DOCTYPE html><html><head><script src="sap-ui-core.js"></script></head><body></body></html>`;
  const out = injectRuntimeHook(html);
  const hook = out.indexOf("__abap2ui5Runtime");
  assert.ok(hook > 0, "the hook is planted");
  assert.ok(hook < out.indexOf("sap-ui-core.js"), "and before the bootstrap");
  assert.ok(out.indexOf("<head>") < hook);
});

test("without a <head> the hook goes after <html>", () => {
  const out = injectRuntimeHook(`<html lang="en"><body>x</body></html>`);
  assert.ok(out.indexOf(`<html lang="en">`) < out.indexOf("__abap2ui5Runtime"));
  assert.ok(out.indexOf("__abap2ui5Runtime") < out.indexOf("<body>"));
});

test("a fragment that is still markup gets the hook in front", () => {
  const out = injectRuntimeHook(`<!doctype html><p>error page</p>`);
  assert.ok(out.startsWith("<script>"));
});

test("something that is not HTML at all stays untouched", () => {
  const body = `{"not": "html"}`;
  assert.equal(injectRuntimeHook(body), body);
});

test("the hook is injected once", () => {
  const out = injectRuntimeHook(`<html><head></head></html>`);
  assert.equal(out.split("abap2ui5-runtime-hook").length - 1, 1);
});

test("ADT search answers reduce to unique class names", () => {
  const { parseAdtClassNames } = require("../proxy") as typeof import("../proxy");
  const xml = `<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="x">
    <adtcore:objectReference adtcore:type="CLAS/OC" adtcore:name="ZCL_APP_ONE" adtcore:description="d"/>
    <adtcore:objectReference adtcore:name="ZCL_APP_TWO" adtcore:type="CLAS/OC"/>
    <adtcore:objectReference adtcore:type="PROG/P" adtcore:name="ZREPORT"/>
    <adtcore:objectReference adtcore:type="CLAS/OC" adtcore:name="ZCL_APP_ONE"/>
  </adtcore:objectReferences>`;
  assert.deepEqual(parseAdtClassNames(xml), ["ZCL_APP_ONE", "ZCL_APP_TWO"]);
});
