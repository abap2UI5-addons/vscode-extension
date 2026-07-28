/**
 * HTML for the two webviews the extension renders:
 *
 * - `previewHtml` — the running app: toolbar, device sizes, loading overlay.
 * - `welcomeHtml` — the empty state shown before the first F9.
 *
 * Both are plain strings without any build step. They only use VS Code theme
 * variables, so they follow the user's colour theme (light, dark, contrast).
 */

import { URL } from "url";

const NONCE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Random nonce so the webview CSP can allow exactly our own script/style. */
export function createNonce(): string {
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return out;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `https://host:44300/sap/bc/z2ui5?app_start=X` -> `host:44300/sap/bc/z2ui5` */
export function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Icons (inline, so the webview needs no resources of its own)
// ---------------------------------------------------------------------------

const ICON = {
  refresh: `<path d="M8 3a5 5 0 1 0 4.9 6h-1.6A3.4 3.4 0 1 1 8 4.6c.9 0 1.7.3 2.3.9L8.6 7.2H13V2.8l-1.5 1.5A4.9 4.9 0 0 0 8 3z"/>`,
  external: `<path d="M9.5 2H14v4.5h-1.5V4.56L7.78 9.28 6.72 8.22l4.72-4.72H9.5V2z"/><path d="M3 4h4v1.5H4.5v6h6V9H12v4H3V4z"/>`,
  desktop: `<path d="M2 3h12v8H2V3zm1.5 1.5v5h9v-5h-9zM5.5 12.5h5V14h-5v-1.5z"/>`,
  tablet: `<path d="M3 2h10v12H3V2zm1.5 1.5v7.5h7V3.5h-7zM7 12h2v1H7v-1z"/>`,
  phone: `<path d="M4.5 1.5h7v13h-7v-13zM6 3.2v8.4h4V3.2H6zM7 12.6h2v1H7v-1z"/>`,
  code: `<path d="M5.6 3.6 6.7 4.7 3.9 7.5l2.8 2.8-1.1 1.1L1.7 7.5l3.9-3.9zm4.8 0 3.9 3.9-3.9 3.9-1.1-1.1 2.8-2.8-2.8-2.8 1.1-1.1z"/>`,
  book: `<path d="M2 3h4.2c.7 0 1.3.2 1.8.6.5-.4 1.1-.6 1.8-.6H14v9.2h-4.2c-.6 0-1.2.3-1.5.8h-.6c-.3-.5-.9-.8-1.5-.8H2V3zm1.5 1.5v6.2h2.7c.5 0 1 .1 1.4.3V5.7c-.3-.2-.6-.2-.9-.2H3.5zm9 0H9.8c-.3 0-.6 0-.9.2v5.3c.4-.2.9-.3 1.4-.3h2.2V4.5z"/>`,
  link: `<path d="M8.5 2.5 10 4l-1.4 1.4-1-1a1.8 1.8 0 0 0-2.6 2.6l1 1L4.6 9.4l-1.5-1.5a3.3 3.3 0 0 1 4.7-4.7l.7.3zm4 4a3.3 3.3 0 0 1 0 4.7l-1.5 1.5-1.4-1.4 1.4-1.4a1.8 1.8 0 0 0-2.6-2.6L7 8.7 5.6 7.3 7 5.9a3.3 3.3 0 0 1 5.5.6z"/>`,
};

function icon(name: keyof typeof ICON): string {
  return `<svg class="ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
}

// ---------------------------------------------------------------------------
// Shared styling
// ---------------------------------------------------------------------------

const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  .ico { fill: currentColor; flex: none; }
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  kbd {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-bottom-width: 2px;
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.17));
    color: var(--vscode-keybindingLabel-foreground, inherit);
  }
`;

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface PreviewOptions {
  /** URL loaded in the iframe (the local auth proxy in tab/panel mode). */
  frameUrl: string;
  /** Real SAP URL — shown in the toolbar and opened by "Open externally". */
  externalUrl: string;
  /** Class name of the app, shown as the title. */
  className: string;
  nonce: string;
}

export function previewHtml(options: PreviewOptions): string {
  const { nonce } = options;
  const frameUrl = escapeHtml(options.frameUrl);
  const externalUrl = escapeHtml(options.externalUrl);
  const className = escapeHtml(options.className);
  const urlLabel = escapeHtml(shortUrl(options.externalUrl));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http: https:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>abap2UI5 Preview</title>
<style nonce="${nonce}">
${BASE_CSS}
  body { display: flex; flex-direction: column; overflow: hidden; }

  /* ---- toolbar ---- */
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 5px 8px;
    background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--vscode-charts-green, #3fb950);
    flex: none;
    transition: background 120ms ease;
  }
  body[data-state="loading"] .dot {
    background: var(--vscode-charts-yellow, #d29922);
    animation: pulse 1.1s ease-in-out infinite;
  }
  body[data-state="slow"] .dot { background: var(--vscode-charts-orange, #db6d28); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

  .name {
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .url {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.65;
    font-size: 0.92em;
  }

  .seg {
    display: flex;
    gap: 2px;
    flex: none;
  }
  .seg button { padding: 3px 7px; border-radius: 5px; opacity: 0.7; }
  .seg button:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.14));
  }
  .seg button[aria-pressed="true"] {
    opacity: 1;
    color: var(--vscode-inputOption-activeForeground, var(--vscode-foreground));
    background: var(--vscode-inputOption-activeBackground, rgba(0,120,212,0.25));
    border-color: var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder));
  }

  .act { padding: 4px 7px; opacity: 0.8; flex: none; }
  .act:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.14)); }
  .act.spin .ico { animation: spin 600ms ease; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  /* ---- stage ---- */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    justify-content: center;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  }
  .viewport {
    position: relative;
    width: 100%;
    height: 100%;
    transition: width 160ms ease;
  }
  .stage[data-device="tablet"] .viewport { width: 834px; max-width: 100%; }
  .stage[data-device="phone"] .viewport { width: 414px; max-width: 100%; }
  .stage[data-device="tablet"] .viewport,
  .stage[data-device="phone"] .viewport {
    border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
  }
  iframe { border: 0; width: 100%; height: 100%; background: #fff; display: block; }

  /* ---- loading overlay ---- */
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: var(--vscode-editor-background);
    transition: opacity 220ms ease;
  }
  body[data-state="ready"] .overlay { opacity: 0; pointer-events: none; }
  .spinner {
    width: 26px; height: 26px;
    border-radius: 50%;
    border: 2px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    border-top-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
    animation: rotate 800ms linear infinite;
  }
  @keyframes rotate { to { transform: rotate(360deg); } }
  .overlay p { margin: 0; opacity: 0.75; }
  .hint {
    display: none;
    align-items: center;
    gap: 10px;
    font-size: 0.92em;
    opacity: 0.75;
  }
  body[data-state="slow"] .hint { display: flex; }
  .hint button {
    padding: 3px 10px;
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
  }

  /* ---- toast ---- */
  .toast {
    position: absolute;
    right: 14px;
    bottom: 14px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.9em;
    color: var(--vscode-notifications-foreground, var(--vscode-foreground));
    background: var(--vscode-notifications-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-notificationCenter-border, var(--vscode-panel-border, transparent));
    box-shadow: 0 2px 10px rgba(0,0,0,0.25);
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 180ms ease, transform 180ms ease;
    pointer-events: none;
  }
  .toast.show { opacity: 1; transform: translateY(0); }
