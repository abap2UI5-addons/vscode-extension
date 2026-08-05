import * as vscode from "vscode";
import { APP_TEMPLATES, templateSource } from "./template";

/*
 * "New App from Template" - the template gallery behind abap2ui5.newApp.
 *
 * Two steps: pick a template (empty view, list, form, master & detail,
 * popup), name the class. The result lands where the user already is: at the
 * cursor of an open ABAP editor, or as a fresh untitled ABAP document when
 * none is open. Every template ships linter-clean - the test suite runs each
 * one through the bundled gates.
 *
 * Shared by the desktop and the web entry: nothing here needs a process or
 * a socket.
 */

const CLASS_NAME_RE = /^[zy][a-z0-9_]{0,29}$/i;

export async function newAppWizard(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    APP_TEMPLATES.map((template) => ({
      label: template.label,
      description: template.description,
      template,
    })),
    {
      title: "abap2UI5: new app",
      placeHolder: "Which kind of app to start from",
    }
  );
  if (!pick) {
    return;
  }
  const className = await vscode.window.showInputBox({
    title: "abap2UI5: class name",
    value: "zcl_my_app",
    prompt: "Name of the app class (customer namespace, up to 30 characters)",
    validateInput: (value) =>
      CLASS_NAME_RE.test(value.trim())
        ? undefined
        : "A class name starts with Z (or Y) and uses letters, digits and _ only.",
  });
  if (!className) {
    return;
  }
  const source = templateSource(pick.template, className.trim());

  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === "abap") {
    await editor.edit((b) => b.insert(editor.selection.active, source));
    return;
  }
  const doc = await vscode.workspace.openTextDocument({
    language: "abap",
    content: source,
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

export function registerNewApp(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("abap2ui5.newApp", () => newAppWizard())
  );
}
