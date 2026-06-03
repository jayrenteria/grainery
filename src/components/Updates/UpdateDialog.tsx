import { Modal } from '../Modal';
import type { AvailableAppUpdate, UpdateDownloadProgress } from '../../lib/appUpdates';

export type UpdateDialogStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'installing'
  | 'installed'
  | 'error';

interface UpdateDialogProps {
  status: UpdateDialogStatus;
  update: AvailableAppUpdate | null;
  progress: UpdateDownloadProgress | null;
  errorMessage: string | null;
  onCheckAgain: () => void;
  onInstall: () => void;
  onRelaunch: () => void;
  onClose: () => void;
}

function formatDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getProgressPercent(progress: UpdateDownloadProgress | null): number | null {
  if (!progress?.contentLength) {
    return null;
  }

  return Math.min(100, Math.round((progress.downloadedBytes / progress.contentLength) * 100));
}

export function UpdateDialog({
  status,
  update,
  progress,
  errorMessage,
  onCheckAgain,
  onInstall,
  onRelaunch,
  onClose,
}: UpdateDialogProps) {
  const isBusy = status === 'checking' || status === 'installing';
  const progressPercent = getProgressPercent(progress);
  const releaseDate = formatDate(update?.date);

  return (
    <Modal onClose={isBusy ? () => undefined : onClose} className="w-[min(32rem,calc(100vw-2rem))]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-base-content">Software Update</h2>
          {update && (
            <p className="mt-1 text-sm text-base-content/70">
              Grainery {update.currentVersion} to {update.version}
            </p>
          )}
        </div>
        {!isBusy && (
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            aria-label="Close update dialog"
            onClick={onClose}
          >
            x
          </button>
        )}
      </div>

      {status === 'checking' && (
        <div className="flex items-center gap-3 text-sm text-base-content/80">
          <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          <span>Checking for updates...</span>
        </div>
      )}

      {status === 'not-available' && (
        <div className="alert py-3 text-sm">
          <span>Grainery is up to date.</span>
        </div>
      )}

      {status === 'available' && update && (
        <div className="flex flex-col gap-3">
          <div className="alert alert-info py-3 text-sm">
            <span>Grainery {update.version} is available.</span>
          </div>
          {releaseDate && (
            <p className="text-xs text-base-content/60">Published {releaseDate}</p>
          )}
          {update.body && (
            <div className="max-h-44 overflow-auto rounded-md border border-base-300 bg-base-200/50 p-3 text-sm whitespace-pre-wrap">
              {update.body}
            </div>
          )}
        </div>
      )}

      {status === 'installing' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-base-content/80">Downloading and installing the update...</p>
          <progress
            className="progress progress-primary w-full"
            value={progressPercent ?? undefined}
            max={progressPercent === null ? undefined : 100}
          />
          {progress && (
            <p className="text-xs text-base-content/60">
              {progress.contentLength
                ? `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.contentLength)}`
                : `${formatBytes(progress.downloadedBytes)} downloaded`}
            </p>
          )}
        </div>
      )}

      {status === 'installed' && (
        <div className="alert alert-success py-3 text-sm">
          <span>The update has been installed. Restart Grainery to finish.</span>
        </div>
      )}

      {status === 'error' && (
        <div className="alert alert-error py-3 text-sm">
          <span>{errorMessage ?? 'Update failed.'}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {status === 'not-available' && (
          <>
            <button type="button" className="btn btn-ghost" onClick={onCheckAgain}>
              Check Again
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        )}

        {status === 'available' && (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Later
            </button>
            <button type="button" className="btn btn-primary" onClick={onInstall}>
              Install and Restart
            </button>
          </>
        )}

        {status === 'installed' && (
          <button type="button" className="btn btn-primary" onClick={onRelaunch}>
            Restart Now
          </button>
        )}

        {status === 'error' && (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Done
            </button>
            <button type="button" className="btn btn-primary" onClick={onCheckAgain}>
              Try Again
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
