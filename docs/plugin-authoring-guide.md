# Grainery Plugin Authoring Guide

This guide is for developers building plugins for Grainery.

If you want deep internals, read `docs/plugin-system.md`.  
If you want UI extension details, read `docs/plugin-ui-extension.md`.

## 1. Mental model: what a Grainery plugin is

A Grainery plugin is a JavaScript module loaded in an isolated Web Worker.  
Your plugin exports an object with `setup(api)`, then registers capabilities with the host.

Core ideas:

- Plugins are optional and writer-focused.
- Plugins do not run in the main UI thread.
- Optional permissions are deny-by-default.
- Plugin UI is declarative and host-rendered (no arbitrary DOM injection).

## 2. Fast path: generate a plugin

From the Grainery repo root:

```bash
npm run plugin:create -- examples/plugins/my-plugin --id com.example.my-plugin --name "My Plugin"
cd examples/plugins/my-plugin
npm install
npm run build
npm run validate
npm run pack
```

The generated archive is installable from Settings -> Plugins -> Install from file.

The generator creates:

```text
my-plugin/
  grainery-plugin.manifest.json
  package.json
  tsconfig.json
  README.md
  src/
    main.ts
```

The TypeScript starter imports SDK types from the local `@grainery/plugin-sdk` package and compiles to `dist/main.js`.

## 3. Start from an example

You can also use one of these existing examples:

- `examples/plugins/wordcount/`
- `examples/plugins/element-toolbar/`
- `examples/plugins/scene-outline/`
- `examples/plugins/review-notes/`

What each example demonstrates:

- `wordcount`: element loop rule, command, status badge, pre-save transform, exporter.
- `element-toolbar`: declarative UI control + side panel + editor action dispatch.
- `scene-outline`: side panel scene list with click-to-jump navigation.
- `review-notes`: reviewer-attributed notes with panel form fields, document plugin data, and inline highlights.

Validate and package any example from the repo root:

```bash
npm run plugin:validate -- examples/plugins/wordcount --check-entry
npm run plugin:pack -- examples/plugins/wordcount
npm run plugin:check-archive -- examples/plugins/wordcount/com.grainery.wordcount.grainery-plugin.zip
```

## 4. Plugin folder structure

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

## 5. Use the SDK types

Generated plugins use `@grainery/plugin-sdk` for TypeScript authoring:

```ts
import type { GraineryPlugin } from '@grainery/plugin-sdk';

const plugin: GraineryPlugin = {
  setup(api) {
    api.registerCommand({
      id: 'hello-world',
      title: 'Hello World',
      handler() {
        // plugin work
      }
    });
  }
};

export default plugin;
```

If you use a bundler, you can also use the identity helpers:

```ts
import { definePlugin } from '@grainery/plugin-sdk';

export default definePlugin({
  setup(api) {
    // strongly typed api
  }
});
```

For plain `tsc` builds, prefer `import type` so the emitted worker module has no runtime SDK import.

## 6. Write the manifest

Create `grainery-plugin.manifest.json`:

```json
{
  "schemaVersion": 1,
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "My Grainery plugin",
  "engine": { "grainery": ">=0.1.0", "pluginApi": "^1.2.0" },
  "entry": "dist/main.js",
  "permissions": ["document:read"],
  "optionalPermissions": [],
  "permissionRationales": {},
  "networkAllowlist": [],
  "activationEvents": ["onCommand:my-command"],
  "contributes": {
    "commands": [{ "id": "my-command", "title": "My Command" }],
    "menus": [
      {
        "id": "my-command-palette",
        "command": "my-command",
        "location": "command-palette",
        "icon": "command",
        "when": "plugin.enabled"
      }
    ],
    "keybindings": [],
    "exporters": [],
    "importers": [],
    "statusBadges": [],
    "inlineAnnotationProviders": [],
    "uiControls": [],
    "uiPanels": [],
    "transforms": []
  },
  "signature": {
    "keyId": "main-2026",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "sig": "PLACEHOLDER"
  }
}
```

Permission sets:

- Core permissions: `document:read`, `document:write`, `editor:commands`, `export:register`
- Optional permissions: `fs:pick-read`, `fs:pick-write`, `network:https`, `ui:mount`, `editor:annotations`, `system:fonts`

