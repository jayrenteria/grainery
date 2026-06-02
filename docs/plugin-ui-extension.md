# Plugin UI Extension Surface (v1.2)

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
- `'editor-floating'`

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

- `heading`
- `text`
- `divider`
- `callout`
- `badgeList`
- `progress`
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

Permission gate:

- requires `document:read` + optional `editor:annotations`

Provider output shape:

- `id`: stable annotation id (plugin-local)
- `from` / `to`: ProseMirror range positions
- `kind`: host style token (`note` or `note-active`)

Notes:

- host clamps/validates ranges before rendering
- annotations are hidden when plugin is disabled or lacks required permissions
- plugins still cannot inject DOM into editor content
- `ui:mount` is not required for annotation-only plugins

## `when` expressions

UI controls and panels can declare `when` expressions in manifest contributions.

Supported operators:

- `!`, `&&`, `||`
- parentheses
- string equality: `editor.currentElement == "sceneHeading"`
- string inequality: `editor.previousElement != "character"`

Supported keys:

- `editor.hasSelection`
- `editor.selection.empty`
- `editor.isCurrentEmpty`
- `editor.currentElement`
- `editor.previousElement`
- `editor.hasPreviousElement`
- `editor.element.sceneHeading|action|character|dialogue|parenthetical|transition`
- `plugin.enabled`

Unknown identifiers evaluate as false. Use quoted strings for equality checks.

## Command surfaces

Manifest `contributes.menus` can place declared commands into host-owned command surfaces:

- `command-palette`
- `main-menu`
- `editor-context`
- `toolbar-overflow`

Menu entries reference local command ids and can include `group`, `icon`, `priority`, and `when`.
The host indexes these entries before worker activation so a future command palette can render
available commands without waking every plugin.

Manifest `contributes.keybindings` declares configurable shortcuts separately from command metadata:

```json
{
  "id": "word-count-default",
  "command": "word-count",
  "key": "Mod+Shift+W",
  "when": "plugin.enabled"
}
```

Optional `mac`, `windows`, and `linux` values override `key` on specific platforms.

## Plugin configuration

Manifest `contributes.configuration` describes plugin settings using host-renderable property schemas.
Current property types are:

- `string`
- `number`
- `boolean`
- `enum`

This milestone indexes and validates configuration schemas and shows them in Settings. A full editor
for configuration values should store values through plugin-scoped global storage and remain host-rendered.

## Advanced custom UI

Arbitrary DOM injection remains unsupported. Any future custom UI surface must be deliberately sandboxed,
loaded in an isolated frame or equivalent boundary, and guarded by an explicit optional permission separate
from `ui:mount`.

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
