import type { BuiltinIconId } from '../types';

interface IconProps {
  className?: string;
}

function IconBase({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-4 w-4'}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function PluginIcon({ icon, className }: { icon: BuiltinIconId; className?: string }) {
  switch (icon) {
    case 'scene-heading':
      return (
        <IconBase className={className}>
          <path d="M2 4h12" />
          <path d="M2 8h9" />
          <path d="M2 12h12" />
        </IconBase>
      );
    case 'action':
      return (
        <IconBase className={className}>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
        </IconBase>
      );
    case 'character':
      return (
        <IconBase className={className}>
          <circle cx="8" cy="5" r="2" />
          <path d="M4 13c.7-2 2.1-3 4-3s3.3 1 4 3" />
        </IconBase>
      );
    case 'dialogue':
      return (
        <IconBase className={className}>
          <rect x="2" y="3" width="9" height="7" rx="1.5" />
          <path d="M6 10v3l2-2h3" />
        </IconBase>
      );
    case 'parenthetical':
      return (
        <IconBase className={className}>
          <path d="M5 3c-1.5 1.2-2.2 2.8-2.2 5s.7 3.8 2.2 5" />
          <path d="M11 3c1.5 1.2 2.2 2.8 2.2 5s-.7 3.8-2.2 5" />
        </IconBase>
      );
    case 'transition':
      return (
        <IconBase className={className}>
          <path d="M2 8h10" />
          <path d="M9 5l3 3-3 3" />
        </IconBase>
      );
    case 'chevron-left':
      return (
        <IconBase className={className}>
          <path d="M10 3L5 8l5 5" />
        </IconBase>
      );
    case 'chevron-right':
      return (
        <IconBase className={className}>
          <path d="M6 3l5 5-5 5" />
        </IconBase>
      );
    case 'panel':
      return (
        <IconBase className={className}>
          <rect x="2" y="3" width="12" height="10" rx="1" />
          <path d="M9 3v10" />
        </IconBase>
      );
    case 'close':
      return (
        <IconBase className={className}>
          <path d="M4 4l8 8" />
          <path d="M12 4l-8 8" />
        </IconBase>
      );
    case 'settings':
      return (
        <IconBase className={className}>
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 2.5v1.2M8 12.3v1.2M12.3 8h1.2M2.5 8h1.2M11.1 4.9l.9-.9M4 12l.9-.9M11.1 11.1l.9.9M4 4l.9.9" />
        </IconBase>
      );
    case 'spark':
      return (
        <IconBase className={className}>
          <path d="M8 2l1.2 3.1L12.5 6 9.2 7.2 8 10.5 6.8 7.2 3.5 6l3.3-.9L8 2Z" />
        </IconBase>
      );
    default:
      return (
        <IconBase className={className}>
          <circle cx="8" cy="8" r="3" />
        </IconBase>
      );
  }
}
