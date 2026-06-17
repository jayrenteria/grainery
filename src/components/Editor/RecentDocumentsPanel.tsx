import type { DocumentMode, RecentFileEntry } from '../../lib/types';

const DOCUMENT_GROUPS: Array<{ mode: DocumentMode; label: string }> = [
  { mode: 'screenplay', label: 'Screenplay' },
  { mode: 'comic', label: 'Comic' },
  { mode: 'freewrite', label: 'Free Write' },
];

interface RecentDocumentsPanelProps {
  recentFiles: RecentFileEntry[];
  currentFilePath: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onCreateDocument: () => void;
  onOpenRecent: (path: string) => void;
  onOpenFile: () => void;
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

function getDisplayName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function getEntriesForMode(recentFiles: RecentFileEntry[], mode: DocumentMode): RecentFileEntry[] {
  return recentFiles.filter((entry) => (entry.documentMode ?? 'screenplay') === mode);
}

export function RecentDocumentsPanel({
  recentFiles,
  currentFilePath,
  isOpen,
  onToggle,
  onClose,
  onCreateDocument,
  onOpenRecent,
  onOpenFile,
}: RecentDocumentsPanelProps) {
  const panelId = 'recent-documents-panel';
  const groupedEntries = DOCUMENT_GROUPS.map((group) => ({
    ...group,
    entries: getEntriesForMode(recentFiles, group.mode),
  }));

  return (
    <div className={`recent-documents-dock${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="recent-documents-rail"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={isOpen ? 'Close recent documents' : 'Open recent documents'}
        title={isOpen ? 'Close recent documents' : 'Open recent documents'}
      >
        <span aria-hidden="true" />
      </button>

      <aside
        id={panelId}
        className="recent-documents-panel"
        aria-label="Recent documents"
        aria-hidden={!isOpen}
      >
        <header className="recent-documents-header">
          <h2>
            Documents<span aria-hidden="true">•</span>
          </h2>
          <div className="recent-documents-actions">
            <button
              type="button"
              className="recent-documents-icon-button"
              onClick={onCreateDocument}
              aria-label="Create document"
              title="Create document"
            >
              +
            </button>
            <button
              type="button"
              className="recent-documents-icon-button"
              onClick={onClose}
              aria-label="Close recent documents"
              title="Close recent documents"
            >
              <span className="recent-documents-close-glyph" aria-hidden="true">
                X
              </span>
            </button>
          </div>
        </header>

        <div className="recent-documents-scroll">
          {groupedEntries.map((group) => (
            <section className="recent-documents-group" key={group.mode}>
              <div className="recent-documents-group-header">
                <h3>{group.label}</h3>
                <span>{group.entries.length}</span>
              </div>

              {group.entries.length === 0 ? (
                <p className="recent-documents-empty">No recent documents.</p>
              ) : (
                <ul className="recent-documents-list">
                  {group.entries.map((entry) => {
                    const isCurrent = currentFilePath === entry.path;

                    return (
                      <li key={entry.path}>
                        <button
                          type="button"
                          className={`recent-documents-item${isCurrent ? ' is-current' : ''}`}
                          onClick={() => onOpenRecent(entry.path)}
                          title={getDirectoryPath(entry.path)}
                        >
                          <span className="recent-documents-name">{getDisplayName(entry.filename)}</span>
                          <span className="recent-documents-meta">
                            {formatRelativeTime(entry.lastOpenedAt)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>

        <footer className="recent-documents-footer">
          <button type="button" className="recent-documents-footer-button" onClick={onOpenFile}>
            Open file...
          </button>
        </footer>
      </aside>
    </div>
  );
}
