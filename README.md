# abap2UI5 for VS Code

VS Code extension for developing **abap2UI5** apps: launch an app with **F9**,
see it right next to the source, and have it reload automatically when you save
— without the context switch to the browser.

Works with any system running abap2UI5 (on-premise or cloud). The only thing
tying the extension to a system is the launch URL you configure once.

## Features

- **F9 runs the app** – With the cursor in an ABAP class that implements
  `z2ui5_if_app`, **F9** opens the app in an embedded browser next to the
  source. If the class is *not* a z2ui5 app, F9 behaves as usual (toggle
  breakpoint), so you don't lose the key.
- **Focus stays in the code** – After launching, the cursor returns to the same
  spot in the source, even when the loading app tries to grab focus.
- **Auto-reload on save** – Saving the class of the app currently shown
  reloads the embedded preview. Can be turned off with
  `abap2ui5.reloadOnSave`.
- **Login without a 401** – For the embedded view the extension ships a local
  auth proxy (see below).
- **Snippets** for ABAP files: `z2ui5app`, `z2ui5button`.
- **Insert an app template** – Class skeleton for a new abap2UI5 app.

All commands are available from the Command Palette (`Ctrl/Cmd + Shift + P`).

## Setting the launch URL

On the first F9 the extension asks for the launch URL. `{class}` is the
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
   and redirects.
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

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `abap2ui5.launchUrlTemplate` | – | URL template used to launch an app, `{class}` as the placeholder |
| `abap2ui5.openMode` | `tab` | `tab`, `panel` or `external` |
| `abap2ui5.reloadOnSave` | `true` | Reload the preview when the shown class is saved |

## Commands

| Command | Description |
| --- | --- |
| `abap2UI5: Run App (F9)` | Launches the app of the current class |
| `abap2UI5: Insert New App Template` | Inserts an app class skeleton |
| `abap2UI5: Clear Stored SAP Credentials` | Removes user and password from the SecretStorage |
| `abap2UI5: Open Project on GitHub` | Opens the abap2UI5 repository in the browser |

## Installation

The extension is currently distributed as a `.vsix` (not on the Marketplace
yet).

**Through the UI:** Extensions panel (`Ctrl/Cmd + Shift + X`) → `…` menu →
**Install from VSIX…** → pick the file.

**Through the terminal:**

```bash
code --install-extension abap2ui5-0.7.0.vsix
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

The result is a file such as `abap2ui5-0.7.0.vsix`.

> `vsce` is included as a devDependency, so `npm run vsix` uses the local
> version. Alternatively install it globally: `npm install -g @vscode/vsce`.

## Contributing

**This project is English-only.** Code, comments, identifiers, commit messages,
documentation, and every user-facing string in the extension are written in
English — see [AGENTS.md](AGENTS.md) for the full conventions.

## License

MIT — see [LICENSE](LICENSE).
