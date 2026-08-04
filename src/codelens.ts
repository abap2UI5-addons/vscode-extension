import * as vscode from "vscode";
import { classDefinitionOffset, isAppClass, usesBuilder } from "./abap";
import { eventUsagesOf, whenBranches } from "./context";

/*
 * The three things you do to an app class, offered where the class is
 * declared.
 *
 * F9 and Ctrl+F3 are the fast path once you know them, but nothing in the
 * editor says they exist - the extension's whole dev loop was discoverable
 * only through the command palette. A lens above `CLASS … DEFINITION` costs
 * one line and makes it obvious.
 */

class AppCodeLens implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  /** Re-emit when the setting is toggled - the lenses appear or vanish. */
  refresh(): void {
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration("abap2ui5").get<boolean>("codeLens", true)) {
      return [];
    }
    const text = doc.getText();
    const app = isAppClass(text);
    const builder = usesBuilder(text);
    if (!app && !builder) {
      return [];
    }
    const range = new vscode.Range(
      doc.positionAt(classDefinitionOffset(text)),
      doc.positionAt(classDefinitionOffset(text))
    );
    const lenses: vscode.CodeLens[] = [];
    if (app) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(play) Run",
          tooltip: "Launch this app in the preview (F9)",
          command: "abap2ui5.run",
        }),
        new vscode.CodeLens(range, {
          title: "$(zap) Activate & reload",
          tooltip: "Activate through your ABAP tooling, then reload the preview",
          command: "abap2ui5.activate",
        })
      );
    }
    if (builder) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(checklist) Check views",
          tooltip: "Run the static view check on this class",
          command: "abap2ui5.checkViews",
        })
      );
      lenses.push(...whenLenses(doc, text));
    }
    return lenses;
  }
}

/**
 * One lens over every `WHEN '…'` the view actually raises: "raised n× in
 * the view", opening a peek at the `_event( )` call(s). A WHEN nothing
 * raises gets no lens - the CASE may switch over something else entirely,
 * and a wrong "0×" would accuse innocent code.
 */
function whenLenses(doc: vscode.TextDocument, text: string): vscode.CodeLens[] {
  const lenses: vscode.CodeLens[] = [];
  for (const branch of whenBranches(text)) {
    const usages = eventUsagesOf(text, branch.name);
    if (!usages.length) {
      continue;
    }
    const at = doc.positionAt(branch.start);
    const locations = usages.map((usage) => {
      const pos = doc.positionAt(usage);
      return new vscode.Location(doc.uri, doc.lineAt(pos.line).range);
    });
    lenses.push(
      new vscode.CodeLens(new vscode.Range(at, at), {
        title: `$(zap) raised ${usages.length}× in the view`,
        tooltip: "Peek the _event( ) call(s) raising this event",
        command: "editor.action.showReferences",
        arguments: [doc.uri, at, locations],
      })
    );
  }
  return lenses;
}

export function registerCodeLens(context: vscode.ExtensionContext): void {
  const provider = new AppCodeLens();
  context.subscriptions.push(
    provider,
    vscode.languages.registerCodeLensProvider({ language: "abap" }, provider),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("abap2ui5.codeLens")) {
        provider.refresh();
      }
    })
  );
}
