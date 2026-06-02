# Review Notes Plugin Example

Demonstrates the declarative review-note workflow:

- Reviewer name + note entry via host-rendered panel input blocks
- Notes persisted in document plugin data (`document:set-plugin-data`)
- Inline highlights via `registerInlineAnnotationProvider`
- Jump/delete note actions from panel

From the repo root:

```bash
npm run plugin:validate -- examples/plugins/review-notes --check-entry
npm run plugin:pack -- examples/plugins/review-notes
```

Install the generated `.grainery-plugin.zip` via Settings -> Plugins -> Install from file.
