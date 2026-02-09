import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Editor, JSONContent } from '@tiptap/react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

import { ScreenplayEditor, TitlePageEditor } from './components/Editor';
import { SettingsModal } from './components/Settings';
import { ThemeProvider } from './contexts/ThemeContext';
import {
  createNewDocument,
  openFile,
  saveFile,
  saveFileAs,
  exportAsFountain,
  exportAsPdf,
  exportAsFdx,
  confirmUnsavedChanges,
  updateWindowTitle,
} from './lib/fileOps';
import { ELEMENT_CYCLE, type ScreenplayDocument, type ScreenplayElementType, type TitlePageData } from './lib/types';
import { PluginManager } from './plugins';
import type { RenderedStatusBadge } from './plugins';
import { PluginUIHost } from './components/PluginUI';
import './styles/screenplay.css';

const AUTO_SAVE_DELAY_MS = 30_000;
const NON_DIALOGUE_CYCLE: ScreenplayElementType[] = ['sceneHeading', 'action', 'character', 'transition'];
const DIALOGUE_BLOCK_CYCLE: ScreenplayElementType[] = ['dialogue', 'parenthetical'];

function isScreenplayElementType(value: string): value is ScreenplayElementType {
  return ELEMENT_CYCLE.includes(value as ScreenplayElementType);
}

function getPreviousNodeType(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  const index = $from.index($from.depth - 1);
  if (index > 0) {
    return $from.doc.child(index - 1).type.name;
  }
  return null;
}

function getCurrentNodeType(editor: Editor): ScreenplayElementType | null {
  const nodeName = editor.state.selection.$from.parent.type.name;
  return isScreenplayElementType(nodeName) ? nodeName : null;
}

function getNextElementType(currentType: ScreenplayElementType, previousType: string | null): ScreenplayElementType {
  if (previousType === 'character') {
    if (currentType === 'dialogue' || currentType === 'parenthetical') {
      const index = DIALOGUE_BLOCK_CYCLE.indexOf(currentType);
      return DIALOGUE_BLOCK_CYCLE[(index + 1) % DIALOGUE_BLOCK_CYCLE.length];
    }
    return 'dialogue';
  }

  const index = NON_DIALOGUE_CYCLE.indexOf(currentType);
  return index === -1 ? 'action' : NON_DIALOGUE_CYCLE[(index + 1) % NON_DIALOGUE_CYCLE.length];
}

function getPreviousElementType(currentType: ScreenplayElementType, previousType: string | null): ScreenplayElementType {
  if (previousType === 'character' && (currentType === 'dialogue' || currentType === 'parenthetical')) {
    const index = DIALOGUE_BLOCK_CYCLE.indexOf(currentType);
    return DIALOGUE_BLOCK_CYCLE[(index - 1 + DIALOGUE_BLOCK_CYCLE.length) % DIALOGUE_BLOCK_CYCLE.length];
  }

  if (currentType === 'dialogue' || currentType === 'parenthetical') {
    return 'character';
  }

  const index = NON_DIALOGUE_CYCLE.indexOf(currentType);
  return index === -1 ? 'action' : NON_DIALOGUE_CYCLE[(index - 1 + NON_DIALOGUE_CYCLE.length) % NON_DIALOGUE_CYCLE.length];
}

