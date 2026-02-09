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

## Plugins (v1)

Grainery now includes a writer-first plugin system:

- Isolated JavaScript plugins running in Web Workers
- Deny-by-default optional permissions (`fs:pick-read`, `fs:pick-write`, `network:https`)
- Sideload install (`.grainery-plugin.zip`) and curated registry install flow
- Plugin extension points for:
  - element loop rules
  - commands + shortcuts
  - document transforms (`post-open`, `pre-save`, `pre-export`)
  - importers/exporters

Manifest schema: `/Users/jay/git/screenwrite/grainery-plugin.manifest.json`

Example plugin: `/Users/jay/git/screenwrite/examples/plugins/wordcount/`

Detailed mechanics: `/Users/jay/git/screenwrite/docs/plugin-system.md`
Developer guide: `/Users/jay/git/screenwrite/docs/plugin-authoring-guide.md`

Validate a manifest:

```bash
npm run validate:plugin-manifest -- examples/plugins/wordcount/grainery-plugin.manifest.json
```
