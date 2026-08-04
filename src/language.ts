import * as vscode from "vscode";
import { prepareAbap } from "@abap2ui5/linter/reconstruct";
import {
  abapBindingContextAt,
  abapContextAt,
  abapNsMap,
  BindingContext,
  eventNameAt,
  eventUsagesOf,
  OutlineNode,
  viewOutline,
  whenBranchOf,
  whenNameAt,
  WriteContext,
  xmlContextAt,
  xmlNsMap,
} from "./context";
import {
  absoluteOffers,
  PathKind,
  PathOffer,
  relativeOffers,
  resolvePathKind,
  rowShapeFor,
} from "./bindingpaths";
import { usesBuilder } from "./abap";
import { Snapshot } from "./metadata";
import {
  controlsIn,
  describeControl,
  describeMember,
  deprecationText,
  membersOf,
  Section,
  valuesFor,
} from "./metadata";
import { snapshot } from "./snapshot";
import { VIEW_SELECTOR } from "./selector";

/*
 * Completion and hover from the bundled UI5 metadata.
 *
 * The snapshot the property gate validates against is a complete UI5 API
 * reference - every control with its parent chain, every declared member with
 * its type, `@since` and `@deprecated`, plus the enum tables. It already ships
 * next to the bundle, so offering it while the view is being written costs no
 * dependency, no network and no SAP system: the same knowledge that reports a
 * typo afterwards can prevent it.
 *
 * `context.ts` answers where the cursor is, `metadata.ts` answers what may go
 * there. This module is only the VS Code plumbing between the two.
 */

const VIEW_XML_RE = /\.(view|fragment)\.xml$/i;

/** Which analysis a document gets - the builder's method chains, or plain
 *  XML. A `*.view.xml` is XML whatever language id it was given. */
function contextAt(
  doc: vscode.TextDocument,
  position: vscode.Position
): WriteContext | undefined {
  const text = doc.getText();
  const offset = doc.offsetAt(position);
  const isXml = VIEW_XML_RE.test(doc.fileName) || /^\s*</.test(text);
  return isXml ? xmlContextAt(text, offset) : abapContextAt(text, offset);
}

/** Completion kinds that read right in the list: a control is a class, an
 *  event is an event, an aggregation is a slot to put things in. */
const MEMBER_KIND: Record<Section, vscode.CompletionItemKind> = {
  properties: vscode.CompletionItemKind.Property,
  aggregations: vscode.CompletionItemKind.Field,
  associations: vscode.CompletionItemKind.Reference,
  events: vscode.CompletionItemKind.Event,
};

/** Members are offered properties-first: that is what a view writes most. */
const SECTION_ORDER: Record<Section, string> = {
  properties: "1",
  aggregations: "2",
  associations: "3",
  events: "4",
};

function markdown(text: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(text);
  md.isTrusted = false;
  return md;
}

// ---------------------------------------------------------------------------
// Binding paths - offered from the model shape the linter derives
// ---------------------------------------------------------------------------

/** The derived model shape of a class, memoised on the document version -
 *  deriving it walks the whole source, and completion asks on keystrokes. */
let shapeMemo:
  | { key: string; version: number; shape: unknown }
  | undefined;

function modelShapeOf(doc: vscode.TextDocument): unknown {
  const key = doc.uri.toString();
  if (shapeMemo && shapeMemo.key === key && shapeMemo.version === doc.version) {
    return shapeMemo.shape;
  }
  const prep = prepareAbap(doc.getText());
  const shape = prep.usesBuilder ? prep.modelShape : undefined;
  shapeMemo = { key, version: doc.version, shape };
  return shape;
}

/**
 * Completions inside a `{…}` binding: the paths the derived model actually
 * has - the same shape the gate reports `unknown-binding-path` against, so
 * what is offered here is exactly what will not squiggle afterwards. Row
 * fields of the enclosing aggregation first, absolute paths after.
 */
function bindingItems(
  doc: vscode.TextDocument,
  binding: BindingContext
): vscode.CompletionItem[] {
  const shape = modelShapeOf(doc);
  if (!shape) {
    return [];
  }
  const range = new vscode.Range(
    doc.positionAt(binding.start),
    doc.positionAt(binding.end)
  );
  const make = (offer: PathOffer, group: string): vscode.CompletionItem => {
    const item = new vscode.CompletionItem(
      offer.path,
      offer.table
        ? vscode.CompletionItemKind.Struct
        : vscode.CompletionItemKind.Field
    );
    item.detail = offer.table ? "table - what an aggregation binds" : "model path";
    item.range = range;
    item.sortText = `${group}${offer.path}`;
    return item;
  };
  const items: vscode.CompletionItem[] = [];
  if (binding.aggregations.length) {
    const row = rowShapeFor(shape, binding.aggregations);
    if (row) {
      // The row the enclosing aggregation hands down - what a relative
      // path means right here.
      items.push(...relativeOffers(row).map((offer) => make(offer, "0")));
    }
  }
  items.push(...absoluteOffers(shape).map((offer) => make(offer, "1")));
  return items;
}

