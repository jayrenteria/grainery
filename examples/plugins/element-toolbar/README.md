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

From the repo root:

```bash
npm run plugin:validate -- examples/plugins/element-toolbar --check-entry
npm run plugin:pack -- examples/plugins/element-toolbar
```

Install the generated `.grainery-plugin.zip` via Settings -> Plugins -> Install from file.
