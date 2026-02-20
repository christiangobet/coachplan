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

// ── Design tokens (matching globals.css) ────────────────────────────────────

const INK     = "#242428";
const MUTED   = "#6b6b76";
const ACCENT  = "#fc4c02";
const ACCENT_STRONG = "#e54400";
const PANEL   = "#f3f3f3";
const BORDER  = "#e5e5e5";
const GREEN   = "#2ecc71";
const AMBER   = "#f39c12";
const RED     = "#e74c3c";
const BLUE    = "#0984e3";

const TYPE_COLOR: Record<ActivityType, string> = {
  RUN:         ACCENT,
  STRENGTH:    "#6c5ce7",
  CROSS_TRAIN: BLUE,
  REST:        "#95a5a6",
  MOBILITY:    "#00b894",
  YOGA:        "#fd79a8",
  HIKE:        "#00cec9",
  OTHER:       MUTED,
};

const TYPE_LABEL: Record<ActivityType, string> = {
  RUN:         "Run",
  STRENGTH:    "Strength",
  CROSS_TRAIN: "Cross-Train",
  REST:        "Rest Day",
  MOBILITY:    "Mobility",
  YOGA:        "Yoga",
  HIKE:        "Hike",
  OTHER:       "Workout",
};

const PRIORITY_COLOR: Record<ActivityPriority, string> = {
  KEY:      ACCENT,
  MEDIUM:   BLUE,
  OPTIONAL: MUTED,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtDist(d: number, unit: Units) {
  return `${d % 1 === 0 ? d : d.toFixed(1)} ${unit === "MILES" ? "mi" : "km"}`;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function CompletionBar({ planned, actual }: { planned: number; actual: number }) {
  const pct = Math.min((actual / planned) * 100, 105);
  const color = pct >= 95 ? GREEN : pct >= 75 ? AMBER : RED;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: 4, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            background: color,
            borderRadius: 2,
            transition: "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
      <div style={{ fontSize: 11, color, fontWeight: 700, marginTop: 3, letterSpacing: "0.02em" }}>
        {Math.round(pct)}% of target
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

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
  const typeColor = TYPE_COLOR[type];
  const priorityColor = PRIORITY_COLOR[priority];

  const hasActuals = completed && (
    actualDistance !== undefined || actualDuration !== undefined || actualPace
  );
  const hasMetrics = distance !== undefined || duration !== undefined || paceTarget;

  const formattedDate = date
    ? new Date(date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div
      style={{
        fontFamily: "Figtree, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "#ffffff",
        borderRadius: 12,
        border: `1px solid ${BORDER}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
        overflow: "hidden",
        width: "100%",
        borderLeft: `3px solid ${typeColor}`,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* ── HEADER ── */}
      <div style={{ padding: "14px 16px 12px" }}>
        {/* Type row */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          {/* Icon pill */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              background: `${typeColor}18`,
              color: typeColor,
              flexShrink: 0,
            }}
          >
            <span style={{ width: 16, height: 16, display: "flex" }}>
              <ActivityTypeIcon type={type} />
            </span>
          </span>

          {/* Type label */}
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: typeColor,
              letterSpacing: "0.01em",
            }}
          >
            {TYPE_LABEL[type]}
            {subtype && (
              <span style={{ color: MUTED, fontWeight: 600 }}> · {subtype}</span>
            )}
          </span>

          {/* Priority badge */}
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.08em",
              padding: "2px 8px",
              borderRadius: 999,
              background: `${priorityColor}14`,
              color: priorityColor,
              textTransform: "uppercase" as const,
              border: `1px solid ${priorityColor}30`,
              flexShrink: 0,
            }}
          >
            {mustDo ? "★ MUST DO" : priority === "KEY" ? "⚡ Key" : priority === "MEDIUM" ? "Medium" : "Optional"}
          </span>
        </div>

        {/* Title */}
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 800,
            color: INK,
            lineHeight: 1.2,
            letterSpacing: "-0.015em",
          }}
        >
          {title}
        </h3>

        {/* Date / week */}
        {(formattedDate || weekLabel) && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: MUTED,
              fontWeight: 500,
            }}
          >
            {weekLabel && <span>{weekLabel}</span>}
            {weekLabel && formattedDate && " · "}
            {formattedDate}
          </p>
        )}
      </div>

      {/* ── METRICS ── */}
      {hasMetrics && (
        <div
          style={{
            display: "flex",
            background: PANEL,
            borderTop: `1px solid ${BORDER}`,
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          {distance !== undefined && (
            <div
              style={{
                flex: 1,
                padding: "11px 14px",
                borderRight: `1px solid ${BORDER}`,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: MUTED,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase" as const,
                  marginBottom: 3,
                }}
              >
                Distance
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: INK,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 2,
                }}
              >
                {distance % 1 === 0 ? distance : distance.toFixed(1)}
                <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>
                  {distanceUnit === "MILES" ? "mi" : "km"}
                </span>
              </div>
              {hasActuals && actualDistance !== undefined && (
                <>
                  <CompletionBar planned={distance} actual={actualDistance} />
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                    {fmtDist(actualDistance, distanceUnit)} logged
                  </div>
                </>
              )}
            </div>
          )}

          {duration !== undefined && (
            <div
              style={{
                flex: 1,
                padding: "11px 14px",
                borderRight: paceTarget ? `1px solid ${BORDER}` : undefined,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: MUTED,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase" as const,
                  marginBottom: 3,
                }}
              >
                Time
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: INK,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                {fmtDuration(duration)}
              </div>
              {hasActuals && actualDuration !== undefined && duration !== undefined && (
                <>
                  <CompletionBar planned={duration} actual={actualDuration} />
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                    {fmtDuration(actualDuration)} logged
                  </div>
                </>
              )}
            </div>
          )}

          {paceTarget && (
            <div style={{ flex: 1, padding: "11px 14px" }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: MUTED,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase" as const,
                  marginBottom: 3,
                }}
              >
                Pace
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: INK,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                {paceTarget}
              </div>
              {hasActuals && actualPace && (
                <div
                  style={{
                    fontSize: 11,
                    color: GREEN,
                    fontWeight: 700,
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {actualPace} logged
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
            padding: "9px 16px",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            gap: 10,
            alignItems: "baseline",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: MUTED,
              letterSpacing: "0.09em",
              textTransform: "uppercase" as const,
              flexShrink: 0,
              paddingTop: 1,
            }}
          >
            Effort
          </span>
          <span style={{ fontSize: 13, color: INK, fontWeight: 500, lineHeight: 1.5 }}>
            {effortTarget}
          </span>
        </div>
      )}

      {/* ── NOTES ── */}
      {notes && (
        <div
          style={{
            padding: "9px 16px",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            gap: 10,
            alignItems: "baseline",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: MUTED,
              letterSpacing: "0.09em",
              textTransform: "uppercase" as const,
              flexShrink: 0,
              paddingTop: 1,
            }}
          >
            Notes
          </span>
          <span style={{ fontSize: 13, color: MUTED, lineHeight: 1.55 }}>
            {notes}
          </span>
        </div>
      )}

      {/* ── COMPLETION BANNER ── */}
      {completed && (
        <div
          style={{
            padding: "9px 16px",
            borderBottom: `1px solid ${BORDER}`,
            background: "rgba(46,204,113,0.05)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: GREEN,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>Completed</span>
          {completedAt && (
            <span style={{ fontSize: 12, color: MUTED }}>
              · {new Date(completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
          {bailAllowed && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 700,
                color: AMBER,
                letterSpacing: "0.05em",
                background: `${AMBER}18`,
                padding: "2px 7px",
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
        <div style={{ padding: "10px 12px", display: "flex", gap: 8 }}>
          {!completed && onComplete && (
            <button
              onClick={onComplete}
              style={{
                flex: 1,
                padding: "9px 16px",
                background: ACCENT,
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
                ((e.currentTarget as HTMLButtonElement).style.background = ACCENT_STRONG)
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = ACCENT)
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
                padding: "9px 16px",
                background: "transparent",
                color: MUTED,
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "Figtree, sans-serif",
              }}
            >
              Update Actuals
            </button>
          )}

          {onEdit && (
            <button
              onClick={onEdit}
              style={{
                padding: "9px 16px",
                background: "transparent",
                color: MUTED,
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "Figtree, sans-serif",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.borderColor = INK)
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.borderColor = BORDER)
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
