import * as vscode from "vscode";
import { prepareAbap } from "@abap2ui5/linter/reconstruct";
import type { PropertyFinding } from "@abap2ui5/linter/properties";
import { classNameOf, usesBuilder } from "./abap";
import { formatDocument } from "./xmlformat";

/*
 * "Show Reconstructed XML View" - the linter's view of the class, for people.
 *
 * abap2UI5 views are strings assembled by builder calls, so what actually
 * reaches `XMLView.create` is never visible in the source. The linter
 * reconstructs exactly that for its checks; this module opens the same
 * reconstruction as a read-only XML document next to the class and keeps it
 * following the edits. Debugging a binding or nesting problem stops being
 * "stare at the builder chain" and becomes "read the view".
 *
 * The reconstruction records which builder call wrote each node and
 * attribute, so the XML is not just readable but navigable: Go to Definition
 * on a line jumps to its `open( )` / `leaf( )` / `a( )` in the class, and the
 * view check's findings are mirrored onto the XML lines they concern.
 */

export const XML_PREVIEW_SCHEME = "abap2ui5-xml";

/** How long after the last keystroke the XML refreshes - same rhythm as the
 *  live view check, for the same reason. */
const REFRESH_DEBOUNCE_MS = 400;

/** virtual document -> the ABAP source it renders. */
const sources = new Map<string, vscode.Uri>();

/** Last rendered content, so the tab survives its source being closed. */
const lastContent = new Map<string, string>();

/** Line -> source-offset map of the last render, for navigation/findings. */
const lastOffsets = new Map<string, Array<number | undefined>>();

function virtualUriFor(doc: vscode.TextDocument): vscode.Uri {
  const className =
    classNameOf(doc.getText(), doc.fileName).toUpperCase() || "VIEW";
  // The query pins one virtual document per source, so two classes never
  // fight over the same tab. The path is what the tab shows. Deliberately
  // not `*.view.xml`: the view check would treat that name as a checkable
  // view file and double-report everything the class already gets.
  return vscode.Uri.from({
    scheme: XML_PREVIEW_SCHEME,
    path: `/${className}.reconstructed.xml`,
    query: doc.uri.toString(),
  });
}

function sourceDocOf(virtualKey: string): vscode.TextDocument | undefined {
  const sourceUri = sources.get(virtualKey);
  if (!sourceUri) {
    return undefined;
  }
  return vscode.workspace.textDocuments.find(
    (doc) => doc.uri.toString() === sourceUri.toString()
  );
}

/** The XML line a source offset renders on: the exact line when one carries
 *  that offset, otherwise the nearest line whose call starts before it - a
 *  finding recorded inside an argument list still lands on its element. */
function lineForOffset(
  offsets: Array<number | undefined>,
  target: number
): number | undefined {
  let best: number | undefined;
  let bestOffset = -1;
  for (let line = 0; line < offsets.length; line++) {
    const offset = offsets[line];
    if (offset === undefined || offset > target) {
      continue;
    }
    if (offset === target) {
      return line;
    }
    if (offset >= bestOffset) {
      bestOffset = offset;
      best = line;
    }
  }
  return best;
}

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  hint: vscode.DiagnosticSeverity.Information,
} as const;

