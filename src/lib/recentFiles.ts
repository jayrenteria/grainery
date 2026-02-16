import type { RecentFileEntry } from './types';

const RECENT_FILES_STORAGE_KEY = 'grainery.recentFiles.v1';
const MAX_RECENT_FILES = 8;

function normalizePath(path: string): string {
  return path.trim();
}

function getFilename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function isRecentFileEntry(value: unknown): value is RecentFileEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<RecentFileEntry>;
  return (
    typeof candidate.path === 'string' &&
    typeof candidate.filename === 'string' &&
    typeof candidate.lastOpenedAt === 'string'
  );
}

function readRecentFiles(): RecentFileEntry[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(RECENT_FILES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(RECENT_FILES_STORAGE_KEY);
      return [];
    }

    const validEntries = parsed.filter(isRecentFileEntry);
    if (validEntries.length !== parsed.length) {
      window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(validEntries));
    }

    return validEntries.slice(0, MAX_RECENT_FILES);
  } catch {
    window.localStorage.removeItem(RECENT_FILES_STORAGE_KEY);
    return [];
  }
}

function writeRecentFiles(entries: RecentFileEntry[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(entries));
}

export function getRecentFiles(): RecentFileEntry[] {
  return readRecentFiles();
}

export function recordRecentFile(path: string): RecentFileEntry[] {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) {
    return getRecentFiles();
  }

  const existing = readRecentFiles().filter((entry) => entry.path !== normalizedPath);
  const nextEntries: RecentFileEntry[] = [
    {
      path: normalizedPath,
      filename: getFilename(normalizedPath),
      lastOpenedAt: new Date().toISOString(),
    },
    ...existing,
  ].slice(0, MAX_RECENT_FILES);

  writeRecentFiles(nextEntries);
  return nextEntries;
}

export function removeRecentFile(path: string): RecentFileEntry[] {
  const normalizedPath = normalizePath(path);
  const nextEntries = readRecentFiles().filter((entry) => entry.path !== normalizedPath);
  writeRecentFiles(nextEntries);
  return nextEntries;
}

export function clearRecentFiles(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(RECENT_FILES_STORAGE_KEY);
}
