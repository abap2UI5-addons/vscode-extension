/*
 * ABAP source helpers.
 *
 * Everything here is a pure function over source text — no `vscode` import,
 * on purpose: these are the pieces the test suite can exercise directly, and
 * they are also the pieces that used to be one-off regexes scattered across
 * `extension.ts` and `viewcheck.ts`, where they drifted apart.
 */

/**
 * What makes a class an abap2UI5 app. The colon is what the first version of
 * this regex missed: `INTERFACES: z2ui5_if_app.` is the chained form and just
 * as common as the plain one, and F9 silently fell through to "toggle
 * breakpoint" for every class written that way. `\s` covers the newline, so
 * the interface may sit on the line after the colon.
 */
export const APP_INTERFACE_RE = /\binterfaces\s*:?\s*z2ui5_if_app\b/i;

/** True when the source implements `z2ui5_if_app` — the F9 launch condition. */
export function isAppClass(source: string): boolean {
  return APP_INTERFACE_RE.test(source);
}

/**
 * The generic builder, the only one the linter reconstructs views from.
 * `z2ui5_cl_xml_view` — the typed builder — is on its way out of abap2UI5 and
 * deliberately not checked.
 */
export const BUILDER_FACTORY_RE = /z2ui5_cl_ai_xml\s*=>\s*factory/i;

/** True when the source builds its view with the generic builder. */
export function usesBuilder(source: string): boolean {
  return BUILDER_FACTORY_RE.test(source);
}

/*
 * The class name, upper-cased — what the launch URL's `{class}` is replaced
 * with. Anchored at the start of a line (leading whitespace allowed) so that
 * a `CLASS … DEFINITION` quoted inside a comment does not win over the real
 * one: both ABAP comment forms (`*` in column 1 and a leading `"`) put a
 * character other than whitespace in front of the keyword.
 */
const CLASS_DEF_RE = /^[ \t]*class\s+(\S+)\s+definition/im;

/** Class name from the source, falling back to the file name. Upper case. */
export function classNameOf(source: string, fileName: string): string {
  const match = source.match(CLASS_DEF_RE);
  if (match) {
    return match[1].toUpperCase();
  }
  const base = fileName.replace(/^.*[\\/]/, "");
  return base
    .replace(/\.clas\.abap$/i, "")
    .replace(/\.abap$/i, "")
    .toUpperCase();
}

/**
 * Character offset of the class definition, for the CodeLens anchor. Returns
 * 0 when the source has none, so the lens still lands somewhere sensible.
 */
export function classDefinitionOffset(source: string): number {
  const match = CLASS_DEF_RE.exec(source);
  return match?.index ?? 0;
}

/**
 * Tokens in a runtime error message worth looking up in the class: binding
 * paths (`/MT_TRAVELS/STATUS`) and quoted names - the pieces UI5 error texts
 * carry that also appear verbatim in the source. Longest first, so the most
 * specific token is tried before its fragments; de-duplicated.
 */
export function errorTokens(message: string): string[] {
  const out = new Set<string>();
  for (const m of message.matchAll(/\/[A-Z0-9_]{2,}(?:\/[A-Z0-9_]+)*/g)) {
    out.add(m[0]);
  }
  for (const m of message.matchAll(/['"]([^'"\n]{3,60})['"]/g)) {
    out.add(m[1]);
  }
  return [...out].sort((a, b) => b.length - a.length);
}
