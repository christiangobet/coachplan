import Image from "next/image";
import { type ExternalSportVisualCode, getExternalSportVisual } from "@/lib/integrations/external-sport-visuals";

type ExternalSportIconProps = {
  provider: string | null | undefined;
  sportType: string | null | undefined;
  className?: string;
};

const ICON_SRC_BY_CODE: Record<ExternalSportVisualCode, string> = {
  RUN: "/branding/strava_icon/run.png",
  TRAIL_RUN: "/branding/strava_icon/trail_run.png",
  WALK: "/branding/strava_icon/walk.png",
  STRENGTH: "/branding/strava_icon/strength.png",
  CROSS_TRAIN: "/branding/strava_icon/cross_train.png",
  REST: "/branding/strava_icon/rest.png",
  BIKE: "/branding/strava_icon/bike.png",
  SWIM: "/branding/strava_icon/swim.png",
  HIKE: "/branding/strava_icon/hike.png",
  TREADMILL_RUN: "/branding/strava_icon/treadmill_run.png",
  YOGA_MOBILITY: "/branding/strava_icon/yoga_mobility.png",
  VIRTUAL_RIDE: "/branding/strava_icon/virtual_ride.png",
  SKI: "/branding/strava_icon/ski.png",
  OTHER: "/branding/strava_icon/other.png"
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
  const src = ICON_SRC_BY_CODE[visual.code] || ICON_SRC_BY_CODE.OTHER;
  const classes = ["ext-sport-icon", `ext-sport-${toToken(visual.code)}`, className].filter(Boolean).join(" ");

  return (
    <span className={classes} role="img" aria-label={visual.ariaLabel} title={visual.label}>
      <Image
        className="ext-sport-icon-img"
        src={src}
        alt=""
        width={48}
        height={48}
        aria-hidden="true"
      />
    </span>
  );
}
