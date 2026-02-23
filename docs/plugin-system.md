# Grainery Plugin System

This document explains how the current Grainery plugin system works end-to-end: runtime model, install flows, security boundaries, extension points, and authoring conventions.

## Goals and Scope

The plugin system is designed for a writer-first experience:

- Keep the core app minimal
- Allow optional features without forking core code
- Enforce deny-by-default permissions
- Isolate plugin execution from the main UI thread
- Keep Rust-side capabilities behind a strict broker

The current implementation supports JavaScript plugins only (no native/dylib plugins).
Current plugin API target is `^1.2.0` (older plugin API ranges are not supported).

## High-Level Architecture

Grainery plugin execution is split across five layers:

1. **Rust plugin backend (`src-tauri/src/plugins/mod.rs`)**
   - Installs/uninstalls plugins
   - Persists plugin state + lock records
   - Fetches curated registry index
   - Brokers privileged operations (`plugin_host_call`)

2. **Frontend plugin manager (`src/plugins/PluginManager.ts`)**
   - Loads installed/enabled plugins
   - Spawns one Web Worker per plugin
   - Tracks registered extension points
   - Routes command/transform/import/export calls

3. **Worker runtime (`src/plugins/worker-runtime.ts`)**
   - Loads plugin entry module in an isolated worker
   - Exposes the plugin SDK API
   - Registers plugin handlers with host
   - Invokes handlers when host requests

4. **Host bridge (`src/plugins/PluginHost.ts`)**
   - Controls document read/write access
   - Handles permission prompts for optional capabilities
   - Forwards privileged ops to Rust broker

5. **Plugin UI host (`src/components/PluginUI/*`)**
   - Renders plugin-declared controls into host UI regions
   - Renders a single active plugin side panel
   - Routes UI actions through a restricted host action layer

## Data Model

Core types live in `src/plugins/types.ts`.

### Manifest

Plugin manifests follow the schema at:

- `grainery-plugin.manifest.json`

Important fields:

- `id`, `name`, `version`, `description`
- `engine.grainery` and `engine.pluginApi` version requirements
- `entry` (JS module path inside plugin package)
- `permissions` (core)
- `optionalPermissions` (promptable)
- `networkAllowlist`
- `activationEvents` (required)
- `contributes` (required)
- `signature` metadata

### Persisted state

Rust persists:

- `InstalledPlugin`
- `PluginPermissionGrant`
- `PluginRegistryEntry`
- `PluginLockRecord`

Store location is under the app data plugins directory (`plugins-state.json` + install tree).

Open screenplay documents can additionally persist plugin-scoped data in-file under:

- `pluginData[pluginId]`

## Lifecycle: Install to Execution

### 1. Install

Frontend settings UI calls Rust commands:

- `plugin_install_from_file`
- `plugin_install_from_registry`

Rust validates:

- Manifest schema/version constraints
- Engine semver compatibility
- Declared permission validity
- Registry hash/signature checks for curated installs

Then Rust extracts plugin files to app data and records installation metadata.

### 2. Load

At app startup and after plugin state changes:

- `PluginManager.initialize()` -> `plugin_list_installed`
- Enabled plugins are contribution-indexed from manifest
- Workers are activated lazily via `activationEvents` (`onStartup` can opt into eager activation)
- Each active plugin runs in its own worker

### 3. Worker init

Host sends `host:init` with:

- `pluginId`
- `manifest`
- `entrySource`

Worker imports the module and calls `setup(api)`.

### 4. Registration

During `setup`, plugin calls SDK registration methods:

- `registerElementLoopProvider`
- `registerCommand`
- `registerDocumentTransform`
- `registerExporter`
- `registerImporter`
- `registerStatusBadge`
- `registerInlineAnnotationProvider`
- `registerUIControl`
- `registerUIPanel`

Worker emits registration messages back to host; manager updates in-memory registries.

### 5. Invocation

Host can invoke plugin handlers via worker RPC:

- Command execution
- Document transform hooks (`post-open`, `pre-save`, `pre-export`)
- Exporter/importer execution

Pending requests are timeout-protected and isolated per worker.

## Extension Points

## 1) Element loop providers

Screenplay key loop behavior (`Tab`, `Shift-Tab`, `Enter`, `Escape`) can be overridden/extended.

Flow:

- `ScreenplayKeymap` calls `resolveElementLoop(context)`
- `PluginManager` evaluates registered rules by priority
- First matching rule returns the next screenplay element type
- If no plugin rule matches, core behavior runs

Files:

- `src/extensions/ScreenplayKeymap.ts`
- `src/components/Editor/ScreenplayEditor.tsx`
- `src/App.tsx`

## 2) Commands

Plugins can register commands with optional shortcuts.

- Shortcuts are captured globally and dispatched to plugin workers
- Commands receive current document snapshot

## 3) Document transforms

Transforms can mutate document content at defined hooks:

- `post-open`
- `pre-save`
- `pre-export`

Transforms run in priority order (highest first), passing along updated content.

## 4) Exporters / Importers

Plugins can add custom export/import formats.

- Exporters return `string` or `Uint8Array`
- Importers return TipTap-compatible `JSONContent`
- Settings UI exposes run buttons for registered exporters/importers

## 5) Status badges

Plugins can render small read-only status badges in the app overlay (bottom-right).

Use:

- `registerStatusBadge`

Badge handlers receive the current document and return:

- a string to render
- `null` (or empty) to hide the badge

Registration shape:

```ts
api.registerStatusBadge({
  id: 'wordcount-status',
  label: 'Wordcount',
  priority: 10,
  handler(context) {
    return '123';
  }
});
```

Behavior:

