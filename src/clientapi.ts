/*
 * The z2ui5_if_client method reference - the knowledge behind the `client->`
 * hover and completion.
 *
 * The UI5 controls have the bundled metadata snapshot; the abap2UI5 client
 * API itself (`_bind`, `_event`, `view_display`, the popup family - the
 * methods every app calls) had nothing, so the one thing the linter could
 * only report AFTER the fact (popover_display takes xml, not val) is now
 * offered BEFORE it: signature and ABAP Doc, parsed from the interface
 * source by scripts/generate-client-api.mjs and bundled as JSON.
 *
 * `vscode`-free: pure lookups over the bundled data, so the test suite can
 * drive the cursor logic without an editor.
 */

import api from "./data/client-api.json";

export interface ClientMethod {
  name: string;
  signature: string;
  doc: string;
  /** Set when the interface's own abapdoc declares the method obsolete -
   *  completion strikes it through and sorts it last. */
  obsolete?: boolean;
}

const METHODS: ClientMethod[] = (api as { methods: ClientMethod[] }).methods;
const BY_NAME = new Map(METHODS.map((m) => [m.name.toLowerCase(), m]));

export function clientMethods(): ClientMethod[] {
  return METHODS;
}

export function clientMethod(name: string): ClientMethod | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** The method name when the cursor sits on `client-><name>` (anywhere within
 *  the name), undefined otherwise. `me->client->x` counts too. */
export function clientCallAt(line: string, character: number): string | undefined {
  const re = /client->(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const start = m.index + "client->".length;
    const end = start + m[1].length;
    if (character >= start && character <= end) {
      return m[1];
    }
  }
  return undefined;
}

/** True when the cursor is completing a `client->` member (right after the
 *  arrow, or inside the partial name being typed). */
export function isClientCompletion(lineUpToCursor: string): boolean {
  return /client->\w*$/i.test(lineUpToCursor);
}

/** The first line of the signature, for the completion detail column. */
export function signatureHead(method: ClientMethod): string {
  return method.signature.split("\n")[0].replace(/\s+/g, " ").trim();
}
