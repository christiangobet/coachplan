"use client";

import React from "react";
import ActivityTypeIcon from "@/components/ActivityTypeIcon";

type ActivityType =
  | "RUN"
  | "STRENGTH"
  | "CROSS_TRAIN"
  | "REST"
  | "MOBILITY"
  | "YOGA"
  | "HIKE"
  | "OTHER";

type ActivityPriority = "KEY" | "MEDIUM" | "OPTIONAL";
type Units = "MILES" | "KM";

export interface WorkoutDetailCardProps {
  id?: string;
  title: string;
  type?: ActivityType;
  subtype?: string;
  date?: Date | string;
  weekLabel?: string;

  // Planned metrics
  distance?: number;
  distanceUnit?: Units;
  duration?: number; // minutes
  paceTarget?: string;
  effortTarget?: string;
  notes?: string;

  // Status
  priority?: ActivityPriority;
  mustDo?: boolean;
  bailAllowed?: boolean;
  completed?: boolean;
  completedAt?: Date | string;

  // Actuals logged by athlete
  actualDistance?: number;
  actualDuration?: number;
  actualPace?: string;

  // Callbacks (used in standalone contexts)
  onComplete?: () => void;
  onEdit?: () => void;

  // Slot for injecting a custom footer (e.g. CalendarActivityLogger)
  // When provided, replaces the default Log/Edit buttons.
  footer?: React.ReactNode;
}

// ── Config tables ───────────────────────────────────────────────────────────

const PRIORITY = {
  KEY:      { color: "#fc4c02", label: "KEY",      bg: "rgba(252,76,2,0.14)",    border: "rgba(252,76,2,0.25)"    },
  MEDIUM:   { color: "#0984e3", label: "MEDIUM",   bg: "rgba(9,132,227,0.12)",   border: "rgba(9,132,227,0.25)"   },
  OPTIONAL: { color: "#6b6b76", label: "OPTIONAL", bg: "rgba(107,107,118,0.12)", border: "rgba(107,107,118,0.22)" },
} as const;

const TYPE = {
  RUN:         { color: "#fc4c02", label: "Run"         },
  STRENGTH:    { color: "#7c5ce7", label: "Strength"    },
  CROSS_TRAIN: { color: "#0984e3", label: "Cross-Train" },
  REST:        { color: "#95a5a6", label: "Rest Day"    },
  MOBILITY:    { color: "#00b894", label: "Mobility"    },
  YOGA:        { color: "#fd79a8", label: "Yoga"        },
  HIKE:        { color: "#00cec9", label: "Hike"        },
  OTHER:       { color: "#b2bec3", label: "Workout"     },
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return [{ n: String(m), u: "min" }];
  if (m === 0) return [{ n: String(h), u: "h" }];
  return [{ n: String(h), u: "h" }, { n: String(m), u: "m" }];
}

