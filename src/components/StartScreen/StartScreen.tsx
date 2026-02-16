import type { RecentFileEntry } from '../../lib/types';
import logo from '../../assets/logo.png';

interface StartScreenProps {
  recentFiles: RecentFileEntry[];
  errorMessage: string | null;
  onDismissError: () => void;
  onNewScreenplay: () => void;
  onOpenFile: () => void;
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

export function StartScreen({
  recentFiles,
  errorMessage,
  onDismissError,
  onNewScreenplay,
  onOpenFile,
  onOpenRecent,
}: StartScreenProps) {
  return (
    <div className="start-screen">
      <div
        className="start-screen-background"
        style={{ backgroundImage: `url(${logo})` }}
        aria-hidden="true"
      />
      <div className="start-screen-card">
        <div className="start-screen-header">
          <p>Choose a recent screenplay or start a new one.</p>
        </div>

        {errorMessage && (
          <div role="alert" className="alert alert-error text-sm">
            <span>{errorMessage}</span>
            <button type="button" className="btn btn-xs btn-ghost" onClick={onDismissError}>
              Dismiss
            </button>
          </div>
        )}

        <div className="start-screen-actions">
          <button type="button" className="btn btn-primary" onClick={onNewScreenplay}>
            New Screenplay
          </button>
          <button type="button" className="btn btn-outline" onClick={onOpenFile}>
            Open File...
          </button>
        </div>

        <section className="start-screen-recent">
          <div className="start-screen-recent-header">
            <h2>Recent Files</h2>
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
                  >
                    <span className="start-screen-filename">{entry.filename}</span>
                    <span className="start-screen-directory">{getDirectoryPath(entry.path)}</span>
                    <span className="start-screen-time">{formatRelativeTime(entry.lastOpenedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
