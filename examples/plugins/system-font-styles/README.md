# System Font Styles

Example Grainery plugin that applies installed system font variants, common text sizes, and block alignment through host-rendered plugin UI.

## Capabilities

- Uses `ui:mount` for a bottom-bar button and side panel.
- Uses `system:fonts` to request installed font family and variant metadata.
- Uses `document:read` and `document:write` to apply marks to the selected text.

The core app owns the TipTap schema marks and the permission-gated system font host call. This plugin owns the user-facing controls.

## Test

```bash
npm run plugin:validate -- examples/plugins/system-font-styles --check-entry
npm run plugin:pack -- examples/plugins/system-font-styles
npm run plugin:check-archive -- examples/plugins/system-font-styles/system-font-styles.grainery-plugin.zip
```

Then sideload `system-font-styles.grainery-plugin.zip` from Settings > Plugins and grant `ui:mount` and `system:fonts`.
