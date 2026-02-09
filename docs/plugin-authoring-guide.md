# Grainery Plugin Authoring Guide

This guide is for developers building plugins for Grainery.

If you want deep internals, read `/Users/jay/git/screenwrite/docs/plugin-system.md`.  
If you want UI extension details, read `/Users/jay/git/screenwrite/docs/plugin-ui-extension.md`.

## 1. Mental model: what a Grainery plugin is

A Grainery plugin is a JavaScript module loaded in an isolated Web Worker.  
Your plugin exports an object with `setup(api)`, then registers capabilities with the host.

Core ideas:

- Plugins are optional and writer-focused.
- Plugins do not run in the main UI thread.
- Optional permissions are deny-by-default.
- Plugin UI is declarative and host-rendered (no arbitrary DOM injection).

## 2. Start from an example

Use one of these existing examples:

- `/Users/jay/git/screenwrite/examples/plugins/wordcount/`
- `/Users/jay/git/screenwrite/examples/plugins/element-toolbar/`

What each example demonstrates:

- `wordcount`: element loop rule, command, status badge, pre-save transform, exporter.
- `element-toolbar`: declarative UI control + side panel + editor action dispatch.

## 3. Plugin folder structure

Use this structure:

```text
my-plugin/
  grainery-plugin.manifest.json
  README.md
  dist/
    main.js
```

Important:

- `grainery-plugin.manifest.json` must be at archive root.
- `entry` in manifest must point to your runtime JS file (for example `dist/main.js`).

## 4. Write the manifest

Create `grainery-plugin.manifest.json`:

```json
{
  "schemaVersion": 1,
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "My Grainery plugin",
  "engine": { "grainery": ">=0.1.0", "pluginApi": "^1.0.0" },
  "entry": "dist/main.js",
  "permissions": ["document:read"],
  "optionalPermissions": [],
  "networkAllowlist": [],
  "signature": {
    "keyId": "main-2026",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "sig": "PLACEHOLDER"
  }
}
```

Permission sets:

- Core permissions: `document:read`, `document:write`, `editor:commands`, `export:register`
- Optional permissions: `fs:pick-read`, `fs:pick-write`, `network:https`, `ui:mount`

## 5. Validate the manifest

From repo root:

```bash
npm run validate:plugin-manifest -- examples/plugins/wordcount/grainery-plugin.manifest.json
```

Use this command for your own manifest path as well.

## 6. Write plugin code (`dist/main.js`)

Your plugin should export a default object:

```js
export default {
  async setup(api) {
    // register capabilities
  },
  async dispose() {
    // optional cleanup
  }
};
```

`api` is the plugin SDK surface. Register only the features you need.

## 7. Build features incrementally

Recommended order:

1. Add a command (`registerCommand`) that logs a result.
2. Add read-only output (`registerStatusBadge`).
3. Add transforms/exporters/importers.
4. Add UI controls/panels (`registerUIControl`, `registerUIPanel`) only if needed.

Why: this keeps your plugin testable and minimizes permission scope.

## 8. Step-by-step walkthrough: `wordcount`

Source: `/Users/jay/git/screenwrite/examples/plugins/wordcount/dist/main.js`

Step sequence:

1. `registerElementLoopProvider` adds a custom Enter behavior: empty Action -> Character.
2. `registerCommand` adds `word-count` with shortcut `Mod+Shift+W`.
3. Command calls `api.hostCall('audit:log', ...)` to write an audit event.
4. `registerStatusBadge` shows subtle `Wordcount: X` in bottom-right.
5. `registerDocumentTransform` trims trailing whitespace before save.
6. `registerExporter` adds plain-text export.

How it fits together:

- Command is explicit user action.
- Badge gives passive live feedback.
- Transform keeps saved files clean.
- Exporter provides format off-ramp.

This is a good baseline architecture for utility plugins.

## 9. Step-by-step walkthrough: `element-toolbar`

Source: `/Users/jay/git/screenwrite/examples/plugins/element-toolbar/dist/main.js`

Step sequence:

1. `registerUIControl` adds a bottom-left toggle button.
2. Button action is `panel:toggle` for `element-toolbar-panel`.
3. `registerUIPanel` defines a side panel shell.
4. `onRender(context)` computes panel content from current editor state.
5. `actions` block emits declarative buttons for each screenplay element type.
6. `onAction(context)` maps clicked action IDs to `editor:set-element` host actions.

How it fits together:

- Plugin does not render custom React/DOM.
- Plugin declares UI shape + behavior in JSON/handlers.
- Host handles rendering, styling, focus, and dispatch.

## 10. Package the plugin zip

From inside your plugin folder:

```bash
zip -q -r my-plugin.grainery-plugin.zip grainery-plugin.manifest.json README.md dist/main.js
```

Then verify contents:

```bash
unzip -l my-plugin.grainery-plugin.zip
```

You should see `grainery-plugin.manifest.json` at root, not nested under another folder.

## 11. Install and test in Grainery

1. Open Grainery.
2. Go to Settings -> Plugins.
3. Click Install from file.
4. Select your `.grainery-plugin.zip`.
5. Enable optional permissions you need (for example `ui:mount`).

Smoke-test checklist:

- Install succeeds with no manifest error.
- Plugin appears in installed list.
- Registered commands/exporters/importers/status badges appear.
- UI controls/panels appear only when `ui:mount` is granted.
- Disable/uninstall removes plugin behavior immediately.

## 12. Security and quality checklist

Before sharing a plugin:

- Request the minimum permissions required.
- Keep `networkAllowlist` as narrow as possible.
- Handle malformed document content safely.
- Avoid long-running handlers; return quickly.
- Keep deterministic behavior for denied permissions.
- Add clear plugin README usage notes.

## 13. Common pitfalls

- Zip has a top-level folder (manifest not at archive root).
- Manifest `entry` path is wrong or absolute.
- Missing `ui:mount` while trying to render UI controls/panel.
- Declaring optional permissions but not handling denied state.
- Expecting direct DOM or Tauri API access from plugin code.

## 14. Where to go next

- Internals and architecture: `/Users/jay/git/screenwrite/docs/plugin-system.md`
- UI extension API: `/Users/jay/git/screenwrite/docs/plugin-ui-extension.md`
- Schema reference: `/Users/jay/git/screenwrite/grainery-plugin.manifest.json`
