/*
 * Minimal typings for the bundled @abap2ui5/linter library
 * (https://github.com/abap2UI5/abap2UI5-linter) - plain .mjs upstream.
 */

declare module "@abap2ui5/linter/reconstruct" {
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

declare module "@abap2ui5/linter/properties" {
  import type { ViewNode } from "@abap2ui5/linter/reconstruct";

  export interface PropertyFinding {
    type: string;
    control: string;
    member?: string;
    since?: string;
    minUi5?: string;
    deprecated?: string | boolean;
    /** invalid-property-value */
    value?: string;
    allowed?: string[];
    memberType?: string;
    /** invalid-aggregation-child */
    parentControl?: string;
    expected?: string;
    /** too-many-children */
    count?: number;
    /** sapui5-only-control */
    library?: string;
    /** unknown-binding-path, duplicate-id, event-without-handler */
    value?: string;
  }

  export function loadSnapshot(file?: string): unknown;

  export function parseXml(xml: string): ViewNode;

  export function checkNodes(
    root: ViewNode,
    opts: {
      data: unknown;
      minUi5?: string;
      allow?: string[];
      distribution?: string;
    }
  ): PropertyFinding[];
}

declare module "@abap2ui5/linter/abap-rules" {
  import type { PropertyFinding } from "@abap2ui5/linter/properties";

  export function checkAbapRules(source: string): PropertyFinding[];
}
