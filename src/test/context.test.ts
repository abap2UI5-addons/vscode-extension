import { test } from "node:test";
import assert from "node:assert/strict";
import { abapContextAt, abapNsMap, xmlContextAt, xmlNsMap } from "../context";

/** The cursor is marked with `‸` in the fixtures - easier to read than an
 *  offset, and it keeps the fixture and the position from drifting apart. */
function at(marked: string) {
  const offset = marked.indexOf("‸");
  assert.notEqual(offset, -1, "the fixture needs a ‸ for the cursor");
  return { source: marked.replace("‸", ""), offset };
}

function abapAt(marked: string) {
  const { source, offset } = at(marked);
  return abapContextAt(source, offset);
}

function xmlAt(marked: string) {
  const { source, offset } = at(marked);
  return xmlContextAt(source, offset);
}

const HEAD =
  "DATA(view) = z2ui5_cl_ai_xml=>factory( ).\n" +
  "view->open( n = `View` ns = `mvc`\n" +
  "    )->a( n = `xmlns` v = `sap.m`\n" +
  "    )->a( n = `xmlns:f` v = `sap.f`\n";

test("the xmlns declarations are read out of the builder calls", () => {
  assert.deepEqual(abapNsMap(HEAD), { "": "sap.m", f: "sap.f" });
  // The attribute-list spelling says the same thing.
  assert.deepEqual(abapNsMap("a = VALUE #( ( `xmlns:l=sap.ui.layout` ) )"), {
    l: "sap.ui.layout",
  });
});

test("a control name completes against the default namespace", () => {
  const context = abapAt(HEAD + "    )->leaf( n = `Butt‸` )");
  assert.equal(context?.kind, "control");
  assert.equal(context?.library, "sap.m");
  assert.equal(context?.prefix, "Butt");
});

test("the ns argument decides the library", () => {
  const context = abapAt(HEAD + "    )->leaf( n = `Ca‸` ns = `f` )");
  assert.equal(context?.kind, "control");
  assert.equal(context?.library, "sap.f");
});

test("a prefix baked into the name wins, and only the local part is replaced", () => {
  const { source, offset } = at(HEAD + "    )->leaf( n = `f:Ca‸` )");
  const context = abapContextAt(source, offset);
  assert.equal(context?.library, "sap.f");
  assert.equal(context?.prefix, "Ca");
  assert.equal(source.slice(context!.start, context!.end), "Ca");
});

test("a member belongs to the control the a( ) is chained to", () => {
  const context = abapAt(HEAD + "    )->leaf( n = `Button` )->a( n = `te‸` )");
  assert.equal(context?.kind, "member");
  assert.equal(context?.control, "sap.m.Button");
});

test("a second a( ) still belongs to the same control", () => {
  const context = abapAt(
    HEAD + "    )->leaf( n = `Button` )->a( n = `text` v = `Hi` )->a( n = `ty‸` )"
  );
  assert.equal(context?.kind, "member");
  assert.equal(context?.control, "sap.m.Button");
});

test("a value knows both the control and the member it belongs to", () => {
  const context = abapAt(HEAD + "    )->leaf( n = `Button` )->a( n = `type` v = `Emph‸` )");
  assert.equal(context?.kind, "value");
  assert.equal(context?.control, "sap.m.Button");
  assert.equal(context?.member, "type");
});

test("a control inside a comment is never the owner", () => {
  const context = abapAt(
    HEAD +
      "    )->leaf( n = `Button` )\n" +
      '    " )->leaf( n = `Table` ) - the old version\n' +
      "    view->a( n = `te‸` )"
  );
  assert.equal(context?.control, "sap.m.Button");
});

test("a builder call quoted inside a string is not a call", () => {
  const context = abapAt(
    HEAD +
      "    )->leaf( n = `Button` )\n" +
      "    DATA(note) = `->leaf( n = ~Table~ )`.\n".replace(/~/g, "'") +
      "    view->a( n = `te‸` )"
  );
  assert.equal(context?.control, "sap.m.Button");
});

test("a quotation mark inside a string template does not start a comment", () => {
  // Without template handling the `"` swallows the rest of the line, the
  // call never closes, and every context after it is wrong.
  const context = abapAt(
    HEAD +
      "    )->leaf( n = `Text` )->a( n = `text` v = |He said \"hi\"| )\n" +
      "    )->leaf( n = `Button` )->a( n = `te‸` )"
  );
  assert.equal(context?.kind, "member");
  assert.equal(context?.control, "sap.m.Button");
});

test("the ns argument itself completes to the declared prefixes", () => {
  const context = abapAt(HEAD + "    )->leaf( n = `Card` ns = `‸` )");
  assert.equal(context?.kind, "namespace");
});

test("outside a literal there is nothing to offer", () => {
  assert.equal(abapAt(HEAD + "    )->leaf( n = `Button` )‸ "), undefined);
  assert.equal(abapAt("DATA(x) = ‸1."), undefined);
});

test("raw XML: the tag name, an attribute and a value", () => {
  const head = '<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc" xmlns:f="sap.f">\n';
  const tag = xmlAt(head + "  <Butt‸");
  assert.equal(tag?.kind, "control");
  assert.equal(tag?.library, "sap.m");

  const prefixed = xmlAt(head + "  <f:Ca‸");
  assert.equal(prefixed?.library, "sap.f");

  const attribute = xmlAt(head + '  <Button te‸');
  assert.equal(attribute?.kind, "member");
  assert.equal(attribute?.control, "sap.m.Button");

  const value = xmlAt(head + '  <Button type="Emph‸"');
  assert.equal(value?.kind, "value");
  assert.equal(value?.control, "sap.m.Button");
  assert.equal(value?.member, "type");
});

test("raw XML: between two tags there is nothing to offer", () => {
  assert.deepEqual(xmlNsMap('<mvc:View xmlns="sap.m">'), { "": "sap.m" });
  assert.equal(xmlAt('<mvc:View xmlns="sap.m">\n  ‸\n</mvc:View>'), undefined);
});
