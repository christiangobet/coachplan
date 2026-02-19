export type ExternalSportVisualCode =
  | "RUN"
  | "RIDE"
  | "SWIM"
  | "WALK_HIKE"
  | "ALPINE_SKI"
  | "NORDIC_SKI"
  | "BACKCOUNTRY_SKI"
  | "SNOWBOARD"
  | "WORKOUT"
  | "YOGA"
  | "ROW"
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

  if (normalized.includes("ALPINE_SKI")) return "ALPINE_SKI";
  if (normalized.includes("BACKCOUNTRY_SKI")) return "BACKCOUNTRY_SKI";
  if (normalized.includes("NORDIC_SKI") || normalized.includes("CROSS_COUNTRY_SKI")) return "NORDIC_SKI";
  if (normalized.includes("SNOWBOARD")) return "SNOWBOARD";
  if (normalized.includes("RUN")) return "RUN";
  if (normalized.includes("RIDE") || normalized.includes("BIKE") || normalized.includes("CYCL")) return "RIDE";
  if (normalized.includes("SWIM")) return "SWIM";
  if (normalized.includes("WALK") || normalized.includes("HIKE")) return "WALK_HIKE";
  if (normalized.includes("YOGA")) return "YOGA";
  if (normalized.includes("ROW")) return "ROW";
  if (
    normalized.includes("WORKOUT")
    || normalized.includes("WEIGHT")
    || normalized.includes("ELLIPTICAL")
    || normalized.includes("STAIR")
    || normalized.includes("STEPPER")
    || normalized.includes("TRAINING")
  ) {
    return "WORKOUT";
  }

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
    RIDE: "Ride",
    SWIM: "Swim",
    WALK_HIKE: "Walk / Hike",
    ALPINE_SKI: "Alpine Ski",
    NORDIC_SKI: "Nordic Ski",
    BACKCOUNTRY_SKI: "Backcountry Ski",
    SNOWBOARD: "Snowboard",
    WORKOUT: "Workout",
    YOGA: "Yoga",
    ROW: "Row",
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
