# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Grainery - A minimal screenwriting application built with Tauri (Rust backend) and React/TypeScript frontend using TipTap editor.

## Commands

```bash
npm run dev       # Start development (Vite + Tauri hot reload)
npm run build     # Production build
npm run tauri     # Direct Tauri CLI access
```

## Architecture

### Frontend (`src/`)
- **React 19 + TypeScript** with Vite on port 1420
- **TipTap** (ProseMirror-based) for the screenplay editor
- Custom node extensions for screenplay elements

### Backend (`src-tauri/`)
- **Rust** with Tauri framework
- File I/O commands for save/load
- Plugins: fs, dialog, opener

### Key Directories

```
src/
  components/
    Editor/           # TipTap editor wrapper, element indicator
    Layout/           # MenuBar
  extensions/
    nodes/            # Custom TipTap nodes (SceneHeading, Action, Character, etc.)
    ScreenplayKeymap.ts  # Tab cycling, Enter behavior
  lib/
    types.ts          # TypeScript types
    fileOps.ts        # File operations (save/load)
  styles/
    screenplay.css    # Screenplay formatting styles
```

## Screenplay Editor

### Element Types
- **SceneHeading**: `INT./EXT. LOCATION - TIME`
- **Action**: Description/action blocks
- **Character**: Character names (supports extensions: V.O., O.S., CONT'D, O.C.)
- **Dialogue**: Character dialogue
- **Parenthetical**: Acting directions in dialogue
- **Transition**: CUT TO:, FADE OUT., etc.

### Keyboard Shortcuts
- **Tab/Shift-Tab**: Cycle through element types
- **Enter**: Smart transition to next element type
- **⌘E**: Cycle character extensions (on Character element)
- **Escape**: Return to Action
- **⌘S**: Save, **⇧⌘S**: Save As, **⌘O**: Open, **⌘N**: New

### Input Rules (Auto-detection)
- `INT. ` / `EXT. ` / `INT./EXT. ` → Scene Heading
- `CUT TO:` / `FADE TO:` / `FADE IN:` etc. → Transition

## File Format

Custom `.screenplay` JSON format containing:
- Document metadata
- Title page (optional)
- ProseMirror JSON content
- Settings (page numbers, scene numbers)

## Key Files

- `src/extensions/nodes/*.ts` - TipTap node definitions
- `src/extensions/ScreenplayKeymap.ts` - Keyboard behavior
- `src/components/Editor/ScreenplayEditor.tsx` - Main editor component
- `src/lib/fileOps.ts` - File save/load operations
- `src-tauri/src/lib.rs` - Rust commands
- `src-tauri/capabilities/default.json` - Tauri permissions
