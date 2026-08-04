import * as vscode from "vscode";
import { prepareAbap } from "@abap2ui5/linter/reconstruct";
import {
  abapBindingContextAt,
  abapContextAt,
  abapNsMap,
  BindingContext,
  WriteContext,
  xmlContextAt,
  xmlNsMap,
} from "./context";
import {
  absoluteOffers,
  PathOffer,
  relativeOffers,
  rowShapeFor,
} from "./bindingpaths";
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
import { VIEW_SELECTOR } from "./quickfix";

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

class ViewHover implements vscode.HoverProvider {
  provideHover(
    doc: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
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
    vscode.languages.registerHoverProvider(VIEW_SELECTOR, new ViewHover())
  );
  log("language: completion and hover from the bundled UI5 metadata registered");
}