Use `permissionRationales` for every optional permission you expect users to grant. Keep the wording
short and conversational. Grainery shows it in Settings beside a plain-language description of the
access, while permission prompts use host-written copy that does not expose internal permission ids.

On a fresh install, Grainery prompts for each optional permission. Plugin updates preserve existing
choices and prompt only when the new version introduces an additional optional permission.

Example:

```json
{
  "optionalPermissions": ["ui:mount"],
  "permissionRationales": {
    "ui:mount": "Adds a screenplay utility panel and toolbar button."
  }
}
```

`activationEvents` + `contributes` are required in plugin API `1.2.0`.

## 7. Validate the manifest

From repo root:

```bash
npm run plugin:validate -- examples/plugins/wordcount --check-entry
```

You can pass either a plugin directory or a direct manifest path:

```bash
npm run plugin:validate -- examples/plugins/wordcount/grainery-plugin.manifest.json
```

`validate:plugin-manifest` remains as a compatibility alias for direct manifest validation.

## 8. Write plugin code (`dist/main.js`)

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

### Screenplay helper API

Prefer `context.screenplay` or `api.screenplay.from(context.document, context)` over hand-walking raw TipTap JSON.

Common helpers:

```js
api.registerCommand({
  id: 'inspect-script',
  title: 'Inspect Script',
  async handler(context) {
    const screenplay = context.screenplay || api.screenplay.from(context.document, context);
    const scenes = screenplay.scenes();
    const dialogue = screenplay.dialogue();
    const current = screenplay.currentElement();

    await api.hostCall('audit:log', {
      scenes: scenes.length,
      dialogueBlocks: dialogue.length,
      currentElement: current?.type || null,
      text: screenplay.plainText(),
    });
  },
});
```

For common mutations, use `api.screenplay.mutate(...)`; it loads the current document, gives you a mutable helper clone, then replaces the document through the normal `document:write` permission gate:

```js
await api.screenplay.mutate((document) => {
  document.appendBlock({ type: 'action', text: 'A new action line.' });
});
```

For highlights and notes, create stable anchors from selections and resolve them after edits:

```js
const selection = context.screenplay.selection(context);
const anchor = context.screenplay.createAnchor(selection);
const resolved = context.screenplay.resolveAnchor(anchor);
```

### Plugin storage

Existing `api.getPluginData()` and `api.setPluginData(value)` still work for document-scoped plugin data.
New typed wrappers make state easier to manage:

```js
const documentState = api.screenplay.documentStorage({ notes: [] });
const state = await documentState.get();
await documentState.update((current) => ({
  ...current,
  notes: [...current.notes, nextNote],
}));

const preferences = api.screenplay.globalStorage('preferences', { compact: false });
await preferences.set({ compact: true });
```

Document storage is saved inside the current `.gwx` file and uses the existing document read/write permission gates.
Global storage is plugin-scoped app data for lightweight preferences.

### Disposable registrations

Registration methods now return a disposable. Ignoring the return value is fine, but long-running plugins can explicitly clean up dynamic registrations:

```js
const disposable = api.registerStatusBadge({
  id: 'temporary-status',
  label: 'Temporary',
  handler() {
    return 'Ready';
  },
});

await disposable.dispose();
```

## 9. Build features incrementally

Recommended order:

1. Add a command (`registerCommand`) that logs a result.
2. Add read-only output (`registerStatusBadge`).
3. Add transforms/exporters/importers.
4. Add UI controls/panels (`registerUIControl`, `registerUIPanel`) only if needed.
5. Add inline annotations (`registerInlineAnnotationProvider`) if your plugin needs range highlights.

Why: this keeps your plugin testable and minimizes permission scope.

## 10. Step-by-step walkthrough: `wordcount`

Source: `examples/plugins/wordcount/dist/main.js`

Step sequence:

1. `registerElementLoopProvider` adds a custom Enter behavior: empty Action -> Character.
2. `registerCommand` adds `word-count`; the manifest exposes it through a command-palette menu entry and keybinding.
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

## 11. Step-by-step walkthrough: `element-toolbar`

Source: `examples/plugins/element-toolbar/dist/main.js`

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

Panel form fields:

- `input` and `textarea` blocks are host-rendered.
- values are delivered to `onAction(context.formValues)`.
- use stable `fieldId` keys to keep form state predictable.

