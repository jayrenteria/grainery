import type { RenderedEditorLandmark } from '../../plugins';

interface PluginLandmarkRailProps {
  landmarks: RenderedEditorLandmark[];
  onJump: (position: number) => void;
}

export function PluginLandmarkRail({ landmarks, onJump }: PluginLandmarkRailProps) {
  if (landmarks.length === 0) {
    return null;
  }

  return (
    <nav className="plugin-landmark-rail" aria-label="Document map">
      <div className="plugin-landmark-track">
        {landmarks.map((landmark) => (
          <button
            key={landmark.id}
            type="button"
            className={`plugin-landmark-tick${landmark.active ? ' is-active' : ''}`}
            style={{ top: `${Math.min(1, Math.max(0, landmark.ratio)) * 100}%` }}
            aria-label={landmark.label}
            aria-current={landmark.active ? 'location' : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onJump(landmark.position)}
          >
            <span className="plugin-landmark-tick-mark" aria-hidden="true" />
            <span className="plugin-landmark-tooltip" role="tooltip">
              {landmark.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
