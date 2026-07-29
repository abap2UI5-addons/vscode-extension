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
- **Device widths** – Switch the preview between desktop, tablet (834px) and
  phone (414px) to check a responsive app without leaving the editor.
- **Status bar** – While an app is running the status bar shows the class;
  clicking it reloads the preview.
- **Login without a 401** – For the embedded view the extension ships a local
  auth proxy (see below).
- **Snippets** for ABAP files: `z2ui5app`, `z2ui5button`.
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

## Open mode (`abap2ui5.openMode`)

| Mode | Behaviour |
| --- | --- |
| `tab` (default) | App embedded in an editor tab next to the code, through the local auth proxy |
| `panel` | The same, but in the bottom panel area next to Terminal/Output |
| `external` | In the normal browser (reuses your existing SAP session/SSO, no proxy needed) |

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

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `abap2ui5.launchUrlTemplate` | – | URL template used to launch an app, `{class}` as the placeholder |
| `abap2ui5.openMode` | `tab` | `tab`, `panel` or `external` |
| `abap2ui5.reloadOn` | `activation` | When the preview reloads on its own: `activation`, `save` or `never` |

## Commands

| Command | Description |
| --- | --- |
| `abap2UI5: Run App (F9)` | Launches the app of the current class |
| `abap2UI5: Activate and Reload Preview (Ctrl+F3)` | Activates the class through your ABAP tooling, then reloads the preview |
| `abap2UI5: Reload Preview` | Reloads the app currently shown |
| `abap2UI5: Set Launch URL` | Sets (or changes) the launch URL template |
| `abap2UI5: Insert New App Template` | Inserts an app class skeleton |
| `abap2UI5: Clear Stored SAP Credentials` | Removes user and password from the SecretStorage |
| `abap2UI5: Open Project on GitHub` | Opens the abap2UI5 repository in the browser |

## Installation

The extension is distributed as a `.vsix` (not on the Marketplace yet).
Download the file from the
[latest release](https://github.com/abap2UI5-addons/vscode-extension/releases/latest)
— or build it yourself, see *Packaging* below.

**Through the UI:** Extensions panel (`Ctrl/Cmd + Shift + X`) → `…` menu →
**Install from VSIX…** → pick the file.

**Through the terminal:**

```bash
code --install-extension abap2ui5-0.9.3.vsix
```

**Updating** means building a new `.vsix` with a higher version number and
installing it again.

**Uninstalling:** Extensions panel → find the extension → **Uninstall**. Or:

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

Handy while developing: `npm run watch` rebuilds on every change, and
`npm run lint` type-checks (`tsc --noEmit`).

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
