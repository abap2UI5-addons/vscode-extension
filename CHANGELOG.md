# Changelog

## 0.11.0

- **Self-installing render gate.** *"abap2UI5: Install Render Gate"*
  downloads the self-contained checker bundle (published by
  ai-view-check's CI) and Chromium into the extension's storage and runs
  both with VS Code's own runtime - the render gate no longer needs
  node, npm or any PATH setup on the machine. The command is also
  offered directly from the warning when the gate is enabled but
  missing, and installing enables `abap2ui5.viewCheck.render`.
- **Fix: no more "view check passed" on files that only quote builder
  code** (e.g. a log file embedding class source). Checkability now
  requires an ABAP source actually calling `z2ui5_cl_ai_xml=>factory`
  (or a `*.view.xml`), and when nothing can be reconstructed the check
  says so instead of claiming a pass.

## 0.10.0

- **Static view checks in the editor.** Saving an ABAP class that builds
  views with `z2ui5_cl_ai_xml` (or a raw `*.view.xml` / `*.fragment.xml`)
  now runs the [ai-view-check](https://github.com/abap2UI5/ai-view-check)
  gates and shows the findings in the Problems panel: controls that do
  not exist in UI5 at all (`sap.m.Shell2` - a typo, shown as an error),
  controls or properties newer than your UI5 floor (default 1.71), and
  deprecated controls. The property gate and its UI5 metadata snapshot
  are **bundled with the extension** - zero setup, instant, works
  offline, on documents from the ABAP remote filesystem (`adt` scheme)
  and on unsaved buffers. Optionally (`abap2ui5.viewCheck.render`) the
  external ai-view-check CLI adds real render errors from a headless
  `XMLView.create`. On demand: *"abap2UI5: Check Views (Static)"*.
  Configure the floor, accepted deviations and the render-gate command
  under `abap2ui5.viewCheck.*`.
- **The abap2UI5 MCP server, offered to every MCP client in the window.**
  The extension registers the
  [ai-mcp](https://github.com/abap2UI5/ai-mcp) server as an MCP server
  definition provider, so Copilot agent mode (and any other MCP client in
  VS Code) can use the abap2UI5 dev loop without an SAP system:
  capability queries, static view validation, deploy into the sandbox,
  transpiled build, headless run returning page errors and a screenshot.
  Point `abap2ui5.mcp.reposRoot` at the folder holding the `abap2UI5`,
  `ai-demokit` (and optionally `ai-view-check`, `ai-mcp`) checkouts;
  disable with `abap2ui5.mcp.enabled`.
- The minimum VS Code version moved from 1.85 to **1.101** (June 2025) -
  the first release with the stable MCP server definition API.

## 0.9.3

- **Fix: every button press in the embedded preview could fail** with
  *"CSRF validation failed - cross-origin POST rejected"*. The embedded app
  talks to the local auth proxy on `127.0.0.1`, so the browser sent that as
  `Origin`/`Referer` while the forwarded request carried the SAP host — a
  mismatch that origin-validating CSRF checks reject on every POST. The proxy
  now rewrites both headers to the system's own origin, so the roundtrips look
  same-origin to the server again.
- **Fix: the activation watch only ever started for `adt:` documents.** Any
  other way of editing a server-backed source never got the automatic reload
  after activation. The watch now starts on every save of the shown class —
  the server knows whether an inactive version exists, whatever the file's
  URI scheme is. (Sources that never reach a server simply never show up as
  inactive, so nothing reloads there either.)
- **Fix: an activation right after the save was missed.** The watch used to
  wait for the class to show up as *inactive* before an *active* answer would
  count as the activation. Activating directly — where the save is part of the
  activation — can be finished on a fast system before the watch ever looks,
  so there was nothing inactive to see and the watch waited for a flip it had
  already missed; only a slow save-then-activate cycle ever reloaded. The
  watch now also remembers the **change timestamp** of the class the preview
  shows: *active with a newer change timestamp* is a finished activation, no
  matter how fast it went. (Sources that never reach the server keep their
  timestamp, so purely local saves still reload nothing.) The first look at
  the server also moved from 2.5 seconds after the save to a quarter of a
  second, with checks every 1.5 seconds after that.
- **New output channel `abap2UI5`** (View → Output): the activation watch says
  what it is doing there — started, class inactive, active again → reload, or
  the reason it stops (ADT unreachable, timeout). When an automatic reload
  does not happen, this is the place that says why.

## 0.9.1

Reloading after activation now actually happens — however you activate
([#5](https://github.com/abap2UI5-addons/vscode-extension/issues/5)).

- **Activations are detected on the server.** 0.9.0 only reloaded on its own
  Ctrl+F3; activating with the ABAP remote filesystem's own button or shortcut
  went unnoticed, because VS Code has no event for it. Now, while the preview
  shows the *not activated* badge, the extension watches the class on the
  server (its ADT metadata, fetched with the credentials it already holds for
  the preview) and reloads as soon as the inactive version is gone — no matter
  whether the activation came from Ctrl+F3, the ABAP extension's own UI or
  even Eclipse. Needs the source to be opened from a system (scheme `adt`) and
  the ADT services answering on the launch-URL host; where they do not, the
  watch stops silently and the badge stays until you reload.
- **Fix: Ctrl+F3 (and the ⚡ button) could stay dead for a whole session.**
  They were gated on a "an ABAP extension with an activate command is
  installed" flag computed once at startup — when this extension happened to
  activate before the ABAP extension had registered its commands, the flag
  stayed false and the key silently did nothing. The gate is now simply "the
  file was opened from an ABAP system" (scheme `adt`), which implies working
  ABAP tooling and cannot go stale.
- **The *not activated* badge is now clickable** — it reloads the preview
  right there (showing the still-active version, as the tooltip says).
- Ctrl+F3 now hands the exact document to `abapfs.activate` instead of relying
  on its active-editor fallback.

## 0.9.0

The preview now reloads when you **activate**, not when you save
([#5](https://github.com/abap2UI5-addons/vscode-extension/issues/5)).

- **No more pointless reload on save.** Saving an ABAP class does not change
  what the server runs — the activation does. A save of the shown class no
  longer reloads the preview; it marks it with a small *not activated* badge in
  the toolbar instead, so it is clear why the app still shows the old version.
- **New command `abap2UI5: Activate and Reload Preview`** on **Ctrl+F3**
  (`Cmd+F3` on macOS, the activation key from SAP GUI) and as a ⚡ button in the
  editor toolbar: it saves the class, hands the activation to the ABAP
  extension you already use (ABAP remote filesystem) and reloads the preview
  afterwards. The key is only taken over for objects opened from a system while
  such an extension is installed — everywhere else Ctrl+F3 keeps its usual
  VS Code meaning.
- **New setting `abap2ui5.reloadOn`** with `activation` (default), `save` and
  `never`. It replaces `abap2ui5.reloadOnSave`, which is deprecated but still
  honoured while the new setting is unset — `false` behaves like `never`,
  `true` like `save`.

## 0.8.0

A visual pass over everything the extension shows.

- **New preview toolbar** with the class name, the system URL, a status dot
  (loading / ready) and buttons for reload and "open externally". It follows
  your colour theme instead of bringing its own colours.
- **Device widths:** switch the preview between desktop, tablet (834px) and
  phone (414px) to check a responsive app without leaving the editor. The
  choice is remembered per preview.
- **Loading state:** a spinner and "Starting ZCL_…" instead of a white area.
  If the app takes longer than 12 seconds, the preview offers *Reload* and
  *Open externally* right there.
- **Welcome screen** in the preview panel: the three steps to a running app,
  plus buttons for the launch URL, the app template and the project page.
- **Status bar entry** while an app is running — shows the class, click
  reloads.
- **Run button in the editor toolbar** for ABAP files, next to the usual
  actions.
- **New commands:** `abap2UI5: Reload Preview` (also in the preview panel's
  title bar) and `abap2UI5: Set Launch URL`, which validates the URL and the
  `{class}` placeholder before saving it.
- **Save toast:** reloading after a save says so in the preview, so a slow
  round trip is not mistaken for nothing happening.
- Extension icon, tab icon and panel icon reworked.
- **The `.vsix` is now a download.** Every release attaches the packaged
  extension to its
  [GitHub release](https://github.com/abap2UI5-addons/vscode-extension/releases/latest),
  so installing no longer means cloning and building. Every push and pull
  request also builds one as a CI artifact.
- Internal: the webview HTML moved to `src/webview.ts` and the inline scripts
  now run under a CSP nonce instead of `unsafe-inline`.

## 0.7.0

- **The project is now English-only.** README, changelog, code comments and
  every user-facing string (command titles, settings descriptions, input
  prompts, error messages, the webview placeholder) were translated from
  German to English. The convention is written down in
  [AGENTS.md](AGENTS.md) so it stays that way.
- Command titles changed accordingly, e.g. "abap2UI5: App starten (F9)" →
  `abap2UI5: Run App (F9)`. Command IDs, setting keys and behaviour are
  unchanged, so your `settings.json` and any custom keybindings keep working.

## 0.6.0

- **Renamed**: the extension is now simply **abap2UI5** instead of "abap2UI5
  Demokit Helper". It was never tied to the demokit — the name only came from
  the repository it originally lived in. It now has its own repository:
  <https://github.com/abap2UI5-addons/vscode-extension>.
- README reworked: describes the extension as a general tool for abap2UI5
  development, with tables for settings and commands.
- Command IDs unified under the `abap2ui5.` prefix:
  `abap2ui5-demokit.newApp` → `abap2ui5.newApp`,
  `abap2ui5-demokit.openDemokit` → `abap2ui5.openHomepage`. The latter has
  always opened the abap2UI5 repository, and its title now says so.

> **When updating:** the rename changes the extension ID from
> `abap2ui5-local.abap2ui5-demokit` to `abap2ui5-local.abap2ui5`. VS Code
> therefore treats the new `.vsix` as a separate extension — uninstall the old
> one once: `code --uninstall-extension abap2ui5-local.abap2ui5-demokit`.
> Your settings (`abap2ui5.*`) survive, they live in `settings.json` and not on
> the extension ID. The SAP credentials in the SecretStorage do hang off the
> ID, so they are asked for once more on the first F9 after the update.

## 0.5.0

- **Auto-reload on activation:** saving/activating the app class shown in the
  tab reloads the embedded browser automatically — no F9 needed. Can be turned
  off with `abap2ui5.reloadOnSave` (default: on).

## 0.4.2

- Fix: after F9 the cursor really does stay in the source. The loading UI5 app
  pulls focus asynchronously — the extension now catches that for a short time
  window (`onDidChangeViewState`) and hands focus back to the code.

## 0.4.1

- After a launch or reload, F9 returns focus to the source — the cursor stays
  where it was and you can keep typing right away.

## 0.4.0

- **F9 now reliably refreshes** the existing tab/panel (reloading the app)
  instead of opening a new one. For a different class the existing tab switches
  to the new app. The reload runs as a message to the iframe.

## 0.3.1

- Fix: blank/white app in the tab — the proxy now strips `X-Frame-Options` and
  the CSP directive `frame-ancestors` from the SAP responses, so the browser
  allows embedding in the iframe.

## 0.3.0

- **Embedded app with login** through a local auth proxy: F9 shows the app in
  an editor tab (or panel) and the proxy injects the SAP credentials — no more
  401.
- `abap2ui5.openMode` extended: `tab` (the new default), `panel`, `external`
- Credentials are asked for once and kept in the SecretStorage
- New command: "abap2UI5: Clear Stored SAP Credentials"
- The proxy forwards UI5 resources, cookies, CSRF and redirects transparently;
  self-signed HTTPS certificates are accepted

## 0.2.0

- New setting `abap2ui5.openMode` (`external` | `panel`), default `external`
  - `external`: F9 opens the app in the normal browser (uses the SAP
    session/SSO)
  - `panel`: embedded in the panel (only without interactive login, otherwise
    401)
- URL normalization: duplicate slashes in the path are removed

## 0.1.0

- **F9** launches a `z2ui5_if_app` class in the embedded browser panel at the
  bottom
- New setting `abap2ui5.launchUrlTemplate` (placeholder `{class}`)
- Panel view "abap2UI5 / App Preview" with an "Open externally" fallback
- F9 on non-app ABAP files keeps the normal breakpoint behaviour

## 0.0.1

- First version
- Command: "abap2UI5: Insert New App Template"
- Command: "abap2UI5: Open Demokit in Browser" (renamed in 0.6.0)
- Snippets: `z2ui5app`, `z2ui5button`
