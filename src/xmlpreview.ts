import * as vscode from "vscode";
import { prepareAbap } from "@abap2ui5/linter/reconstruct";
import { classNameOf, usesBuilder } from "./abap";
import { prettyDocument } from "./xmlformat";

/*
 * "Show Reconstructed XML View" - the linter's view of the class, for people.
 *
 * abap2UI5 views are strings assembled by builder calls, so what actually
 * reaches `XMLView.create` is never visible in the source. The linter
 * reconstructs exactly that for its checks; this module opens the same
 * reconstruction as a read-only XML document next to the class and keeps it
 * following the edits. Debugging a binding or nesting problem stops being
 * "stare at the builder chain" and becomes "read the view".
 */

export const XML_PREVIEW_SCHEME = "abap2ui5-xml";

/** How long after the last keystroke the XML refreshes - same rhythm as the
 *  live view check, for the same reason. */
const REFRESH_DEBOUNCE_MS = 400;

/** virtual document -> the ABAP source it renders. */
const sources = new Map<string, vscode.Uri>();

/** Last rendered content, so the tab survives its source being closed. */
const lastContent = new Map<string, string>();

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

function render(source: vscode.TextDocument): string {
  const prep = prepareAbap(source.getText());
  const className =
    classNameOf(source.getText(), source.fileName).toUpperCase() || "this class";
  if (!prep.nodes.length) {
    return (
      `<!-- ${className}: no view could be reconstructed - the class calls ` +
      `z2ui5_cl_ai_xml=>factory( ) but nothing checkable came out of the ` +
      `builder chain. -->\n`
    );
  }
  return prettyDocument(prep.nodes, className);
}

class ReconstructedXmlProvider implements vscode.TextDocumentContentProvider {
  readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = uri.toString();
    const sourceUri = sources.get(key);
    const source =
      sourceUri &&
      vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === sourceUri.toString()
      );
    if (!source) {
      return (
        lastContent.get(key) ??
        "<!-- The ABAP class this view was reconstructed from is no longer open. -->\n"
      );
    }
    const content = render(source);
    lastContent.set(key, content);
    return content;
  }
}

export function registerXmlPreview(
  context: vscode.ExtensionContext,
  log: (m: string) => void
): void {
  const provider = new ReconstructedXmlProvider();
  const timers = new Map<string, NodeJS.Timeout>();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      XML_PREVIEW_SCHEME,
      provider
    ),
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },

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
        const timer = timers.get(key);
        if (timer) {
          clearTimeout(timer);
          timers.delete(key);
        }
      }
    })
  );
}