</style>
</head>
<body data-state="loading">
  <div class="bar">
    <span class="dot" id="dot"></span>
    <span class="name" id="name">${className}</span>
    <span class="url" id="url" title="${externalUrl}">${urlLabel}</span>
    <div class="seg" role="group" aria-label="Preview size">
      <button id="d-desktop" data-device="desktop" aria-pressed="true" title="Desktop width">${icon("desktop")}</button>
      <button id="d-tablet" data-device="tablet" aria-pressed="false" title="Tablet width (834px)">${icon("tablet")}</button>
      <button id="d-phone" data-device="phone" aria-pressed="false" title="Phone width (414px)">${icon("phone")}</button>
    </div>
    <button class="act" id="reload" title="Reload the app">${icon("refresh")}</button>
    <button class="act" id="ext" title="Open in the default browser">${icon("external")}</button>
  </div>

  <div class="stage" id="stage" data-device="desktop">
    <div class="viewport">
      <!-- src is set from the script below, so the load listener is never missed -->
      <iframe id="app" title="abap2UI5 app"
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"></iframe>
    </div>
    <div class="overlay" id="overlay">
      <div class="spinner"></div>
      <p id="loading-text">Starting ${className}&hellip;</p>
      <div class="hint">
        <span>Taking longer than usual.</span>
        <button id="hint-reload">Reload</button>
        <button id="hint-ext">Open externally</button>
      </div>
    </div>
    <div class="toast" id="toast"></div>
  </div>

