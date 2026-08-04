import * as vscode from "vscode";

/*
 * The one place that says which documents the view tooling applies to. Both
 * builds import it: the desktop bundle through quickfix/viewcheck, the web
 * bundle through the language features alone - which is why it must not pull
 * anything heavier than `vscode` in.
 */

/** The files the view providers are offered for. `abap` carries no scheme on
 *  purpose: classes opened from a system through the ABAP remote filesystem
 *  live under `adt:`, and they are the main case. */
export const VIEW_SELECTOR: vscode.DocumentSelector = [
  { language: "abap" },
  { pattern: "**/*.view.xml" },
  { pattern: "**/*.fragment.xml" },
];
