# abap2UI5 Demokit Helper (VS Code Extension)

Eine kleine VS-Code-Extension mit Snippets und Befehlen rund um abap2UI5.
Gedacht zum **privaten Teilen** (du + Freunde) – ganz **ohne Marketplace**.

## Features

- **F9 startet die App** – Steht der Cursor in einer ABAP-Klasse, die
  `z2ui5_if_app` implementiert, öffnet **F9** die App **unten im Panel**
  (neben Terminal/Output) in einem eingebetteten Browser.
  Ist die Klasse *keine* z2ui5-App, verhält sich F9 wie gewohnt
  (Breakpoint umschalten).
- **Auto-Reload beim Aktivieren** – Wird die im Tab gezeigte App-Klasse
  gespeichert/aktiviert, lädt der eingebettete Browser automatisch neu (ohne F9).
  Abschaltbar via `abap2ui5.reloadOnSave`.
- **Command "abap2UI5: Neue App-Vorlage einfügen"** – App-Klassen-Skelett.
- **Command "abap2UI5: Demokit im Browser öffnen"** – öffnet das abap2UI5-Repo.
- **Snippets** (in ABAP-Dateien): `z2ui5app`, `z2ui5button`.

Befehle findest du über die Command Palette (`Ctrl/Cmd + Shift + P`).

## Einrichtung der Launch-URL

Beim ersten F9 wirst du nach der Launch-URL gefragt. `{class}` ist der
Platzhalter für den Klassennamen, z. B.:

```
https://host:44300/sap/bc/z2ui5?app_start={class}&sap-client=100
```

Die URL wird gespeichert und lässt sich jederzeit ändern:
Settings → `abap2ui5.launchUrlTemplate` (oder in `settings.json`).

## Öffnen-Modus (`abap2ui5.openMode`)

- **`tab`** (Standard): App eingebettet in einem Editor-Tab.
- **`panel`**: App eingebettet unten im Panel-Bereich.
- **`external`**: App im normalen Browser (nutzt deine bestehende SAP-Session).

### Wie die Anmeldung im Tab/Panel funktioniert (Auth-Proxy)

Ein eingebetteter iframe hat **keine** SAP-Session – ein direkter Aufruf würde
mit **401 Not authorized** enden. Deshalb startet die Extension bei `tab`/`panel`
einen **lokalen Auth-Proxy** auf `127.0.0.1`:

1. Beim ersten Start fragt sie **einmalig** deinen SAP-Benutzer + Passwort ab
   (dieselben wie in ADT). Die Daten liegen sicher im VS Code **SecretStorage**.
2. Der Proxy hängt bei **jedem** Request `Authorization: Basic …` an und leitet
   ihn an dein SAP-System weiter (inkl. UI5-Ressourcen, Cookies, CSRF, Redirects).
3. Der iframe lädt `http://127.0.0.1:<port>/…` – die App läuft eingebettet, ohne 401.

> Zugangsdaten ändern/löschen: Command **"abap2UI5: Gespeicherte SAP-Zugangsdaten
> löschen"** (Command Palette), danach wird beim nächsten F9 neu gefragt.
>
> Voraussetzung: Das System akzeptiert **Basic Auth** (User/Passwort). Reine
> SSO/SAML-Anmeldung ohne Basic-Auth-Fallback wird nicht unterstützt – dann
> `external` verwenden.
>
> Selbst-signierte Zertifikate (HTTPS) werden vom Proxy akzeptiert.

---

## Entwickeln

```bash
npm install
npm run compile      # baut dist/extension.js mit esbuild
```

In VS Code dieses Repository öffnen und **F5** drücken → es startet ein
zweites VS-Code-Fenster (Extension Development Host) mit geladener Extension.

Während der Entwicklung praktisch: `npm run watch` (baut bei jeder Änderung neu).

---

## Als `.vsix` paketieren (zum Verteilen)

```bash
npm install
npm run vsix         # ruft "vsce package --allow-missing-repository" auf
```

Ergebnis: eine Datei wie `abap2ui5-demokit-0.0.1.vsix`. Diese Datei kannst du
per Mail/Cloud/USB an deine Freunde weitergeben. **Kein Marketplace nötig.**

> `vsce` ist als devDependency enthalten; `npm run vsix` nutzt die lokale Version.
> Alternativ global: `npm install -g @vscode/vsce` und dann `vsce package`.

---

## Installieren (für dich & Freunde)

Aus der `.vsix`-Datei – zwei Wege:

**Über die Oberfläche:**
1. Extensions-Panel öffnen (`Ctrl/Cmd + Shift + X`)
2. Oben auf das `…`-Menü → **Install from VSIX…**
3. Die `.vsix`-Datei auswählen

**Über das Terminal:**
```bash
code --install-extension abap2ui5-demokit-0.0.1.vsix
```

**Update** = neue `.vsix` mit höherer Versionsnummer (`version` in `package.json`
hochzählen) bauen und erneut installieren.

---

## Deinstallieren

Extensions-Panel → Extension suchen → **Uninstall**. Oder:

```bash
code --uninstall-extension abap2ui5-local.abap2ui5-demokit
```
