import { invoke } from '@tauri-apps/api/core';
import { open, save, ask } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { DocumentMode, ScreenplayDocument, TitlePageData } from './types';
import type { JSONContent } from '@tiptap/react';
import { exportToFountain } from './fountain';
import { exportToFdx, importFromFdx } from './fdx';
import { recordRecentFile } from './recentFiles';
import { getDefaultContent } from './elementConfig';

export async function updateWindowTitle(filename: string | null, isDirty: boolean = false): Promise<void> {
  const title = (filename || 'Untitled') + (isDirty ? ' - Edited' : '');
  await getCurrentWebviewWindow().setTitle(title);
}

const FILE_EXTENSION = 'gwx';
const FDX_EXTENSION = 'fdx';
const APP_NAME = 'Grainery';
const APP_VERSION = '1.5.1';

export function createNewDocument(documentMode: ScreenplayDocument['documentMode'] = 'screenplay'): ScreenplayDocument {
  return {
    formatVersion: '1.0',
    documentMode,
    application: {
      name: APP_NAME,
      version: APP_VERSION,
    },
    meta: {
      id: crypto.randomUUID(),
      filename: null,
      filePath: null,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      version: APP_VERSION,
    },
    titlePage: null,
    document: getDefaultContent(documentMode),
    settings: {
      pageNumberStart: 1,
      showSceneNumbers: false,
      revision: null,
    },
    pluginData: {},
  };
}

function normalizeDocument(doc: ScreenplayDocument): ScreenplayDocument {
  return {
    ...doc,
    documentMode: doc.documentMode ?? 'screenplay',
  };
}

function populateDocumentMetaFromPath(doc: ScreenplayDocument, filePath: string): ScreenplayDocument {
  return {
    ...doc,
    meta: {
      ...doc.meta,
      filePath,
      filename: filePath.split(/[\\/]/).pop() || null,
    },
  };
}

function getPathExtension(path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? path;
  const match = filename.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function getFilenameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || 'untitled';
}

function replacePathExtension(filename: string, extension: string): string {
  return `${filename.replace(/\.[^.]+$/, '')}.${extension}`;
}

function createImportedDocument(
  imported: ReturnType<typeof importFromFdx>,
  sourcePath: string
): ScreenplayDocument {
  const now = new Date().toISOString();
  const sourceFilename = getFilenameFromPath(sourcePath);
  const importedFilename = replacePathExtension(sourceFilename, FILE_EXTENSION);

  return {
    ...createNewDocument(),
    meta: {
      id: crypto.randomUUID(),
      filename: importedFilename,
      filePath: null,
      createdAt: now,
      modifiedAt: now,
      version: APP_VERSION,
    },
    titlePage: imported.titlePage,
    document: imported.document,
  };
}

export async function openFileAtPath(path: string): Promise<ScreenplayDocument> {
  const content = await invoke<string>('load_screenplay', { path });

  if (getPathExtension(path) === FDX_EXTENSION) {
    const doc = createImportedDocument(importFromFdx(content), path);
    recordRecentFile(path, doc.documentMode);
    return doc;
  }

  const doc = JSON.parse(content) as ScreenplayDocument;
  const normalized = populateDocumentMetaFromPath(normalizeDocument(doc), path);
  recordRecentFile(path, normalized.documentMode);
  return normalized;
}

export async function openFile(): Promise<ScreenplayDocument | null> {
  const filePath = await open({
    multiple: false,
    filters: [
      {
        name: 'Screenplay',
        extensions: [FILE_EXTENSION, FDX_EXTENSION],
      },
      {
        name: 'Grainery',
        extensions: [FILE_EXTENSION],
      },
      {
        name: 'Final Draft',
        extensions: [FDX_EXTENSION],
      },
      {
        name: 'All Files',
        extensions: ['*'],
      },
    ],
  });

  if (!filePath) return null;

  return openFileAtPath(filePath);
}

export async function importFdxFile(): Promise<ScreenplayDocument | null> {
  const filePath = await open({
    multiple: false,
    filters: [
      {
        name: 'Final Draft',
        extensions: [FDX_EXTENSION],
      },
      {
        name: 'All Files',
        extensions: ['*'],
      },
    ],
  });

  if (!filePath) return null;

  return openFileAtPath(filePath);
}

