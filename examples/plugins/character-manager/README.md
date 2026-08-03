# Character Manager

Character Manager adds two screenplay-focused tools:

- Character cue autocomplete using names that already exist in the current document.
- Previewed, cue-only mass rename with merge warnings.

Autocomplete begins after one character. The first match is selected automatically, `Tab` accepts it, arrow keys change the selection, and `Escape` dismisses the menu. Empty cues and unmatched new names leave Grainery's normal Tab loop untouched.

Mass rename changes exact, case-insensitive character cue matches only. Dialogue, action text, character extensions, and cue styling are preserved.

## Permissions

- `document:read`
- `document:write`
- `editor:commands`
- Optional: `ui:mount`

## Packaging

From the repository root:

```bash
npm run plugin:validate -- examples/plugins/character-manager --check-entry
npm run plugin:pack -- examples/plugins/character-manager
```
