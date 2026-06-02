# Grainery

## WHY?
The goal of this project is create a simple and minimalistic screenwriting application. I wanted something that just mostly got out of the way and lets me write, with some small but convenient features that make things like formatting easier.

## WHAT?
Grainery is a play on grain (like film) and a granary (like a place to store grain/seeds). In that way, you can hopefully store ideas and pile them up until you dump a script out of it.

## HOW?
Pop it open and just start writing.

Some tips:

Use the `tab` key to cycle through your elements. This works in a kind of "smart" loop, which looks like this:
- Base loop: cycles between "Action", "Character", "Transition", and "Scene Heading"
- Character sub-loop: cycles between "Character", "Paranthetical", and "Dialogue"

There is a subtle box at the top of the screen that indicates the current element you are editing. There may also be some special instructions in there to experiment with. These are new and maybe a little janky, but I will update them as I can.

You can also save your script at any time, and export it as a PDF or to a `.fountain` or a `.fdx` file if you want to take your script somewhere else or export to Final Draft.

## Plugins (v1.2)

Grainery now includes a writer-first plugin system:

- Isolated JavaScript plugins running in Web Workers
- Deny-by-default optional permissions (`fs:pick-read`, `fs:pick-write`, `network:https`, `ui:mount`, `editor:annotations`)
- Sideload install (`.grainery-plugin.zip`) for development/private plugins, clearly marked unverified
- Curated registry install/update flow with signature verification, archive SHA-256 checks, and lock records
- Permission prompts that show plugin name/id/version, permission descriptions, current allow/deny state, author rationales, and trust status
- Persisted plugin diagnostics for activation errors, runtime crashes, permission denials, and invocation timeouts
- Lazy plugin activation via manifest `activationEvents`
- Required manifest contributions via `contributes`, including menus, keybindings, and configuration schemas
- Plugin extension points for:
  - element loop rules
  - commands, command menus, and keybindings
  - document transforms (`post-open`, `pre-save`, `pre-export`)
  - importers/exporters
  - status badges
  - inline annotations (host-rendered)
  - declarative toolbar controls + side panels (host-rendered)
  - plugin-scoped document persistence (`pluginData`)
  - plugin-scoped global storage for lightweight preferences

Manifest schema: `grainery-plugin.manifest.json`

Bundled example plugins:

- `examples/plugins/wordcount/`
- `examples/plugins/element-toolbar/`
- `examples/plugins/scene-outline/`
- `examples/plugins/review-notes/`

Detailed mechanics: `docs/plugin-system.md`
Developer guide: `docs/plugin-authoring-guide.md`
Agent handoff: `docs/plugin-agent.md`

Validate a manifest:

```bash
npm run validate:plugin-manifest -- examples/plugins/wordcount/grainery-plugin.manifest.json
```

Package and inspect an installable archive:

```bash
npm run plugin:pack -- examples/plugins/wordcount
npm run plugin:check-archive -- examples/plugins/wordcount/com.grainery.wordcount.grainery-plugin.zip
```

Note: plugin manifests must target `engine.pluginApi: "^1.2.0"`. Earlier plugin API ranges are not supported. Optional permissions should include `permissionRationales` so users see why a plugin is asking for access.
