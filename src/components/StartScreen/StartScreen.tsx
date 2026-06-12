import type { DocumentMode, RecentFileEntry } from '../../lib/types';

const DOCUMENT_MODE_LABELS: Record<DocumentMode, string> = {
  screenplay: 'Screenplay',
  comic: 'Comic',
  freewrite: 'Free Write',
};

interface StartScreenProps {
  recentFiles: RecentFileEntry[];
  errorMessage: string | null;
  onDismissError: () => void;
  onNewScreenplay: () => void;
  onNewComic: () => void;
  onNewFreewrite: () => void;
  onOpenFile: () => void;
  onImportFdx: () => void;
  onOpenRecent: (path: string) => void;
}

function formatRelativeTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }

  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) {
    return 'just now';
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 60) {
    return rtf.format(minutes, 'minute');
  }

  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(hours) < 24) {
    return rtf.format(hours, 'hour');
  }

  const days = Math.round(diffMs / 86_400_000);
  if (Math.abs(days) < 7) {
    return rtf.format(days, 'day');
  }

  return date.toLocaleDateString();
}

function getDirectoryPath(path: string): string {
  const segments = path.split(/[\\/]/);
  if (segments.length <= 1) {
    return path;
  }

  return segments.slice(0, -1).join('/');
}

function getApplicationVersion(): string {
  return '1.5';
}

export function StartScreen({
  recentFiles,
  errorMessage,
  onDismissError,
  onNewScreenplay,
  onNewComic,
  onNewFreewrite,
  onOpenFile,
  onImportFdx,
  onOpenRecent,
}: StartScreenProps) {
  return (
    <div className="start-screen">
      <main className="start-screen-shell" aria-labelledby="start-screen-title">
        <div className="start-screen-header">
          <h1 id="start-screen-title">
            GRAINERY<span aria-hidden="true">•</span>
          </h1>
        </div>

        {errorMessage && (
          <div role="alert" className="start-screen-error">
            <span>{errorMessage}</span>
            <button type="button" onClick={onDismissError}>
              Dismiss
            </button>
          </div>
        )}

        <button type="button" className="start-screen-new" onClick={onNewScreenplay}>
          <span className="start-screen-new-icon" aria-hidden="true">
            +
          </span>
          <span className="start-screen-new-copy">
            <span>Start a new screenplay</span>
            <span>Blank page - formatting handles itself</span>
          </span>
          <span className="start-screen-shortcut" aria-hidden="true">
            <kbd>⌘</kbd>
            <kbd>N</kbd>
          </span>
        </button>

        <button type="button" className="start-screen-new" onClick={onNewComic}>
          <span className="start-screen-new-icon" aria-hidden="true">
            +
          </span>
          <span className="start-screen-new-copy">
            <span>Start a new comic</span>
            <span>Page and panel script formatting</span>
          </span>
        </button>

        <button type="button" className="start-screen-new" onClick={onNewFreewrite}>
          <span className="start-screen-new-icon" aria-hidden="true">
            +
          </span>
          <span className="start-screen-new-copy">
            <span>Start a free write</span>
            <span>Simple notes - titles, headings, and lists</span>
          </span>
        </button>

        <section className="start-screen-recent">
          <div className="start-screen-recent-header">
            <h2>Recent</h2>
            <div className="start-screen-file-actions">
              <button type="button" onClick={onOpenFile}>
                Open a file...
              </button>
              <button type="button" onClick={onImportFdx}>
                Import Final Draft...
              </button>
            </div>
          </div>

          {recentFiles.length === 0 ? (
            <p className="start-screen-empty">No recent files yet.</p>
          ) : (
            <ul className="start-screen-list">
              {recentFiles.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className="start-screen-list-item"
                    onClick={() => onOpenRecent(entry.path)}
                    title={getDirectoryPath(entry.path)}
                  >
                    <span className="start-screen-filename">{entry.filename}</span>
                    {entry.documentMode && (
                      <span className="start-screen-doc-type">{DOCUMENT_MODE_LABELS[entry.documentMode]}</span>
                    )}
                    <span className="start-screen-time">{formatRelativeTime(entry.lastOpenedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <p className="start-screen-version">GRAINERY {getApplicationVersion()}</p>
    </div>
  );
}
