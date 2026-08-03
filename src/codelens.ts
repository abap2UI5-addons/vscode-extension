import * as vscode from "vscode";
import { classDefinitionOffset, isAppClass, usesBuilder } from "./abap";

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
    }
    return lenses;
  }
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
