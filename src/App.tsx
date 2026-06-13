import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Editor, JSONContent } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask as askDialog } from '@tauri-apps/plugin-dialog';

import { ScreenplayEditor } from './components/Editor';
import { SettingsModal } from './components/Settings';
import { StartScreen } from './components/StartScreen';
import { UpdateDialog, type UpdateDialogStatus } from './components/Updates';
import { ThemeProvider } from './contexts/ThemeContext';
import {
  createNewDocument,
  importFdxFile,
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
import {
  type AvailableAppUpdate,
  type UpdateDownloadProgress,
  checkForAppUpdate,
  installAppUpdate,
  recordStartupUpdateCheck,
  relaunchApp,
  shouldRunStartupUpdateCheck,
} from './lib/appUpdates';
import { getRecentFiles, removeRecentFile } from './lib/recentFiles';
import {
  type DocumentMode,
  type RecentFileEntry,
  type ScreenplayDocument,
  type ScreenplayElementType,
  type TitlePageData,
} from './lib/types';
import {
  getElementSeedText,
  getEscapeElementType,
  getNextElementType,
  getPreviousElementType,
  hasOnlyElementSeedText,
  isScreenplayElementType,
} from './lib/elementConfig';
import { PluginManager } from './plugins';
import type { RenderedInlineAnnotation, RenderedStatusBadge } from './plugins';
import { PluginUIHost } from './components/PluginUI';
import './styles/screenplay.css';

const DEFAULT_AUTO_SAVE_INTERVAL_MS = 30_000;
const AUTO_SAVE_INTERVAL_OPTIONS_MS = [15_000, 30_000, 60_000, 300_000] as const;
const INLINE_ANNOTATION_REFRESH_DEBOUNCE_MS = 120;
const KEYMAP_HINTS_STORAGE_KEY = 'grainery-keymap-hints-enabled';
const AUTO_SAVE_PREFERENCES_STORAGE_KEY = 'grainery-autosave-preferences';

interface AutoSavePreferences {
  enabled: boolean;
  intervalMs: number;
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

function isEditorCurrentNodeEffectivelyEmpty(editor: Editor): boolean {
  const currentType = getCurrentNodeType(editor);
  const currentText = editor.state.selection.$from.parent.textContent;
  return currentText.trim().length === 0 || Boolean(currentType && hasOnlyElementSeedText(currentType, currentText));
}

function setEditorNodeType(editor: Editor, type: ScreenplayElementType): void {
  const currentType = getCurrentNodeType(editor);
  const { $from } = editor.state.selection;
  const currentText = $from.parent.textContent;
  const shouldClearCurrentSeed = currentType
    ? hasOnlyElementSeedText(currentType, currentText)
    : false;
  const isCurrentEffectivelyEmpty =
    currentText.trim().length === 0 || shouldClearCurrentSeed;
  const seedText = isCurrentEffectivelyEmpty ? getElementSeedText(type) : null;
  let chain = editor.chain();

  if (shouldClearCurrentSeed) {
    chain = chain.deleteRange({ from: $from.start(), to: $from.end() });
  }

  if (seedText) {
    chain.setNode(type).insertContent(seedText).focus().run();
    return;
  }

  chain.setNode(type).focus().run();
}

function getStoredKeymapHintsEnabled(): boolean {
  return localStorage.getItem(KEYMAP_HINTS_STORAGE_KEY) !== 'false';
}

function isValidAutoSaveInterval(value: unknown): value is typeof AUTO_SAVE_INTERVAL_OPTIONS_MS[number] {
  return (
    typeof value === 'number' &&
    AUTO_SAVE_INTERVAL_OPTIONS_MS.includes(value as typeof AUTO_SAVE_INTERVAL_OPTIONS_MS[number])
  );
}

function getStoredAutoSavePreferences(): AutoSavePreferences {
  const fallback: AutoSavePreferences = {
    enabled: true,
    intervalMs: DEFAULT_AUTO_SAVE_INTERVAL_MS,
  };
  const raw = localStorage.getItem(AUTO_SAVE_PREFERENCES_STORAGE_KEY);

  if (!raw) {
    return fallback;
  }

  try {
    const stored = JSON.parse(raw) as Partial<AutoSavePreferences>;

    return {
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : fallback.enabled,
      intervalMs: isValidAutoSaveInterval(stored.intervalMs) ? stored.intervalMs : fallback.intervalMs,
    };
  } catch {
    return fallback;
  }
}

function storeAutoSavePreferences(preferences: AutoSavePreferences): void {
  localStorage.setItem(AUTO_SAVE_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [view, setView] = useState<'start' | 'editor'>('start');
  const [document, setDocument] = useState<ScreenplayDocument>(createNewDocument);
  const [isDirty, setIsDirty] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(() => getRecentFiles());
  const [startScreenError, setStartScreenError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pluginStateVersion, setPluginStateVersion] = useState(0);
  const [editorVersion, setEditorVersion] = useState(0);
  const [statusBadges, setStatusBadges] = useState<RenderedStatusBadge[]>([]);
  const [inlineAnnotations, setInlineAnnotations] = useState<RenderedInlineAnnotation[]>([]);
  const [isResolvingInitialOpen, setIsResolvingInitialOpen] = useState(true);
  const [keymapHintsEnabled, setKeymapHintsEnabled] = useState(getStoredKeymapHintsEnabled);
  const [autoSavePreferences, setAutoSavePreferences] = useState(getStoredAutoSavePreferences);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [updateDialogStatus, setUpdateDialogStatus] = useState<UpdateDialogStatus>('checking');
  const [availableUpdate, setAvailableUpdate] = useState<AvailableAppUpdate | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateDownloadProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const editorRef = useRef<Editor | null>(null);
  const editorContentRef = useRef<JSONContent>(document.document);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const performAutoSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const pluginDataRef = useRef<Record<string, unknown>>(document.pluginData ?? {});
  const pluginManagerRef = useRef<PluginManager | null>(null);
  const viewRef = useRef(view);
  const isDirtyRef = useRef(isDirty);
  const showSettingsRef = useRef(showSettings);
  const isClosingRef = useRef(false);

  const clearQueuedAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const queueAutoSave = useCallback(() => {
    clearQueuedAutoSave();

    if (!autoSavePreferences.enabled) {
      return;
    }

    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void performAutoSaveRef.current();
    }, autoSavePreferences.intervalMs);
  }, [autoSavePreferences.enabled, autoSavePreferences.intervalMs, clearQueuedAutoSave]);

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
        return isEditorCurrentNodeEffectivelyEmpty(editor);
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
        setEditorNodeType(editor, type);
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
          documentMode: document.documentMode,
          previousType,
          isCurrentEmpty: isEditorCurrentNodeEffectivelyEmpty(editor),
        });

        const target =
          pluginResolved ?? (direction === 'next'
            ? getNextElementType(document.documentMode, currentType, previousType)
            : getPreviousElementType(document.documentMode, currentType, previousType));

        setEditorNodeType(editor, target);
        setEditorVersion((prev) => prev + 1);
      },
      escapeToAction: () => {
        const editor = editorRef.current;
        if (!editor) {
          return;
        }
        editor.commands.setNode(getEscapeElementType(document.documentMode));
        setEditorVersion((prev) => prev + 1);
      },
    }),
    [document.documentMode, pluginManager]
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
    if (!isDirty) return;

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
  }, [document, isDirty, runTransformHook]);

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

  const handleNew = useCallback(async (documentMode: DocumentMode = 'screenplay') => {
    if (view === 'editor' && isDirty) {
      const discard = await confirmUnsavedChanges();
      if (!discard) return;
    }

    const nextDoc = createNewDocument(documentMode);
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

  const handleShowStartScreen = useCallback(async () => {
    if (view === 'editor' && isDirty) {
      const discard = await confirmUnsavedChanges();
      if (!discard) return;
    }

    setView('start');
    setIsDirty(false);
    setStartScreenError(null);
    editorRef.current = null;
    refreshRecentFiles();
    await updateWindowTitle(null);
  }, [isDirty, refreshRecentFiles, view]);

  const handleImportFdx = useCallback(async () => {
    if (view === 'editor' && isDirty) {
      const discard = await confirmUnsavedChanges();
      if (!discard) return;
    }

    try {
      const doc = await importFdxFile();
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
      console.error('Failed to import Final Draft file:', error);
      if (view === 'start') {
        const message = error instanceof Error ? error.message : String(error);
        setStartScreenError(`Failed to import Final Draft file. ${message}`);
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

  const saveCurrentDocument = useCallback(async (): Promise<boolean> => {
    try {
      const transformed = await runTransformHook('pre-save', editorContentRef.current);
      editorContentRef.current = transformed;

      const savedDoc = await saveFile(document, transformed);
      if (!savedDoc) {
        return false;
      }

      setDocument(savedDoc);
      setIsDirty(false);
      refreshRecentFiles();
      await updateWindowTitle(savedDoc.meta.filename);
      return true;
    } catch (error) {
      console.error('Failed to save file:', error);
      return false;
    }
  }, [document, refreshRecentFiles, runTransformHook]);

  const confirmQuitWithUnsavedChanges = useCallback(async (): Promise<boolean> => {
    if (!(viewRef.current === 'editor' && isDirtyRef.current)) {
      return true;
    }

    const shouldSave = await askDialog('You have unsaved changes. Save before quitting?', {
      title: 'Unsaved Changes',
      kind: 'warning',
      okLabel: 'Save',
      cancelLabel: "Don't Save",
    });

    if (shouldSave) {
      return saveCurrentDocument();
    }

    return askDialog('Quit without saving your changes?', {
      title: 'Unsaved Changes',
      kind: 'warning',
      okLabel: 'Quit',
      cancelLabel: 'Cancel',
    });
  }, [saveCurrentDocument]);

  const performAppExit = useCallback(async () => {
    if (isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
    try {
      await invoke('exit_app');
    } finally {
      isClosingRef.current = false;
    }
  }, []);

  const requestAppExit = useCallback(async () => {
    if (isClosingRef.current) {
      return;
    }

    const shouldQuit = await confirmQuitWithUnsavedChanges();
    if (!shouldQuit) {
      return;
    }

    await performAppExit();
  }, [confirmQuitWithUnsavedChanges, performAppExit]);

  const confirmInstallUpdateWithUnsavedChanges = useCallback(async (): Promise<boolean> => {
    if (!(viewRef.current === 'editor' && isDirtyRef.current)) {
      return true;
    }

    const shouldSave = await askDialog('You have unsaved changes. Save before installing the update?', {
      title: 'Unsaved Changes',
      kind: 'warning',
      okLabel: 'Save',
      cancelLabel: "Don't Save",
    });

    if (shouldSave) {
      return saveCurrentDocument();
    }

    return askDialog('Install the update without saving your changes?', {
      title: 'Unsaved Changes',
      kind: 'warning',
      okLabel: 'Install',
      cancelLabel: 'Cancel',
    });
  }, [saveCurrentDocument]);

  const checkForUpdates = useCallback(async (silent: boolean) => {
    if (!silent) {
      setIsUpdateDialogOpen(true);
      setUpdateDialogStatus('checking');
      setAvailableUpdate(null);
      setUpdateProgress(null);
      setUpdateError(null);
    }

    try {
      const nextUpdate = await checkForAppUpdate();

      if (!nextUpdate) {
        if (!silent) {
          setUpdateDialogStatus('not-available');
        }
        return;
      }

      setAvailableUpdate(nextUpdate);
      setUpdateProgress(null);
      setUpdateError(null);
      setUpdateDialogStatus('available');
      setIsUpdateDialogOpen(true);
    } catch (error) {
      const message = getErrorMessage(error);
      if (silent) {
        console.error('Startup update check failed:', error);
        return;
      }

      setUpdateError(message);
      setUpdateDialogStatus('error');
      setIsUpdateDialogOpen(true);
    } finally {
      if (silent) {
        recordStartupUpdateCheck();
      }
    }
  }, []);

  const handleCheckForUpdates = useCallback(() => {
    void checkForUpdates(false);
  }, [checkForUpdates]);

  const handleInstallUpdate = useCallback(async () => {
    if (!availableUpdate) {
      return;
    }

    const canInstall = await confirmInstallUpdateWithUnsavedChanges();
    if (!canInstall) {
      return;
    }

    setUpdateDialogStatus('installing');
    setUpdateProgress(null);
    setUpdateError(null);

    try {
      await installAppUpdate(availableUpdate, setUpdateProgress);
      setUpdateDialogStatus('installed');
      await relaunchApp();
    } catch (error) {
      setUpdateError(getErrorMessage(error));
      setUpdateDialogStatus('error');
    }
  }, [availableUpdate, confirmInstallUpdateWithUnsavedChanges]);

  const handleRelaunchAfterUpdate = useCallback(() => {
    void relaunchApp().catch((error) => {
      setUpdateError(getErrorMessage(error));
      setUpdateDialogStatus('error');
    });
  }, []);

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
    if (document.documentMode !== 'screenplay') {
      await askDialog('Fountain export is only available for screenplay documents.', {
        title: 'Export Unavailable',
        kind: 'info',
        okLabel: 'OK',
      });
      return;
    }

    try {
      const transformed = await runTransformHook('pre-export', editorContentRef.current);
      await exportAsFountain(transformed, document.titlePage, document.meta.filename);
    } catch (error) {
      console.error('Failed to export as Fountain:', error);
    }
  }, [document.documentMode, document.meta.filename, document.titlePage, runTransformHook]);

  const handleExportPdf = useCallback(async () => {
    try {
      const transformed = await runTransformHook('pre-export', editorContentRef.current);
      await exportAsPdf(transformed, document.titlePage, document.meta.filename, document.documentMode);
    } catch (error) {
      console.error('Failed to export as PDF:', error);
    }
  }, [document.documentMode, document.meta.filename, document.titlePage, runTransformHook]);

  const handleExportFdx = useCallback(async () => {
    if (document.documentMode !== 'screenplay') {
      await askDialog('Final Draft export is only available for screenplay documents.', {
        title: 'Export Unavailable',
        kind: 'info',
        okLabel: 'OK',
      });
      return;
    }

    try {
      const transformed = await runTransformHook('pre-export', editorContentRef.current);
      await exportAsFdx(transformed, document.titlePage, document.meta.filename);
    } catch (error) {
      console.error('Failed to export as Final Draft:', error);
    }
  }, [document.documentMode, document.meta.filename, document.titlePage, runTransformHook]);

  const handleFind = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.commands.openFind();
    setEditorVersion((prev) => prev + 1);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
    if (viewRef.current === 'editor') {
      editorRef.current?.commands.focus();
    }
  }, []);

  const handleKeymapHintsEnabledChange = useCallback((enabled: boolean) => {
    setKeymapHintsEnabled(enabled);
    localStorage.setItem(KEYMAP_HINTS_STORAGE_KEY, String(enabled));
  }, []);

  const handleAutoSaveEnabledChange = useCallback(
    (enabled: boolean) => {
      setAutoSavePreferences((prev) => {
        const next = { ...prev, enabled };
        storeAutoSavePreferences(next);
        return next;
      });

      if (!enabled) {
        clearQueuedAutoSave();
      }
    },
    [clearQueuedAutoSave]
  );

  const handleAutoSaveIntervalChange = useCallback((intervalMs: number) => {
    if (!isValidAutoSaveInterval(intervalMs)) {
      return;
    }

    setAutoSavePreferences((prev) => {
      const next = { ...prev, intervalMs };
      storeAutoSavePreferences(next);
      return next;
    });
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

  useEffect(() => {
    const claimFindShortcut = (event: KeyboardEvent) => {
      if (showSettingsRef.current) {
        return;
      }

      const isCommandShortcut = event.ctrlKey || event.metaKey;
      if (!isCommandShortcut || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'f' && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleFind();
        return;
      }

      if (key === 'h' && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleReplace();
        return;
      }

      if (key === 'g') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.shiftKey) {
          handleFindPrevious();
        } else {
          handleFindNext();
        }
      }
    };

    window.addEventListener('keydown', claimFindShortcut, true);

    return () => {
      window.removeEventListener('keydown', claimFindShortcut, true);
    };
  }, [handleFind, handleFindNext, handleFindPrevious, handleReplace]);

  const handleSaveTitlePage = useCallback((titlePage: TitlePageData | null) => {
    setDocument((prev) => ({
      ...prev,
      titlePage,
    }));
    setIsDirty(true);
  }, []);

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
    let timer: ReturnType<typeof setTimeout> | null = null;

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

    timer = setTimeout(() => {
      void refreshInlineAnnotations();
    }, INLINE_ANNOTATION_REFRESH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
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

  useEffect(() => {
    return clearQueuedAutoSave;
  }, [clearQueuedAutoSave]);

  useEffect(() => {
    if (!autoSavePreferences.enabled) {
      clearQueuedAutoSave();
      return;
    }

    if (isDirtyRef.current) {
      queueAutoSave();
    }
  }, [autoSavePreferences.enabled, autoSavePreferences.intervalMs, clearQueuedAutoSave, queueAutoSave]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);

  useEffect(() => {
    const appWindow = getCurrentWindow();

    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();

      if (isClosingRef.current) {
        return;
      }

      const shouldQuit = await confirmQuitWithUnsavedChanges();
      if (!shouldQuit) {
        return;
      }

      await performAppExit();
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [confirmQuitWithUnsavedChanges, performAppExit]);

  useEffect(() => {
    pluginDataRef.current = document.pluginData ?? {};
  }, [document.pluginData]);

  useEffect(() => {
    if (!shouldRunStartupUpdateCheck()) {
      return;
    }

    void checkForUpdates(true);
  }, [checkForUpdates]);

  // Listen for native menu events
  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      if (event.payload.startsWith('plugin:command:')) {
        void pluginManager.executeCommand(event.payload.replace('plugin:command:', ''));
        return;
      }

      switch (event.payload) {
        case 'new':
          void handleNew('screenplay');
          break;
        case 'new_comic':
          void handleNew('comic');
          break;
        case 'new_freewrite':
          void handleNew('freewrite');
          break;
        case 'open':
          void handleOpen();
          break;
        case 'import_fdx':
          void handleImportFdx();
          break;
        case 'start_screen':
          void handleShowStartScreen();
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
        case 'settings':
          setShowSettings(true);
          break;
        case 'check_updates':
          handleCheckForUpdates();
          break;
        case 'quit':
          void requestAppExit();
          break;
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [
    handleExportFdx,
    handleExportFountain,
    handleExportPdf,
    handleFind,
    handleFindNext,
    handleFindPrevious,
    handleShowStartScreen,
    handleImportFdx,
    handleNew,
    handleOpen,
    handleReplace,
    handleSave,
    handleSaveAs,
    handleCheckForUpdates,
    requestAppExit,
    pluginManager,
  ]);

  useEffect(() => {
    const unlisten = listen('app-quit-requested', () => {
      void requestAppExit();
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [requestAppExit]);

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
              void handleNew('screenplay');
            }}
            onNewComic={() => {
              void handleNew('comic');
            }}
            onNewFreewrite={() => {
              void handleNew('freewrite');
            }}
            onOpenFile={() => {
              void handleOpen();
            }}
            onImportFdx={() => {
              void handleImportFdx();
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
              documentMode={document.documentMode}
              initialContent={editorContentRef.current}
              inlineAnnotations={inlineAnnotations}
              onChange={handleEditorChange}
              resolveElementLoop={(context) => pluginManager.resolveElementLoop(context)}
              onSelectionChange={() => {
                setEditorVersion((prev) => prev + 1);
              }}
              onEditorReady={(editor) => {
                editorRef.current = editor;
              }}
              showKeymapHint={keymapHintsEnabled}
            />

            <PluginUIHost
              pluginManager={pluginManager}
              pluginStateVersion={pluginStateVersion}
              editorVersion={editorVersion}
              document={editorContentRef.current}
              documentMode={document.documentMode}
              editorAdapter={editorAdapter}
            />

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

        {showSettings && (
          <SettingsModal
            onClose={handleCloseSettings}
            documentMode={document.documentMode}
            titlePage={document.titlePage}
            onTitlePageChange={handleSaveTitlePage}
            pluginManager={pluginManager}
            pluginStateVersion={pluginStateVersion}
            keymapHintsEnabled={keymapHintsEnabled}
            onKeymapHintsEnabledChange={handleKeymapHintsEnabledChange}
            autoSaveEnabled={autoSavePreferences.enabled}
            autoSaveIntervalMs={autoSavePreferences.intervalMs}
            onAutoSaveEnabledChange={handleAutoSaveEnabledChange}
            onAutoSaveIntervalChange={handleAutoSaveIntervalChange}
          />
        )}

        {isUpdateDialogOpen && (
          <UpdateDialog
            status={updateDialogStatus}
            update={availableUpdate}
            progress={updateProgress}
            errorMessage={updateError}
            onCheckAgain={handleCheckForUpdates}
            onInstall={handleInstallUpdate}
            onRelaunch={handleRelaunchAfterUpdate}
            onClose={() => setIsUpdateDialogOpen(false)}
          />
        )}
      </div>
    </ThemeProvider>
  );
}

export default App;
