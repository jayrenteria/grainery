import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Editor, JSONContent } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

import { ScreenplayEditor, TitlePageEditor } from './components/Editor';
import { SettingsModal } from './components/Settings';
import { StartScreen } from './components/StartScreen';
import { ThemeProvider } from './contexts/ThemeContext';
import {
  createNewDocument,
  openFile,
  openFileAtPath,
  saveFile,
  saveFileAs,
  exportAsFountain,
  exportAsPdf,
  exportAsFdx,
  confirmUnsavedChanges,
  updateWindowTitle,
} from './lib/fileOps';
import { getRecentFiles, removeRecentFile } from './lib/recentFiles';
import {
  ELEMENT_CYCLE,
  type RecentFileEntry,
  type ScreenplayDocument,
  type ScreenplayElementType,
  type TitlePageData,
} from './lib/types';
import { PluginManager } from './plugins';
import type { RenderedInlineAnnotation, RenderedStatusBadge } from './plugins';
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
  const [view, setView] = useState<'start' | 'editor'>('start');
  const [document, setDocument] = useState<ScreenplayDocument>(createNewDocument);
  const [isDirty, setIsDirty] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(() => getRecentFiles());
  const [startScreenError, setStartScreenError] = useState<string | null>(null);
  const [showTitlePageEditor, setShowTitlePageEditor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pluginStateVersion, setPluginStateVersion] = useState(0);
  const [editorVersion, setEditorVersion] = useState(0);
  const [statusBadges, setStatusBadges] = useState<RenderedStatusBadge[]>([]);
  const [inlineAnnotations, setInlineAnnotations] = useState<RenderedInlineAnnotation[]>([]);
  const [isResolvingInitialOpen, setIsResolvingInitialOpen] = useState(true);

  const editorRef = useRef<Editor | null>(null);
  const editorContentRef = useRef<JSONContent>(document.document);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const performAutoSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const pluginDataRef = useRef<Record<string, unknown>>(document.pluginData ?? {});
  const pluginManagerRef = useRef<PluginManager | null>(null);
  const viewRef = useRef(view);
  const isDirtyRef = useRef(isDirty);

  const queueAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      void performAutoSaveRef.current();
    }, AUTO_SAVE_DELAY_MS);
  }, []);

  const getPluginDataForPlugin = useCallback((pluginId: string): unknown | null => {
    return pluginDataRef.current[pluginId] ?? null;
  }, []);

  const setPluginDataFromPlugin = useCallback(
    (pluginId: string, value: unknown) => {
      setDocument((prev) => {
        const nextPluginData = { ...(prev.pluginData ?? {}) };
        if (value === null) {
          delete nextPluginData[pluginId];
        } else {
          nextPluginData[pluginId] = value;
        }

        pluginDataRef.current = nextPluginData;

        return {
          ...prev,
          pluginData: nextPluginData,
          meta: {
            ...prev.meta,
            modifiedAt: new Date().toISOString(),
          },
        };
      });

      if (!isDirty) {
        setIsDirty(true);
        void updateWindowTitle(document.meta.filename, true);
      }

      queueAutoSave();
      setEditorVersion((prev) => prev + 1);
    },
    [document.meta.filename, isDirty, queueAutoSave]
  );

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

      queueAutoSave();
      setEditorVersion((prev) => prev + 1);
    },
    [document.meta.filename, isDirty, queueAutoSave]
  );

  if (!pluginManagerRef.current) {
    pluginManagerRef.current = new PluginManager({
      getDocument: () => editorContentRef.current,
      replaceDocument: applyDocumentFromPlugin,
      getPluginData: getPluginDataForPlugin,
      setPluginData: setPluginDataFromPlugin,
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
      jumpToPosition: (position: number, offsetTop = 100) => {
        const editor = editorRef.current;
        if (!editor || !Number.isFinite(position)) {
          return;
        }

        const view = editor.view;
        const max = Math.max(1, view.state.doc.content.size);
        const nextPosition = Math.min(Math.max(Math.floor(position), 1), max);

        const selection = TextSelection.create(view.state.doc, nextPosition);
        view.dispatch(view.state.tr.setSelection(selection));
        view.focus();

        const scrollContainer = view.dom.closest('.paginated-editor-container');
        if (!(scrollContainer instanceof HTMLElement)) {
          editor.commands.scrollIntoView();
          return;
        }

        requestAnimationFrame(() => {
          try {
            const coordinates = view.coordsAtPos(nextPosition);
            const containerRect = scrollContainer.getBoundingClientRect();
            const desiredTop =
              coordinates.top - containerRect.top + scrollContainer.scrollTop - offsetTop;

            scrollContainer.scrollTo({
              top: Math.max(0, desiredTop),
              behavior: 'smooth',
            });
          } catch (error) {
            console.error('[Plugins] Failed to scroll to requested position', error);
            editor.commands.scrollIntoView();
          }
        });
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

  const refreshRecentFiles = useCallback(() => {
    setRecentFiles(getRecentFiles());
  }, []);

  const openPathIntoEditor = useCallback(
    async (
      path: string,
      options?: {
        confirmIfDirty?: boolean;
        errorPrefix?: string;
        showStartError?: boolean;
      }
    ) => {
      const { confirmIfDirty = false, errorPrefix = 'Failed to open file.', showStartError = false } = options ?? {};

      if (confirmIfDirty && viewRef.current === 'editor' && isDirtyRef.current) {
        const discard = await confirmUnsavedChanges();
        if (!discard) {
          return false;
        }
      }

      try {
        const doc = await openFileAtPath(path);
        const transformed = await runTransformHook('post-open', doc.document);
        doc.document = transformed;

        setDocument(doc);
        editorContentRef.current = transformed;
        setIsDirty(false);
        setView('editor');
        setStartScreenError(null);
        refreshRecentFiles();
        await updateWindowTitle(doc.meta.filename);
        return true;
      } catch (error) {
        console.error('Failed to open file at path:', error);
        if (showStartError && viewRef.current === 'start') {
          const message = error instanceof Error ? error.message : String(error);
          setStartScreenError(`${errorPrefix} ${message}`);
        }
        return false;
      }
    },
    [refreshRecentFiles, runTransformHook]
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

  useEffect(() => {
    performAutoSaveRef.current = performAutoSave;
  }, [performAutoSave]);

  const handleEditorChange = useCallback(
    (content: JSONContent) => {
      editorContentRef.current = content;
      if (!isDirty) {
        setIsDirty(true);
        void updateWindowTitle(document.meta.filename, true);
      }

      queueAutoSave();

      setEditorVersion((prev) => prev + 1);
    },
    [document.meta.filename, isDirty, queueAutoSave]
  );

  const handleNew = useCallback(async () => {
    if (view === 'editor' && isDirty) {
      const discard = await confirmUnsavedChanges();
      if (!discard) return;
    }

    const nextDoc = createNewDocument();
    setDocument(nextDoc);
    editorContentRef.current = nextDoc.document;
    setIsDirty(false);
    setView('editor');
    setStartScreenError(null);
    await updateWindowTitle(null);
  }, [isDirty, view]);

  const handleOpen = useCallback(async () => {
    if (view === 'editor' && isDirty) {
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
      setView('editor');
      setStartScreenError(null);
      refreshRecentFiles();
      await updateWindowTitle(doc.meta.filename);
    } catch (error) {
      console.error('Failed to open file:', error);
      if (view === 'start') {
        const message = error instanceof Error ? error.message : String(error);
        setStartScreenError(`Failed to open file. ${message}`);
      }
    }
  }, [isDirty, refreshRecentFiles, runTransformHook, view]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      setStartScreenError(null);

      try {
        const exists = await invoke<boolean>('file_exists', { path });
        if (!exists) {
          const next = removeRecentFile(path);
          setRecentFiles(next);
          setStartScreenError('This file is no longer available. It has been removed from Recent Files.');
          return;
        }

        await openPathIntoEditor(path, {
          confirmIfDirty: false,
          errorPrefix: 'Failed to open recent file.',
          showStartError: true,
        });
      } catch (error) {
        console.error('Failed to open recent file:', error);
        const message = error instanceof Error ? error.message : String(error);
        setStartScreenError(`Failed to open recent file. ${message}`);
      }
    },
    [openPathIntoEditor]
  );

  const handleSave = useCallback(async () => {
    try {
      const transformed = await runTransformHook('pre-save', editorContentRef.current);
      editorContentRef.current = transformed;

      const savedDoc = await saveFile(document, transformed);
      if (savedDoc) {
        setDocument(savedDoc);
        setIsDirty(false);
        refreshRecentFiles();
        await updateWindowTitle(savedDoc.meta.filename);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [document, refreshRecentFiles, runTransformHook]);

  const handleSaveAs = useCallback(async () => {
    try {
      const transformed = await runTransformHook('pre-save', editorContentRef.current);
      editorContentRef.current = transformed;

      const savedDoc = await saveFileAs(document, transformed);
      if (savedDoc) {
        setDocument(savedDoc);
        setIsDirty(false);
        refreshRecentFiles();
        await updateWindowTitle(savedDoc.meta.filename);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [document, refreshRecentFiles, runTransformHook]);

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

  const handleFind = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.commands.openFind();
    setEditorVersion((prev) => prev + 1);
  }, []);

  const handleFindNext = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (editor.commands.findNext()) {
      setEditorVersion((prev) => prev + 1);
    }
  }, []);

  const handleFindPrevious = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (editor.commands.findPrevious()) {
      setEditorVersion((prev) => prev + 1);
    }
  }, []);

  const handleReplace = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.commands.openFind();
    setEditorVersion((prev) => prev + 1);
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
      getPluginData: getPluginDataForPlugin,
      setPluginData: setPluginDataFromPlugin,
    });
  }, [applyDocumentFromPlugin, getPluginDataForPlugin, pluginManager, setPluginDataFromPlugin]);

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

    const refreshInlineAnnotations = async () => {
      try {
        const selection = editorAdapter.getSelectionRange();
        const next = await pluginManager.evaluateInlineAnnotations({
          document: editorContentRef.current,
          selectionFrom: selection.from,
          selectionTo: selection.to,
          metadata: {
            filename: document.meta.filename,
          },
        });

        if (!cancelled) {
          setInlineAnnotations(next);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[Plugins] Failed to evaluate inline annotations', error);
          setInlineAnnotations([]);
        }
      }
    };

    void refreshInlineAnnotations();

    return () => {
      cancelled = true;
    };
  }, [document.meta.filename, document.meta.id, editorAdapter, editorVersion, pluginManager, pluginStateVersion]);

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
  }, [document.meta.filename, document.meta.id, editorVersion, pluginManager, pluginStateVersion]);

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

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    pluginDataRef.current = document.pluginData ?? {};
  }, [document.pluginData]);

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
        case 'find':
          handleFind();
          break;
        case 'find_next':
          handleFindNext();
          break;
        case 'find_prev':
          handleFindPrevious();
          break;
        case 'replace':
          handleReplace();
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
    handleFind,
    handleFindNext,
    handleFindPrevious,
    handleNew,
    handleOpen,
    handleReplace,
    handleSave,
    handleSaveAs,
    pluginManager,
  ]);

  // Open files when the app is launched via file association / OS open-file events.
  useEffect(() => {
    const openIncomingPaths = async (paths: string[]) => {
      const firstPath = paths.find((path) => typeof path === 'string' && path.length > 0);
      if (!firstPath) {
        return;
      }

      await openPathIntoEditor(firstPath, {
        confirmIfDirty: true,
        errorPrefix: 'Failed to open file.',
        showStartError: true,
      });
    };

    const unlisten = listen<string[]>('app-open-file', (event) => {
      if (!Array.isArray(event.payload)) {
        return;
      }

      void openIncomingPaths(event.payload);
    });

    void (async () => {
      try {
        const pending = await invoke<string[]>('consume_pending_open_files');
        await openIncomingPaths(Array.isArray(pending) ? pending : []);
      } catch (error) {
        console.error('Failed to consume pending open files:', error);
      } finally {
        setIsResolvingInitialOpen(false);
      }
    })();

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [openPathIntoEditor]);

  return (
    <ThemeProvider>
      <div className="app-container">
        {view === 'start' ? (
          isResolvingInitialOpen ? null : (
          <StartScreen
            recentFiles={recentFiles}
            errorMessage={startScreenError}
            onDismissError={() => setStartScreenError(null)}
            onNewScreenplay={() => {
              void handleNew();
            }}
            onOpenFile={() => {
              void handleOpen();
            }}
            onOpenRecent={(path) => {
              void handleOpenRecent(path);
            }}
          />
          )
        ) : (
          <>
            <ScreenplayEditor
              key={document.meta.id}
              initialContent={document.document}
              inlineAnnotations={inlineAnnotations}
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
          </>
        )}
      </div>
    </ThemeProvider>
  );
}

export default App;
