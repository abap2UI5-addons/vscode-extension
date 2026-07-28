# AGENTS.md

Single source of truth for agents working on the **abap2UI5 VS Code
extension** — the extension that launches `z2ui5_if_app` classes in an
embedded preview from the editor.

> These instructions OVERRIDE any default behavior and must be followed exactly.

## Language

**This entire project is in English.** All code, comments, identifiers, commit
messages, PR titles, PR descriptions, documentation, and any other text must be
written in English.

This explicitly includes **everything the user sees inside VS Code**:

- command titles in `contributes.commands`
- setting descriptions and `enumDescriptions` in `contributes.configuration`
- input-box titles and prompts, information/warning/error messages
- text rendered inside the webview (including `lang="en"` on the HTML)
- snippet names and descriptions

The extension was originally written in German and translated in 0.7.0. If you
find a German string anywhere, it is a leftover — translate it.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/extension.ts` | Activation, the F9 command, webview tab and panel, auto-reload, credential handling |
| `src/webview.ts` | HTML for the preview and the welcome screen (theme variables, CSP nonce) |
| `src/proxy.ts` | Local reverse proxy that injects basic auth so the embedded iframe avoids a 401 |
| `snippets/` | ABAP snippets contributed to the editor |
| `media/` | Icons: `icon.svg` (panel), `icon-light/dark.svg` (preview tab), `icon.png` (gallery) |
| `esbuild.js` | Bundles `src/extension.ts` into `dist/extension.js` |

`dist/`, `node_modules/` and `*.vsix` are build output and are not committed.

## Build and verify

Run all three before pushing — there is currently no CI to catch what you miss:

```bash
npm install
npm run lint      # tsc --noEmit
npm run package   # production esbuild
npm run vsix      # vsce package, catches manifest errors
```

## Conventions

- **Keep the manifest and the code in sync.** Every command registered with
  `registerCommand` needs a matching entry in `contributes.commands`, and vice
  versa — a mismatch only shows up at runtime, not in `tsc`.
- **Settings live under the `abap2ui5.` prefix** and are read through
  `CONFIG_SECTION`. Command IDs use the same prefix.
- **Do not rename `name` or `publisher` casually.** Together they form the
  extension ID; changing it makes VS Code treat the result as a different
  extension, orphaning the old install and the SecretStorage entries (which are
  scoped per extension ID). Settings are unaffected — they live in
  `settings.json`.
- **Bump `version` and add a `CHANGELOG.md` entry** with every user-visible
  change. The changelog is written for users of the extension, not for
  reviewers of the diff.
- **Webview markup lives in `src/webview.ts`,** styled only with `--vscode-*`
  theme variables so it works in light, dark and high-contrast themes. Inline
  `<style>`/`<script>` carry the CSP nonce - no `unsafe-inline`, and therefore
  no `style="..."` attributes in the markup either.
- **Never log or persist credentials** anywhere but `context.secrets`. The
  proxy holds them in memory only, as a prepared header.

## Related repositories

| Repository | Purpose |
| --- | --- |
| [abap2UI5](https://github.com/abap2UI5/abap2UI5) | Core framework |
| [samples](https://github.com/abap2UI5/samples) | Sample applications |
| [ai-demokit](https://github.com/abap2UI5/ai-demokit) | Ported demo-kit samples — where this extension used to live, until 0.6.0 |
