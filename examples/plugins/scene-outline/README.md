# Scene Manager (Example Plugin)

Scene Manager builds on the original Scene Outline plugin. It now:

- Numbers every scene sequentially from `1` through `N`.
- Shows scene numbers on both sides of scene headings.
- Adds an always-visible right-side scene map with hover labels.
- Jumps to a scene from either the map or the optional outline panel.
- Persists numbers on save and adds them to PDF, FDX, and Fountain exports.

One scene index built with `context.screenplay.scenes()` drives all of these features.

## Permissions

- `document:read`
- `document:write`
- Optional: `ui:mount`

## Packaging

From the repo root:

```bash
npm run plugin:validate -- examples/plugins/scene-outline --check-entry
npm run plugin:pack -- examples/plugins/scene-outline
```
