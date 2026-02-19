export type ExternalSportVisualCode =
  | "RUN"
  | "TRAIL_RUN"
  | "WALK"
  | "STRENGTH"
  | "CROSS_TRAIN"
  | "REST"
  | "BIKE"
  | "SWIM"
  | "HIKE"
  | "TREADMILL_RUN"
  | "YOGA_MOBILITY"
  | "VIRTUAL_RIDE"
  | "SKI"
  | "OTHER";

export type ExternalSportVisual = {
  code: ExternalSportVisualCode;
  label: string;
  ariaLabel: string;
};

function normalizeSportType(value: string | null | undefined) {
  if (!value) return "";
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

export function mapStravaSportTypeToVisualCode(sportType: string | null | undefined): ExternalSportVisualCode {
  const normalized = normalizeSportType(sportType);
  if (!normalized) return "OTHER";

  if (normalized.includes("TRAIL_RUN")) return "TRAIL_RUN";
  if (normalized.includes("TREADMILL")) return "TREADMILL_RUN";
  if (normalized.includes("VIRTUAL_RIDE") || normalized.includes("VIRTUAL_CYCLING")) return "VIRTUAL_RIDE";
  if (normalized.includes("REST") || normalized.includes("SLEEP")) return "REST";
  if (normalized.includes("WALK")) return "WALK";
  if (normalized.includes("HIKE")) return "HIKE";
  if (normalized.includes("RUN")) return "RUN";
  if (
    normalized.includes("WEIGHT")
    || normalized.includes("WORKOUT")
    || normalized.includes("TRAINING")
    || normalized.includes("CROSSFIT")
  ) {
    return "STRENGTH";
  }
  if (
    normalized.includes("ELLIPTICAL")
    || normalized.includes("STAIR")
    || normalized.includes("STEPPER")
    || normalized.includes("ROW")
    || normalized.includes("PADDLE")
  ) {
    return "CROSS_TRAIN";
  }
  if (normalized.includes("RIDE") || normalized.includes("BIKE") || normalized.includes("CYCL")) return "BIKE";
  if (normalized.includes("SWIM")) return "SWIM";
  if (normalized.includes("YOGA") || normalized.includes("PILATES") || normalized.includes("MOBILITY")) return "YOGA_MOBILITY";
  if (normalized.includes("SKI") || normalized.includes("SNOWBOARD")) return "SKI";

  return "OTHER";
}

export function getExternalSportVisual(
  provider: string | null | undefined,
  sportType: string | null | undefined
): ExternalSportVisual {
  const normalizedProvider = String(provider || "").trim().toUpperCase();
  const code = normalizedProvider === "STRAVA" ? mapStravaSportTypeToVisualCode(sportType) : "OTHER";

  const labelByCode: Record<ExternalSportVisualCode, string> = {
    RUN: "Run",
    TRAIL_RUN: "Trail Run",
    WALK: "Walk",
    STRENGTH: "Strength",
    CROSS_TRAIN: "Cross Training",
    REST: "Rest",
    BIKE: "Bike",
    SWIM: "Swim",
    HIKE: "Hike",
    TREADMILL_RUN: "Treadmill Run",
    YOGA_MOBILITY: "Yoga / Mobility",
    VIRTUAL_RIDE: "Virtual Ride",
    SKI: "Ski",
    OTHER: "External Activity"
  };

  return {
    code,
    label: labelByCode[code],
    ariaLabel: normalizedProvider === "STRAVA"
      ? `Strava ${labelByCode[code]}`
      : labelByCode[code]
  };
}
