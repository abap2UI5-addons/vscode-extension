/*
 * Minimal typings for the bundled @abap2ui5/view-check library
 * (https://github.com/abap2UI5/ai-view-check) - plain .mjs upstream.
 */

declare module "@abap2ui5/view-check/reconstruct" {
  export interface ViewNode {
    name: string | null;
    ns: string | null;
    attrs: Array<[string, string]>;
    children: ViewNode[];
  }

  export interface PreparedAbap {
    usesBuilder: boolean;
    nodes: ViewNode[];
    docs: string[];
    model: Record<string, unknown>;
    notes: string[];
    helperTokens: number;
  }

  export function prepareAbap(source: string): PreparedAbap;
}

declare module "@abap2ui5/view-check/properties" {
  import type { ViewNode } from "@abap2ui5/view-check/reconstruct";

  export interface PropertyFinding {
    type: string;
    control: string;
    member?: string;
    since?: string;
    minUi5?: string;
    deprecated?: string | boolean;
  }

  export function loadSnapshot(file?: string): unknown;

  export function parseXml(xml: string): ViewNode;

  export function checkNodes(
    root: ViewNode,
    opts: { data: unknown; minUi5?: string; allow?: string[] }
  ): PropertyFinding[];
}
