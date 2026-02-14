import type { ReactNode } from 'react';

type ActivityTypeIconProps = {
  type: string | null | undefined;
  className?: string;
};

function normalizeType(type: string | null | undefined) {
  return String(type || 'OTHER').toUpperCase();
}

export default function ActivityTypeIcon({ type, className = '' }: ActivityTypeIconProps) {
  const normalized = normalizeType(type);

  let glyph: ReactNode;
  switch (normalized) {
    case 'RUN':
      glyph = (
        <>
          <circle cx="7" cy="4.8" r="1.4" />
          <path d="M8.3 6.3l2.2 1.7 2.7-.8" />
          <path d="M10.5 8l-2 2.5-2.4 1.1" />
          <path d="M10.4 8.3l1.7 2.7 2.8.3" />
        </>
      );
      break;
    case 'STRENGTH':
      glyph = (
        <>
          <path d="M4 7v6M6 6v8M14 6v8M16 7v6M6 10h8" />
        </>
      );
      break;
    case 'CROSS_TRAIN':
      glyph = (
        <>
          <path d="M6.3 8a4 4 0 016.9-1" />
          <path d="M13.2 5.5v2.8h-2.8" />
          <path d="M13.7 12a4 4 0 01-6.9 1" />
          <path d="M6.8 14.5v-2.8h2.8" />
        </>
      );
      break;
    case 'REST':
      glyph = <path d="M12.6 4.3A5.3 5.3 0 007.4 12a5.2 5.2 0 005.2 3.7 5.1 5.1 0 01-2.2-11.4z" />;
      break;
    case 'MOBILITY':
      glyph = (
        <>
          <circle cx="10" cy="4.8" r="1.4" />
          <path d="M10 6.4v4.1" />
          <path d="M10 7.9l-3-1.8" />
          <path d="M10 7.9l3-1.8" />
          <path d="M10 10.5l-2.8 3" />
          <path d="M10 10.5l2.8 3" />
        </>
      );
      break;
    case 'YOGA':
      glyph = (
        <>
          <circle cx="10" cy="4.8" r="1.4" />
          <path d="M6.4 8.6c1.2 1 2.3 1.5 3.6 1.5s2.4-.5 3.6-1.5" />
          <path d="M5.6 12.4c1.5-.9 2.9-1.4 4.4-1.4s2.9.5 4.4 1.4" />
          <path d="M7.3 14.4h5.4" />
        </>
      );
      break;
    case 'HIKE':
      glyph = (
        <>
          <path d="M3.2 14.5l3.6-5.8 2.7 3.8 2.2-3.1 4.9 5.1" />
          <path d="M7 8.7l1.3-3.2" />
          <circle cx="8.7" cy="4.9" r="1.2" />
        </>
      );
      break;
    default:
      glyph = <circle cx="10" cy="10" r="2.2" />;
  }

  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyph}
    </svg>
  );
}
