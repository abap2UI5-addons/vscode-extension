/*
 * "What is being written here?" — the position analysis behind completion and
 * hover.
 *
 * abap2UI5 views are built by chaining calls on `z2ui5_cl_ai_xml`, so the
 * control a property belongs to is not lexically around the cursor the way it
 * is in XML — it sits in the `open( )` / `leaf( )` call the `a( )` is chained
 * to. Getting that relationship right is the whole job of this module:
 *
 *   view->open( n = `VBox` )->leaf( n = `Button` )->a( n = `text` v = `Hi` )
 *                                        ^ the control            ^ its member
 *
 * Raw `*.view.xml` / `*.fragment.xml` files are handled too, where the same
 * three positions are simply the tag name, an attribute name and an attribute
 * value.
 *
 * `vscode`-free by design: this is the part with the interesting edge cases,
 * and the test suite drives it directly.
 */

/** Which of the three writable positions the cursor sits in. */
export type ContextKind = "control" | "member" | "value" | "namespace";

export interface WriteContext {
  kind: ContextKind;
  /** Library-qualified control, e.g. `sap.m.Button` — when it could be
   *  resolved. For `kind === "control"` this is what is being typed. */
  control?: string;
  /** The member whose value is being written (`kind === "value"`). */
  member?: string;
  /** The library a completed control name would land in (`kind ===
   *  "control"`), derived from the namespace in play. */
  library?: string;
  /** What is already typed inside the literal. */
  prefix: string;
  /** The literal's content span, i.e. the range a completion replaces. */
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

/** The prefix an undecorated control name belongs to when the source declares
 *  no default namespace of its own — every abap2UI5 view starts from sap.m. */
export const DEFAULT_LIBRARY = "sap.m";

/**
 * The `xmlns` declarations of an ABAP-built view. The builder writes them as
 * ordinary attributes, in either of its two spellings:
 *
 *   ->a( n = `xmlns:f` v = `sap.f` )
 *   a = VALUE #( ( `xmlns:f=sap.f` ) )
 *
 * The map is keyed by prefix, `""` for the default namespace.
 */
export function abapNsMap(source: string): Record<string, string> {
  const map: Record<string, string> = {};
  const pair =
    /n\s*=\s*[`'"]xmlns(?::([\w.]+))?[`'"]\s*v\s*=\s*[`'"]([\w.]+)[`'"]/gi;
  const flat = /[`'"]xmlns(?::([\w.]+))?=([\w.]+)[`'"]/gi;
  for (const re of [pair, flat]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      map[m[1] ?? ""] = m[2];
    }
  }
  return map;
}

/** The `xmlns` declarations of a raw view/fragment XML. */
export function xmlNsMap(source: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /xmlns(?::([\w.]+))?\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    map[m[1] ?? ""] = m[2];
  }
  return map;
}

/** Library for a namespace prefix, falling back to sap.m for the default one
 *  so a view that never declares anything still completes usefully. */
function libraryOf(map: Record<string, string>, prefix: string): string {
  return map[prefix] ?? (prefix ? "" : DEFAULT_LIBRARY);
}

/** Splits a written control name into its prefix and local name — the builder
 *  accepts `core:Icon` as well as `ns = \`core\`` + `n = \`Icon\``. */
export function splitName(name: string): { prefix: string; local: string } {
  const ix = name.indexOf(":");
  return ix > 0
    ? { prefix: name.slice(0, ix), local: name.slice(ix + 1) }
    : { prefix: "", local: name };
}

// ---------------------------------------------------------------------------
// ABAP: a one-pass scan that knows about literals, comments and call nesting
// ---------------------------------------------------------------------------

interface Call {
  name: string;
  /** Offset of the `(`. */
  open: number;
  /** Offset of the matching `)`, or undefined while still open. */
  close?: number;
}

interface Literal {
  /** Content span, i.e. between the quotes. */
  start: number;
  end: number;
}

interface AbapScan {
  /** Call stack at the cursor, innermost last. */
  stack: Call[];
  /** Every call that started before the cursor, in source order. */
  calls: Call[];
  /** The literal the cursor sits in, if any. */
  literal?: Literal;
}