function App() {
  const [document, setDocument] = useState<ScreenplayDocument>(createNewDocument);
  const [isDirty, setIsDirty] = useState(false);
  const [showTitlePageEditor, setShowTitlePageEditor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pluginStateVersion, setPluginStateVersion] = useState(0);
  const [editorVersion, setEditorVersion] = useState(0);
  const [statusBadges, setStatusBadges] = useState<RenderedStatusBadge[]>([]);

  const editorRef = useRef<Editor | null>(null);
  const editorContentRef = useRef<JSONContent>(document.document);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pluginManagerRef = useRef<PluginManager | null>(null);

  const applyDocumentFromPlugin = useCallback(
    (next: JSONContent) => {
      editorContentRef.current = next;

      if (editorRef.current) {
        editorRef.current.commands.setContent(next, { emitUpdate: false });
      }

      setDocument((prev) => ({
        ...prev,
        document: next,
        meta: {
          ...prev.meta,
          modifiedAt: new Date().toISOString(),
        },
      }));

      if (!isDirty) {
        setIsDirty(true);
        void updateWindowTitle(document.meta.filename, true);
      }

      setEditorVersion((prev) => prev + 1);
    },
    [document.meta.filename, isDirty]
  );

  if (!pluginManagerRef.current) {
    pluginManagerRef.current = new PluginManager({
      getDocument: () => editorContentRef.current,
      replaceDocument: applyDocumentFromPlugin,
    });
  }

  const pluginManager = pluginManagerRef.current;

  const editorAdapter = useMemo(
    () => ({
      getCurrentElementType: () => {
        const editor = editorRef.current;
        if (!editor) {
          return null;
        }
        return getCurrentNodeType(editor);
      },
      getPreviousElementType: () => {
        const editor = editorRef.current;
        if (!editor) {
          return null;
        }
        return getPreviousNodeType(editor);
      },
      isCurrentElementEmpty: () => {
        const editor = editorRef.current;
        if (!editor) {
          return true;
        }
        return editor.state.selection.$from.parent.textContent.trim().length === 0;
      },
      getSelectionRange: () => {
        const editor = editorRef.current;
        if (!editor) {
          return { from: 0, to: 0 };
        }
        const { from, to } = editor.state.selection;
        return { from, to };
      },
      setElementType: (type: ScreenplayElementType) => {
        const editor = editorRef.current;
        if (!editor) {
          return;
        }
        editor.commands.setNode(type);
        setEditorVersion((prev) => prev + 1);
      },
      cycleElement: (direction: 'next' | 'prev') => {
        const editor = editorRef.current;
        if (!editor) {
          return;
        }

        const currentType = getCurrentNodeType(editor);
        if (!currentType) {
          return;
        }

        const previousType = getPreviousNodeType(editor);
        const pluginResolved = pluginManager.resolveElementLoop({
          event: direction === 'next' ? 'tab' : 'shift-tab',
          currentType,
          previousType,
          isCurrentEmpty: editor.state.selection.$from.parent.textContent.trim().length === 0,
        });

        const target =
          pluginResolved ?? (direction === 'next'
            ? getNextElementType(currentType, previousType)
            : getPreviousElementType(currentType, previousType));

        editor.commands.setNode(target);
        setEditorVersion((prev) => prev + 1);
      },
      escapeToAction: () => {
        const editor = editorRef.current;
        if (!editor) {
          return;
        }
        editor.commands.setNode('action');
        setEditorVersion((prev) => prev + 1);
      },
    }),
    [pluginManager]
  );

  const runTransformHook = useCallback(
    async (hook: 'post-open' | 'pre-save' | 'pre-export', content: JSONContent) => {
      try {
        return await pluginManager.runDocumentTransforms(hook, content, {
          filename: document.meta.filename,
        });
      } catch (error) {
        console.error(`[Plugins] Transform hook failed (${hook})`, error);
        return content;
      }
    },
    [document.meta.filename, pluginManager]
  );

  const performAutoSave = useCallback(async () => {
    if (!isDirty || showTitlePageEditor) return;

    try {
      const transformed = await runTransformHook('pre-save', editorContentRef.current);
      editorContentRef.current = transformed;

      const savedDoc = await saveFile(document, transformed);
      if (savedDoc) {
        setDocument(savedDoc);
        setIsDirty(false);
        await updateWindowTitle(savedDoc.meta.filename);
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  }, [document, isDirty, runTransformHook, showTitlePageEditor]);

  const handleEditorChange = useCallback(
    (content: JSONContent) => {
      editorContentRef.current = content;
      if (!isDirty) {
        setIsDirty(true);
        void updateWindowTitle(document.meta.filename, true);
      }

      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
        void performAutoSave();
      }, AUTO_SAVE_DELAY_MS);

      setEditorVersion((prev) => prev + 1);
    },
    [document.meta.filename, isDirty, performAutoSave]
  );

  const handleNew = useCallback(async () => {
    if (isDirty) {
      const discard = await confirmUnsavedChanges();
      if (!discard) return;
    }

    const nextDoc = createNewDocument();
    setDocument(nextDoc);
    editorContentRef.current = nextDoc.document;
    setIsDirty(false);
    await updateWindowTitle(null);
  }, [isDirty]);

  const handleOpen = useCallback(async () => {
    if (isDirty) {
      const discard = await confirmUnsavedChanges();
      if (!discard) return;
    }

    try {
      const doc = await openFile();
      if (!doc) {
        return;
      }

      const transformed = await runTransformHook('post-open', doc.document);
      doc.document = transformed;

      setDocument(doc);
      editorContentRef.current = transformed;
      setIsDirty(false);
      await updateWindowTitle(doc.meta.filename);
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }, [isDirty, runTransformHook]);

  const handleSave = useCallback(async () => {
    try {
      const transformed = await runTransformHook('pre-save', editorContentRef.current);
      editorContentRef.current = transformed;

      const savedDoc = await saveFile(document, transformed);
      if (savedDoc) {
        setDocument(savedDoc);
        setIsDirty(false);
        await updateWindowTitle(savedDoc.meta.filename);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [document, runTransformHook]);

  const handleSaveAs = useCallback(async () => {
    try {
      const transformed = await runTransformHook('pre-save', editorContentRef.current);
      editorContentRef.current = transformed;

      const savedDoc = await saveFileAs(document, transformed);
      if (savedDoc) {
        setDocument(savedDoc);
        setIsDirty(false);
        await updateWindowTitle(savedDoc.meta.filename);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [document, runTransformHook]);

  const handleExportFountain = useCallback(async () => {
    try {
      const transformed = await runTransformHook('pre-export', editorContentRef.current);
      await exportAsFountain(transformed, document.titlePage, document.meta.filename);
    } catch (error) {
      console.error('Failed to export as Fountain:', error);
    }
  }, [document.meta.filename, document.titlePage, runTransformHook]);

  const handleExportPdf = useCallback(async () => {
    try {
      const transformed = await runTransformHook('pre-export', editorContentRef.current);
      await exportAsPdf(transformed, document.titlePage, document.meta.filename);
    } catch (error) {
      console.error('Failed to export as PDF:', error);
    }
  }, [document.meta.filename, document.titlePage, runTransformHook]);

  const handleExportFdx = useCallback(async () => {
    try {
      const transformed = await runTransformHook('pre-export', editorContentRef.current);
      await exportAsFdx(transformed, document.titlePage, document.meta.filename);
    } catch (error) {
      console.error('Failed to export as Final Draft:', error);
    }
  }, [document.meta.filename, document.titlePage, runTransformHook]);

  const handleEditTitlePage = useCallback(() => {
    setShowTitlePageEditor(true);
  }, []);

  const handleSaveTitlePage = useCallback((titlePage: TitlePageData | null) => {
    setDocument((prev) => ({
      ...prev,
      titlePage,
    }));
    setIsDirty(true);
  }, []);

  const handleRunPluginExporter = useCallback(
    async (exporterId: string) => {
      const exporter = pluginManager.getExporters().find((item) => item.id === exporterId);
      if (!exporter) {
        throw new Error(`Exporter not found: ${exporterId}`);
      }

      const transformed = await runTransformHook('pre-export', editorContentRef.current);
      const output = await pluginManager.runExporter(exporterId, {
        document: transformed,
        title: document.meta.filename,
      });

      const baseName = document.meta.filename
        ? document.meta.filename.replace(/\.[^.]+$/, '')
        : 'untitled';

      const filePath = await saveDialog({
        filters: [
          {
            name: exporter.title,
            extensions: [exporter.extension],
          },
        ],
        defaultPath: `${baseName}.${exporter.extension}`,
      });

      if (!filePath) {
        return;
      }

      const content =
        typeof output === 'string' ? output : new TextDecoder().decode(output);

      await invoke('save_screenplay', {
        path: filePath,
        content,
      });
    },
    [document.meta.filename, pluginManager, runTransformHook]
  );

  const handleRunPluginImporter = useCallback(
    async (importerId: string) => {
      const importer = pluginManager.getImporters().find((item) => item.id === importerId);
      if (!importer) {
        throw new Error(`Importer not found: ${importerId}`);
      }

      const filePath = await openDialog({
        multiple: false,
        filters: [
          {
            name: importer.title,
            extensions: importer.extensions,
          },
          {
            name: 'All files',
            extensions: ['*'],
          },
        ],
      });

      if (!filePath || Array.isArray(filePath)) {
        return;
      }

      const input = await invoke<string>('load_screenplay', {
        path: filePath,
      });

      const imported = await pluginManager.runImporter(importerId, input);
      applyDocumentFromPlugin(imported);
    },
    [applyDocumentFromPlugin, pluginManager]
  );

  useEffect(() => {
    pluginManager.updateDocumentAccess({
      getDocument: () => editorContentRef.current,
      replaceDocument: applyDocumentFromPlugin,
    });
  }, [applyDocumentFromPlugin, pluginManager]);

  useEffect(() => {
    let mounted = true;

    const unsubscribe = pluginManager.subscribe(() => {
      if (mounted) {
        setPluginStateVersion((prev) => prev + 1);
      }
    });

    void pluginManager.initialize().catch((error) => {
      console.error('[Plugins] Failed to initialize plugin manager', error);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [pluginManager]);

  useEffect(() => {
    let cancelled = false;

    const refreshStatusBadges = async () => {
      try {
        const next = await pluginManager.evaluateStatusBadges({
          document: editorContentRef.current,
          metadata: {
            filename: document.meta.filename,
          },
        });

        if (!cancelled) {
          setStatusBadges(next);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[Plugins] Failed to render status badges', error);
          setStatusBadges([]);
        }
      }
    };

    void refreshStatusBadges();

    return () => {
      cancelled = true;
    };
  }, [document.meta.filename, editorVersion, pluginManager, pluginStateVersion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      void pluginManager.maybeExecuteShortcut(event);
    };

    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [pluginManager]);

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Listen for native menu events
  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      if (event.payload.startsWith('plugin:command:')) {
        void pluginManager.executeCommand(event.payload.replace('plugin:command:', ''));
        return;
      }

      switch (event.payload) {
        case 'new':
          void handleNew();
          break;
        case 'open':
          void handleOpen();
          break;
        case 'save':
          void handleSave();
          break;
        case 'save_as':
          void handleSaveAs();
          break;
        case 'export_fountain':
          void handleExportFountain();
          break;
        case 'export_pdf':
          void handleExportPdf();
          break;
        case 'export_fdx':
          void handleExportFdx();
          break;
        case 'title_page':
          handleEditTitlePage();
          break;
        case 'settings':
          setShowSettings(true);
          break;
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [
    handleEditTitlePage,
    handleExportFdx,
    handleExportFountain,
    handleExportPdf,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    pluginManager,
  ]);

  return (
    <ThemeProvider>
      <div className="app-container">
        <ScreenplayEditor
          key={document.meta.id}
          initialContent={document.document}
          onChange={handleEditorChange}
          resolveElementLoop={(context) => pluginManager.resolveElementLoop(context)}
          onSelectionChange={() => {
            setEditorVersion((prev) => prev + 1);
          }}
          onEditorReady={(editor) => {
            editorRef.current = editor;
          }}
        />

        <PluginUIHost
          pluginManager={pluginManager}
          pluginStateVersion={pluginStateVersion}
          editorVersion={editorVersion}
          document={editorContentRef.current}
          editorAdapter={editorAdapter}
        />

        {showTitlePageEditor && (
          <TitlePageEditor
            titlePage={document.titlePage}
            onSave={handleSaveTitlePage}
            onClose={() => setShowTitlePageEditor(false)}
          />
        )}

        {showSettings && (
          <SettingsModal
            onClose={() => setShowSettings(false)}
            onOpenTitlePage={handleEditTitlePage}
            titlePage={document.titlePage}
            pluginManager={pluginManager}
            pluginStateVersion={pluginStateVersion}
            onRunPluginExporter={handleRunPluginExporter}
            onRunPluginImporter={handleRunPluginImporter}
          />
        )}

        {statusBadges.length > 0 && (
          <div className="plugin-status-badges">
            {statusBadges.map((badge) => (
              <div key={badge.id} className="plugin-status-badge">
                {badge.label}: {badge.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </ThemeProvider>
  );
}

export default App;
