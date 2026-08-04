import { test } from "node:test";
import assert from "node:assert/strict";
import type { ViewNode } from "@abap2ui5/linter/reconstruct";
import { prettyDocument, prettyXml } from "../xmlformat";

const node = (
  name: string | null,
  attrs: Array<[string, string]> = [],
  children: ViewNode[] = [],
  ns: string | null = null
): ViewNode => ({ name, ns, attrs, children });

test("nesting becomes indentation", () => {
  const view = node("View", [["xmlns", "sap.m"]], [
    node("Page", [["title", "Hello"]], [node("Text", [["text", "Hi"]])]),
  ]);
  assert.equal(
    prettyXml(view),
    [
      `<View xmlns="sap.m">`,
      `  <Page title="Hello">`,
      `    <Text text="Hi"/>`,
      `  </Page>`,
      `</View>`,
    ].join("\n")
  );
});

test("the synthetic root wrapper is invisible", () => {
  const wrapped = node(null, [], [node("Text", [["text", "Hi"]])]);
  assert.equal(prettyXml(wrapped), `<Text text="Hi"/>`);
});

test("many attributes wrap to one per line, xmlns first", () => {
  const view = node("View", [
    ["controllerName", "a.long.controller.name.that.pushes.past.the.limit"],
    ["xmlns:mvc", "sap.ui.core.mvc"],
    ["displayBlock", "true"],
  ]);
  const lines = prettyXml(view).split("\n");
  assert.equal(lines[0], "<View");
  assert.ok(lines[1].trim().startsWith("xmlns:mvc="), "namespaces first");
  assert.ok(lines[lines.length - 1].trim().endsWith("/>"));
});

test("attribute values are escaped", () => {
  const view = node("Text", [["text", `a < b & "c"`]]);
  assert.equal(prettyXml(view), `<Text text="a &lt; b &amp; &quot;c&quot;"/>`);
});

test("a namespaced control keeps its prefix", () => {
  const view = node("Card", [], [], "f");
  assert.equal(prettyXml(view), `<f:Card/>`);
});

test("two views are labelled, one is not", () => {
  const one = prettyDocument([node("Text")], "ZCL_ONE");
  assert.ok(one.includes("ZCL_ONE"));
  assert.ok(!one.includes("view 1 of"));
  const two = prettyDocument([node("Text"), node("Text")], "ZCL_TWO");
  assert.ok(two.includes("view 1 of 2"));
  assert.ok(two.includes("view 2 of 2"));
});
