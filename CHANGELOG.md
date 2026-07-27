# Changelog

## 0.5.0

- **Auto-Reload beim Aktivieren:** Wird die im Tab gezeigte App-Klasse
  gespeichert/aktiviert, lädt der eingebettete Browser automatisch neu –
  ohne F9. Abschaltbar über `abap2ui5.reloadOnSave` (Default: an).

## 0.4.2

- Fix: Cursor bleibt nach F9 wirklich im Quelltext. Die ladende UI5-App zieht
  den Fokus asynchron an sich – die Extension fängt das jetzt für ein kurzes
  Zeitfenster ab (`onDidChangeViewState`) und gibt den Fokus in den Code zurück.

## 0.4.1

- F9 gibt den Fokus nach dem Start/Reload wieder an den Quelltext zurück –
  der Cursor bleibt an derselben Stelle, du kannst direkt weiterschreiben.

## 0.4.0

- **F9 aktualisiert** jetzt zuverlässig den bestehenden Tab/Panel (Reload der
  App), statt einen neuen zu öffnen. Bei einer anderen Klasse wechselt der
  bestehende Tab auf die neue App. Reload läuft per Nachricht an den iframe.

## 0.3.1

- Fix: leere/weiße App im Tab – der Proxy entfernt jetzt `X-Frame-Options`
  und die CSP-Direktive `frame-ancestors` aus den SAP-Antworten, sodass der
  Browser das Einbetten im iframe zulässt.

## 0.3.0

- **Eingebettete App mit Anmeldung** über einen lokalen Auth-Proxy:
  F9 zeigt die App im Editor-Tab (oder Panel), der Proxy injiziert die
  SAP-Zugangsdaten – kein 401 mehr.
- `abap2ui5.openMode` erweitert: `tab` (neuer Default), `panel`, `external`
- Zugangsdaten werden einmalig abgefragt und im SecretStorage gespeichert
- Neuer Command: "abap2UI5: Gespeicherte SAP-Zugangsdaten löschen"
- Proxy leitet UI5-Ressourcen, Cookies, CSRF und Redirects transparent weiter;
  selbst-signierte HTTPS-Zertifikate werden akzeptiert

## 0.2.0

- Neue Einstellung `abap2ui5.openMode` (`external` | `panel`), Default `external`
  - `external`: F9 öffnet die App im normalen Browser (nutzt SAP-Session/SSO)
  - `panel`: eingebettet im Panel (nur ohne interaktive Anmeldung, sonst 401)
- URL-Normalisierung: doppelte Slashes im Pfad werden entfernt

## 0.1.0

- **F9** startet eine `z2ui5_if_app`-Klasse im eingebetteten Browser-Panel unten
- Neue Einstellung `abap2ui5.launchUrlTemplate` (Platzhalter `{class}`)
- Panel-View "abap2UI5 / App Preview" mit "Extern öffnen"-Fallback
- F9 auf Nicht-App-ABAP-Dateien: normales Breakpoint-Verhalten bleibt erhalten

## 0.0.1

- Erste Version
- Command: "abap2UI5: Neue App-Vorlage einfügen"
- Command: "abap2UI5: Demokit im Browser öffnen"
- Snippets: `z2ui5app`, `z2ui5button`
