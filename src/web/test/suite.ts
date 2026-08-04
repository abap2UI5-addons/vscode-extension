import * as vscode from "vscode";

/*
 * The web smoke test, run INSIDE a browser extension host by
 * `@vscode/test-web` (`npm run test:web`).
 *
 * It answers the one question the desktop suite cannot: does the web bundle
 * actually load and activate in a browser host? A module that newly drags a
 * node builtin into the web graph, a snapshot that stops parsing, a
 * registration that throws - all of it surfaces here as a failed activation
 * instead of a broken Marketplace build.
 *
 * Activation is explicit: the host has no ABAP language extension, so the
 * `onLanguage:abap` event never fires on its own.
 */

/** What a successful web activation must have registered. */
const EXPECTED_COMMANDS = [
  "abap2ui5.checkViews",
  "abap2ui5.showReconstructedXml",
  "abap2ui5.newApp",
  "abap2ui5.openHomepage",
];

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("abap2ui5.abap2ui5");
  if (!extension) {
    throw new Error("abap2ui5.abap2ui5 is not present in the web host");
  }
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const id of EXPECTED_COMMANDS) {
    if (!commands.includes(id)) {
      throw new Error(`${id} was not registered by the web activation`);
    }
  }
}
