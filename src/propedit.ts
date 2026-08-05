/*
 * The edits behind the property editor: set, add and remove one attribute of
 * a builder control call - as plain text spans, so the panel's form writes
 * real `a( )` calls instead of owning a parallel representation.
 *
 * `vscode`-free: `controlCallAt( )`'s result and the source in, one span
 * edit out - covered by the test suite.
 */

import { ChainAttribute, ControlCall } from "./context";

export interface SpanEdit {
  start: number;
  end: number;
  text: string;
}

/** Doubles the quote character inside an ABAP literal. */
function escapeLiteral(value: string, quote: string): string {
  return value.split(quote).join(quote + quote);
}

function findAttr(
  call: ControlCall,
  name: string
): ChainAttribute | undefined {
  return call.attrs.find(
    (attr) => attr.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * The edit that gives `name` the value `value`: an in-place rewrite of the
 * literal when the attribute is already written, an appended `)->a( … )`
 * line when it is not. Undefined when the value cannot be written safely -
 * an expression-valued attribute, or a chain style appending would break.
 */
export function setAttributeEdit(
  source: string,
  call: ControlCall,
  name: string,
  value: string
): SpanEdit | undefined {
  const existing = findAttr(call, name);
  if (existing) {
    if (
      !existing.literal ||
      existing.valueStart === undefined ||
      existing.valueEnd === undefined
    ) {
      return undefined; // a `client->_bind( … )` is not the form's to rewrite
    }
    const quote = source[existing.valueStart - 1] ?? "`";
    return {
      start: existing.valueStart,
      end: existing.valueEnd,
      text: escapeLiteral(value, quote),
    };
  }
  if (call.appendAt < 0) {
    return undefined;
  }
  const text = `\n${call.appendIndent})->a( n = \`${escapeLiteral(
    name,
    "`"
  )}\` v = \`${escapeLiteral(value, "`")}\``;
  return { start: call.appendAt, end: call.appendAt, text };
}

/**
 * The edit that removes an attribute: its whole chain line (or lines, for a
 * multi-line value). Only offered when the a-call sits on lines of its own -
 * the leading `)` of its line closes the previous call, and the closing `)`
 * on the following line takes over that job, so dropping the full lines
 * keeps the chain balanced. Undefined when the layout is anything else.
 */
export function removeAttributeEdit(
  source: string,
  call: ControlCall,
  name: string
): SpanEdit | undefined {
  const attr = findAttr(call, name);
  if (!attr || attr.aClose === undefined) {
    return undefined;
  }
  const lineStart = source.lastIndexOf("\n", attr.aOpen) + 1;
  const line = source.slice(lineStart, source.indexOf("\n", lineStart));
  if (!/^\s*\)->\s*a\s*\(/.test(line)) {
    return undefined; // shares its line with another call - keep hands off
  }
  const closeLineStart = source.lastIndexOf("\n", attr.aClose) + 1;
  if (closeLineStart <= lineStart) {
    return undefined; // the close sits on the same line - not chain style
  }
  return { start: lineStart, end: closeLineStart, text: "" };
}
