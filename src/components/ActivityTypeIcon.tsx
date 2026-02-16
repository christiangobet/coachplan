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
          <path d="M3.5 15.5h4l2.9-2.7 2.4 1.7h2.8l4 2.4" />
          <path d="M3.5 18h17" />
        </>
      );
      break;
    case 'STRENGTH':
      glyph = (
        <>
          <path d="M3.5 9v6M6 8v8M8.5 11.5h7M15.5 8v8M18 9v6" />
        </>
      );
      break;
    case 'CROSS_TRAIN':
      glyph = (
        <>
          <path d="M7.5 8h7" />
          <path d="M9 6.5L7.5 8 9 9.5" />
          <path d="M16.5 16h-7" />
          <path d="M15 14.5l1.5 1.5-1.5 1.5" />
          <circle cx="12" cy="12" r="1.2" />
        </>
      );
      break;
    case 'REST':
      glyph = <path d="M14.8 4.8a7 7 0 1 0 0 14 5.6 5.6 0 1 1 0-14z" />;
      break;
    case 'MOBILITY':
      glyph = (
        <>
          <circle cx="8.5" cy="6.8" r="1.2" />
          <circle cx="15.5" cy="17.2" r="1.2" />
          <path d="M9.3 7.7l2.9 2.8-2.1 2.1" />
          <path d="M10.1 15.2h5.1" />
        </>
      );
      break;
    case 'YOGA':
      glyph = (
        <>
          <circle cx="12" cy="6.7" r="1.3" />
          <path d="M8.3 11.8c1.2 1 2.4 1.5 3.7 1.5 1.3 0 2.5-.5 3.7-1.5" />
          <path d="M6.7 16c1.5-1.1 3.3-1.7 5.3-1.7s3.8.6 5.3 1.7" />
        </>
      );
      break;
    case 'HIKE':
      glyph = (
        <>
          <path d="M3.8 18l4.3-6.6 3 3.8 2.6-3.5 4.5 6.3" />
          <path d="M10.5 8.8l1.1-2.8" />
          <path d="M13.4 9.3v8.2" />
        </>
      );
      break;
    default:
      glyph = (
        <>
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="12" r="6.5" />
        </>
      );
  }

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyph}
    </svg>
  );
}
