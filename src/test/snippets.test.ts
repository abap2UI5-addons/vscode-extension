import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { checkAbapRules } from "@abap2ui5/linter/abap-rules";
import { annotate, severityOf } from "@abap2ui5/linter/findings";
import { runGate } from "../gate";
import { snapshot } from "../snapshot";
import { usesBuilder } from "../abap";
import { APP_TEMPLATE } from "../template";
import { clientMethod } from "../clientapi";

/*
 * Every piece of ABAP the extension SHIPS - the snippets and the app
 * template - must pass the extension's own linter. This is the gate that
 * was missing when a snippet shipped `_bind_edit`: the method exists and
 * its parameters were right, but the linter's `obsolete-binder` rule (the
 * ecosystem convention) said otherwise, and nothing automated asked it.
 * Hand-written ABAP that goes out to users is corpus too.
 */

const SNIPPETS_FILE = path.join(
  __dirname,
  "..",
  "snippets",
  "abap2ui5.code-snippets"
);

interface Snippet {
  prefix: string;
  body: string[];
}

function loadSnippets(): Snippet[] {
  const raw = JSON.parse(fs.readFileSync(SNIPPETS_FILE, "utf8")) as Record<
    string,
    Snippet
  >;
  return Object.values(raw);
}

/** A snippet body as the editor would insert it: first choice for choices,
 *  the default text for placeholders, nothing for bare tab stops. */
function expand(body: string[]): string {
  return body
    .join("\n")
    .replace(/\$\{\d+\|([^|]*)\|\}/g, (_, choices: string) => choices.split(",")[0])
    .replace(/\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "")
    .replace(/\$\d+/g, "");
}

/** The attributes the snippet defaults reference, so the binding rules can
 *  resolve them instead of reporting the scaffold. */
const SCAFFOLD_HEAD = `CLASS zcl_snippet DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    TYPES: BEGIN OF ty_s_row,
             field TYPE string,
           END OF ty_s_row.
    DATA mt_data TYPE STANDARD TABLE OF ty_s_row WITH EMPTY KEY.
    DATA mv_value TYPE string.
ENDCLASS.
CLASS zcl_snippet IMPLEMENTATION.`;

const SCAFFOLD_FOOT = `ENDCLASS.`;

/** Wraps one expanded snippet into a complete class, by its shape. */
function wrap(expanded: string): string {
  if (/^CLASS\b/i.test(expanded)) {
    return expanded; // already a whole class (z2ui5app)
  }
  if (/^METHOD\b/i.test(expanded)) {
    // a whole method (z2ui5main)
    return `${SCAFFOLD_HEAD}\n${expanded}\n${SCAFFOLD_FOOT}`;
  }
  if (/^(open|leaf|a)\(/i.test(expanded)) {
    // a chain fragment - inserted where the corpus inserts it: after `)->`
    // inside a view being built
    return `${SCAFFOLD_HEAD}
  METHOD z2ui5_if_app~main.
    DATA(view) = z2ui5_cl_ai_xml=>factory( ).
    view->open( n = \`View\` ns = \`mvc\`
        )->a( n = \`xmlns\` v = \`sap.m\`
        )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\`
        )->open( n = \`Page\`
        )->${expanded}->shut( ).
    client->view_display( view->stringify( ) ).
  ENDMETHOD.
${SCAFFOLD_FOOT}`;
  }
  // whole statements (toast, popup, nav, the CASE dispatcher, the waiver)
  return `${SCAFFOLD_HEAD}
  METHOD z2ui5_if_app~main.
    ${expanded.split("\n").join("\n    ")}
  ENDMETHOD.
${SCAFFOLD_FOOT}`;
}

/** error/warning findings of a wrapped source - hints (advisories like
 *  missing-accessibility) do not fail a snippet, exactly as they do not
 *  fail CI. */
function gatingFindings(source: string): string[] {
  const data = snapshot();
  const findings = usesBuilder(source)
    ? runGate(source, "zcl_snippet.clas.abap", false, {
        minUi5: "1.71",
        distribution: "sapui5",
        allow: [],
      }).findings
    : annotate(checkAbapRules(source, { data }), source);
  return findings
    .filter((f) => (f.severity ?? severityOf(f)) !== "hint")
    .map((f) => `${f.type} (${f.member ?? f.value ?? f.control ?? ""})`);
}

test("every shipped snippet passes the bundled linter", () => {
  for (const snippet of loadSnippets()) {
    const findings = gatingFindings(wrap(expand(snippet.body)));
    assert.deepEqual(
      findings,
      [],
      `snippet ${snippet.prefix} does not pass the linter it ships with`
    );
  }
});

test("the app template passes the bundled linter", () => {
  const findings = gatingFindings(APP_TEMPLATE);
  assert.deepEqual(findings, []);
});

test("no shipped ABAP calls a method the interface marks obsolete", () => {
  // the linter catches _bind_edit specifically; this catches the whole
  // class of mistake - any client-> call whose abapdoc says obsolete
  const sources = [
    APP_TEMPLATE,
    ...loadSnippets().map((s) => expand(s.body)),
  ];
  for (const source of sources) {
    for (const m of source.matchAll(/client->(\w+)\s*\(/gi)) {
      const method = clientMethod(m[1]);
      assert.ok(
        !method?.obsolete,
        `shipped ABAP calls client->${m[1]}, which the interface marks obsolete`
      );
    }
  }
});
