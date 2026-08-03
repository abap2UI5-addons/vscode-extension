import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expandTemplate,
  isUsableTemplate,
  normalizeUrl,
  originOf,
  sapClientOf,
  shortUrl,
  withParams,
} from "../urls";

const TEMPLATE = "https://host:44300/sap/bc/z2ui5?app_start={class}&sap-client=100";

test("the protocol survives slash collapsing", () => {
  assert.equal(
    normalizeUrl("https://host//sap//bc/z2ui5"),
    "https://host/sap/bc/z2ui5"
  );
});

test("the class placeholder is replaced upper-cased and encoded", () => {
  assert.equal(
    expandTemplate(TEMPLATE, "zcl_my_app"),
    "https://host:44300/sap/bc/z2ui5?app_start=ZCL_MY_APP&sap-client=100"
  );
  assert.equal(expandTemplate("https://h/{CLASS}", "zcl_a"), "https://h/ZCL_A");
});

test("the toolbar label keeps host and path only", () => {
  assert.equal(shortUrl(expandTemplate(TEMPLATE, "zcl_a")), "host:44300/sap/bc/z2ui5");
  assert.equal(shortUrl("not a url"), "not a url");
});

test("theme and language are set and removed as plain parameters", () => {
  const url = expandTemplate(TEMPLATE, "zcl_a");
  const dark = withParams(url, { "sap-ui-theme": "sap_horizon_dark" });
  assert.ok(dark.includes("sap-ui-theme=sap_horizon_dark"));
  // An empty value means "back to the system default", not "set it to empty".
  const back = withParams(dark, { "sap-ui-theme": undefined });
  assert.equal(back.includes("sap-ui-theme"), false);
  assert.ok(back.includes("app_start=ZCL_A"));
});

test("the sap-client is read off the launch URL for the ADT lookups", () => {
  assert.equal(sapClientOf(expandTemplate(TEMPLATE, "zcl_a")), "100");
  assert.equal(sapClientOf("https://host/sap/bc/z2ui5"), undefined);
  assert.equal(sapClientOf("nonsense"), undefined);
});

test("the origin is what the proxy is started for", () => {
  assert.equal(originOf(TEMPLATE), "https://host:44300");
  assert.equal(originOf("nonsense"), undefined);
});

test("a template is usable only with a placeholder and a real URL", () => {
  assert.ok(isUsableTemplate(TEMPLATE));
  assert.equal(isUsableTemplate(""), false);
  assert.equal(isUsableTemplate("https://host/sap/bc/z2ui5"), false, "no placeholder");
  assert.equal(isUsableTemplate("host/{class}"), false, "not a URL");
});