function fmtDist(d: number, unit: Units) {
  return `${d % 1 === 0 ? d : d.toFixed(1)} ${unit === "MILES" ? "mi" : "km"}`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function CompletionBar({ planned, actual }: { planned: number; actual: number }) {
  const pct = Math.min((actual / planned) * 100, 105);
  const barColor = pct >= 95 ? "#2ecc71" : pct >= 75 ? "#f39c12" : "#e74c3c";
  return (
    <div style={{ marginTop: 9 }}>
      <div
        style={{
          height: 3,
          background: "#ebebeb",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            background: barColor,
            borderRadius: 2,
            transition: "width 0.9s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          color: barColor,
          fontWeight: 700,
          marginTop: 4,
          letterSpacing: "0.04em",
        }}
      >
        {Math.round(pct)}% of target
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function WorkoutDetailCard({
  title,
  type = "RUN",
  subtype,
  date,
  weekLabel,
  distance,
  distanceUnit = "MILES",
  duration,
  paceTarget,
  effortTarget,
  notes,
  priority = "MEDIUM",
  mustDo = false,
  bailAllowed = false,
  completed = false,
  completedAt,
  actualDistance,
  actualDuration,
  actualPace,
  onComplete,
  onEdit,
  footer,
}: WorkoutDetailCardProps) {
  const p = PRIORITY[priority];
  const t = TYPE[type];

  const hasActuals = completed && (actualDistance !== undefined || actualDuration !== undefined || actualPace);
  const hasMetrics = distance !== undefined || duration !== undefined || paceTarget;

  const formattedDate = date
    ? new Date(date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : null;

  const duParts = duration !== undefined ? fmtDuration(duration) : null;
  const actualDuParts = actualDuration !== undefined ? fmtDuration(actualDuration) : null;

  return (
    <div
      style={{
        fontFamily: "Figtree, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "#ffffff",
        borderRadius: 14,
        boxShadow:
          "0 4px 20px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.06)",
        overflow: "hidden",
        width: "100%",
        borderLeft: `4px solid ${p.color}`,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* ── HEADER ── */}
      <div
        style={{
          background: "linear-gradient(145deg, #1d1d23 0%, #131317 100%)",
          padding: "22px 20px 20px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ghost icon backdrop */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -10,
            bottom: -14,
            width: 96,
            height: 96,
            opacity: 0.055,
            color: "#ffffff",
            pointerEvents: "none",
          }}
        >
          <ActivityTypeIcon type={type} />
        </div>

        {/* Type label + Priority badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 11,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.09em",
              color: t.color,
              textTransform: "uppercase",
            }}
          >
            {t.label}
            {subtype && (
              <span style={{ opacity: 0.65, fontWeight: 600 }}> · {subtype}</span>
            )}
          </span>

          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.1em",
              padding: "3px 9px",
              borderRadius: 20,
              background: p.bg,
              color: p.color,
              textTransform: "uppercase",
              border: `1px solid ${p.border}`,
              flexShrink: 0,
            }}
          >
            {mustDo ? "★ MUST DO" : priority === "KEY" ? "⚡ KEY" : p.label}
          </span>
        </div>

        {/* Title */}
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 800,
            color: "#ffffff",
            lineHeight: 1.15,
            letterSpacing: "-0.028em",
          }}
        >
          {title}
        </h2>

        {/* Date / week */}
        {(formattedDate || weekLabel) && (
          <p
            style={{
              margin: "7px 0 0",
              fontSize: 12,
              color: "rgba(255,255,255,0.35)",
              fontWeight: 500,
              letterSpacing: "0.01em",
            }}
          >
            {weekLabel && <span>{weekLabel}</span>}
            {weekLabel && formattedDate && " · "}
            {formattedDate}
          </p>
        )}
      </div>

      {/* ── METRICS STRIP ── */}
      {hasMetrics && (
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #efefef",
          }}
        >
          {/* Distance */}
          {distance !== undefined && (
            <div
              style={{
                flex: 1,
                padding: "15px 15px 13px",
                borderRight: "1px solid #efefef",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "#a0a0ad",
                  textTransform: "uppercase",
                  marginBottom: 5,
                }}
              >
                Distance
              </div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: "#18181f",
                  letterSpacing: "-0.045em",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 3,
                }}
              >
                {distance % 1 === 0 ? distance : distance.toFixed(1)}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#a0a0ad",
                    letterSpacing: 0,
                  }}
                >
                  {distanceUnit === "MILES" ? "mi" : "km"}
                </span>
              </div>

              {hasActuals && actualDistance !== undefined && (
                <>
                  <CompletionBar planned={distance} actual={actualDistance} />
                  <div
                    style={{
                      fontSize: 11,
                      color: "#5e5e6e",
                      marginTop: 4,
                      fontWeight: 500,
                    }}
                  >
                    {fmtDist(actualDistance, distanceUnit)} actual
                  </div>
                </>
              )}
            </div>
          )}

          {/* Duration */}
          {duParts && (
            <div
              style={{
                flex: 1,
                padding: "15px 15px 13px",
                borderRight: paceTarget ? "1px solid #efefef" : undefined,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "#a0a0ad",
                  textTransform: "uppercase",
                  marginBottom: 5,
                }}
              >
                Duration
              </div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: "#18181f",
                  letterSpacing: "-0.045em",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 1,
                }}
              >
                {duParts.map((seg, i) => (
                  <span key={i}>
                    {seg.n}
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#a0a0ad",
                        letterSpacing: 0,
                      }}
                    >
                      {seg.u}
                    </span>
                    {i < duParts.length - 1 && <span>&nbsp;</span>}
                  </span>
                ))}
              </div>

              {hasActuals && actualDuration !== undefined && duration !== undefined && (
                <>
                  <CompletionBar planned={duration} actual={actualDuration} />
                  <div
                    style={{
                      fontSize: 11,
                      color: "#5e5e6e",
                      marginTop: 4,
                      fontWeight: 500,
                    }}
                  >
                    {actualDuParts!.map((s) => `${s.n}${s.u}`).join(" ")} actual
                  </div>
                </>
              )}
            </div>
          )}

          {/* Pace */}
          {paceTarget && (
            <div style={{ flex: 1, padding: "15px 15px 13px" }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "#a0a0ad",
                  textTransform: "uppercase",
                  marginBottom: 5,
                }}
              >
                Pace
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: "#18181f",
                  letterSpacing: "-0.03em",
                  lineHeight: 1.1,
                }}
              >
                {paceTarget}
              </div>

              {hasActuals && actualPace && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#2ecc71",
                    fontWeight: 700,
                    marginTop: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <svg
                    width={10}
                    height={10}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {actualPace}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── EFFORT TARGET ── */}
      {effortTarget && (
        <div
          style={{
            padding: "11px 16px",
            background: "#fafafa",
            borderBottom: "1px solid #efefef",
            display: "flex",
            alignItems: "baseline",
            gap: 10,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "#a0a0ad",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            Effort
          </span>
          <span style={{ fontSize: 13, color: "#3e3e4a", fontWeight: 500, lineHeight: 1.5 }}>
            {effortTarget}
          </span>
        </div>
      )}

      {/* ── NOTES ── */}
      {notes && (
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #efefef" }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "#a0a0ad",
              textTransform: "uppercase",
              marginBottom: 7,
            }}
          >
            Coach Notes
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "#4e4e5c",
              lineHeight: 1.65,
              borderLeft: "2px solid #efefef",
              paddingLeft: 10,
            }}
          >
            {notes}
          </p>
        </div>
      )}

      {/* ── COMPLETION BANNER ── */}
      {completed && (
        <div
          style={{
            padding: "11px 16px",
            background:
              "linear-gradient(90deg, rgba(46,204,113,0.08) 0%, transparent 70%)",
            borderBottom: "1px solid rgba(46,204,113,0.15)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {/* Check circle */}
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#2ecc71",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 0 0 3px rgba(46,204,113,0.15)",
            }}
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#2ecc71",
                letterSpacing: "0.03em",
              }}
            >
              Completed
            </div>
            {completedAt && (
              <div style={{ fontSize: 11, color: "#a0a0ad", marginTop: 1 }}>
                {new Date(completedAt).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </div>
            )}
          </div>

          {bailAllowed && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 700,
                color: "#f39c12",
                letterSpacing: "0.06em",
                background: "rgba(243,156,18,0.1)",
                border: "1px solid rgba(243,156,18,0.22)",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              BAIL OK
            </span>
          )}
        </div>
      )}

      {/* ── ACTIONS / FOOTER ── */}
      {footer ? (
        <div style={{ padding: "12px 14px 14px" }}>{footer}</div>
      ) : (
        <div style={{ padding: "12px 14px", display: "flex", gap: 8 }}>
          {!completed && onComplete && (
            <button
              onClick={onComplete}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: "#fc4c02",
                color: "#ffffff",
                border: "none",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "Figtree, sans-serif",
                letterSpacing: "0.01em",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = "#e54400")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = "#fc4c02")
              }
            >
              Log Workout
            </button>
          )}

          {completed && onComplete && (
            <button
              onClick={onComplete}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: "transparent",
                color: "#5e5e6e",
                border: "1px solid #e5e5e5",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "Figtree, sans-serif",
                transition: "border-color 0.15s",
              }}
            >
              Update Actuals
            </button>
          )}

          {onEdit && (
            <button
              onClick={onEdit}
              style={{
                padding: "10px 16px",
                background: "transparent",
                color: "#5e5e6e",
                border: "1px solid #e5e5e5",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "Figtree, sans-serif",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.borderColor = "#242428")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.borderColor = "#e5e5e5")
              }
            >
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
