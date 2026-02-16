import { invoke } from '@tauri-apps/api/core';
import { open, save, ask } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ScreenplayDocument, TitlePageData } from './types';
import type { JSONContent } from '@tiptap/react';
import { exportToFountain } from './fountain';
import { exportToFdx } from './fdx';
import { recordRecentFile } from './recentFiles';

export async function updateWindowTitle(filename: string | null, isDirty: boolean = false): Promise<void> {
  const title = (filename || 'Untitled') + (isDirty ? ' - Edited' : '');
  await getCurrentWebviewWindow().setTitle(title);
}

const FILE_EXTENSION = 'gwx';
const APP_NAME = 'Grainery';
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
          type: 'sceneHeading',
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

export async function openFileAtPath(path: string): Promise<ScreenplayDocument> {
  const content = await invoke<string>('load_screenplay', { path });
  const doc = JSON.parse(content) as ScreenplayDocument;
  const normalized = populateDocumentMetaFromPath(doc, path);
  recordRecentFile(path);
  return normalized;
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

  recordRecentFile(doc.meta.filePath);
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
      filename: filePath.split(/[\\/]/).pop() || null,
      modifiedAt: new Date().toISOString(),
    },
  };

  await invoke('save_screenplay', {
    path: filePath,
    content: JSON.stringify(updatedDoc, null, 2),
  });

  recordRecentFile(filePath);
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