export async function saveFile(
  doc: ScreenplayDocument,
  editorContent: JSONContent
): Promise<ScreenplayDocument | null> {
  if (!doc.meta.filePath) {
    return saveFileAs(doc, editorContent);
  }

  const updatedDoc: ScreenplayDocument = {
    ...doc,
    document: editorContent,
    meta: {
      ...doc.meta,
      modifiedAt: new Date().toISOString(),
    },
  };

  await invoke('save_screenplay', {
    path: doc.meta.filePath,
    content: JSON.stringify(updatedDoc, null, 2),
  });

  recordRecentFile(doc.meta.filePath, updatedDoc.documentMode);
  return updatedDoc;
}

export async function saveFileAs(
  doc: ScreenplayDocument,
  editorContent: JSONContent
): Promise<ScreenplayDocument | null> {
  const filePath = await save({
    filters: [
      {
        name: 'Grainery Document',
        extensions: [FILE_EXTENSION],
      },
    ],
    defaultPath: doc.meta.filename || 'untitled.gwx',
  });

  if (!filePath) return null;

  const updatedDoc: ScreenplayDocument = {
    ...doc,
    document: editorContent,
    meta: {
      ...doc.meta,
      filePath,
      filename: filePath.split(/[\\/]/).pop() || null,
      modifiedAt: new Date().toISOString(),
    },
  };

  await invoke('save_screenplay', {
    path: filePath,
    content: JSON.stringify(updatedDoc, null, 2),
  });

  recordRecentFile(filePath, updatedDoc.documentMode);
  return updatedDoc;
}

export async function confirmUnsavedChanges(): Promise<boolean> {
  return ask('You have unsaved changes. Do you want to discard them?', {
    title: 'Unsaved Changes',
    kind: 'warning',
    okLabel: 'Discard',
    cancelLabel: 'Cancel',
  });
}

export async function exportAsFountain(
  editorContent: JSONContent,
  titlePage: TitlePageData | null,
  currentFilename: string | null
): Promise<boolean> {
  // Generate default filename from current file or 'untitled'
  const baseName = currentFilename
    ? currentFilename.replace(/\.[^.]+$/, '')
    : 'untitled';

  const filePath = await save({
    filters: [
      {
        name: 'Fountain',
        extensions: ['fountain'],
      },
    ],
    defaultPath: `${baseName}.fountain`,
  });

  if (!filePath) return false;

  const fountainContent = exportToFountain(editorContent, titlePage);

  await invoke('save_screenplay', {
    path: filePath,
    content: fountainContent,
  });

  return true;
}

export async function exportAsPdf(
  editorContent: JSONContent,
  titlePage: TitlePageData | null,
  currentFilename: string | null,
  documentMode: DocumentMode
): Promise<boolean> {
  const baseName = currentFilename
    ? currentFilename.replace(/\.[^.]+$/, '')
    : 'untitled';

  const filePath = await save({
    filters: [
      {
        name: 'PDF',
        extensions: ['pdf'],
      },
    ],
    defaultPath: `${baseName}.pdf`,
  });

  if (!filePath) return false;

  await invoke('export_pdf', {
    contentJson: JSON.stringify(editorContent),
    titlePageJson: titlePage ? JSON.stringify(titlePage) : null,
    outputPath: filePath,
    documentTitle: baseName,
    documentMode,
  });

  return true;
}

export async function exportAsFdx(
  editorContent: JSONContent,
  titlePage: TitlePageData | null,
  currentFilename: string | null
): Promise<boolean> {
  const baseName = currentFilename
    ? currentFilename.replace(/\.[^.]+$/, '')
    : 'untitled';

  const filePath = await save({
    filters: [
      {
        name: 'Final Draft',
        extensions: ['fdx'],
      },
    ],
    defaultPath: `${baseName}.fdx`,
  });

  if (!filePath) return false;

  const fdxContent = exportToFdx(editorContent, titlePage);

  await invoke('save_screenplay', {
    path: filePath,
    content: fdxContent,
  });

  return true;
}
