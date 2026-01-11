import { invoke } from '@tauri-apps/api/core';
import { open, save, ask } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ScreenplayDocument, TitlePageData } from './types';
import type { JSONContent } from '@tiptap/react';
import { exportToFountain } from './fountain';

export async function updateWindowTitle(filename: string | null, isDirty: boolean = false): Promise<void> {
  const title = (filename || 'Untitled') + (isDirty ? ' - Edited' : '');
  await getCurrentWebviewWindow().setTitle(title);
}

const FILE_EXTENSION = 'gwx';
const APP_NAME = 'Screenwrite';
const APP_VERSION = '0.1.0';

export function createNewDocument(): ScreenplayDocument {
  return {
    formatVersion: '1.0',
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
    document: {
      type: 'doc',
      content: [
        {
          type: 'action',
          content: [],
        },
      ],
    },
    settings: {
      pageNumberStart: 1,
      showSceneNumbers: false,
      revision: null,
    },
  };
}

export async function openFile(): Promise<ScreenplayDocument | null> {
  const filePath = await open({
    multiple: false,
    filters: [
      {
        name: 'Screenplay',
        extensions: [FILE_EXTENSION],
      },
      {
        name: 'All Files',
        extensions: ['*'],
      },
    ],
  });

  if (!filePath) return null;

  const content = await invoke<string>('load_screenplay', { path: filePath });
  const doc = JSON.parse(content) as ScreenplayDocument;

  // Update the file path in meta
  doc.meta.filePath = filePath;
  doc.meta.filename = filePath.split('/').pop() || null;

  return doc;
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

  return updatedDoc;
}

export async function saveFileAs(
  doc: ScreenplayDocument,
  editorContent: JSONContent
): Promise<ScreenplayDocument | null> {
  const filePath = await save({
    filters: [
      {
        name: 'Screenplay',
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
      filename: filePath.split('/').pop() || null,
      modifiedAt: new Date().toISOString(),
    },
  };

  await invoke('save_screenplay', {
    path: filePath,
    content: JSON.stringify(updatedDoc, null, 2),
  });

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
  currentFilename: string | null
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
  });

  return true;
}
