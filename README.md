# abap2UI5 for VS Code

VS Code extension for developing **abap2UI5** apps: launch an app with **F9**,
see it right next to the source, and have it reload automatically when you
activate the class — without the context switch to the browser.

Works with any system running abap2UI5 (on-premise or cloud). The only thing
tying the extension to a system is the launch URL you configure once.

## Features

- **F9 runs the app** – With the cursor in an ABAP class that implements
  `z2ui5_if_app`, **F9** opens the app in an embedded browser next to the
  source. If the class is *not* a z2ui5 app, F9 behaves as usual (toggle
  breakpoint), so you don't lose the key.
- **Focus stays in the code** – After launching, the cursor returns to the same
  spot in the source, even when the loading app tries to grab focus.
- **Reload on activation, not on save** – **Ctrl+F3** (`Cmd+F3` on macOS)
  saves the class, activates it through your ABAP tooling and then reloads the
  preview. Activations done any other way are noticed on the server and reload
  the preview too. A plain save leaves the server on the active version, so it
  does not reload — the preview shows a *not activated* badge instead. See
  [Reloading](#reloading-abap2ui5reloadon).
- **Preview toolbar** – Class name, system URL, status dot and buttons for
  reload and "open externally". Themed with your VS Code colour theme.
- **Device widths, theme and language** – Switch the preview between desktop,
  tablet (834px) and phone (414px), and between UI5 themes and logon
  languages, to check a responsive app without leaving the editor.
- **Status bar** – While an app is running the status bar shows the class and
  the system; clicking it reloads the preview.
- **Several systems** – Name your systems in `abap2ui5.systems` and switch
  with *"abap2UI5: Select System"*. The choice is remembered per window and
  credentials are stored per host. See [Systems](#systems-abap2ui5systems).
- **Login without a 401** – For the embedded view the extension ships a local
  auth proxy (see below).
- **Static view checks** – A class that builds views with `z2ui5_cl_ai_xml`
  (or a raw `*.view.xml`) is validated against the UI5 metadata *while you
  type*: too-new or deprecated controls and properties land in the Problems
  panel before the app ever reaches a system. See
  [Static view checks](#static-view-checks-abap2ui5viewcheck).
- **Quick fixes** – The findings whose correction is mechanical carry it with
  them, and the lightbulb offers it. Plus "suppress on this line", which
  writes the linter directive CI honours too.
- **Completion and hover for the whole UI5 API** – Control names, the members
  of exactly that control, and the values an enum property accepts — from the
  metadata snapshot the extension already ships. See
  [Completion and hover](#completion-and-hover).
- **The abap2UI5 MCP server for AI agents** – Copilot agent mode (and every
  other MCP client in the window) gets the abap2UI5 dev loop without an SAP
  system. See [MCP server](#mcp-server-abap2ui5mcp).
- **Snippets** for ABAP files: `z2ui5app`, `z2ui5open`, `z2ui5leaf`,
  `z2ui5button`, `z2ui5input`, `z2ui5table`, `z2ui5event`, `z2ui5disable`.
- **Insert an app template** – Class skeleton for a new abap2UI5 app.

All commands are available from the Command Palette (`Ctrl/Cmd + Shift + P`).

## Setting the launch URL

On the first F9 the extension asks for the launch URL — the command
*"abap2UI5: Set Launch URL"* asks again at any time. `{class}` is the
placeholder for the class name:

```
https://host:44300/sap/bc/z2ui5?app_start={class}&sap-client=100
```

The URL is stored and can be changed at any time under
Settings → `abap2ui5.launchUrlTemplate` (or directly in `settings.json`).

## Systems (`abap2ui5.systems`)

One launch URL covers one system, which is rarely how anybody works. Name them
instead:

```jsonc
"abap2ui5.systems": [
  { "name": "DEV",     "url": "https://dev:44300/sap/bc/z2ui5?app_start={class}&sap-client=100" },
  { "name": "Sandbox", "url": "https://box:44300/sap/bc/z2ui5?app_start={class}" }
]
```

*"abap2UI5: Select System"* switches between them — and adds one, so you never
have to find the JSON. The active system is remembered **per window**, so two
windows can work against two systems at once, and it is shown in the status
bar next to the running class.

Credentials follow the system: they are stored per host in the SecretStorage,
so switching back and forth does not ask again. `abap2ui5.launchUrlTemplate`
keeps working as the single-system shorthand and becomes the first entry of
the list as soon as you add a second one.

## Open mode (`abap2ui5.openMode`)

| Mode | Behaviour |
| --- | --- |
| `tab` (default) | App embedded in an editor tab next to the code, through the local auth proxy |
| `panel` | The same, but in the bottom panel area next to Terminal/Output |
| `external` | In the normal browser (reuses your existing SAP session/SSO, no proxy needed) |

The choice does not have to be made in the settings: **abap2UI5: Show the
Preview in the Panel** and **abap2UI5: Show the Preview in an Editor Tab**
switch the mode and take a running app along — it changes place, it does not
restart. The panel's title bar carries the way back, and the panel's empty
state says which mode is in force, so it never asks you to press F9 for an app
that opens somewhere else.

### How the login works in tab/panel mode (auth proxy)

An embedded iframe has **no** SAP session — a direct call would end in a
**401 Not authorized**. That is why in `tab` and `panel` mode the extension
starts a local auth proxy on `127.0.0.1`:

1. On the first launch it asks **once** for your SAP user and password (the
   same ones you use in ADT). They are kept in the VS Code **SecretStorage**.
2. The proxy attaches `Authorization: Basic …` to **every** request and
   forwards it to your system — including UI5 resources, cookies, CSRF tokens
   and redirects. `Origin` and `Referer` are rewritten to the system's own
   origin, so origin-validating CSRF checks accept the app's POSTs.
3. The iframe loads `http://127.0.0.1:<port>/…`, so the app runs embedded
   without a 401.

To make embedding possible at all, the proxy strips `X-Frame-Options` and the
CSP directive `frame-ancestors` from the responses. Self-signed HTTPS
certificates are accepted.

> **Requirement:** the system must accept **basic auth**. Pure SSO/SAML login
> without a basic-auth fallback is not supported — use `external` in that case.
> When the system rejects the logon, the extension says so and offers to
> retype the credentials, instead of leaving an unhelpful page in the iframe.
>
> **Change or delete credentials:** run the command *"abap2UI5: Clear Stored
> SAP Credentials"*. The next F9 asks again.

## Reloading (`abap2ui5.reloadOn`)

Saving an ABAP class does not change what the server runs — only **activation**
does. That is why the preview reloads on activation and not on every save:

| Value | Behaviour |
| --- | --- |
| `activation` (default) | **Ctrl+F3** saves the class, activates it and reloads the preview; activations done any other way are detected on the server. A plain save only marks the preview *not activated* |
| `save` | Reload on every save of the shown class — for setups in which saving already publishes the change |
| `never` | Only F9, the reload button in the preview or the status bar reload |

**Ctrl+F3** (`Cmd+F3` on macOS, the activation key from SAP GUI) runs
*abap2UI5: Activate and Reload Preview*: it saves the class, hands the
activation to the ABAP extension you already use — the
[ABAP remote filesystem](https://marketplace.visualstudio.com/items?itemName=murbani.vscode-abap-remote-fs)
extension and its `abapfs.activate` — and reloads the preview afterwards. The
same command sits behind the ⚡ button in the editor toolbar.

The key is only taken over for ABAP objects opened from a system (scheme
`adt`). Everywhere else Ctrl+F3 keeps its usual VS Code meaning.

> **Activating any other way works too.** VS Code gives no notification when
> another extension activates an object, so while the preview shows the *not
> activated* badge, the extension watches the class on the server instead (its
> ADT metadata, fetched with the same credentials the preview already uses)
> and reloads as soon as the class is active again — whether you activated
> with Ctrl+F3, the ABAP remote filesystem's own button, or even from Eclipse.
> The watch requires the ADT services (`/sap/bc/adt`) to answer on the
> launch-URL host; where they don't, the badge simply stays until you reload
> (click the badge, the toolbar button, the status bar or F9). The **abap2UI5**
> output channel (View → Output) shows what the watch sees — the place to look
> when the automatic reload does not happen.

> The predecessor `abap2ui5.reloadOnSave` still works while `abap2ui5.reloadOn`
> is unset: `false` behaves like `never`, `true` like `save`.

## Static view checks (`abap2ui5.viewCheck.*`)

abap2UI5 views are built as strings — a typo'd property or a control newer
than your system's UI5 version normally fails at runtime in the browser. The
extension runs the [abap2UI5-linter](https://github.com/abap2UI5/linter)
gates instead, in the editor:

- **SAPUI5 or OpenUI5** (`abap2ui5.viewCheck.distribution`) — SAPUI5 ships
  libraries OpenUI5 does not (`sap.ui.comp`, `sap.suite.*`, `sap.ushell`,
  `sap.fe`, …), so a SmartTable is fine on SAPUI5 and a guaranteed runtime
  error on OpenUI5. Set it to what your system serves; with `openui5` those
  controls become errors.
- **Property gate** — bundled with the extension, zero setup, instant:
  every control and property written in the view is resolved against a UI5
  metadata snapshot. A control that does not exist at all (`sap.m.Shell2` —
  a typo) is an error; anything newer than the configured UI5 floor
  (default **1.71**) or deprecated is a warning.
- **abap2UI5-specific rules** — the defects that stay *silent* at runtime:
  a hand-written binding path the model does not have, `_bind( )` on an
  event or `_event( )` on a property, a value bound to a local variable
  (lost after the roundtrip), an event nothing handles, and the obsolete
  `client->_bind_edit( )`. Plus duplicate `id`s, undeclared namespace
  prefixes and basic accessibility defects.
- **Render gate** (optional, `abap2ui5.viewCheck.render`) — the view is
  loaded with a real `XMLView.create` in headless Chromium, so broken
  expression bindings and property-type violations fail too. Install it
  once with *"abap2UI5: Install Render Gate"*: the command downloads the
  self-contained checker bundle (~30 MB, published by abap2UI5-linter's CI)
  and Chromium into the extension's storage and runs everything with VS
  Code's own runtime — no node, npm or PATH setup on the machine.
  Alternatively point `abap2ui5.mcp.reposRoot` at a folder containing your
  own `linter` checkout (`npm ci` +
  `npx playwright install chromium` done), or set
  `abap2ui5.viewCheck.command`.

Checked are ABAP classes building views with the generic `z2ui5_cl_ai_xml`
builder and raw `*.view.xml` / `*.fragment.xml` files. Documents from the ABAP
remote filesystem (`adt` scheme) and unsaved buffers work too.

**When it runs.** The property gate runs **while you type**, shortly after
each pause (`abap2ui5.viewCheck.live`) — it works in-process and needs no
I/O. The render gate is the expensive one and stays on save
(`abap2ui5.viewCheck.onSave`) and on demand, with *"abap2UI5: Check Views
(Static)"*. *"abap2UI5: Check All Views in the Workspace"* runs the gate over
every ABAP class and view file at once, the way CI does.

### Quick fixes and waivers

Every finding whose correction is mechanical carries the correction with it,
and the lightbulb offers it: the obsolete `client->_bind_edit( )`, a missing
`$` in an event argument, an ABAP boolean written straight into the view. A
rule whose correction would have to guess deliberately carries none. There is
also *"fix all in this file"* — as a command and as
`source.fixAll.abap2ui5`, so it can go into `editor.codeActionsOnSave`:

```jsonc
"editor.codeActionsOnSave": { "source.fixAll.abap2ui5": "explicit" }
```

The other quick fix on any finding is **suppress on this line**, which writes
the linter's own directive above it:

```abap
" abap2ui5lint-disable-next-line unknown-binding-path -- filled in a LOOP
```

The CLI and the GitHub Action honour the same directive, so waiving something
here waives it in CI as well — and a line waived in CI no longer squiggles
here.

### `abap2ui5lint.jsonc`

A repository can pin its UI5 floor, its distribution, its `allow` list and its
per-rule severities in an
[`abap2ui5lint.jsonc`](https://github.com/abap2UI5/linter). That file is what
the CLI and the GitHub Action check against, so it **wins over the VS Code
settings** wherever it says something; the settings fill in the rest, and the
two `allow` lists merge. The **abap2UI5** output channel names the file the
current values came from — the first place to look when the editor and CI
disagree.

### Completion and hover

The UI5 metadata snapshot the property gate validates against is a complete
API reference, and it ships with the extension. So it is also offered while
the view is being written:

- **Control names** in the `n` argument of ``open( )`` / ``leaf( )``, resolved
  through the namespace in play — an ``ns`` of ``f`` offers `sap.f`, a name
  written as `core:Icon` offers `sap.ui.core`.
- **Members of exactly that control** in the `n` argument of the ``a( )``
  chained to it — properties first, then aggregations, associations and
  events, own members before inherited ones.
- **The values an enum or boolean property accepts** in the `v` argument.

Hover adds the type, the UI5 version a member appeared in, its deprecation and
a link to the UI5 API reference. Raw `*.view.xml` and `*.fragment.xml` files
get the same, on the tag name, the attribute name and the attribute value.

No SAP system, no network and no setup is involved — it is the same data the
check already uses.

## MCP server (`abap2ui5.mcp.*`)

The extension offers the [abap2UI5 MCP server](https://github.com/abap2UI5/ai-mcp)
to every MCP client in the VS Code window — GitHub Copilot agent mode, Claude
Code, or any other extension speaking MCP (VS Code 1.101+). The server gives
an AI agent the full abap2UI5 development loop **without an SAP system**:

| MCP tool | What the agent gets |
| --- | --- |
| `capabilities` | What abap2UI5 can express — the verified capability map |
| `validate_view` | The static gates above, in seconds |
| `deploy_app` | Write an app class into the local sandbox, abaplint it |
| `build_backend` | Transpile framework + apps to the Node backend |
| `run_app` | Boot the app headless, return errors **and a screenshot** |

The server orchestrates local checkouts of `abap2UI5` and
[`ai-demokit`](https://github.com/abap2UI5/ai-demokit) (plus optionally
`linter` and `ai-mcp` itself). Clone them into one folder and point
`abap2ui5.mcp.reposRoot` at it — the extension passes the matching
`A2UI5_HOME` / `AI_DEMOKIT_HOME` / `AI_VIEW_CHECK_HOME` variables to the
server and prefers the local `ai-mcp` checkout over downloading via npx.
The server appears in the MCP view (`MCP: List Servers`) as **abap2UI5**;
`abap2ui5.mcp.enabled: false` removes it.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `abap2ui5.launchUrlTemplate` | – | URL template used to launch an app, `{class}` as the placeholder |
| `abap2ui5.systems` | `[]` | Named launch profiles, for more than one system |
| `abap2ui5.openMode` | `tab` | `tab`, `panel` or `external` |
| `abap2ui5.reloadOn` | `activation` | When the preview reloads on its own: `activation`, `save` or `never` |
| `abap2ui5.codeLens` | `true` | Show Run / Activate & reload / Check views above the class definition |
| `abap2ui5.viewCheck.onSave` | `true` | Run the static view check when a checkable file is saved |
| `abap2ui5.viewCheck.live` | `true` | Also run the property gate while typing |
| `abap2ui5.viewCheck.command` | – | Command running the abap2UI5-linter CLI for the render gate (empty = local checkout or npx) |
| `abap2ui5.viewCheck.minUi5` | `1.71` | The UI5 version your system runs — checked against in both directions |
| `abap2ui5.viewCheck.distribution` | `sapui5` | Which distribution the system serves: `sapui5` or `openui5` |
| `abap2ui5.viewCheck.render` | `false` | Also run the headless render gate |
| `abap2ui5.viewCheck.allow` | `[]` | Accepted deviations, e.g. `sap.m.GenericTile.systemInfo` |
| `abap2ui5.mcp.enabled` | `true` | Offer the abap2UI5 MCP server to MCP clients |
| `abap2ui5.mcp.command` | – | Command starting the MCP server (empty = local checkout or npx) |
| `abap2ui5.mcp.reposRoot` | – | Folder with the `abap2UI5` / `ai-demokit` / `linter` / `ai-mcp` checkouts |

## Commands

| Command | Description |
| --- | --- |
| `abap2UI5: Run App (F9)` | Launches the app of the current class |
| `abap2UI5: Activate and Reload Preview (Ctrl+F3)` | Activates the class through your ABAP tooling, then reloads the preview |
| `abap2UI5: Reload Preview` | Reloads the app currently shown |
| `abap2UI5: Run a Recently Launched App` | Launches an app this window has run before, without opening its class |
| `abap2UI5: Select System` | Switches the system F9 launches against, or adds one |
| `abap2UI5: Show the Preview in the Panel` | Moves the preview (and the running app) into the bottom panel |
| `abap2UI5: Show the Preview in an Editor Tab` | Moves it back into an editor tab |
| `abap2UI5: Go to the Running App` | Focuses the preview, wherever it currently is |
| `abap2UI5: Check Views (Static)` | Runs the static view check on the current file |
| `abap2UI5: Check All Views in the Workspace` | Runs the same check over every ABAP class and view file |
| `abap2UI5: Fix All View Findings in This File` | Applies every mechanical fix at once |
| `abap2UI5: Install Render Gate` | Downloads the render-gate checker and Chromium into the extension's storage |
| `abap2UI5: Set Launch URL` | Sets (or changes) the launch URL template |
| `abap2UI5: Insert New App Template` | Inserts an app class skeleton |
| `abap2UI5: Clear Stored SAP Credentials` | Removes user and password from the SecretStorage |
| `abap2UI5: Open Project on GitHub` | Opens the abap2UI5 repository in the browser |

## Installation

Install **abap2UI5** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=abap2ui5.abap2ui5):
Extensions panel (`Ctrl/Cmd + Shift + X`) → search for *abap2UI5* →
**Install**. Updates arrive automatically like for any other extension.
Through the terminal:

```bash
code --install-extension abap2ui5.abap2ui5
```

On [Open VSX](https://open-vsx.org/extension/abap2ui5/abap2ui5) for
VSCodium, Eclipse Theia, SAP Business Application Studio and friends.

**Without Marketplace access:** every
[release](https://github.com/abap2UI5/vscode-extension/releases/latest)
carries the `.vsix` — Extensions panel → `…` menu → **Install from
VSIX…** — or build it yourself, see *Packaging* below.

**Coming from a pre-Marketplace `.vsix` install?** Those builds used the
placeholder publisher `abap2ui5-local`, which makes them a different
extension to VS Code — they keep working but never update. Uninstall once
(Extensions panel → **Uninstall**, or the command below), then install from
the Marketplace. Settings are kept; the stored SAP credentials are asked
for once again.

```bash
code --uninstall-extension abap2ui5-local.abap2ui5
```

## Development

```bash
npm install
npm run compile      # builds dist/extension.js with esbuild
```

Open this repository in VS Code and press **F5** → a second VS Code window
(Extension Development Host) starts with the extension loaded.

Handy while developing: `npm run watch` rebuilds on every change,
`npm run lint` type-checks (`tsc --noEmit`) and `npm test` runs the unit
suite. The tests cover the modules that do not import `vscode` — URL and ABAP
source handling, the completion context analysis, the metadata queries and the
`abap2ui5lint.jsonc` merge — bundled with the same esbuild config the
extension uses and run with `node --test`.

## Packaging as a `.vsix`

```bash
npm install
npm run vsix
```

The result is a file such as `abap2ui5-0.9.3.vsix`.

> `vsce` is included as a devDependency, so `npm run vsix` uses the local
> version. Alternatively install it globally: `npm install -g @vscode/vsce`.

Every push and pull request builds the same `.vsix` in CI and attaches it to
the run as an artifact — handy for trying out a branch without building it
locally.

## Releasing

Bump `version` in `package.json`, add the matching `CHANGELOG.md` section, then
either

- run the **Release** workflow from the Actions tab — it tags the current
  commit with `v<version>` and releases it, or
- tag the commit yourself:

  ```bash
  git tag v0.9.3
  git push origin v0.9.3
  ```

Either way the workflow builds the `.vsix`, creates the GitHub release and
attaches the file, with the changelog section of that version as the release
notes. Tag and `package.json` have to agree, otherwise the run fails on
purpose — and a version that is already released is refused instead of
overwritten.

## Contributing

**This project is English-only.** Code, comments, identifiers, commit messages,
documentation, and every user-facing string in the extension are written in
English — see [AGENTS.md](AGENTS.md) for the full conventions.

## License

MIT — see [LICENSE](LICENSE).
