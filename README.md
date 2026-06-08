<div align="center">
  <img src="src-tauri/icons/icon.png" alt="Grainery icon" width="112" height="112" />
  <h1>Grainery</h1>
  <p><strong>A quiet, minimal screenwriting app that keeps formatting out of your way.</strong></p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-1.4.6-4f7a5f?style=flat-square" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square" />
    <img alt="React" src="https://img.shields.io/badge/React-19-61dafb?style=flat-square" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square" />
    <img alt="License" src="https://img.shields.io/badge/license-MIT-f2c94c?style=flat-square" />
  </p>
</div>

---

## The Idea

Grainery is built for drafting screenplays with as little friction as possible. Open it, write, and let the editor handle the small formatting decisions that usually interrupt the flow.

The name is a play on grain, like film grain, and granary, a place to store grain and seeds. It is a place to collect fragments, scenes, and ideas until they become a script.

## Features

- Screenplay-aware editor powered by TipTap and ProseMirror
- Smart element cycling for action, character, dialogue, transitions, and scene headings
- Automatic detection for common scene headings and transitions
- Save and load native Grainery screenplay documents
- Export support for PDF, Fountain, and Final Draft workflows
- Writer-first plugin system for private, curated, and experimental extensions

## Getting Started

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

## Writing Flow

Use `Tab` to cycle through screenplay elements. Grainery keeps two simple loops:

| Loop | Elements |
| --- | --- |
| Base | `Action` -> `Character` -> `Transition` -> `Scene Heading` |
| Character | `Character` -> `Parenthetical` -> `Dialogue` |

Other useful shortcuts:

| Shortcut | Action |
| --- | --- |
| `Enter` | Move to the next smart element |
| `Shift+Tab` | Cycle backward through elements |
| `Cmd+E` | Cycle character extensions |
| `Escape` | Return to action |
| `Cmd+S` | Save |
| `Shift+Cmd+S` | Save as |
| `Cmd+O` | Open |
| `Cmd+N` | New screenplay |

Grainery also shows a subtle element indicator at the bottom left of the editor so you always know what kind of screenplay block you are writing.

## Plugin System

Grainery includes a plugin system designed around writer trust and host-rendered UI:

- Isolated JavaScript plugins running in Web Workers
- Deny-by-default optional permissions: `fs:pick-read`, `fs:pick-write`, `network:https`, `ui:mount`, `editor:annotations`
- Sideload install with unverified-plugin labeling
- Curated registry install and update flow with signature verification, archive SHA-256 checks, and lock records
- Permission prompts that show plugin identity, permission descriptions, current allow/deny state, author rationales, and trust status
- Persisted plugin diagnostics for activation errors, runtime crashes, permission denials, and timeouts
- Lazy plugin activation through manifest `activationEvents`
- Required manifest contributions through `contributes`, including menus, keybindings, and configuration schemas

### Extension Points

| Area | Plugin capabilities |
| --- | --- |
| Writing | Element loop rules, commands, command menus, keybindings |
| Documents | `post-open`, `pre-save`, and `pre-export` transforms |
| Files | Importers and exporters |
| Interface | Status badges, inline annotations, toolbar controls, side panels |
| Storage | Plugin-scoped document data and lightweight global preferences |

Plugin manifests use `grainery-plugin.manifest.json` and must target `engine.pluginApi: "^1.2.0"`.
Earlier plugin API ranges are not supported. Optional permissions should include `permissionRationales` so writers can see why a plugin is asking for access.

### Example Plugins

- [`examples/plugins/wordcount/`](examples/plugins/wordcount/)
- [`examples/plugins/element-toolbar/`](examples/plugins/element-toolbar/)
- [`examples/plugins/scene-outline/`](examples/plugins/scene-outline/)
- [`examples/plugins/review-notes/`](examples/plugins/review-notes/)

### Plugin Docs

- [Plugin system mechanics](docs/plugin-system.md)
- [Plugin authoring guide](docs/plugin-authoring-guide.md)
- [Agent handoff notes](docs/plugin-agent.md)

Validate a manifest:

```bash
npm run validate:plugin-manifest -- examples/plugins/wordcount/grainery-plugin.manifest.json
```

Package and inspect an installable archive:

```bash
npm run plugin:pack -- examples/plugins/wordcount
npm run plugin:check-archive -- examples/plugins/wordcount/com.grainery.wordcount.grainery-plugin.zip
```

## License

MIT. See [LICENSE](LICENSE).
