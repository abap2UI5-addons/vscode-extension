import * as vscode from "vscode";
import {
  abapContextAt,
  abapNsMap,
  WriteContext,
  xmlContextAt,
  xmlNsMap,
} from "./context";
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

class ViewCompletion implements vscode.CompletionItemProvider {
  provideCompletionItems(
    doc: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const context = contextAt(doc, position);
    if (!context) {
      return [];
    }
    const data = snapshot();
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
      // builder; `<` and the space are the same positions in raw XML.
      "`",
      "'",
      '"',
      "<",
      " "
    ),
    vscode.languages.registerHoverProvider(VIEW_SELECTOR, new ViewHover())
  );
  log("language: completion and hover from the bundled UI5 metadata registered");
}
