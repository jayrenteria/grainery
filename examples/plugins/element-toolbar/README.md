# Element Toolbar (Example Plugin)

This plugin demonstrates the declarative plugin UI extension surface:

- `registerUIPanel`
- `registerUIControl`
- side-panel content rendering (`onRender(context)`)
- side-panel action handling (`onAction(context)`)
- whitelisted editor action dispatch (`editor:set-element`)

Runtime behavior:

- Adds a bottom-bar panel toggle control.
- Opens an `Element Toolbar` side panel with quick actions for Scene Heading, Action, Character, Dialogue, Parenthetical, and Transition.
- Clicking an action switches the current node to that screenplay element.
- The active element is shown in the panel and highlighted in the action list.

This example requires optional permission `ui:mount`.

Package this directory as a `.grainery-plugin.zip` with `grainery-plugin.manifest.json` at the root to install via Settings -> Plugins -> Install from file.
