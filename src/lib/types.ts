import type { JSONContent } from '@tiptap/react';

export type DocumentMode = 'screenplay' | 'comic';

export type ScreenplayElementType =
  | 'sceneHeading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'comicPage'
  | 'comicPanel'
  | 'caption'
  | 'soundEffect';

export type CharacterExtension = 'V.O.' | 'O.S.' | "CONT'D" | 'O.C.' | null;

export interface TitlePageData {
  title: string;
  credit?: string;
  author: string;
  source?: string;
  draftDate?: string;
  contact?: string;
  copyright?: string;
  notes?: string;
}

export interface DocumentMeta {
  id: string;
  filename: string | null;
  filePath: string | null;
  createdAt: string;
  modifiedAt: string;
  version: string;
}

export interface DocumentSettings {
  pageNumberStart: number;
  showSceneNumbers: boolean;
  revision: string | null;
}

export interface ScreenplayDocument {
  formatVersion: '1.0';
  documentMode: DocumentMode;
  application: {
    name: string;
    version: string;
  };
  meta: DocumentMeta;
  titlePage: TitlePageData | null;
  document: JSONContent;
  settings: DocumentSettings;
  pluginData?: Record<string, unknown>;
}

export interface RecentFileEntry {
  path: string;
  filename: string;
  lastOpenedAt: string;
}

export const SCREENPLAY_ELEMENT_TYPES: ScreenplayElementType[] = [
  'sceneHeading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
];

export const COMIC_ELEMENT_TYPES: ScreenplayElementType[] = [
  'comicPage',
  'comicPanel',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'caption',
  'soundEffect',
];

export const ELEMENT_CYCLE: ScreenplayElementType[] = [
  ...SCREENPLAY_ELEMENT_TYPES,
  'comicPage',
  'comicPanel',
  'caption',
  'soundEffect',
];
