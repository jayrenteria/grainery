import { Modal } from '../Modal';
import packageJson from '../../../package.json';
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

interface UpdateDialogCopy {
  title: string;
  detail: string;
}

const errorMessageFallback = 'Something interrupted the update check. Try again when you are back online.';

function formatDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

function getStatusCopy(
  status: UpdateDialogStatus,
  update: AvailableAppUpdate | null,
  currentVersion: string
): UpdateDialogCopy {
  switch (status) {
    case 'checking':
      return {
        title: 'Looking for a newer draft...',
        detail: `Reaching the workshop to see if anything has changed since version ${currentVersion}.`,
      };
    case 'available':
      return {
        title: 'A newer draft is ready.',
        detail: `Version ${update?.version ?? 'the latest release'} is available for Grainery.`,
      };
    case 'not-available':
      return {
        title: 'This draft is current.',
        detail: `Nothing has changed since version ${currentVersion}.`,
      };
    case 'installing':
      return {
        title: 'Binding the newer draft...',
        detail: 'Downloading the update and preparing Grainery to restart.',
      };
    case 'installed':
      return {
        title: 'The newer draft is in place.',
        detail: 'Restart Grainery to open the updated version.',
      };
    case 'error':
      return {
        title: 'The draft could not be checked.',
        detail: errorMessageFallback,
      };
  }
}

function UpdateRule({
  status,
  progressPercent,
}: {
  status: UpdateDialogStatus;
  progressPercent: number | null;
}) {
  if (status === 'installing' && progressPercent !== null) {
    return (
      <div className="h-px overflow-hidden bg-base-300" aria-label={`${progressPercent}% downloaded`}>
        <div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} />
      </div>
    );
  }

  if (status === 'checking' || status === 'installing') {
    return (
      <>
        <style>
          {`
            @keyframes grainery-update-rule {
              0% { transform: translateX(-120%); }
              100% { transform: translateX(330%); }
            }
          `}
        </style>
        <div className="relative h-px overflow-hidden bg-base-300" aria-hidden="true">
          <div
            className="absolute inset-y-0 left-0 w-1/3 bg-primary"
            style={{ animation: 'grainery-update-rule 1.35s ease-in-out infinite' }}
          />
        </div>
      </>
    );
  }

  return <div className="h-px bg-base-300" aria-hidden="true" />;
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
  const progressPercent = getProgressPercent(progress);
  const currentVersion = update?.currentVersion ?? packageJson.version;
  const releaseDate = formatDate(update?.date);
  const copy = getStatusCopy(status, update, currentVersion);
  const canDismiss = status !== 'installing';
  const detail = status === 'error' ? errorMessage ?? errorMessageFallback : copy.detail;

  return (
    <Modal
      onClose={canDismiss ? onClose : () => undefined}
      overlayClassName="backdrop-blur-[6px]"
      className="w-[min(25.75rem,calc(100vw-2rem))] !gap-0 rounded-[14px] border border-base-300 !bg-base-100 !px-8 !pb-6 !pt-8 text-base-content shadow-2xl"
    >
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
        <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-base-content/45">
          Grainery
        </span>
      </div>

      <h2 className="mt-6 font-mono text-[21px] font-bold leading-[1.25] tracking-normal text-base-content">
        {copy.title}
      </h2>

      <p className="mt-3 max-w-[18.5rem] text-[13px] leading-5 text-base-content/60">
        {detail}
      </p>

      {status === 'available' && update?.body && (
        <div className="mt-5 max-h-28 overflow-auto rounded-md border border-base-300 bg-base-200/50 px-3 py-2 font-mono text-[12px] leading-5 text-base-content/70 whitespace-pre-wrap">
          {update.body}
        </div>
      )}

      {status === 'available' && releaseDate && (
        <p className="mt-3 text-[11px] text-base-content/45">Published {releaseDate}</p>
      )}

      {status === 'installing' && progress && (
        <p className="mt-4 text-[11px] text-base-content/45">
          {progress.contentLength
            ? `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.contentLength)}`
            : `${formatBytes(progress.downloadedBytes)} downloaded`}
        </p>
      )}

      <div className="mt-7">
        <UpdateRule status={status} progressPercent={progressPercent} />
      </div>

      <div className="mt-8 flex justify-end gap-5">
        {status === 'checking' && (
          <button
            type="button"
            className="bg-transparent p-0 text-[13px] font-medium text-base-content/45 shadow-none transition-colors hover:text-base-content/70"
            onClick={onClose}
          >
            Cancel
          </button>
        )}

        {status === 'not-available' && (
          <>
            <button
              type="button"
              className="bg-transparent p-0 text-[13px] font-medium text-base-content/45 shadow-none transition-colors hover:text-base-content/70"
              onClick={onCheckAgain}
            >
              Check Again
            </button>
            <button
              type="button"
              className="bg-transparent p-0 text-[13px] font-medium text-primary shadow-none transition-colors hover:text-primary/80"
              onClick={onClose}
            >
              Done
            </button>
          </>
        )}

        {status === 'available' && (
          <>
            <button
              type="button"
              className="bg-transparent p-0 text-[13px] font-medium text-base-content/45 shadow-none transition-colors hover:text-base-content/70"
              onClick={onClose}
            >
              Later
            </button>
            <button
              type="button"
              className="bg-transparent p-0 text-[13px] font-medium text-primary shadow-none transition-colors hover:text-primary/80"
              onClick={onInstall}
            >
              Install
            </button>
          </>
        )}

        {status === 'installed' && (
          <button
            type="button"
            className="bg-transparent p-0 text-[13px] font-medium text-primary shadow-none transition-colors hover:text-primary/80"
            onClick={onRelaunch}
          >
            Restart
          </button>
        )}

        {status === 'error' && (
          <>
            <button
              type="button"
              className="bg-transparent p-0 text-[13px] font-medium text-base-content/45 shadow-none transition-colors hover:text-base-content/70"
              onClick={onClose}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="bg-transparent p-0 text-[13px] font-medium text-primary shadow-none transition-colors hover:text-primary/80"
              onClick={onCheckAgain}
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
