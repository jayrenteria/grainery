import { useState, useCallback, useRef, useEffect } from 'react';
import { ScreenplayEditor, TitlePageEditor } from './components/Editor';
import { listen } from '@tauri-apps/api/event';
import {
  createNewDocument,
  openFile,
  saveFile,
  saveFileAs,
  exportAsFountain,
  exportAsPdf,
  confirmUnsavedChanges,
  updateWindowTitle,
} from './lib/fileOps';
import type { ScreenplayDocument, TitlePageData } from './lib/types';
import type { JSONContent } from '@tiptap/react';
import './styles/screenplay.css';

const AUTO_SAVE_DELAY_MS = 30000;

function App() {
  const [document, setDocument] = useState<ScreenplayDocument>(createNewDocument);
  const [isDirty, setIsDirty] = useState(false);
  const [showTitlePageEditor, setShowTitlePageEditor] = useState(false);
  const editorContentRef = useRef<JSONContent>(document.document);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performAutoSave = useCallback(async () => {
    if (!isDirty) return;
    
    try {
      const savedDoc = await saveFile(document, editorContentRef.current);
      if (savedDoc) {
        setDocument(savedDoc);
        setIsDirty(false);
        await updateWindowTitle(savedDoc.meta.filename);
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  }, [document, isDirty]);

  const handleEditorChange = useCallback((content: JSONContent) => {
    editorContentRef.current = content;
    if (!isDirty) {
      setIsDirty(true);
      updateWindowTitle(document.meta.filename, true);
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      performAutoSave();
    }, AUTO_SAVE_DELAY_MS);
  }, [isDirty, document.meta.filename, performAutoSave]);

  const handleNew = useCallback(async () => {
    if (isDirty) {
      const discard = await confirmUnsavedChanges();
      if (!discard) return;
    }
    setDocument(createNewDocument());
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
      if (doc) {
        setDocument(doc);
        editorContentRef.current = doc.document;
        setIsDirty(false);
        await updateWindowTitle(doc.meta.filename);
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }, [isDirty]);

  const handleSave = useCallback(async () => {
    try {
      const savedDoc = await saveFile(document, editorContentRef.current);
      if (savedDoc) {
        setDocument(savedDoc);
        setIsDirty(false);
        await updateWindowTitle(savedDoc.meta.filename);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [document]);

  const handleSaveAs = useCallback(async () => {
    try {
      const savedDoc = await saveFileAs(document, editorContentRef.current);
      if (savedDoc) {
        setDocument(savedDoc);
        setIsDirty(false);
        await updateWindowTitle(savedDoc.meta.filename);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [document]);

  const handleExportFountain = useCallback(async () => {
    try {
      await exportAsFountain(
        editorContentRef.current,
        document.titlePage,
        document.meta.filename
      );
    } catch (error) {
      console.error('Failed to export as Fountain:', error);
    }
  }, [document.titlePage, document.meta.filename]);

  const handleExportPdf = useCallback(async () => {
    try {
      await exportAsPdf(
        editorContentRef.current,
        document.titlePage,
        document.meta.filename
      );
    } catch (error) {
      console.error('Failed to export as PDF:', error);
    }
  }, [document.titlePage, document.meta.filename]);

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
      switch (event.payload) {
        case 'new':
          handleNew();
          break;
        case 'open':
          handleOpen();
          break;
        case 'save':
          handleSave();
          break;
        case 'save_as':
          handleSaveAs();
          break;
        case 'export_fountain':
          handleExportFountain();
          break;
        case 'export_pdf':
          handleExportPdf();
          break;
        case 'title_page':
          handleEditTitlePage();
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleNew, handleOpen, handleSave, handleSaveAs, handleExportFountain, handleExportPdf, handleEditTitlePage]);

  return (
    <div className="app-container">
      <ScreenplayEditor
        key={document.meta.id}
        initialContent={document.document}
        onChange={handleEditorChange}
      />

      {showTitlePageEditor && (
        <TitlePageEditor
          titlePage={document.titlePage}
          onSave={handleSaveTitlePage}
          onClose={() => setShowTitlePageEditor(false)}
        />
      )}
    </div>
  );
}

export default App;
