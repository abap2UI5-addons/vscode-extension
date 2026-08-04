/*
 * Pretty-printer for the view trees the linter reconstructs out of an ABAP
 * class (`prepareAbap( ).nodes`).
 *
 * The linter's own `toXml( )` serialises for machines - one line, no
 * whitespace - because its output feeds `XMLView.create`. "Show Reconstructed
 * XML View" shows the same tree to a person, so this module owns the
 * presentation: indentation, one attribute per line once they stop fitting,
 * the namespace declarations first. The linter stays the one source of what
 * the tree contains.
 *
 * `vscode`-free: nodes in, string out - covered by the test suite.
 */

import type { ViewNode } from "@abap2ui5/linter/reconstruct";

const INDENT = "  ";

/** Attributes short enough for this stay on the element's line. */
const ONE_LINE_ATTRS = 72;

function escapeAttr(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;")
    .replace(/\t/g, "&#x9;");
}

/** xmlns declarations first - they are what the rest of the element means. */
function sortedAttrs(attrs: Array<[string, string]>): Array<[string, string]> {
  const ns = attrs.filter(([name]) => name === "xmlns" || name.startsWith("xmlns:"));
  const rest = attrs.filter(([name]) => name !== "xmlns" && !name.startsWith("xmlns:"));
  return [...ns, ...rest];
}

function formatNode(node: ViewNode, depth: number, out: string[]): void {
  // The synthetic root the reconstruction wraps a document in.
  if (node.name === null) {
    for (const child of node.children) {
      formatNode(child, depth, out);
    }
    return;
  }
  const pad = INDENT.repeat(depth);
  const name = node.ns ? `${node.ns}:${node.name}` : node.name;
  const attrs = sortedAttrs(node.attrs).map(
    ([n, v]) => `${n}="${escapeAttr(v)}"`
  );
  const oneLine = attrs.join(" ");
  const close = node.children.length ? ">" : "/>";

  if (!attrs.length) {
    out.push(`${pad}<${name}${close}`);
  } else if (pad.length + name.length + oneLine.length <= ONE_LINE_ATTRS) {
    out.push(`${pad}<${name} ${oneLine}${close}`);
  } else {
    out.push(`${pad}<${name}`);
    const attrPad = pad + INDENT.repeat(2);
    attrs.forEach((attr, ix) => {
      const last = ix === attrs.length - 1;
      out.push(`${attrPad}${attr}${last ? close : ""}`);
    });
  }

  for (const child of node.children) {
    formatNode(child, depth + 1, out);
  }
  if (node.children.length) {
    out.push(`${pad}</${name}>`);
  }
}

/**
 * One reconstructed view, indented for reading.
 */
export function prettyXml(node: ViewNode): string {
  const out: string[] = [];
  formatNode(node, 0, out);
  return out.join("\n");
}

/**
 * Everything a class builds, as one XML document to look at. More than one
 * view (a class assembling a popup next to its main view) is separated by a
 * comment naming which is which.
 */
export function prettyDocument(nodes: ViewNode[], className: string): string {
  const header =
    `<!-- ${className}: the view(s) reconstructed from the z2ui5_cl_ai_xml ` +
    `builder calls - what the abap2UI5 view check validates. Read-only, ` +
    `regenerated as the class changes. -->`;
  const views = nodes.map((node, ix) =>
    nodes.length > 1 ? `<!-- view ${ix + 1} of ${nodes.length} -->\n${prettyXml(node)}` : prettyXml(node)
  );
  return [header, ...views].join("\n\n") + "\n";
}