class ViewCompletion implements vscode.CompletionItemProvider {
  provideCompletionItems(
    doc: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const data = snapshot();

    // A binding being written wins over the enum values of the member - the
    // `{` says the value is a path, not a literal.
    const isXml =
      VIEW_XML_RE.test(doc.fileName) || /^\s*</.test(doc.getText());
    if (!isXml) {
      const binding = abapBindingContextAt(
        doc.getText(),
        doc.offsetAt(position),
        (control, member) =>
          membersOf(data, control).some(
            (m) => m.name === member && m.section === "aggregations"
          )
      );
      if (binding) {
        return bindingItems(doc, binding);
      }
    }

    const context = contextAt(doc, position);
    if (!context) {
      return [];
    }
    const range = new vscode.Range(
      doc.positionAt(context.start),
      doc.positionAt(context.end)
    );

    if (context.kind === "control" && context.library) {
      return controlsIn(data, context.library).map((local) => {
        const full = `${context.library}.${local}`;
        const item = new vscode.CompletionItem(
          local,
          vscode.CompletionItemKind.Class
        );
        item.detail = context.library;
        item.documentation = markdown(describeControl(data, full));
        item.range = range;
        if (deprecationText(data[full]?.deprecated)) {
          item.tags = [vscode.CompletionItemTag.Deprecated];
        }
        return item;
      });
    }

    if (context.kind === "member" && context.control) {
      return membersOf(data, context.control).map((member) => {
        const item = new vscode.CompletionItem(
          member.name,
          MEMBER_KIND[member.section]
        );
        item.detail = member.type ?? member.section;
        item.documentation = markdown(
          describeMember(data, context.control!, member.name)
        );
        item.range = range;
        // Own members before inherited ones, properties before the rest.
        const inherited = member.declaredOn === context.control ? "0" : "1";
        item.sortText = `${SECTION_ORDER[member.section]}${inherited}${member.name}`;
        if (deprecationText(member.deprecated)) {
          item.tags = [vscode.CompletionItemTag.Deprecated];
        }
        return item;
      });
    }

    if (context.kind === "value" && context.control && context.member) {
      const values = valuesFor(data, context.control, context.member);
      return (values ?? []).map((value) => {
        const item = new vscode.CompletionItem(
          value,
          vscode.CompletionItemKind.EnumMember
        );
        item.range = range;
        return item;
      });
    }

    if (context.kind === "namespace") {
      const text = doc.getText();
      const map = VIEW_XML_RE.test(doc.fileName) ? xmlNsMap(text) : abapNsMap(text);
      return Object.entries(map)
        .filter(([prefix]) => prefix)
        .map(([prefix, library]) => {
          const item = new vscode.CompletionItem(
            prefix,
            vscode.CompletionItemKind.Module
          );
          item.detail = library;
          item.range = range;
          return item;
        });
    }

    return [];
  }
}

/** What the hover says about one resolved binding path. */
const PATH_KIND_TEXT: Record<PathKind, string> = {
  table:
    "a **table** in the derived model - what an aggregation (`items`, `rows`, …) " +
    "binds. Inside its template, relative paths address one row.",
  structure: "a **structure** in the derived model.",
  field: "a **field** in the derived model - the binding resolves.",
  "unknown-shape":
    "below a structure this class does not declare (a DDIC or foreign type). " +
    "The view check accepts any path here rather than guess.",
  missing:
    "**not in the derived model** - the view check reports this as " +
    "`unknown-binding-path`, and at runtime the binding stays silently empty.",
};

/** Hover for a `{…}` path: what the derived model says about it. */
function bindingHover(
  doc: vscode.TextDocument,
  position: vscode.Position,
  data: Snapshot
): vscode.Hover | undefined {
  const binding = abapBindingContextAt(
    doc.getText(),
    doc.offsetAt(position),
    (control, member) =>
      membersOf(data, control).some(
        (m) => m.name === member && m.section === "aggregations"
      )
  );
  if (!binding) {
    return undefined;
  }
  const range = new vscode.Range(
    doc.positionAt(binding.start),
    doc.positionAt(binding.end)
  );
  const path = doc.getText(range);
  if (!path) {
    return undefined;
  }
  const shape = modelShapeOf(doc);
  if (!shape) {
    return undefined;
  }
  let text: string;
  if (path.startsWith("/")) {
    text = PATH_KIND_TEXT[resolvePathKind(shape, path)];
  } else if (binding.aggregations.length) {
    const row = rowShapeFor(shape, binding.aggregations);
    text = row
      ? PATH_KIND_TEXT[resolvePathKind(row, path)] +
        `\n\nRelative to the row of \`{${binding.aggregations[binding.aggregations.length - 1]}}\`.`
      : "a relative path - the enclosing aggregation binds something the " +
        "derived model cannot follow, so the row's fields are unknown here.";
  } else {
    text =
      "a **relative path** - it addresses the row handed down by an " +
      "enclosing aggregation binding, and none is in effect here.";
  }
  return new vscode.Hover(markdown(`\`{${path}}\` — ${text}`), range);
}

