/**
 * Strava brand icon — orange square with the official "S" chevron mark.
 * Matches the Strava app icon used on Android/iOS.
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
      {/* Orange square background */}
      <rect width="24" height="24" rx="4" fill="#FC4C02" />
      {/* Official Strava "S" chevron mark, scaled and centered */}
      <path
        transform="translate(2.44 3) scale(.75)"
        d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0 5 13.828h4.172"
        fill="white"
      />
    </svg>
  );
}