## 12. Step-by-step walkthrough: `review-notes`

Source: `/Users/jay/git/screenwrite/examples/plugins/review-notes/dist/main.js`

Step sequence:

1. `registerUIControl` adds a panel toggle in the bottom toolbar.
2. `registerUIPanel` renders reviewer/name note fields with declarative `input` + `textarea` blocks.
3. `onAction` reads `context.formValues`, creates/deletes notes, and returns updated panel content.
4. Plugin persists notes via `api.getPluginData()` / `api.setPluginData(...)`.
5. `registerInlineAnnotationProvider` returns inline highlight ranges (`note` / `note-active`) for host rendering.

How it fits together:

- state is stored per plugin in document `pluginData`.
- annotations stay host-rendered and sandbox-safe.
- note anchors can be re-resolved from stored quote context after document edits.

## 13. Package the plugin zip

From the repo root:

```bash
npm run plugin:pack -- examples/plugins/my-plugin
```

Write to a custom archive path:

```bash
npm run plugin:pack -- examples/plugins/my-plugin --out /tmp/my-plugin.grainery-plugin.zip
```

Then verify contents and manifest consistency:

```bash
npm run plugin:check-archive -- examples/plugins/my-plugin/com.example.my-plugin.grainery-plugin.zip
```

The archive must contain `grainery-plugin.manifest.json` at root, not nested under another folder. The manifest `entry` file must also exist inside the archive.

## 14. Install and test in Grainery

1. Open Grainery.
2. Go to Settings -> Plugins.
3. Click Install from file.
4. Select your `.grainery-plugin.zip`.
5. Enable optional permissions you need (for example `ui:mount`).

Sideloaded plugins remain marked **unverified** in Settings. That is expected for local development and private testing. Registry plugins are marked verified only after the registry signature and archive SHA-256 checks pass.

Smoke-test checklist:

- Install succeeds with no manifest error.
- Plugin appears in installed list.
- Trust/source and lock verification details look correct.
- Registered commands/exporters/importers/status badges appear.
- UI controls/panels appear only when `ui:mount` is granted.
- Permission prompts show useful rationales and your plugin handles deny gracefully.
- Diagnostics stay empty during normal use.
- Disable/uninstall removes plugin behavior immediately.

## 15. Security and quality checklist

Before sharing a plugin:

- Request the minimum permissions required.
- Provide a clear `permissionRationales` entry for every optional permission.
- Keep `networkAllowlist` as narrow as possible.
- Handle malformed document content safely.
- Avoid long-running handlers; return quickly.
- Keep deterministic behavior for denied permissions.
- Add clear plugin README usage notes.
- Document support expectations: what data the plugin touches, known limitations, and how users should report diagnostics from Settings.

## 16. Publishing, signing, and updates

Registry publishing requires a manifest entry, archive SHA-256, signing key id, and signature. Grainery treats registry installs as verified only when:

- the registry entry id/version matches the manifest id/version;
- the registry signature verifies with a trusted Grainery registry key;
- the downloaded archive SHA-256 matches the registry record;
- the archive passes the same manifest and package validation as sideloaded plugins.

Settings exposes the lock record so users can see the archive hash, signing key, source, and registry/download URLs. If the fetched registry contains a higher semver for an installed plugin, Settings shows an update action and asks for confirmation before replacing the installed package. Keep updates compatible with existing granted permissions where possible, and mention breaking changes in your README.

## 17. Common pitfalls

- Zip has a top-level folder (manifest not at archive root).
- Manifest `entry` path is wrong or absolute.
- Missing `ui:mount` while trying to render UI controls/panel.
- Missing `editor:annotations` while trying to render inline highlights.
- Forgetting `document:write` when using `setPluginData`.
- Returning annotation ranges without validating stale anchors.
- Omitting `permissionRationales`, which leaves users without author context in prompts.
- Declaring optional permissions but not handling denied state.
- Expecting direct DOM or Tauri API access from plugin code.
- Importing SDK runtime helpers in an unbundled plugin; use `import type` with plain `tsc`.

## 18. Where to go next

- Internals and architecture: `docs/plugin-system.md`
- UI extension API: `docs/plugin-ui-extension.md`
- Schema reference: `grainery-plugin.manifest.json`
