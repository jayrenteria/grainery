# Plugin UI Extension Surface (v1.1)

This document describes Grainery's declarative plugin UI surface.

## Design constraints

- Host-rendered only: plugins cannot inject arbitrary DOM.
- Worker-isolated logic: plugin handlers run in plugin workers.
- Deny-by-default: plugin UI is hidden unless `ui:mount` is granted.
- Single active panel: only one plugin side panel is open at a time.

## Permission gate

Plugins must declare `ui:mount` in `optionalPermissions` and the user must grant it.

If `ui:mount` is not granted:

- registered controls are ignored by host rendering
- registered side panels are ignored by host rendering

## Registration API

Plugin SDK methods:

- `registerUIControl(control)`
- `registerUIPanel(panel)`

Control mounts:

- `'top-bar'`
- `'bottom-bar'`

Control action model:

- `command`
- `editor:set-element`
- `editor:jump-to`
- `editor:cycle-element`
- `editor:escape-to-action`
- `panel:open`
- `panel:close`
- `panel:toggle`

`editor:jump-to` fields:

- `position` (required): ProseMirror document position
- `offsetTop` (optional): desired pixel offset from the top of the editor viewport

Panel content model (v1 primitives):

- `text`
- `list`
- `keyValue`
- `input`
- `textarea`
- `actions`

`input` / `textarea` fields:

- are host-rendered and sanitized
- are keyed by `fieldId`
- flow through `onAction(context.formValues)` when an actions block button is clicked
- preserve typed values across panel rerenders unless the plugin returns explicit replacement defaults

## Inline annotations

Plugins can register inline range highlights rendered by the host editor layer:

- `registerInlineAnnotationProvider(provider)`

Provider output shape:

- `id`: stable annotation id (plugin-local)
- `from` / `to`: ProseMirror range positions
- `kind`: host style token (`note` or `note-active`)

Notes:

- host clamps/validates ranges before rendering
- annotations are hidden when plugin is disabled or lacks required permissions
- plugins still cannot inject DOM into editor content

## Runtime mechanics

1. Plugin worker calls register APIs during `setup(api)`.
2. Worker sends metadata registration messages to host.
3. `PluginManager` stores controls/panels and notifies subscribers.
4. `PluginUIHost` renders toolbars and active panel in app shell.
5. Host batches state evaluation (`ui-evaluate`) with current editor/document context.
6. Clicks route through host action dispatcher and/or worker handlers.

## Editor integration

Host exposes an editor adapter used by UI actions:

- read active element and selection state
- set/cycle element type
- jump to a document position
- escape current element to `action`

Panel render/action contexts include current selection positions (`selectionFrom`, `selectionTo`) for active-row and navigation logic.

Element mutations are host-whitelisted operations only.

## Files involved

- `src/plugins/types.ts`
- `src/plugins/rpc.ts`
- `src/plugins/worker-runtime.ts`
- `src/plugins/PluginManager.ts`
- `src/components/PluginUI/PluginUIHost.tsx`
- `src/components/PluginUI/PluginToolbar.tsx`
- `src/components/PluginUI/PluginSidePanel.tsx`
- `src/plugins/ui/icons.tsx`

## Example

`examples/plugins/element-toolbar/dist/main.js` demonstrates:

- side-panel-based element switching workflow
- panel content updates from editor context (`onRender`)
- host-routed element switching actions (`editor:set-element`)
