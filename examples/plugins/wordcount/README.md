# Word Count Utilities (Example Plugin)

This plugin demonstrates the Grainery plugin SDK surface:

- `registerElementLoopProvider`
- `registerCommand`
- `registerDocumentTransform`
- `registerExporter`
- `registerStatusBadge`
- manifest command menu + keybinding contributions
- manifest configuration schema
- `api.screenplay.from(...)`

Runtime behavior:

- Adds a subtle bottom-right `Wordcount: X` status badge
- Declares a command-palette menu entry and configurable `Mod+Shift+W` keybinding
- Uses the screenplay helper API for plain-text extraction and whitespace cleanup

From the repo root:

```bash
npm run plugin:validate -- examples/plugins/wordcount --check-entry
npm run plugin:pack -- examples/plugins/wordcount
```

Install the generated `.grainery-plugin.zip` via Settings -> Plugins -> Install from file.