export function registerXmlPreview(
  context: vscode.ExtensionContext,
  log: (m: string) => void,
  /** The view check's findings for a source document - injected so this
   *  module stays free of the checker plumbing (the web build has none). */
  findingsFor?: (doc: vscode.TextDocument) => PropertyFinding[]
): void {
  const timers = new Map<string, NodeJS.Timeout>();
  const diagnostics =
    vscode.languages.createDiagnosticCollection("abap2ui5-xml-preview");

  /** Mirrors the source's findings onto the XML lines their calls render. */
  function mirrorFindings(
    virtualUri: vscode.Uri,
    source: vscode.TextDocument,
    offsets: Array<number | undefined>,
    lines: string[]
  ): void {
    if (!findingsFor) {
      return;
    }
    let findings: PropertyFinding[];
    try {
      findings = findingsFor(source);
    } catch {
      return; // an unparsable buffer mid-edit is not worth reporting
    }
    const out: vscode.Diagnostic[] = [];
    for (const f of findings) {
      if (typeof f.offset !== "number") {
        continue;
      }
      const line = lineForOffset(offsets, f.offset);
      if (line === undefined) {
        continue;
      }
      const text = lines[line] ?? "";
      const start = text.length - text.trimStart().length;
      const d = new vscode.Diagnostic(
        new vscode.Range(line, start, line, text.length),
        f.message ?? f.type,
        SEVERITY[f.severity ?? "warning"]
      );
      d.source = "abap2UI5-linter";
      d.code = f.type;
      out.push(d);
    }
    diagnostics.set(virtualUri, out);
  }

  function render(virtualUri: vscode.Uri, source: vscode.TextDocument): string {
    const key = virtualUri.toString();
    const prep = prepareAbap(source.getText());
    const className =
      classNameOf(source.getText(), source.fileName).toUpperCase() ||
      "this class";
    if (!prep.nodes.length) {
      const empty =
        `<!-- ${className}: no view could be reconstructed - the class calls ` +
        `z2ui5_cl_ai_xml=>factory( ) but nothing checkable came out of the ` +
        `builder chain. -->\n`;
      lastContent.set(key, empty);
      lastOffsets.delete(key);
      diagnostics.delete(virtualUri);
      return empty;
    }
    const formatted = formatDocument(prep.nodes, className);
    lastContent.set(key, formatted.text);
    lastOffsets.set(key, formatted.lineOffsets);
    mirrorFindings(
      virtualUri,
      source,
      formatted.lineOffsets,
      formatted.text.split("\n")
    );
    return formatted.text;
  }

  const provider = new (class implements vscode.TextDocumentContentProvider {
    readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
      const source = sourceDocOf(uri.toString());
      if (!source) {
        return (
          lastContent.get(uri.toString()) ??
          "<!-- The ABAP class this view was reconstructed from is no longer open. -->\n"
        );
      }
      return render(uri, source);
    }
  })();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      XML_PREVIEW_SCHEME,
      provider
    ),
    diagnostics,
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },

    // A line of the XML knows the builder call that wrote it.
    vscode.languages.registerDefinitionProvider(
      { scheme: XML_PREVIEW_SCHEME },
      {
        provideDefinition(doc, position) {
          const offsets = lastOffsets.get(doc.uri.toString());
          const source = sourceDocOf(doc.uri.toString());
          const offset = offsets?.[position.line];
          if (!source || offset === undefined) {
            return undefined;
          }
          const at = source.positionAt(Math.min(offset, source.getText().length));
          return new vscode.Location(
            source.uri,
            source.lineAt(at.line).range
          );
        },
      }
    ),

    vscode.commands.registerCommand("abap2ui5.showReconstructedXml", async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (
        !doc ||
        (doc.languageId !== "abap" && !/\.abap$/i.test(doc.fileName)) ||
        !usesBuilder(doc.getText())
      ) {
        vscode.window.showInformationMessage(
          "abap2UI5: open an ABAP class that builds views with " +
            "z2ui5_cl_ai_xml to see its reconstructed XML."
        );
        return;
      }
      const uri = virtualUriFor(doc);
      sources.set(uri.toString(), doc.uri);
      const virtual = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(virtual, "xml");
      await vscode.window.showTextDocument(virtual, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
        preview: false,
      });
      log(`xml-preview: showing the reconstruction of ${doc.fileName}`);
    }),

    // The reconstruction follows the class: re-render shortly after each
    // pause, but only for sources that actually have a preview open.
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!e.contentChanges.length) {
        return;
      }
      const changed = e.document.uri.toString();
      for (const [virtualKey, sourceUri] of sources) {
        if (sourceUri.toString() !== changed) {
          continue;
        }
        const existing = timers.get(virtualKey);
        if (existing) {
          clearTimeout(existing);
        }
        timers.set(
          virtualKey,
          setTimeout(() => {
            timers.delete(virtualKey);
            provider.onDidChangeEmitter.fire(vscode.Uri.parse(virtualKey));
          }, REFRESH_DEBOUNCE_MS)
        );
      }
    }),

    // A closed preview tab does not need refreshing any more.
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === XML_PREVIEW_SCHEME) {
        const key = doc.uri.toString();
        sources.delete(key);
        lastContent.delete(key);
        lastOffsets.delete(key);
        diagnostics.delete(doc.uri);
        const timer = timers.get(key);
        if (timer) {
          clearTimeout(timer);
          timers.delete(key);
        }
      }
    })
  );
}
