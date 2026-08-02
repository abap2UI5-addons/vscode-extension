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
| `src/extension.ts` | Activation, the F9 command, the Ctrl+F3 activate-and-reload command, webview tab and panel, reload handling, credentials |
| `src/webview.ts` | HTML for the preview and the welcome screen (theme variables, CSP nonce) |
| `src/proxy.ts` | Local reverse proxy that injects basic auth so the embedded iframe avoids a 401 |
| `src/viewcheck.ts` | Static view checks via abap2UI5-linter: on-save + on-demand, findings as diagnostics |
| `src/mcp.ts` | Registers the abap2UI5 MCP server (ai-mcp) for MCP clients in the window |
| `snippets/` | ABAP snippets contributed to the editor |
| `media/` | Icons: `icon.svg` (panel), `icon-light/dark.svg` (preview tab), `icon.png` (gallery) |
| `esbuild.js` | Bundles `src/extension.ts` into `dist/extension.js` |
| `.github/workflows/` | `ci.yml` builds every push and PR, `release.yml` publishes a tagged `.vsix` |

`dist/`, `node_modules/` and `*.vsix` are build output and are not committed.

## Build and verify

Run all three before pushing. CI runs the same commands on every push and pull
request, so a failure there means you skipped this:

```bash
npm install
npm run lint      # tsc --noEmit
npm run package   # production esbuild
npm run vsix      # vsce package, catches manifest errors
```

CI installs with `npm ci`, so `package-lock.json` has to stay in sync with
`package.json` — a lockfile left behind fails the build before anything else
runs.

## Releasing

The `.vsix` is not committed; users download it from the GitHub release.
Releasing is a tag:

1. Bump `version` in `package.json` and add the matching `CHANGELOG.md` section.
2. Either run the **Release** workflow from the Actions tab (it tags
   `v<version>` itself) or push the tag by hand:
   `git tag v<version> && git push origin v<version>`.

`release.yml` verifies that tag and `package.json` agree, refuses a version
that is already released, builds the `.vsix` and attaches it to the release,
using that version's changelog section as the release notes. **The changelog heading has to be exactly `## <version>`** — the
notes are extracted by matching that line, and a mismatch silently produces an
empty release body (the workflow falls back to a placeholder).

## Conventions

- **Keep the manifest and the code in sync.** Every command registered with
  `registerCommand` needs a matching entry in `contributes.commands`, and vice
  versa — a mismatch only shows up at runtime, not in `tsc`.
- **Settings live under the `abap2ui5.` prefix** and are read through
  `CONFIG_SECTION`. Command IDs use the same prefix.
- **The preview reloads on activation, not on save.** A saved ABAP class is
  still inactive on the server, so reloading would show the old version. Keys
  that other ABAP extensions own (F9, Ctrl+F3) are taken over only with a
  fallback: the command delegates to what the key would otherwise do.
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

## Toolchain & supply chain

Facts an agent cannot see from the code but will trip over:

- **The linter is a git devDependency pinned to a COMMIT in the lockfile.**
  `"@abap2ui5/linter": "github:abap2UI5/abap2UI5-linter"` resolves in
  `package-lock.json` to a fixed SHA (as a `git+ssh://` URL — `npm ci` can
  fail in HTTPS-only/tokenless environments, and it pulls the linter's full
  tree: all `@openui5/*` packages plus playwright, hundreds of MB).
  Consequences: a new linter finding type is **invisible in the editor until
  the lock is bumped** — bump deliberately with
  `npm install @abap2ui5/linter@github:abap2UI5/abap2UI5-linter` and commit
  the lockfile (this has been done by hand before; it is the release lever).
- **Node versions are mismatched by design debt**: CI pins Node 20
  (`ci.yml`/`release.yml`) while the linter declares `engines >= 22`. npm
  only warns today; if an install starts failing on engines, this is why.
- **`esbuild.js` carries two load-bearing hacks** — do not "clean them up":
  the `import.meta.url` define + `scripts/import-meta-url-shim.mjs` inject
  (ESM linter modules bundled into CJS), and `copySnapshot()`, which copies
  the linter's `data/properties.json` into `dist/` at build time. If
  `dist/properties.json` is missing, the property gate runs with **no
  metadata and finds nothing** — silently.
- **The render gate is downloaded at runtime**, not bundled:
  `src/rendergate.ts` fetches `view-check-bundle.tgz` from the linter's
  rolling prerelease tag `render-gate-bundle` (published by the linter's
  `bundle.yml` on every merge to its main). What installed extensions
  execute for the render gate therefore changes without any release of this
  extension — when debugging a render-gate report, check what the bundle
  currently contains, not only the pinned package.
- The MCP registration (`src/mcp.ts`) and the view checker still resolve the
  **pre-rename alias `ai-view-check`** alongside `abap2UI5-linter` (mirrored
  in ai-mcp's `lib/repos.mjs`) — drop it only in a coordinated change.

## Related repositories

| Repository | Purpose |
| --- | --- |
| [abap2UI5](https://github.com/abap2UI5/abap2UI5) | Core framework |
| [samples](https://github.com/abap2UI5/samples) | Sample applications |
| [ai-demokit](https://github.com/abap2UI5/ai-demokit) | Ported demo-kit samples — where this extension used to live, until 0.6.0 |
| [abap2UI5-linter](https://github.com/abap2UI5/abap2UI5-linter) | The view checker behind `src/viewcheck.ts` (SHA-pinned package) and `src/rendergate.ts` (runtime bundle download) |
| [ai-mcp](https://github.com/abap2UI5/ai-mcp) | The MCP server `src/mcp.ts` registers for MCP clients in the window |
