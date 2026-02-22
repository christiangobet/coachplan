/**
 * Strava brand mark — two chevrons forming the "S" symbol.
 * Used inline to attribute Strava-sourced data.
 */
export default function StravaIcon({
  size = 16,
  className = ''
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Strava"
      role="img"
      className={className}
    >
      {/* White circle with orange outline */}
      <circle cx="12" cy="12" r="11" fill="white" stroke="#FC4C02" strokeWidth="1.5" />
      {/* Upper chevron */}
      <path d="M10.5 3L15 11.5H12L10.5 9L9 11.5H6L10.5 3Z" fill="#FC4C02" />
      {/* Lower chevron */}
      <path d="M13.5 11.5L18 20H15L13.5 17.5L12 20H9L13.5 11.5Z" fill="#FC4C02" opacity="0.65" />
    </svg>
  );
}