<script nonce="${nonce}">
(function () {
  const vscodeApi = acquireVsCodeApi();
  const body = document.body;
  const frame = document.getElementById('app');
  const stage = document.getElementById('stage');
  const nameEl = document.getElementById('name');
  const urlEl = document.getElementById('url');
  const loadingText = document.getElementById('loading-text');
  const toast = document.getElementById('toast');
  const reloadBtn = document.getElementById('reload');

  let frameUrl = ${JSON.stringify(options.frameUrl)};
  let externalUrl = ${JSON.stringify(options.externalUrl)};
  let slowTimer;
  let toastTimer;
  let startedAt = Date.now();

  // Device width survives a webview being hidden and restored.
  const saved = vscodeApi.getState() || {};
  setDevice(saved.device || 'desktop', false);

  function setDevice(device, persist) {
    stage.dataset.device = device;
    for (const btn of document.querySelectorAll('.seg button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.device === device));
    }
    if (persist !== false) { vscodeApi.setState({ device: device }); }
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function beginLoad(message) {
    startedAt = Date.now();
    body.dataset.state = 'loading';
    loadingText.textContent = message;
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => {
      if (body.dataset.state === 'loading') { body.dataset.state = 'slow'; }
    }, 12000);
  }

  function load(url, message) {
    beginLoad(message);
    frame.src = url; // reassigning src is what forces the reload
  }

  frame.addEventListener('load', () => {
    clearTimeout(slowTimer);
    body.dataset.state = 'ready';
  });

  reloadBtn.addEventListener('click', () => {
    reloadBtn.classList.remove('spin');
    void reloadBtn.offsetWidth; // restart the animation
    reloadBtn.classList.add('spin');
    load(frameUrl, 'Reloading ' + nameEl.textContent + '\\u2026');
  });

  document.getElementById('ext').addEventListener('click', openExternal);
  document.getElementById('hint-ext').addEventListener('click', openExternal);
  document.getElementById('hint-reload').addEventListener('click', () => {
    load(frameUrl, 'Reloading ' + nameEl.textContent + '\\u2026');
  });
  function openExternal() { vscodeApi.postMessage({ type: 'openExternal' }); }

  for (const btn of document.querySelectorAll('.seg button')) {
    btn.addEventListener('click', () => setDevice(btn.dataset.device, true));
  }

  // Start the app only now: the load listener above is already attached.
  load(frameUrl, 'Starting ' + nameEl.textContent + '\\u2026');

  // The host sends 'load' on F9, on the reload command and on save.
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type !== 'load') { return; }
    const switched = msg.className && msg.className !== nameEl.textContent;
    frameUrl = msg.frameUrl;
    externalUrl = msg.externalUrl;
    if (msg.className) { nameEl.textContent = msg.className; }
    urlEl.textContent = msg.shortUrl || msg.externalUrl;
    urlEl.title = msg.externalUrl;
    load(frameUrl, (switched ? 'Starting ' : 'Reloading ') + nameEl.textContent + '\\u2026');
    if (msg.reason) { showToast(msg.reason); }
  });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Welcome / empty state
// ---------------------------------------------------------------------------

export interface WelcomeOptions {
  nonce: string;
  /** False -> the first step nudges the user to configure the launch URL. */
  hasLaunchUrl: boolean;
}

export function welcomeHtml(options: WelcomeOptions): string {
  const { nonce, hasLaunchUrl } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>abap2UI5</title>
<style nonce="${nonce}">
${BASE_CSS}
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card { max-width: 460px; }
  h1 {
    margin: 0 0 4px;
    font-size: 1.25em;
    font-weight: 600;
  }
  .sub { margin: 0 0 20px; opacity: 0.7; }
  ol {
    margin: 0 0 20px;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  li { display: flex; gap: 10px; align-items: baseline; }
  .num {
    flex: none;
    width: 20px; height: 20px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8em;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.17));
    border-radius: 4px;
    padding: 1px 5px;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .actions button {
    padding: 5px 12px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .actions button:hover { background: var(--vscode-button-hoverBackground); }
  .actions button.secondary {
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border-color: var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  .actions button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground));
  }
</style>
</head>
<body>
  <div class="card">
    <h1>abap2UI5 preview</h1>
    <p class="sub">Your app runs here, right next to the code.</p>
    <ol>
      <li><span class="num">1</span><span>${
        hasLaunchUrl
          ? "Open an ABAP class that implements <code>z2ui5_if_app</code>."
          : "Set the launch URL of your system &mdash; asked once, stored in the settings."
      }</span></li>
      <li><span class="num">2</span><span>${
        hasLaunchUrl
          ? "Press <kbd>F9</kbd> &mdash; the app opens here, the cursor stays in the code."
          : "Open an app class and press <kbd>F9</kbd>."
      }</span></li>
      <li><span class="num">3</span><span>Save the class &mdash; the preview reloads on its own.</span></li>
    </ol>
    <div class="actions">
      <button data-command="abap2ui5.setLaunchUrl">${icon("link")}Set launch URL</button>
      <button class="secondary" data-command="abap2ui5.newApp">${icon("code")}Insert app template</button>
      <button class="secondary" data-command="abap2ui5.openHomepage">${icon("book")}Project on GitHub</button>
    </div>
  </div>
<script nonce="${nonce}">
(function () {
  const vscodeApi = acquireVsCodeApi();
  for (const btn of document.querySelectorAll('[data-command]')) {
    btn.addEventListener('click', () => {
      vscodeApi.postMessage({ type: 'command', command: btn.dataset.command });
    });
  }
})();
</script>
</body>
</html>`;
}
