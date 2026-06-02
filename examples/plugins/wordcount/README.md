# Word Count Utilities (Example Plugin)

This plugin demonstrates the Grainery plugin SDK surface:

- `registerElementLoopProvider`
- `registerCommand`
- `registerDocumentTransform`
- `registerExporter`
- `registerStatusBadge`

Runtime behavior:

- Adds a subtle bottom-right `Wordcount: X` status badge

From the repo root:

```bash
npm run plugin:validate -- examples/plugins/wordcount --check-entry
npm run plugin:pack -- examples/plugins/wordcount
```

Install the generated `.grainery-plugin.zip` via Settings -> Plugins -> Install from file.
