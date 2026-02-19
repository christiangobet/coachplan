import type { ReactNode } from "react";
import { getExternalSportVisual } from "@/lib/integrations/external-sport-visuals";

type ExternalSportIconProps = {
  provider: string | null | undefined;
  sportType: string | null | undefined;
  className?: string;
};

function toToken(value: string) {
  return value.toLowerCase().replace(/_/g, "-");
}

export default function ExternalSportIcon({
  provider,
  sportType,
  className = ""
}: ExternalSportIconProps) {
  const visual = getExternalSportVisual(provider, sportType);

  let glyph: ReactNode;
  switch (visual.code) {
    case "RUN":
      glyph = (
        <>
          <circle cx="9.1" cy="6.7" r="1.4" />
          <path d="M8.8 8.3l2.5 1.4-1.2 2.7" />
          <path d="M7.8 11.1l-2.5 1.2-.8 4.1" />
          <path d="M10.7 12.6l3.1 1.9 2.7-1.4" />
          <path d="M9.8 14.2l-1.4 3.5 3.3.2" />
        </>
      );
      break;
    case "TRAIL_RUN":
      glyph = (
        <>
          <circle cx="8.8" cy="6.6" r="1.3" />
          <path d="M8.7 8.1l2.1 1.4-1.1 2.6" />
          <path d="M7.7 10.8l-2.3 1.6" />
          <path d="M5 18.1l4.1-1.6 3.2.8 4.6-2.6" />
          <path d="M13.4 6.4l2.4-.8v2.6" />
        </>
      );
      break;
    case "WALK":
      glyph = (
        <>
          <circle cx="10.1" cy="6.7" r="1.4" />
          <path d="M10 8.5l1.2 2.2" />
          <path d="M11.2 10.7l2.6 1.4" />
          <path d="M9.2 10.8l-1.7 2.8" />
          <path d="M10.4 13l-2 4" />
        </>
      );
      break;
    case "STRENGTH":
      glyph = (
        <>
          <path d="M3.8 10.1v3.8M6 9v6" />
          <path d="M8.2 12h7.6" />
          <path d="M18 9v6M20.2 10.1v3.8" />
          <path d="M11.8 15.8c1.1 0 2.1.4 2.9 1" />
        </>
      );
      break;
    case "CROSS_TRAIN":
      glyph = (
        <>
          <path d="M4.2 14.8h15.6" />
          <path d="M6.2 11.4h3.3M7.9 9.7v3.3" />
          <path d="M14.5 11.4h3.3M16.2 9.7v3.3" />
          <path d="M9.8 17.9h4.4" />
        </>
      );
      break;
    case "REST":
      glyph = (
        <>
          <path d="M4.3 15.9h15.4" />
          <path d="M6.2 15.9V9.6h11.6v6.3" />
          <path d="M8.7 12.8h2.8" />
          <path d="M13 12.2h2.6" />
          <path d="M16.6 6.6c.8.3 1.3.9 1.5 1.8" />
        </>
      );
      break;
    case "BIKE":
      glyph = (
        <>
          <circle cx="7.2" cy="16.3" r="2.2" />
          <circle cx="16.8" cy="16.3" r="2.2" />
          <path d="M7.2 16.3l3.1-5.1h3.6l2.9 5.1M10.3 11.2l2.1 2.3" />
          <path d="M15.8 9.4h2.1" />
        </>
      );
      break;
    case "SWIM":
      glyph = (
        <>
          <circle cx="8.3" cy="8.2" r="1.5" />
          <path d="M10.2 10.4l3.5 1.2" />
          <path d="M3.5 14.2c1.4 1 2.8 1 4.2 0s2.8-1 4.2 0 2.8 1 4.2 0 2.8-1 4.2 0" />
          <path d="M3.5 17.2c1.4 1 2.8 1 4.2 0s2.8-1 4.2 0 2.8 1 4.2 0 2.8-1 4.2 0" />
        </>
      );
      break;
    case "HIKE":
      glyph = (
        <>
          <path d="M3.8 13.8l3.4-3.7 2.4 2.5 3.6-4 4.9 5.4" />
          <circle cx="9.2" cy="6.9" r="1.1" />
          <path d="M9.5 8.4l2.1 2.2" />
          <path d="M5 18.2l8.8-2.6" />
        </>
      );
      break;
    case "TREADMILL_RUN":
      glyph = (
        <>
          <path d="M4.5 17.8h15" />
          <path d="M6.2 15.8h11.3" />
          <circle cx="9.2" cy="7.1" r="1.2" />
          <path d="M9.2 8.6l2.2 1.3-1 2.2" />
          <path d="M8.3 11.2l-2.1 1.8" />
          <path d="M10.3 12.2l2.7 1.6" />
        </>
      );
      break;
    case "YOGA_MOBILITY":
      glyph = (
        <>
          <circle cx="12" cy="6.8" r="1.4" />
          <path d="M8 11.8c1.2 1 2.5 1.4 4 1.4s2.8-.4 4-1.4" />
          <path d="M7.2 16.4c1.5-1.1 3.2-1.6 4.8-1.6s3.3.5 4.8 1.6" />
          <path d="M9.6 18.4h4.8" />
        </>
      );
      break;
    case "VIRTUAL_RIDE":
      glyph = (
        <>
          <circle cx="7.1" cy="16.5" r="1.8" />
          <circle cx="12.3" cy="16.5" r="1.8" />
          <path d="M7.1 16.5l2.1-3.5h2.4l2 3.5" />
          <path d="M14.9 7.5h5.6v4.1h-5.6z" />
          <path d="M16.2 9.6h3.1" />
        </>
      );
      break;
    case "SKI":
      glyph = (
        <>
          <circle cx="9.2" cy="6.9" r="1.1" />
          <path d="M9.4 8.4l2.3 2.2-1.3 2" />
          <path d="M12.2 10.7l3.3 2.1" />
          <path d="M4.2 18.4l8.5-2.4" />
          <path d="M10.8 19.4l9-2.7" />
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

  const classes = ["ext-sport-icon", `ext-sport-${toToken(visual.code)}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} role="img" aria-label={visual.ariaLabel} title={visual.label}>
      <svg
        className="ext-sport-icon-glyph"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.05"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glyph}
      </svg>
    </span>
  );
}
