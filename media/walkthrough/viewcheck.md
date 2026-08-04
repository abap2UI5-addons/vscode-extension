# The view check finds problems while you type

abap2UI5 views are built as strings — a typo'd property or a control newer
than your system's UI5 version normally fails at runtime, in the browser.
Here the [abap2UI5-linter](https://github.com/abap2UI5/linter) runs **in the
editor, while you type**: unknown controls, too-new or deprecated members,
binding paths the model does not have, events nothing handles — all in the
Problems panel before the app ever reaches a system.

Mechanical corrections come as **quick fixes** (lightbulb), and every finding
links to its rule reference. Typing `{` in a value completes the **binding
paths the model actually has**; hovering one says what it resolves to.

Set `abap2ui5.viewCheck.minUi5` and `.distribution` to what your system runs
— after the first F9 the extension reads both from the system and offers to
align.
