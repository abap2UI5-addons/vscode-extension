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
| `src/extension.ts` | Activation, the F9 command, the Ctrl+F3 activate-and-reload command, webview tab and panel, reload handling |
| `src/webview.ts` | HTML for the preview and the welcome screen (theme variables, CSP nonce, theme/language pickers) |
| `src/proxy.ts` | Local reverse proxy that injects basic auth so the embedded iframe avoids a 401 |
| `src/systems.ts` | Named launch profiles, the active-system state, credentials per host |
| `src/viewcheck.ts` | Static view checks via abap2UI5-linter: live + on-save + on-demand + workspace, findings as diagnostics |
| `src/lintconfig.ts` | Discovers and merges the repo's `abap2ui5lint.jsonc` with the VS Code settings |
| `src/quickfix.ts` | Code actions: the linter's own fixes, "fix all", and the disable-directive waiver |
| `src/language.ts` | Completion and hover, wired from `context.ts` + `metadata.ts` |
| `src/codelens.ts` | Run / Activate & reload / Check views above the class definition |
| `src/mcp.ts` | Registers the abap2UI5 MCP server (ai-mcp) for MCP clients in the window |
| `src/snapshot.ts` | Loads the bundled UI5 metadata once, for the gate and the language features |
| `src/abap.ts`, `src/urls.ts`, `src/context.ts`, `src/metadata.ts` | The `vscode`-free helpers — see below |
| `src/test/` | `node --test` suite over exactly those modules |
| `snippets/` | ABAP snippets contributed to the editor |
| `media/` | Icons: `icon.svg` (panel), `icon-light/dark.svg` (preview tab), `icon.png` (gallery) |
| `esbuild.js` | Bundles `src/extension.ts` into `dist/extension.js`, and `src/test/` into `dist-test/` |
| `.github/workflows/` | `ci.yml` builds every push and PR, `release.yml` publishes a tagged `.vsix` |

`dist/`, `dist-test/`, `node_modules/` and `*.vsix` are build output and are
not committed.

**The `vscode`-free boundary is load-bearing.** `abap.ts`, `urls.ts`,
`context.ts`, `metadata.ts`, `lintconfig.ts` and `snapshot.ts` must not import
`vscode`: the test suite bundles them for plain Node, and an accidental import
turns a unit test into a module-not-found error. Put the interesting logic
there and keep the VS Code modules to plumbing — that is what made the regex
bugs (`INTERFACES:`, a class name inside a comment) testable at all.

## Build and verify

Run all four before pushing. CI runs the same commands on every push and pull
request, so a failure there means you skipped this:

```bash
npm install
npm run lint      # tsc --noEmit
npm test          # esbuild -> dist-test, then node --test
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
  proxy holds them in memory only, as a prepared header. They are keyed by
  origin (`abap2ui5.user:<origin>`); the unscoped pre-0.14 keys are migrated
  on first use, so do not reuse those names for anything else.
- **A setting that names a program to start is `"scope": "machine"`.**
  `viewCheck.command`, `mcp.command` and `mcp.reposRoot` decide which binary
  the extension spawns; machine scope keeps a cloned repository's
  `.vscode/settings.json` out of that decision. The same three are listed
  under `capabilities.untrustedWorkspaces.restrictedConfigurations`.
- **The linter owns the rules, this extension owns the presentation.**
  Severity, wording, the `fixes` on a finding, the `rules` block and the
  `abap2ui5lint-disable…` directives all live in `@abap2ui5/linter` and are
  applied through it — never re-derived here. Two copies of that semantics is
  exactly how the editor and CI drifted apart before.

## Toolchain & supply chain

Facts an agent cannot see from the code but will trip over:

- **The linter is a git devDependency pinned to a COMMIT in the lockfile.**
  `"@abap2ui5/linter": "github:abap2UI5/linter"` resolves in
  `package-lock.json` to a fixed SHA (as a `git+ssh://` URL — `npm ci` can
  fail in HTTPS-only/tokenless environments, and it pulls the linter's full
  tree: all `@openui5/*` packages plus playwright, hundreds of MB).
  Consequences: a new linter finding type is **invisible in the editor until
  the lock is bumped** — bump deliberately with
  `npm install @abap2ui5/linter@github:abap2UI5/linter` and commit
  the lockfile (this has been done by hand before; it is the release lever).
