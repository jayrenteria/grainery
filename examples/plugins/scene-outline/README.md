# Scene Outline (Example Plugin)

This plugin adds a `Scenes` button to the plugin toolbar and opens a side panel with one entry per `sceneHeading` block.

Click any scene in the panel to jump directly to that scene in the editor.

The implementation uses `context.screenplay.scenes()` instead of walking raw ProseMirror JSON.

## Permissions

- Optional: `ui:mount`

## Packaging

From the repo root:

```bash
npm run plugin:validate -- examples/plugins/scene-outline --check-entry
npm run plugin:pack -- examples/plugins/scene-outline
```
