import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';

const STARTUP_UPDATE_CHECK_STORAGE_KEY = 'grainery-last-startup-update-check';
const STARTUP_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 30_000;
const GITHUB_RELEASE_BY_TAG_URL = 'https://api.github.com/repos/jayrenteria/grainery/releases/tags';

export interface AvailableAppUpdate {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  update: Update;
}

export interface UpdateDownloadProgress {
  downloadedBytes: number;
  contentLength: number | null;
  finished: boolean;
}

export type UpdateDownloadProgressHandler = (progress: UpdateDownloadProgress) => void;

interface GitHubReleaseResponse {
  body?: string | null;
}

export function shouldRunStartupUpdateCheck(): boolean {
  if (!import.meta.env.PROD) {
    return false;
  }

  const lastChecked = Number.parseInt(
    localStorage.getItem(STARTUP_UPDATE_CHECK_STORAGE_KEY) ?? '',
    10
  );

  if (!Number.isFinite(lastChecked)) {
    return true;
  }

  return Date.now() - lastChecked >= STARTUP_UPDATE_CHECK_INTERVAL_MS;
}

export function recordStartupUpdateCheck(): void {
  localStorage.setItem(STARTUP_UPDATE_CHECK_STORAGE_KEY, String(Date.now()));
}

async function fetchGitHubReleaseBody(version: string): Promise<string | null> {
  try {
    const response = await fetch(`${GITHUB_RELEASE_BY_TAG_URL}/app-v${version}`, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const release = (await response.json()) as GitHubReleaseResponse;
    const body = release.body?.trim();

    return body ? body : null;
  } catch {
    return null;
  }
}

export async function checkForAppUpdate(): Promise<AvailableAppUpdate | null> {
  const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });

  if (!update) {
    return null;
  }

  const releaseBody = await fetchGitHubReleaseBody(update.version);

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: releaseBody ?? update.body,
    update,
  };
}

export async function installAppUpdate(
  availableUpdate: AvailableAppUpdate,
  onProgress: UpdateDownloadProgressHandler
): Promise<void> {
  let downloadedBytes = 0;
  let contentLength: number | null = null;

  await availableUpdate.update.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case 'Started':
        downloadedBytes = 0;
        contentLength = event.data.contentLength ?? null;
        onProgress({ downloadedBytes, contentLength, finished: false });
        break;
      case 'Progress':
        downloadedBytes += event.data.chunkLength;
        onProgress({ downloadedBytes, contentLength, finished: false });
        break;
      case 'Finished':
        onProgress({ downloadedBytes, contentLength, finished: true });
        break;
    }
  });
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}