class ViewHover implements vscode.HoverProvider {
  provideHover(
    doc: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const isXml =
      VIEW_XML_RE.test(doc.fileName) || /^\s*</.test(doc.getText());
    if (!isXml) {
      const binding = bindingHover(doc, position, snapshot());
      if (binding) {
        return binding;
      }
    }
    const context = contextAt(doc, position);
    if (!context) {
      return undefined;
    }
    const data = snapshot();
    const range = new vscode.Range(
      doc.positionAt(context.start),
      doc.positionAt(context.end)
    );
    const word = doc.getText(range);
    if (!word) {
      return undefined;
    }

    if (context.kind === "control" && context.library) {
      const text = describeControl(data, `${context.library}.${word}`);
      return text ? new vscode.Hover(markdown(text), range) : undefined;
    }
    if (context.kind === "member" && context.control) {
      const text = describeMember(data, context.control, word);
      return text ? new vscode.Hover(markdown(text), range) : undefined;
    }
    // On a value, what helps is the member it belongs to: its type and, for
    // an enum, everything else that would have been allowed there.
    if (context.kind === "value" && context.control && context.member) {
      const text = describeMember(data, context.control, context.member);
      return text ? new vscode.Hover(markdown(text), range) : undefined;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Events: definition jumps between _event( ) and the WHEN branch
// ---------------------------------------------------------------------------

/** ABAP sources only - events do not appear in raw view XML this way. */
const ABAP_SELECTOR: vscode.DocumentSelector = [
  { language: "abap" },
  { pattern: "**/*.abap" },
];

class EventDefinition implements vscode.DefinitionProvider {
  provideDefinition(
    doc: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Definition | vscode.LocationLink[] | undefined {
    const text = doc.getText();
    const offset = doc.offsetAt(position);

    // From the view's _event( 'NAME' ) to the WHEN 'NAME' that handles it.
    const event = eventNameAt(text, offset);
    if (event) {
      const target = whenBranchOf(text, event.name);
      if (target === undefined) {
        return undefined;
      }
      const at = doc.positionAt(target);
      return [
        {
          originSelectionRange: new vscode.Range(
            doc.positionAt(event.start),
            doc.positionAt(event.end)
          ),
          targetUri: doc.uri,
          targetRange: doc.lineAt(at.line).range,
        },
      ];
    }

    // And back: from WHEN 'NAME' to every _event( ) that raises it.
    const when = whenNameAt(text, offset);
    if (when) {
      return eventUsagesOf(text, when.name).map((usage) => {
        const at = doc.positionAt(usage);
        return new vscode.Location(doc.uri, doc.lineAt(at.line).range);
      });
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Outline: the view hierarchy as symbols
// ---------------------------------------------------------------------------

class ViewOutlineSymbols implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
    const text = doc.getText();
    if (/^\s*</.test(text) || !usesBuilder(text)) {
      return []; // raw XML has outlines of its own; non-builder classes too
    }
    const clamp = (offset: number) => Math.min(offset, text.length);
    const toSymbol = (node: OutlineNode): vscode.DocumentSymbol => {
      const symbol = new vscode.DocumentSymbol(
        node.label,
        node.id ? `#${node.id}` : "",
        node.container
          ? vscode.SymbolKind.Object
          : vscode.SymbolKind.Field,
        new vscode.Range(
          doc.positionAt(clamp(node.start)),
          doc.positionAt(clamp(node.end + 1))
        ),
        new vscode.Range(
          doc.positionAt(clamp(node.selStart)),
          doc.positionAt(clamp(node.selEnd))
        )
      );
      symbol.children = node.children.map(toSymbol);
      return symbol;
    };
    return viewOutline(text).map(toSymbol);
  }
}

export function registerLanguageFeatures(
  context: vscode.ExtensionContext,
  log: (m: string) => void
): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      VIEW_SELECTOR,
      new ViewCompletion(),
      // The quotes are where a control, a member or a value starts in the
      // builder; `<` and the space are the same positions in raw XML. `{`
      // and `/` are where a binding path starts and descends.
      "`",
      "'",
      '"',
      "<",
      " ",
      "{",
      "/"
    ),
    vscode.languages.registerHoverProvider(VIEW_SELECTOR, new ViewHover()),
    vscode.languages.registerDefinitionProvider(
      ABAP_SELECTOR,
      new EventDefinition()
    ),
    // The label keeps this outline apart from the ABAP extension's own.
    vscode.languages.registerDocumentSymbolProvider(
      ABAP_SELECTOR,
      new ViewOutlineSymbols(),
      { label: "abap2UI5 view" }
    )
  );
  log("language: completion, hover, event navigation and view outline registered");
}