- **`esbuild.js` carries two load-bearing hacks** — do not "clean them up":
  the `import.meta.url` define + `scripts/import-meta-url-shim.mjs` inject
  (ESM linter modules bundled into CJS), and `copySnapshot()`, which copies
  the linter's `data/properties.json` into `dist/` at build time. If
  `dist/properties.json` is missing, the property gate runs with **no
  metadata and finds nothing**, and completion and hover go quiet with it —
  `snapshot.ts` logs why, which is the only signal you get. The test build
  copies the same file into `dist-test/`, because `snapshot.ts` resolves it
  next to its own bundle.
- **The rule reference is coupled by URL, not by import.** Every diagnostic's
  code links to `https://abap2ui5.github.io/linter/#<rule-id>`, which the
  linter's `generate-rules-page` emits one anchor per rule for. The rule ids
  themselves come from the linter's exported `RULES`, so an id that stops
  existing stops being linked rather than producing a dead link — but the page
  URL is hard-coded in `viewcheck.ts` and moves with the linter's Pages
  deployment.
- **The snapshot's shape is a contract now.** `metadata.ts` reads
  `parent` / `members` / `properties` / `aggregations` / `associations` /
  `events` / `__enums` out of it for completion and hover. `metadata.test.ts`
  runs against the *real* bundled snapshot on purpose: a regenerated snapshot
  that renamed a section would pass any mocked test and silently empty the
  completion list.
- **The render gate is downloaded at runtime**, not bundled:
  `src/rendergate.ts` fetches `view-check-bundle.tgz` from the linter's
  rolling prerelease tag `render-gate-bundle` (published by the linter's
  `bundle.yml` on every merge to its main). What installed extensions
  execute for the render gate therefore changes without any release of this
  extension — when debugging a render-gate report, check what the bundle
  currently contains, not only the pinned package.
- **The editor/CI divergence is closed, keep it closed.** `src/lintconfig.ts`
  discovers the workspace's `abap2ui5lint.jsonc` through the linter's own
  `findConfigFrom`/`loadConfig` and lets it win over the VS Code settings, and
  `viewcheck.ts` applies the linter's `applyRules` and `applyDirectives`. Any
  new knob the linter's config grows belongs in that merge — and never as a
  second implementation of the JSONC parsing or the directive syntax here.
- The MCP registration (`src/mcp.ts`) and the view checker (`src/viewcheck.ts`)
  both probe checkout directories by name: `linter` (the checker's own
  repository name) plus the **pre-rename aliases** `abap2UI5-linter` and
  `ai-view-check`. The same list lives in ai-mcp's `lib/repos.mjs` as
  `VIEW_CHECK_DIRS` — keep all three in sync, and drop an alias only in a
  coordinated change.

## Related repositories

| Repository | Purpose |
| --- | --- |
| [abap2UI5](https://github.com/abap2UI5/abap2UI5) | Core framework |
| [samples](https://github.com/abap2UI5/samples) | Sample applications |
| [ai-demokit](https://github.com/abap2UI5/ai-demokit) | Ported demo-kit samples — where this extension used to live, until 0.6.0 |
| [abap2UI5-linter](https://github.com/abap2UI5/linter) | The view checker behind `src/viewcheck.ts` (SHA-pinned package) and `src/rendergate.ts` (runtime bundle download) |
| [ai-mcp](https://github.com/abap2UI5/ai-mcp) | The MCP server `src/mcp.ts` registers for MCP clients in the window |