/**
 * Walks the source once, tracking ABAP's two literal forms (`'…'` and
 * `` `…` ``, both escaped by doubling), its two comment forms (`*` in column
 * one, `"` anywhere else) and the parenthesis nesting. Everything the context
 * analysis needs comes out of this: a `leaf(` inside a comment or a string
 * never becomes a control, which is exactly the confusion a plain backwards
 * regex search would produce.
 */
function scanAbap(source: string, offset: number): AbapScan {
  const stack: Call[] = [];
  const calls: Call[] = [];
  let literal: Literal | undefined;
  let stackAtCursor: Call[] | undefined;

  const snapshot = () => {
    if (stackAtCursor === undefined) {
      stackAtCursor = [...stack];
    }
  };

  let i = 0;
  while (i < source.length) {
    if (stackAtCursor === undefined && i > offset) {
      snapshot();
    }
    const c = source[i];

    // `*` in column one comments out the whole line.
    if (c === "*" && (i === 0 || source[i - 1] === "\n")) {
      const nl = source.indexOf("\n", i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    // `"` starts a comment to the end of the line — it is not a string
    // delimiter in ABAP.
    if (c === '"') {
      const nl = source.indexOf("\n", i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (c === "'" || c === "`") {
      const start = i + 1;
      let j = start;
      while (j < source.length && source[j] !== "\n") {
        if (source[j] === c) {
          if (source[j + 1] === c) {
            j += 2; // doubled quote: an escaped one, the literal goes on
            continue;
          }
          break;
        }
        j++;
      }
      if (offset >= start && offset <= j) {
        literal = { start, end: j };
        snapshot();
      }
      i = j + 1;
      continue;
    }
    // A string template. It is skipped rather than offered for completion -
    // what matters is that its content is not read as code: a `"` inside one
    // would otherwise start a comment and swallow the rest of the line,
    // including the `)` that closes the call.
    if (c === "|") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === "|") {
          break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "(") {
      // The method name is the identifier run right in front of the paren.
      let k = i;
      while (k > 0 && /[A-Za-z0-9_~]/.test(source[k - 1])) {
        k--;
      }
      const call: Call = { name: source.slice(k, i), open: i };
      if (i < offset) {
        calls.push(call);
      }
      stack.push(call);
      i++;
      continue;
    }
    if (c === ")") {
      const call = stack.pop();
      if (call) {
        call.close = i;
      }
      i++;
      continue;
    }
    i++;
  }
  return { stack: stackAtCursor ?? [...stack], calls, literal };
}

/** The argument text of a call — up to its `)`, or to the end when it is the
 *  call still being written. */
function argsOf(source: string, call: Call): string {
  return source.slice(call.open + 1, call.close ?? source.length);
}

/** The literal value of a named argument, e.g. `n` in `a( n = \`text\` … )`. */
function argValue(args: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*[\`'"]([^\`'"]*)[\`'"]`, "i").exec(
    args
  );
  return m ? m[1] : undefined;
}

/** Which named argument the cursor's literal belongs to: the last `name =`
 *  in front of it inside the same call. */
function argNameBefore(source: string, from: number, to: number): string | undefined {
  const before = source.slice(from, to);
  const m = /\b(\w+)\s*=\s*[`'"]?[^`'"=]*$/.exec(before);
  return m ? m[1].toLowerCase() : undefined;
}

/** The control an `a( )` call attaches to: the last `open( )` / `leaf( )`
 *  started before it — exactly the rule z2ui5_cl_ai_xml itself follows. */
function controlCallBefore(calls: Call[], before: number): Call | undefined {
  let found: Call | undefined;
  for (const call of calls) {
    if (call.open >= before) {
      break;
    }
    const name = call.name.toLowerCase();
    if (name === "open" || name === "leaf") {
      found = call;
    }
  }
  return found;
}

/** Library-qualified control name of an `open( )` / `leaf( )` call. */
function controlOf(
  source: string,
  call: Call,
  ns: Record<string, string>
): string | undefined {
  const args = argsOf(source, call);
  const written = argValue(args, "n");
  if (!written) {
    return undefined;
  }
  const split = splitName(written);
  const prefix = split.prefix || argValue(args, "ns") || "";
  const library = libraryOf(ns, prefix);
  return library ? `${library}.${split.local}` : undefined;
}

/** The write position at `offset` in an ABAP source, or undefined when the
 *  cursor is not in a place the view metadata has anything to say about. */
export function abapContextAt(
  source: string,
  offset: number
): WriteContext | undefined {
  const { stack, calls, literal } = scanAbap(source, offset);
  const call = stack[stack.length - 1];
  if (!literal || !call) {
    return undefined;
  }
  const name = call.name.toLowerCase();
  const arg = argNameBefore(source, call.open + 1, literal.start - 1);
  const ns = abapNsMap(source);
  const span = { prefix: source.slice(literal.start, offset), ...literal };

  if (name === "open" || name === "leaf") {
    if (arg === "n") {
      // The builder takes the namespace either as its own argument or baked
      // into the name (`core:Icon`); a prefix in the name wins, and the
      // completion then replaces only the local part.
      const written = source.slice(literal.start, literal.end);
      const inName = splitName(written);
      const prefix = inName.prefix || argValue(argsOf(source, call), "ns") || "";
      const library = libraryOf(ns, prefix);
      if (!library) {
        return undefined;
      }
      const start = literal.start + (inName.prefix ? inName.prefix.length + 1 : 0);
      return {
        kind: "control",
        library,
        prefix: source.slice(start, Math.max(start, offset)),
        start,
        end: literal.end,
      };
    }
    if (arg === "ns") {
      return { kind: "namespace", ...span };
    }
    return undefined;
  }

  if (name === "a") {
    const owner = controlCallBefore(calls, call.open);
    const control = owner ? controlOf(source, owner, ns) : undefined;
    if (!control) {
      return undefined;
    }
    if (arg === "n") {
      return { kind: "member", control, ...span };
    }
    if (arg === "v") {
      const member = argValue(argsOf(source, call), "n");
      return member ? { kind: "value", control, member, ...span } : undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Raw view / fragment XML
// ---------------------------------------------------------------------------

/** The write position at `offset` in a view/fragment XML. */
export function xmlContextAt(
  source: string,
  offset: number
): WriteContext | undefined {
  // The tag the cursor sits in: the last `<` not yet closed by a `>`.
  const open = source.lastIndexOf("<", offset - 1);
  if (open < 0) {
    return undefined;
  }
  const closed = source.indexOf(">", open);
  if (closed >= 0 && closed < offset) {
    return undefined; // between tags — nothing to complete
  }
  if (source[open + 1] === "/" || source[open + 1] === "!" || source[open + 1] === "?") {
    return undefined;
  }
  const ns = xmlNsMap(source);
  const tagEnd = /[\s/>]/.exec(source.slice(open + 1))?.index;
  const nameEnd = open + 1 + (tagEnd ?? offset - open - 1);

  // Inside the tag name itself.
  if (offset <= nameEnd) {
    const written = source.slice(open + 1, offset);
    const prefix = splitName(written).prefix;
    const library = libraryOf(ns, prefix);
    return library
      ? {
          kind: "control",
          library,
          prefix: splitName(written).local,
          start: open + 1 + (prefix ? prefix.length + 1 : 0),
          end: nameEnd,
        }
      : undefined;
  }

  const tagName = source.slice(open + 1, nameEnd);
  const split = splitName(tagName);
  const library = libraryOf(ns, split.prefix);
  if (!library) {
    return undefined;
  }
  const control = `${library}.${split.local}`;

  // Inside an attribute value?
  const attrs = source.slice(nameEnd, offset);
  const quotes = (attrs.match(/"/g) ?? []).length;
  if (quotes % 2 === 1) {
    const start = nameEnd + attrs.lastIndexOf('"') + 1;
    const closeQuote = source.indexOf('"', start);
    const member = /([\w:.]+)\s*=\s*"[^"]*$/.exec(attrs)?.[1];
    return member
      ? {
          kind: "value",
          control,
          member,
          prefix: source.slice(start, offset),
          start,
          end: closeQuote < 0 ? offset : closeQuote,
        }
      : undefined;
  }

  // Attribute name position.
  const word = /([\w:.]*)$/.exec(attrs)?.[1] ?? "";
  return {
    kind: "member",
    control,
    prefix: word,
    start: offset - word.length,
    end: offset,
  };
}
