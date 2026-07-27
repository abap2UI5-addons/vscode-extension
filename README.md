# abap2UI5 für VS Code

VS-Code-Extension für die Entwicklung von **abap2UI5**-Apps: App per **F9**
starten, direkt daneben im Editor ansehen, beim Speichern automatisch neu laden
– ohne den Kontextwechsel in den Browser.

Funktioniert mit jedem System, auf dem abap2UI5 läuft (On-Premise oder Cloud);
gebunden ist die Extension an nichts außer die Launch-URL, die du einmal
hinterlegst.

## Features

- **F9 startet die App** – Steht der Cursor in einer ABAP-Klasse, die
  `z2ui5_if_app` implementiert, öffnet **F9** die App in einem eingebetteten
  Browser neben dem Quelltext. Ist die Klasse *keine* z2ui5-App, verhält sich
  F9 wie gewohnt (Breakpoint umschalten) – die Taste geht dir also nicht
  verloren.
- **Fokus bleibt im Code** – Nach dem Start springt der Cursor zurück an
  dieselbe Stelle im Quelltext; auch wenn die ladende App den Fokus an sich
  ziehen will.
- **Auto-Reload beim Speichern** – Wird die gezeigte App-Klasse gespeichert,
  lädt die eingebettete Vorschau automatisch neu. Abschaltbar über
  `abap2ui5.reloadOnSave`.
- **Anmeldung ohne 401** – Für die eingebettete Ansicht bringt die Extension
  einen lokalen Auth-Proxy mit (siehe unten).
- **Snippets** für ABAP-Dateien: `z2ui5app`, `z2ui5button`.
- **App-Vorlage einfügen** – Klassen-Skelett für eine neue abap2UI5-App.

Alle Befehle findest du über die Command Palette (`Ctrl/Cmd + Shift + P`).

## Launch-URL einrichten

Beim ersten F9 fragt die Extension nach der Launch-URL. `{class}` ist der
Platzhalter für den Klassennamen:

```
https://host:44300/sap/bc/z2ui5?app_start={class}&sap-client=100
```

Die URL wird gespeichert und lässt sich jederzeit ändern:
Settings → `abap2ui5.launchUrlTemplate` (oder direkt in der `settings.json`).

## Öffnen-Modus (`abap2ui5.openMode`)

| Modus | Verhalten |
| --- | --- |
| `tab` (Standard) | App eingebettet in einem Editor-Tab neben dem Code, über den lokalen Auth-Proxy |
| `panel` | Dasselbe, aber unten im Panel-Bereich neben Terminal/Output |
| `external` | Im normalen Browser (nutzt deine bestehende SAP-Session/SSO, kein Proxy nötig) |

### Wie die Anmeldung im Tab/Panel funktioniert (Auth-Proxy)

Ein eingebetteter iframe hat **keine** SAP-Session – ein direkter Aufruf würde
mit **401 Not authorized** enden. Deshalb startet die Extension bei `tab` und
`panel` einen lokalen Auth-Proxy auf `127.0.0.1`:

1. Beim ersten Start fragt sie **einmalig** SAP-Benutzer und Passwort ab
   (dieselben wie in ADT). Die Daten liegen im VS Code **SecretStorage**.
2. Der Proxy hängt an **jeden** Request `Authorization: Basic …` an und leitet
   ihn an dein System weiter – inklusive UI5-Ressourcen, Cookies, CSRF-Token
   und Redirects.
3. Der iframe lädt `http://127.0.0.1:<port>/…`, die App läuft eingebettet,
   ohne 401.

Damit das Einbetten überhaupt erlaubt ist, entfernt der Proxy `X-Frame-Options`
und die CSP-Direktive `frame-ancestors` aus den Antworten. Selbstsignierte
HTTPS-Zertifikate werden akzeptiert.

> **Voraussetzung:** Das System akzeptiert **Basic Auth**. Reine SSO-/SAML-
> Anmeldung ohne Basic-Auth-Fallback wird nicht unterstützt – dann `external`
> verwenden.
>
> **Zugangsdaten ändern/löschen:** Command *„abap2UI5: Gespeicherte
> SAP-Zugangsdaten löschen"*. Beim nächsten F9 wird neu gefragt.

## Einstellungen

| Einstellung | Default | Bedeutung |
| --- | --- | --- |
| `abap2ui5.launchUrlTemplate` | – | URL-Vorlage zum Starten einer App, `{class}` als Platzhalter |
| `abap2ui5.openMode` | `tab` | `tab`, `panel` oder `external` |
| `abap2ui5.reloadOnSave` | `true` | Vorschau beim Speichern der gezeigten Klasse neu laden |

## Befehle

| Befehl | Beschreibung |
| --- | --- |
| `abap2UI5: App starten (F9)` | Startet die App der aktuellen Klasse |
| `abap2UI5: Neue App-Vorlage einfügen` | Fügt ein App-Klassen-Skelett ein |
| `abap2UI5: Gespeicherte SAP-Zugangsdaten löschen` | Löscht Benutzer und Passwort aus dem SecretStorage |
| `abap2UI5: Projekt auf GitHub öffnen` | Öffnet das abap2UI5-Repository im Browser |

## Installation

Die Extension wird derzeit als `.vsix` verteilt (noch nicht im Marketplace).

**Über die Oberfläche:** Extensions-Panel (`Ctrl/Cmd + Shift + X`) → `…`-Menü →
**Install from VSIX…** → Datei auswählen.

**Über das Terminal:**

```bash
code --install-extension abap2ui5-0.6.0.vsix
```

**Update** = neue `.vsix` mit höherer Versionsnummer bauen und erneut
installieren.

**Deinstallieren:** Extensions-Panel → Extension suchen → **Uninstall**. Oder:

```bash
code --uninstall-extension abap2ui5-local.abap2ui5
```

## Entwickeln

```bash
npm install
npm run compile      # baut dist/extension.js mit esbuild
```

Dieses Repository in VS Code öffnen und **F5** drücken → es startet ein zweites
VS-Code-Fenster (Extension Development Host) mit geladener Extension.

Praktisch während der Entwicklung: `npm run watch` baut bei jeder Änderung neu.
`npm run lint` prüft die Typen (`tsc --noEmit`).

## Als `.vsix` paketieren

```bash
npm install
npm run vsix
```

Ergebnis ist eine Datei wie `abap2ui5-0.6.0.vsix`.

> `vsce` ist als devDependency enthalten, `npm run vsix` nutzt die lokale
> Version. Alternativ global: `npm install -g @vscode/vsce`.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
