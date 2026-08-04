# Ctrl+F3 activates and reloads

Saving an ABAP class does not change what the server runs — only
**activation** does. That is why the preview reloads on activation, not on
save:

- **Ctrl+F3** (`Cmd+F3` on macOS — the activation key from SAP GUI) saves the
  class, activates it through your ABAP tooling and reloads the preview.
- Activating any other way (the ABAP extension's own button, even Eclipse)
  is noticed on the server, and the preview reloads too.
- A plain save only marks the preview *not activated*.

The behaviour is configurable with `abap2ui5.reloadOn`.
