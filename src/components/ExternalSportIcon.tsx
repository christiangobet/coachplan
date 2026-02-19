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
          <path d="M3.5 15.5h4l2.9-2.7 2.4 1.7h2.8l4 2.4" />
          <path d="M3.5 18h17" />
        </>
      );
      break;
    case "RIDE":
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
    case "WALK_HIKE":
      glyph = (
        <>
          <circle cx="10" cy="6.9" r="1.2" />
          <path d="M10.1 8.4l1.9 2.1-1.1 2.6" />
          <path d="M9.4 12.2l-1.9 2.9" />
          <path d="M12.5 12.1l2.2 2.3" />
          <path d="M15.2 9.2v8.4" />
        </>
      );
      break;
    case "ALPINE_SKI":
      glyph = (
        <>
          <circle cx="9.7" cy="6.8" r="1.1" />
          <path d="M9.9 8.2l2.3 2.3-1.4 1.8" />
          <path d="M12.2 10.5l3.3 2.4" />
          <path d="M4 18.2l8.2-2.3" />
          <path d="M10.6 19.4l9.4-2.8" />
        </>
      );
      break;
    case "NORDIC_SKI":
      glyph = (
        <>
          <circle cx="9.3" cy="6.9" r="1.1" />
          <path d="M9.4 8.4l2.2 2.6" />
          <path d="M11.6 10.9l2.1 2.2" />
          <path d="M6 17.8h8.4" />
          <path d="M12.1 8.6v8.4" />
        </>
      );
      break;
    case "BACKCOUNTRY_SKI":
      glyph = (
        <>
          <path d="M3.8 13.8l3.4-3.7 2.4 2.5 3.6-4 4.9 5.4" />
          <circle cx="9.2" cy="6.9" r="1.1" />
          <path d="M9.5 8.4l2.1 2.2" />
          <path d="M5 18.2l8.8-2.6" />
        </>
      );
      break;
    case "SNOWBOARD":
      glyph = (
        <>
          <circle cx="9.3" cy="7" r="1.1" />
          <path d="M9.5 8.5l2.5 2.3" />
          <path d="M7.2 15.2h8.9" />
          <path d="M6.1 17.3c1.8 1.1 4 .8 5.9 0 1.9-.8 4.1-1.1 5.9 0" />
        </>
      );
      break;
    case "WORKOUT":
      glyph = <path d="M3.5 9v6M6 8v8M8.5 11.5h7M15.5 8v8M18 9v6" />;
      break;
    case "YOGA":
      glyph = (
        <>
          <circle cx="12" cy="6.7" r="1.3" />
          <path d="M8.3 11.8c1.2 1 2.4 1.5 3.7 1.5 1.3 0 2.5-.5 3.7-1.5" />
          <path d="M6.7 16c1.5-1.1 3.3-1.7 5.3-1.7s3.8.6 5.3 1.7" />
        </>
      );
      break;
    case "ROW":
      glyph = (
        <>
          <path d="M4.5 16.2h15" />
          <path d="M7.2 12.2l3.1 3.3" />
          <path d="M14.2 9.2l2 9" />
          <path d="M8.8 16.2c.8 1.1 1.9 1.7 3.2 1.7 1.3 0 2.4-.6 3.2-1.7" />
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
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glyph}
      </svg>
    </span>
  );
}