- one badge entry per registered id
- badges are evaluated by priority (highest first)
- badge text refreshes as editor/plugin state changes
- badges are informational only (no click actions)

## 6) Declarative plugin UI

Plugins can mount declarative UI in host-rendered regions:

- top bar controls (`mount: 'top-bar'`)
- bottom bar controls (`mount: 'bottom-bar'`)
- one side panel at a time

Key properties:

- plugins do not render arbitrary DOM
- controls use host icon IDs (`BuiltinIconId`)
- actions are restricted to whitelisted types (`command`, editor element actions, panel open/close/toggle)
- host batches worker state evaluation via `ui-evaluate`

See `docs/plugin-ui-extension.md` for the complete API and behavior details.

## 7) Inline annotations

Plugins can provide inline highlight ranges rendered by the host editor layer.

Use:

- `registerInlineAnnotationProvider`

Provider handlers receive current document + selection context and return a list of range annotations.

Behavior:

- host validates and clamps returned ranges
- annotations are rendered with host-owned style tokens (`note`, `note-active`)
- annotations disappear immediately when plugin is disabled/uninstalled
- no arbitrary plugin DOM injection is involved

## Permission and Security Model

### Deny-by-default

Optional permissions are denied unless explicitly granted per plugin.

Optional permissions:

- `fs:pick-read`
- `fs:pick-write`
- `network:https`
- `ui:mount`
- `editor:annotations`

Core permissions are declared in manifest and validated:

- `document:read`
- `document:write`
- `editor:commands`
- `export:register`

### Document access

Document operations are brokered through host API methods, not direct app state access:

- `document:get`
- `document:replace`
- `document:get-plugin-data`
- `document:set-plugin-data`

`document:get-plugin-data` / `document:set-plugin-data` are plugin-scoped persistence helpers backed by the open `.gwx` document payload (`pluginData[pluginId]`).

### Rust host-call broker

Privileged operations are brokered by `plugin_host_call`.

Currently supported brokered operations:

- `network:get_json`
- `network:get_text`
- `audit:log`

Enforcements:

- Plugin must be enabled
- Required optional permission must be granted
- Network URL must be `https`
- Host must match plugin `networkAllowlist`
- Operation is audit-logged

### Isolation and fault tolerance

- One worker per plugin
- Worker crash does not crash app
- Crash counts tracked in manager; repeated crashes trigger disable logic
- Invocation timeout guard prevents hung plugin calls

### App hardening

- CSP is explicitly configured in `src-tauri/tauri.conf.json`
- Tauri default capability was tightened to least needed defaults in `src-tauri/capabilities/default.json`

## Install / Package Mechanics

## Supported install paths

1. **Sideload file install**
   - UI: Settings -> Plugins -> Install from file
   - Rust command: `plugin_install_from_file`

2. **Curated registry install**
   - UI: fetch registry + install entry
   - Rust commands:
     - `plugin_fetch_registry_index`
     - `plugin_install_from_registry`

## ZIP packaging requirement (current)

The installer expects `grainery-plugin.manifest.json` at archive root.

Valid structure:

```text
grainery-plugin.manifest.json
dist/main.js
...other files
```

If your zip has a top-level folder (for example `wordcount/grainery-plugin.manifest.json`), installation fails with:

- `Plugin archive missing grainery-plugin.manifest.json`

## Plugin SDK for Authors

SDK alias:

- `@grainery/plugin-sdk`

Configured in:

- `tsconfig.json`
- `vite.config.ts`

Typical author entry:

```ts
import { definePlugin } from '@grainery/plugin-sdk';

export default definePlugin({
  async setup(api) {
    // register features
  },
  async dispose() {
    // optional cleanup
  }
});
```

Available API surface:

- `registerElementLoopProvider`
- `registerCommand`
- `registerDocumentTransform`
- `registerExporter`
- `registerImporter`
- `registerStatusBadge`
- `registerInlineAnnotationProvider`
- `registerUIControl`
- `registerUIPanel`
- `getDocument`
- `replaceDocument`
- `getPluginData`
- `setPluginData`
- `requestPermission`
- `hostCall`
- `proposed` (only when allowlisted via `enabledApiProposals`)

## Developer Tooling

Manifest validation script:

- `scripts/validate-plugin-manifest.mjs`

Run:

```bash
npm run validate:plugin-manifest -- examples/plugins/wordcount/grainery-plugin.manifest.json
```

Example plugin:

- `examples/plugins/wordcount/`

## Tauri Commands Exposed

Registered in `src-tauri/src/lib.rs`:

- `plugin_list_installed`
- `plugin_get_lock_records`
- `plugin_install_from_file`
- `plugin_install_from_registry`
- `plugin_uninstall`
- `plugin_enable_disable`
- `plugin_update_permissions`
- `plugin_fetch_registry_index`
- `plugin_host_call`

## Current Limitations

- No native Rust plugin loading
- No custom TipTap schema/node registration from plugins
- ZIP install requires root-level manifest
- Curated signature key map is currently placeholder-backed in code

## Troubleshooting

### "Plugin archive missing grainery-plugin.manifest.json"

Cause: manifest is not at zip root.

Fix: re-zip contents so manifest is directly at archive root.

### Permission denied errors

Cause: optional permission not granted.

Fix: toggle permission in Settings -> Plugins for that plugin.

### Network host blocked

Cause: requested host not in `networkAllowlist`.

Fix: add host to manifest allowlist and reinstall plugin.

### Plugin seems inactive after install

Check:

- plugin is enabled
- `entry` path exists in extracted package
- `setup(api)` exported correctly
- version constraints in `engine` match app/plugin API
