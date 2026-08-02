/*
 * Minimal typings for the bundled @abap2ui5/linter library
 * (https://github.com/abap2UI5/linter) - plain .mjs upstream.
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
    /** What a literal seed actually sets - the model the renderer gets. */
    model: Record<string, unknown>;
    /** Every declared field of every declared structure - what the property
     *  gate judges binding paths against. */
    modelShape: Record<string, unknown>;
    notes: string[];
    helperTokens: number;
  }

  export function prepareAbap(source: string): PreparedAbap;
}

declare module "@abap2ui5/linter/properties" {
  import type { ViewNode } from "@abap2ui5/linter/reconstruct";
  import type { Severity } from "@abap2ui5/linter/findings";

  export interface PropertyFinding {
    type: string;
    control: string;
    member?: string;
    since?: string;
    minUi5?: string;
    deprecated?: string | boolean | { since?: string | null; text?: string };
    /** invalid-property-value, unknown-binding-path, duplicate-id,
     *  event-without-handler, unconverted-abap-boolean */
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
    /** Character offset into the checked file - set by every gate that can
     *  place its finding; absent for view parts inlined from helper
     *  methods, which map back to no position at all. */
    offset?: number;
    /** Filled in by annotate( ) from the findings subpath. */
    severity?: Severity;
    message?: string;
    line?: number;
    column?: number;
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
      /** Without these two the binding-path rules cannot run at all. */
      model?: Record<string, unknown> | null;
      shape?: Record<string, unknown> | null;
    }
  ): PropertyFinding[];
}

declare module "@abap2ui5/linter/abap-rules" {
  import type { PropertyFinding } from "@abap2ui5/linter/properties";

  export function checkAbapRules(source: string): PropertyFinding[];
}

declare module "@abap2ui5/linter/findings" {
  import type { PropertyFinding } from "@abap2ui5/linter/properties";

  /** error - the app breaks; warning - it will not survive the target
   *  system; hint - worth knowing, never wrong by itself. */
  export type Severity = "hint" | "warning" | "error";

  export const SEVERITIES: Severity[];

  export function severityOf(finding: { type: string }): Severity;

  export function describe(finding: PropertyFinding): string;

  /** Adds severity, message and (where the gate recorded an offset)
   *  line/column, in place. */
  export function annotate<T extends PropertyFinding>(
    findings: T[],
    source: string
  ): T[];
}
