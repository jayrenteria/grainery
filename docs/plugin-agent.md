# Plugin Agent Handoff (Grainery)

This document is for future coding agents that need to build or extend the Grainery plugin system without prior thread context.

## Purpose

Use this as the execution map for plugin-related changes:

- where to edit
- what contracts must remain stable
- how to validate behavior safely

## System Snapshot

Grainery plugins are JavaScript modules loaded into isolated Web Workers.

Current plugin model:

- Runtime: worker-isolated, one worker per active plugin
- Activation: manifest-driven (`activationEvents`)
- Install: sideload zip + curated registry
- Permissions: deny-by-default for optional scopes
- UI extensions: declarative, host-rendered only
- Native code plugins: not supported in v1

## Source of Truth Files

Core plugin contracts:

- `src/plugins/types.ts`
- `src/plugins/sdk.ts`
- `src/plugins/rpc.ts`

Runtime / orchestration:

- `src/plugins/worker-runtime.ts`
- `src/plugins/PluginManager.ts`
- `src/plugins/PluginHost.ts`

Host app integration:

- `src/App.tsx`
- `src/components/Editor/ScreenplayEditor.tsx`
- `src/components/Settings/SettingsModal.tsx`

Plugin UI host:

- `src/components/PluginUI/PluginUIHost.tsx`
- `src/components/PluginUI/PluginToolbar.tsx`
- `src/components/PluginUI/PluginSidePanel.tsx`
- `src/plugins/ui/icons.tsx`
- `src/styles/plugin-ui.css`

Rust backend:

- `src-tauri/src/plugins/mod.rs`
- `src-tauri/src/lib.rs` (command wiring)

Manifest and validation:

- `grainery-plugin.manifest.json`
- `scripts/validate-plugin-manifest.mjs`

Examples:
- `examples/plugins/wordcount/`
- `examples/plugins/element-toolbar/`
- `examples/plugins/review-notes/`


## Non-Negotiable Constraints

1. Plugins must not inject arbitrary DOM into host UI.
2. Plugins must not directly call Tauri `invoke` from plugin code.
3. Optional permissions must remain deny-by-default.
4. UI definitions must be ignored unless `ui:mount` is granted.
5. Inline annotation providers require `editor:annotations`.
6. Zip install expects `grainery-plugin.manifest.json` at archive root.
7. Worker crashes/timeouts must not crash editor host.

## Extension Points (v1.2)

Supported plugin registrations:

- element loop providers
- commands
- document transforms (`post-open`, `pre-save`, `pre-export`)
- exporters/importers
- status badges
- inline annotation providers
- UI controls (`top-bar`, `bottom-bar`)
- single side panel with primitive blocks (`text`, `list`, `keyValue`, `input`, `textarea`, `actions`)

Not supported:

- arbitrary plugin React components
- custom schema/node mutation from plugins
- native dylib plugins

## Known Integration Gotchas

1. **Composite IDs**
   - Host stores IDs as `pluginId:localId`.
   - UI actions coming from workers may be local IDs and must be normalized.
   - See normalization logic in `src/plugins/PluginManager.ts`.

2. **UI refresh coupling**
   - Plugin UI state depends on editor selection + document state.
   - Keep selection updates wired through editor callbacks in `src/components/Editor/ScreenplayEditor.tsx` and `src/App.tsx`.

3. **Permission list drift**
   - If you add optional/core permissions, update all of:
   - TypeScript unions (`types.ts`)
   - frontend constants (`permissions.ts`)
   - manifest JSON schema
   - JS manifest validator
   - Rust permission checks
   - settings UI toggles

## Change Playbook

When adding a new plugin capability:

1. Add types to `src/plugins/types.ts`.
2. Extend SDK exposure in `src/plugins/sdk.ts`.
3. Extend worker/host RPC parsing in `src/plugins/rpc.ts`.
4. Implement worker handler paths in `src/plugins/worker-runtime.ts`.
5. Implement manager storage + dispatch in `src/plugins/PluginManager.ts`.
6. Wire host behavior in app/components as needed.
7. Update docs + at least one example plugin.
8. Validate with build checks below.

## Validation Checklist

Run after plugin-system changes:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Validate manifests:

```bash
npm run validate:plugin-manifest -- examples/plugins/wordcount/grainery-plugin.manifest.json
npm run validate:plugin-manifest -- examples/plugins/element-toolbar/grainery-plugin.manifest.json
npm run validate:plugin-manifest -- examples/plugins/review-notes/grainery-plugin.manifest.json
```

If modifying example zips, rebuild and verify root layout:

```bash
unzip -l examples/plugins/wordcount/wordcount.grainery-plugin.zip
unzip -l examples/plugins/element-toolbar/element-toolbar.grainery-plugin.zip
```

## Manual QA Minimum

1. Install example plugin from file succeeds.
2. Permission gating works (especially `ui:mount`).
3. Disable/uninstall removes plugin behavior immediately.
4. Plugin crash does not crash editor.
5. Core writing loop (Tab/Enter/Escape) remains intact without plugins.

## Related Docs

- `docs/plugin-system.md`
- `docs/plugin-ui-extension.md`
- `docs/plugin-authoring-guide.md`
