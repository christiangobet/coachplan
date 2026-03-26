import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getDayDateFromWeekStart, resolveWeekBounds } from "@/lib/plan-dates";
import { ensureUserFromAuth } from "@/lib/user-sync";
import { getDayMissedReason, getDayStatus, isDayExplicitlyOpen, type DayStatus } from "@/lib/day-status";
import { pickSelectedPlan, SELECTED_PLAN_COOKIE } from "@/lib/plan-selection";
import { getFirstName } from "@/lib/display-name";
import { buildPlanBanner } from "@/lib/plan-banner";
import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  resolveDistanceUnitFromActivity,
  type DistanceUnit
} from "@/lib/unit-display";
import { inferPaceBucketFromText } from "@/lib/intensity-targets";
import AthleteSidebar from "@/components/AthleteSidebar";
import DayLogCard from "@/components/DayLogCard";
import { buildLogActivities } from "@/lib/log-activity";
import ExternalSportIcon from "@/components/ExternalSportIcon";
import RaceDetailsEditor from "@/components/RaceDetailsEditor";
import SelectedPlanCookie from "@/components/SelectedPlanCookie";
import StravaDaySyncButton from "@/components/StravaDaySyncButton";
import CalendarDayTapHandler from "@/components/CalendarDayTapHandler";
import StravaIcon from "@/components/StravaIcon";
import PlanSummarySection from "@/components/PlanSummarySection";
import type { PlanSummary } from "@/lib/types/plan-summary";
import WeekStrip from "@/components/WeekStrip";
import type { WeekStripDay } from "@/components/WeekStrip";
import { buildStravaRoutePreview, extractStravaActivityPhoto } from "@/lib/strava-route";
import { mapStravaSportTypeToVisualCode } from "@/lib/integrations/external-sport-visuals";
import CalendarRouteMap from "@/components/CalendarRouteMap";
import ScreenPerfProbe from "@/components/ScreenPerfProbe";
import "../dashboard/dashboard.css";
import "./calendar.css";

// Royalty-free Unsplash photos per sport type (shown when no GPS route is available)
// All URLs verified returning HTTP 200 image/jpeg
const SPORT_PHOTO: Record<string, { url: string; alt: string }> = {
  RUN:           { url: "https://images.unsplash.com/photo-1571008887538-b36bb32f4571?auto=format&fit=crop&w=600&h=320&q=75", alt: "Runner on road" },
  TRAIL_RUN:     { url: "https://images.unsplash.com/photo-1502904550040-7534597429ae?auto=format&fit=crop&w=600&h=320&q=75", alt: "Trail runner in mountains" },
  TREADMILL_RUN: { url: "https://images.unsplash.com/photo-1519834785169-98be25ec3f84?auto=format&fit=crop&w=600&h=320&q=75", alt: "Running on treadmill" },
  WALK:          { url: "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&w=600&h=320&q=75", alt: "Person walking outdoors" },
  BIKE:          { url: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=600&h=320&q=75", alt: "Cyclist on road" },
  VIRTUAL_RIDE:  { url: "https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?auto=format&fit=crop&w=600&h=320&q=75", alt: "Indoor cycling" },
  SWIM:          { url: "https://images.unsplash.com/photo-1530549387789-4c1017266635?auto=format&fit=crop&w=600&h=320&q=75", alt: "Swimmer in pool" },
  HIKE:          { url: "https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=600&h=320&q=75", alt: "Hiker on mountain trail" },
  YOGA_MOBILITY: { url: "https://images.unsplash.com/photo-1545389336-cf090694435e?auto=format&fit=crop&w=600&h=320&q=75", alt: "Yoga pose" },
  STRENGTH:      { url: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=600&h=320&q=75", alt: "Weight training" },
  CROSS_TRAIN:   { url: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=600&h=320&q=75", alt: "Cross training workout" },
  SKI:           { url: "https://images.unsplash.com/photo-1599058945522-28d584b6f0ff?auto=format&fit=crop&w=600&h=320&q=75", alt: "Skier on slopes" },
  REST:          { url: "https://images.unsplash.com/photo-1520877880798-5ee004e3f11e?auto=format&fit=crop&w=600&h=320&q=75", alt: "Rest and recovery" },
  OTHER:         { url: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=600&h=320&q=75", alt: "Fitness activity" },
};

function getSportPhotoUrl(sportType: string | null, provider: string, raw: unknown): { url: string; isActivityPhoto: boolean } | null {
  if (provider !== "STRAVA") return null;
  const activityPhoto = extractStravaActivityPhoto(raw);
  if (activityPhoto) return { url: activityPhoto, isActivityPhoto: true };
  const code = mapStravaSportTypeToVisualCode(sportType);
  const stock = SPORT_PHOTO[code];
  if (!stock) return null;
  return { url: stock.url, isActivityPhoto: false };
}

function getSportPhotoAlt(sportType: string | null): string {
  const code = mapStravaSportTypeToVisualCode(sportType);
  return SPORT_PHOTO[code]?.alt ?? "Activity";
}

function isAppleTouchUserAgent(userAgent: string | null) {
  if (!userAgent) return false;
  return /iP(hone|ad|od)/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));
}

function resolveCalendarDefaultView(userAgent: string | null) {
  return isAppleTouchUserAgent(userAgent) ? "week" : "month";
}

function resolveCalendarRequestedView(view: string | undefined, userAgent: string | null) {
  if (typeof view === "string") return view;
  return resolveCalendarDefaultView(userAgent);
}

const PACE_BUCKET_SHORT: Record<string, string> = {
  RECOVERY: 'RE', EASY: 'EZ', LONG: 'LR', RACE: 'RP',
  TEMPO: 'TP', THRESHOLD: 'TH', INTERVAL: 'IN'
};

type CalendarSearchParams = {
  plan?: string;
  month?: string;
  date?: string;
  returnTo?: string;
  view?: string;   // "week" | "month" (default "month")
  week?: string;   // YYYY-MM-DD of the Monday — only used when view=week
};

type ActivityType =
  | "RUN"
  | "STRENGTH"
  | "CROSS_TRAIN"
  | "REST"
  | "MOBILITY"
  | "YOGA"
  | "HIKE"
  | "OTHER";

type DatedActivity = {
  id: string;
  title: string;
  type: ActivityType;
  subtype: string | null;
  completed: boolean;
  completedAt: Date | null;
  distance: number | null;
  duration: number | null;
  distanceUnit: "MILES" | "KM" | null;
  paceTarget: string | null;
  paceTargetBucket: string | null;
  effortTarget: string | null;
  priority: "KEY" | "MEDIUM" | "OPTIONAL" | null;
  actualDistance: number | null;
  actualDuration: number | null;
  actualPace: string | null;
  notes: string | null;
  sessionInstructions: string | null;
  sessionGroupId: string | null;
  sessionOrder: number | null;
};

type DayExternalLog = {
  id: string;
  provider: string;
  name: string;
  sportType: string | null;
  startTime: Date;
  startTimeLabel: string | null;
  distanceM: number | null;
  durationSec: number | null;
  avgHeartRate: number | null;
  calories: number | null;
  matchedPlanActivityId: string | null;
  equivalence: string | null;
  equivalenceOverride: string | null;
  equivalenceNote: string | null;
  loadRatio: number | null;
  raw: unknown;
};

type DayInfo = {
  dayId: string;
  manualStatus: DayStatus;
  explicitlyOpen: boolean;
  missedReason: string | null;
  rawText: string | null;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TYPE_GLOSSARY_ORDER: ActivityType[] = [
  "RUN",
  "STRENGTH",
  "CROSS_TRAIN",
  "REST",
  "MOBILITY",
  "YOGA",
  "HIKE",
  "OTHER"
];
const ACTIVITY_TYPE_ABBR: Record<ActivityType, string> = {
  RUN: "RUN",
  STRENGTH: "STR",
  CROSS_TRAIN: "XT",
  REST: "RST",
  MOBILITY: "MOB",
  YOGA: "YOG",
  HIKE: "HIK",
  OTHER: "OTH"
};

function normalizeDate(value: Date) {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getIsoDay(value: Date) {
  const day = value.getUTCDay();
  return day === 0 ? 7 : day;
}

function formatType(type: string) {
  return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function formatProviderName(provider: string | null | undefined) {
  const normalized = String(provider || "").trim().toUpperCase();
  if (normalized === "STRAVA") return "Strava";
  if (normalized === "GARMIN") return "Garmin";
  return provider || "External";
}

function getTypeAbbr(type: string) {
  const key = (type in ACTIVITY_TYPE_ABBR ? type : "OTHER") as ActivityType;
  return ACTIVITY_TYPE_ABBR[key];
}

function dateKey(value: Date) {
  const yyyy = value.getUTCFullYear();
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(value.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateKeyUtc(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthParam(value: Date) {
  const yyyy = value.getUTCFullYear();
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function parseMonthParam(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [yearStr, monthStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const d = new Date(`${yearStr}-${monthStr}-01T00:00:00.000Z`);
  return normalizeDate(d);
}

function parseDateParam(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return normalizeDate(parsed);
}

function addMonths(value: Date, delta: number) {
  const d = normalizeDate(value);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d;
}

function getMonthStart(value: Date) {
  const d = normalizeDate(value);
  d.setUTCDate(1);
  return d;
}

/** Returns the ISO Monday (Mon=1) of the week containing `value`. */
function getWeekMonday(value: Date): Date {
  const d = normalizeDate(value);
  const isoDay = getIsoDay(d); // 1=Mon … 7=Sun
  d.setUTCDate(d.getUTCDate() - (isoDay - 1));
  return d;
}

/** Add `delta` weeks to `value`. */
function addWeeks(value: Date, delta: number): Date {
  const d = normalizeDate(value);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d;
}

/** Build the URL for week view: preserves plan, date, and returnTo. */
function buildWeekHref(
  weekMonday: Date,
  planId: string,
  selectedDate?: string | null,
  returnTo?: string | null
): string {
  const params = new URLSearchParams();
  params.set("view", "week");
  params.set("week", dateKey(weekMonday));
  if (planId) params.set("plan", planId);
  if (selectedDate) params.set("date", selectedDate);
  if (returnTo) params.set("returnTo", returnTo);
  return `/calendar?${params.toString()}`;
}

function formatMonthLabel(value: Date) {
  return value.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDateLabel(value: Date | null | undefined) {
  if (!value) return "Not set";
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toDateInputValue(value: Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildCalendarHref(month: Date, planId: string, selectedDate?: string | null, returnTo?: string | null) {
  const params = new URLSearchParams();
  params.set("month", monthParam(month));
  params.set("view", "month");
  if (planId) params.set("plan", planId);
  if (selectedDate) params.set("date", selectedDate);
  if (returnTo === "dashboard") params.set("returnTo", returnTo);
  return `/calendar?${params.toString()}`;
}

function buildAdjustHref(planId: string, prompt: string) {
  const params = new URLSearchParams();
  params.set("aiPrompt", prompt);
  params.set("aiSource", "calendar");
  return `/plans/${planId}?${params.toString()}#ai-trainer`;
}

function formatClock(value: Date) {
  return value.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatClockFromIsoText(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  const rawHour = Number(match[1]);
  const minute = match[2];
  if (!Number.isInteger(rawHour) || rawHour < 0 || rawHour > 23) return null;
  const suffix = rawHour >= 12 ? "PM" : "AM";
  const hour12 = rawHour % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
}

function formatDurationSeconds(value: number | null | undefined) {
  if (!value || value <= 0) return "—";
  return `${Math.round(value / 60)} min`;
}

function formatDistanceMeters(value: number | null | undefined, viewerUnit: DistanceUnit) {
  if (!value || value <= 0) return "—";
  const converted = convertDistanceForDisplay(value / 1000, "KM", viewerUnit);
  if (!converted) return "—";
  return `${formatDistanceNumber(converted.value)} ${distanceUnitLabel(converted.unit)}`;
}

function trimUnitFromValue(value: string, unit: string) {
  if (!unit) return value;
  if (value.endsWith(` ${unit}`)) return value.slice(0, -(unit.length + 1));
  if (value.endsWith(unit)) return value.slice(0, -unit.length);
  return value;
}

function buildDistanceProgressLabel(planned: string | null, logged: string | null, unit?: string) {
  if (planned && logged) {
    const plannedCompact = unit ? trimUnitFromValue(planned, unit) : planned;
    return `${plannedCompact} \u2192 ${logged}`;
  }
  if (logged) return logged;
  if (planned) return planned;
  return null;
}

function formatDistanceOneDecimal(value: number) {
  return value.toFixed(1);
}

type MatchLevel = 'FULL' | 'PARTIAL' | 'NONE' | null;

function resolveMatchLevel(log: DayExternalLog): MatchLevel {
  return (log.equivalenceOverride || log.equivalence || null) as MatchLevel;
}

function matchBadgeClass(level: MatchLevel, isMatched: boolean) {
  if (level === 'FULL') return 'cal-match-badge full';
  if (level === 'PARTIAL') return 'cal-match-badge partial';
  if (level === 'NONE') return 'cal-match-badge none';
  if (isMatched) return 'cal-match-badge matched';
  return 'cal-match-badge unmatched';
}

function matchBadgeLabel(level: MatchLevel, isMatched: boolean) {
  if (level === 'FULL') return '✓ Full credit';
  if (level === 'PARTIAL') return '≈ Partial credit';
  if (level === 'NONE') return '✗ No credit';
  if (isMatched) return 'Matched';
  return 'No match';
}

function logItemClass(level: MatchLevel) {
  if (level === 'FULL') return 'cal-day-detail-item log match-full';
  if (level === 'PARTIAL') return 'cal-day-detail-item log match-partial';
  if (level === 'NONE') return 'cal-day-detail-item log match-none';
  return 'cal-day-detail-item log match-unmatched';
}

function parseExternalRawDateKey(raw: unknown) {
  if (raw && typeof raw === "object") {
    const payload = raw as Record<string, unknown>;
    const localStart = payload.start_date_local;
    if (typeof localStart === "string" && /^\d{4}-\d{2}-\d{2}/.test(localStart)) {
      return localStart.slice(0, 10);
    }
    const utcStart = payload.start_date;
    if (typeof utcStart === "string" && /^\d{4}-\d{2}-\d{2}/.test(utcStart)) {
      return utcStart.slice(0, 10);
    }
  }
  return null;
}

function parseExternalRawTimeLabel(raw: unknown) {
  if (raw && typeof raw === "object") {
    const payload = raw as Record<string, unknown>;
    const localStart = typeof payload.start_date_local === "string" ? payload.start_date_local : null;
    const utcStart = typeof payload.start_date === "string" ? payload.start_date : null;
    return formatClockFromIsoText(localStart) || formatClockFromIsoText(utcStart);
  }
  return null;
}

function getExternalDateKey(raw: unknown, startTime: Date) {
  return parseExternalRawDateKey(raw) || dateKeyUtc(startTime);
}

export default async function CalendarPage({
  searchParams
}: {
  searchParams?: Promise<CalendarSearchParams>;
}) {
  // Stage 1: parallel — auth + params + cookies (no DB yet)
  const [user, params, cookieStore, headersList] = await Promise.all([
    currentUser(),
    searchParams ?? Promise.resolve({} as CalendarSearchParams),
    cookies(),
    headers(),
  ]);
  if (!user) redirect("/sign-in");

  const name = getFirstName(user.fullName || user.firstName || "Athlete");
  const requestedPlanId = typeof params.plan === "string" ? params.plan : "";
  const requestedMonth = typeof params.month === "string" ? params.month : undefined;
  const requestedDate = typeof params.date === "string" ? params.date : undefined;
  const requestedReturnTo = typeof params.returnTo === "string" ? params.returnTo : "";
  const returnToDashboard = requestedReturnTo === "dashboard";
  const returnToParam = returnToDashboard ? "dashboard" : null;
  const requestedView = resolveCalendarRequestedView(typeof params.view === "string" ? params.view : undefined, headersList.get("user-agent"));
  const isWeekView = requestedView === "week";
  const requestedWeek = typeof params.week === "string" ? params.week : undefined;
  const cookiePlanId = cookieStore.get(SELECTED_PLAN_COOKIE)?.value || "";

  // Resolve the target plan ID — URL param wins, then cookie
  const targetPlanId = requestedPlanId || cookiePlanId || "";

  const PLAN_META_SELECT = {
    id: true, name: true, status: true, sourceId: true, bannerImageId: true,
    raceName: true, raceType: true, raceDate: true, weekCount: true, createdAt: true
  } as const;

  // Stage 2: parallel — user sync + strava account + plan resolution
  // Happy path: plan ID known → load only that one plan's metadata (+ other active plan names for switcher)
  // Fallback: no plan ID → load all active plan metadata to auto-select
  const [syncedUser, stravaAccount, plansMeta] = await Promise.all([
    ensureUserFromAuth(user, { defaultRole: "ATHLETE", defaultCurrentRole: "ATHLETE" }),
    prisma.externalAccount.findFirst({
      where: { userId: user.id, provider: "STRAVA" },
      select: { id: true }
    }),
    targetPlanId
      ? prisma.trainingPlan.findMany({
          // Load only: the requested plan + other ACTIVE plans (for switcher, metadata only)
          where: { athleteId: user.id, isTemplate: false, status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          select: PLAN_META_SELECT,
        })
      : prisma.trainingPlan.findMany({
          where: { athleteId: user.id, isTemplate: false },
          orderBy: { createdAt: "desc" },
          select: PLAN_META_SELECT,
        }),
  ]);
  const viewerUnits: DistanceUnit = syncedUser.units === "KM" ? "KM" : "MILES";

  // Pick selected plan from lightweight metadata (no full tree needed yet)
  if (plansMeta.length === 0) redirect("/dashboard");
  const activePlansMeta = plansMeta.filter((plan) => plan.status === "ACTIVE");
  if (activePlansMeta.length === 0) redirect("/plans");
  const selectedPlanMeta = pickSelectedPlan(activePlansMeta, { requestedPlanId, cookiePlanId });
  if (!selectedPlanMeta) redirect("/plans");

  // Compute approximate grid range from params for early external activities fetch
  const earlyMonthStart = normalizeDate(parseMonthParam(requestedMonth) || new Date());
  earlyMonthStart.setUTCDate(1);
  const earlyMonthEnd = normalizeDate(new Date(Date.UTC(earlyMonthStart.getUTCFullYear(), earlyMonthStart.getUTCMonth() + 1, 0)));
  const earlyGridStart = normalizeDate(new Date(earlyMonthStart));
  earlyGridStart.setUTCDate(earlyGridStart.getUTCDate() - (getIsoDay(earlyGridStart) - 1));
  const earlyGridEnd = normalizeDate(new Date(earlyMonthEnd));
  earlyGridEnd.setUTCDate(earlyGridEnd.getUTCDate() + (7 - getIsoDay(earlyGridEnd)));
  earlyGridEnd.setUTCHours(23, 59, 59, 999);

  // Stage 3: parallel — full plan tree + banner + source name + external activities
  const [selectedPlan, sourcePlanNameResult, selectedBannerImage, externalActivitiesSummary] = await Promise.all([
    prisma.trainingPlan.findUnique({
      where: { id: selectedPlanMeta.id },
      include: {
        weeks: {
          orderBy: { weekIndex: "asc" },
          include: {
            days: {
              orderBy: { dayOfWeek: "asc" },
              include: {
                activities: true,
              }
            }
          }
        }
      }
    }),
    selectedPlanMeta.sourceId
      ? prisma.trainingPlan.findUnique({ where: { id: selectedPlanMeta.sourceId }, select: { name: true } })
      : Promise.resolve(null),
    selectedPlanMeta.bannerImageId
      ? prisma.planImage.findUnique({ where: { id: selectedPlanMeta.bannerImageId }, select: { focusY: true } })
      : Promise.resolve(null),
    prisma.externalActivity.findMany({
      where: { userId: user.id, startTime: { gte: earlyGridStart, lte: earlyGridEnd } },
      orderBy: { startTime: "asc" },
      select: {
        id: true, provider: true, name: true, sportType: true, startTime: true,
        distanceM: true, durationSec: true, avgHeartRate: true, calories: true,
        matchedPlanActivityId: true, equivalence: true, equivalenceOverride: true,
        equivalenceNote: true, loadRatio: true
      }
    }),
  ]);
  if (!selectedPlan) redirect("/plans");

  const sourcePlanName = sourcePlanNameResult?.name || null;
  const planDisplayName = sourcePlanName || selectedPlan.name;
  const selectedPlanBanner = buildPlanBanner(
    selectedPlan.id,
    selectedPlan.bannerImageId,
    selectedBannerImage?.focusY ?? null
  );
  const raceName = (selectedPlan.raceName || "").trim()
    || (selectedPlan.raceType ? formatType(selectedPlan.raceType) : "Not set");
  const raceDateStr = selectedPlan.raceDate
    ? new Date(selectedPlan.raceDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Not set";
  const jumpToPlans = activePlansMeta.filter((plan) => plan.id !== selectedPlan.id);

  const weeks = [...selectedPlan.weeks].sort((a, b) => a.weekIndex - b.weekIndex);
  const weekOne = weeks.find((week) => week.weekIndex === 1) || weeks[0] || null;
  const weekOneStartDate = toDateInputValue(weekOne?.startDate ?? null);
  const initialWeekDateAnchor = selectedPlan.raceDate ? 'RACE_DATE' : weekOneStartDate ? 'START_DATE' : 'RACE_DATE';
  const allWeekIndexes = weeks.map((week) => week.weekIndex);
  const toDisplayDistance = (value: number | null | undefined, sourceUnit: string | null | undefined) =>
    convertDistanceForDisplay(value, sourceUnit, viewerUnits);
  const weeklyRunData = weeks.map((week) => {
    const runs = (week.days || [])
      .flatMap((day) => day.activities || [])
      .filter((activity) => String(activity.type).toUpperCase() === "RUN");
    let total = 0;
    let loggedTotal = 0;
    let longRun = 0;
    for (const run of runs) {
      const plannedSourceUnit = resolveDistanceUnitFromActivity({
        distanceUnit: run.distanceUnit,
        paceTarget: run.paceTarget,
        actualPace: run.actualPace,
        fallbackUnit: viewerUnits
      }) || viewerUnits;
      const plannedDistance = toDisplayDistance(run.distance, plannedSourceUnit);
      const plannedValue = plannedDistance?.value ?? 0;
      total += plannedValue;
      if (plannedValue > longRun) longRun = plannedValue;

      const loggedSourceUnit = resolveDistanceUnitFromActivity({
        distanceUnit: run.distanceUnit,
        paceTarget: run.paceTarget,
        actualPace: run.actualPace,
        fallbackUnit: viewerUnits,
        preferActualPace: true
      }) || viewerUnits;
      const loggedDistance = toDisplayDistance(run.actualDistance, loggedSourceUnit);
      loggedTotal += loggedDistance?.value ?? 0;
    }
    return {
      weekIndex: week.weekIndex,
      total: Math.round(total * 10) / 10,
      longRun: Math.round(longRun * 10) / 10,
      loggedTotal: Math.round(loggedTotal * 10) / 10
    };
  });

  const activitiesByDate = new Map<string, DatedActivity[]>();
  const dayInfoByDate = new Map<string, DayInfo>();
  const planDateKeys = new Set<string>();
  const alignedDates: Date[] = [];

  let derivedWeekCount = 0;
  let storedWeekCount = 0;

  for (const week of weeks) {
    const bounds = resolveWeekBounds({
      weekIndex: week.weekIndex,
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      raceDate: selectedPlan.raceDate,
      weekCount: selectedPlan.weekCount,
      allWeekIndexes
    });

    if (bounds.source === "derived") derivedWeekCount += 1;
    if (bounds.source === "stored") storedWeekCount += 1;

    for (const day of week.days || []) {
      const dayDate = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
      if (!dayDate) continue;
      const key = dateKey(dayDate);
      planDateKeys.add(key);
      alignedDates.push(dayDate);
      if (!dayInfoByDate.has(key)) {
        dayInfoByDate.set(key, {
          dayId: day.id,
          manualStatus: getDayStatus(day.notes),
          explicitlyOpen: isDayExplicitlyOpen(day.notes),
          missedReason: getDayMissedReason(day.notes),
          rawText: day.rawText ?? null,
        });
      }

      for (const activity of day.activities || []) {
        const next: DatedActivity = {
          id: activity.id,
          title: activity.title || formatType(activity.type),
          type: (activity.type as ActivityType) || "OTHER",
          subtype: activity.subtype ?? null,
          completed: !!activity.completed,
          completedAt: activity.completedAt ?? null,
          distance: activity.distance ?? null,
          duration: activity.duration ?? null,
          distanceUnit: activity.distanceUnit ?? null,
          paceTarget: activity.paceTarget ?? null,
          paceTargetBucket: activity.paceTargetBucket ?? null,
          effortTarget: activity.effortTarget ?? null,
          priority: (activity.priority as "KEY" | "MEDIUM" | "OPTIONAL" | null) ?? null,
          actualDistance: activity.actualDistance ?? null,
          actualDuration: activity.actualDuration ?? null,
          actualPace: activity.actualPace ?? null,
          notes: activity.notes ?? null,
          sessionInstructions: activity.sessionInstructions ?? null,
          sessionGroupId: activity.sessionGroupId ?? null,
          sessionOrder: activity.sessionOrder ?? null
        };
        const existing = activitiesByDate.get(key) || [];
        existing.push(next);
        activitiesByDate.set(key, existing);
      }
    }
  }

  for (const [key, list] of activitiesByDate.entries()) {
    list.sort((a, b) => {
      if (a.type === "REST" && b.type !== "REST") return 1;
      if (a.type !== "REST" && b.type === "REST") return -1;
      return a.title.localeCompare(b.title);
    });
    activitiesByDate.set(key, list);
  }

  alignedDates.sort((a, b) => a.getTime() - b.getTime());
  const planStartDate = alignedDates.length > 0 ? alignedDates[0] : null;
  const planEndDate = alignedDates.length > 0 ? alignedDates[alignedDates.length - 1] : null;

  const today = normalizeDate(new Date());
  const activeCurrentWeekIndex = (() => {
    if (selectedPlan.status !== "ACTIVE") return null;
    for (const week of weeks) {
      const bounds = resolveWeekBounds({
        weekIndex: week.weekIndex,
        weekStartDate: week.startDate,
        weekEndDate: week.endDate,
        raceDate: selectedPlan.raceDate,
        weekCount: selectedPlan.weekCount,
        allWeekIndexes
      });
      if (bounds.startDate && bounds.endDate && today >= bounds.startDate && today <= bounds.endDate) {
        return week.weekIndex;
      }
    }
    return null;
  })();
  const requestedMonthDate = parseMonthParam(requestedMonth);
  const defaultMonth =
    requestedMonthDate
    || new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthStart = getMonthStart(defaultMonth);
  const monthEnd = normalizeDate(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)));

  const gridStart = normalizeDate(monthStart);
  gridStart.setUTCDate(gridStart.getUTCDate() - (getIsoDay(gridStart) - 1));
  const gridEnd = normalizeDate(monthEnd);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (7 - getIsoDay(gridEnd)));

  const dayCells: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    dayCells.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const parsedRequestedDate = parseDateParam(requestedDate);
  const hasSelectedDate = !!parsedRequestedDate;
  const selectedDateKey = parsedRequestedDate ? dateKey(parsedRequestedDate) : null;
  const defaultSelectedDate =
    parsedRequestedDate
    || (
      today >= monthStart && today <= monthEnd
        ? today
        : monthStart
    );
  const highlightedDateKey = selectedDateKey || dateKey(defaultSelectedDate);
  const selectedDate = selectedDateKey ? parsedRequestedDate! : defaultSelectedDate;

  const prevMonthHref = buildCalendarHref(addMonths(monthStart, -1), selectedPlan.id, selectedDateKey, returnToParam);
  const nextMonthHref = buildCalendarHref(addMonths(monthStart, 1), selectedPlan.id, selectedDateKey, returnToParam);
  const dashboardReturnHref = returnToDashboard ? `/dashboard?plan=${encodeURIComponent(selectedPlan.id)}` : null;
  const collapseCardHref = buildCalendarHref(monthStart, selectedPlan.id, null, returnToParam);

  // Week view: resolve the Monday of the displayed week
  const parsedWeekParam = parseDateParam(requestedWeek);
  const fallbackWeekMonday = parsedWeekParam ? getWeekMonday(parsedWeekParam) : getWeekMonday(selectedDate);
  const selectedWeekMonday = selectedDateKey ? getWeekMonday(selectedDate) : fallbackWeekMonday;
  const weekMonday = isWeekView
    ? (selectedDateKey ? selectedWeekMonday : fallbackWeekMonday)
    : getWeekMonday(selectedDate);
  const monthToggleHref = buildCalendarHref(
    getMonthStart(selectedDateKey ? selectedDate : (isWeekView ? weekMonday : monthStart)),
    selectedPlan.id,
    selectedDateKey,
    returnToParam
  );
  const prevWeekSelectedDateKey = selectedDateKey ? dateKey(addWeeks(selectedDate, -1)) : null;
  const nextWeekSelectedDateKey = selectedDateKey ? dateKey(addWeeks(selectedDate, 1)) : null;
  const weekViewHref = buildWeekHref(selectedWeekMonday, selectedPlan.id, selectedDateKey, returnToParam);

  const prevWeekHref = buildWeekHref(addWeeks(weekMonday, -1), selectedPlan.id, prevWeekSelectedDateKey, returnToParam);
  const nextWeekHref = buildWeekHref(addWeeks(weekMonday, 1), selectedPlan.id, nextWeekSelectedDateKey, returnToParam);

  // Calendar shell uses summary-only external logs; selected-day media is fetched separately.

  const externalByDate = new Map<string, DayExternalLog[]>();
  for (const item of externalActivitiesSummary) {
    const key = getExternalDateKey(null, item.startTime);
    const row = externalByDate.get(key) || [];
    row.push({
      id: item.id,
      provider: item.provider,
      name: item.name || item.sportType || "External activity",
      sportType: item.sportType,
      startTime: item.startTime,
      startTimeLabel: formatClock(item.startTime),
      distanceM: item.distanceM ?? null,
      durationSec: item.durationSec ?? null,
      avgHeartRate: item.avgHeartRate ?? null,
      calories: item.calories ?? null,
      matchedPlanActivityId: item.matchedPlanActivityId ?? null,
      equivalence: item.equivalence ?? null,
      equivalenceOverride: item.equivalenceOverride ?? null,
      equivalenceNote: item.equivalenceNote ?? null,
      loadRatio: item.loadRatio ?? null,
      raw: null,
    });
    externalByDate.set(key, row);
  }

  const selectedDayInfo = selectedDateKey ? (dayInfoByDate.get(selectedDateKey) || null) : null;
  const selectedPlanActivities = selectedDateKey ? (activitiesByDate.get(selectedDateKey) || []) : [];
  const selectedIsPastOrToday = selectedDateKey ? selectedDate.getTime() <= today.getTime() : false;
  const selectedDayWindowStart = new Date(selectedDate);
  selectedDayWindowStart.setUTCDate(selectedDayWindowStart.getUTCDate() - 1);
  selectedDayWindowStart.setUTCHours(0, 0, 0, 0);
  const selectedDayWindowEnd = new Date(selectedDate);
  selectedDayWindowEnd.setUTCDate(selectedDayWindowEnd.getUTCDate() + 1);
  selectedDayWindowEnd.setUTCHours(23, 59, 59, 999);
  const selectedExternalActivityRows = selectedDateKey && selectedIsPastOrToday ? await prisma.externalActivity.findMany({
      where: {
        userId: user.id,
        startTime: {
          gte: selectedDayWindowStart,
          lte: selectedDayWindowEnd
        }
      },
      orderBy: { startTime: "asc" },
      select: {
        id: true,
        provider: true,
        name: true,
        sportType: true,
        startTime: true,
        distanceM: true,
        durationSec: true,
        avgHeartRate: true,
        calories: true,
        matchedPlanActivityId: true,
        equivalence: true,
        equivalenceOverride: true,
        equivalenceNote: true,
        loadRatio: true,
        raw: true
      }
    }) : [];
  const selectedExternalLogs = selectedExternalActivityRows
    .filter((item) => getExternalDateKey(item.raw, item.startTime) === selectedDateKey)
    .map((item) => ({
      id: item.id,
      provider: item.provider,
      name: item.name || item.sportType || "External activity",
      sportType: item.sportType,
      startTime: item.startTime,
      startTimeLabel: parseExternalRawTimeLabel(item.raw) || formatClock(item.startTime),
      distanceM: item.distanceM ?? null,
      durationSec: item.durationSec ?? null,
      avgHeartRate: item.avgHeartRate ?? null,
      calories: item.calories ?? null,
      matchedPlanActivityId: item.matchedPlanActivityId ?? null,
      equivalence: item.equivalence ?? null,
      equivalenceOverride: item.equivalenceOverride ?? null,
      equivalenceNote: item.equivalenceNote ?? null,
      loadRatio: item.loadRatio ?? null,
      raw: item.raw ?? null,
    }));
  const selectedManualStatus = selectedDayInfo?.manualStatus || 'OPEN';
  const selectedDayAutoDone = selectedPlanActivities.length > 0 && selectedPlanActivities.every((activity) => activity.completed);
  const selectedDayExplicitlyOpen = selectedDayInfo?.explicitlyOpen ?? false;
  const selectedDayStatus: DayStatus = selectedDayExplicitlyOpen ? 'OPEN' : selectedDayAutoDone ? 'DONE' : selectedManualStatus;
  const selectedDayDone = selectedDayStatus === 'DONE';
  const selectedDayMissed = selectedDayStatus === 'MISSED';
  const selectedDayPartial = selectedDayStatus === 'PARTIAL';

  const monthWorkoutCount = dayCells
    .filter((date) => date.getUTCMonth() === monthStart.getUTCMonth() && date.getUTCFullYear() === monthStart.getUTCFullYear())
    .reduce((sum, date) => sum + (activitiesByDate.get(dateKey(date))?.length || 0), 0);
  const monthCompletedCount = dayCells
    .filter((date) => date.getUTCMonth() === monthStart.getUTCMonth() && date.getUTCFullYear() === monthStart.getUTCFullYear())
    .reduce((sum, date) => sum + (activitiesByDate.get(dateKey(date))?.filter((a) => a.completed).length || 0), 0);
  const monthCompletionPct = monthWorkoutCount > 0
    ? Math.round((monthCompletedCount / monthWorkoutCount) * 100)
    : 0;
  const selectedDayLabel = selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const todayHref = `/dashboard?plan=${encodeURIComponent(selectedPlan.id)}`;
  const adjustThisWeekHref = buildAdjustHref(
    selectedPlan.id,
    "Adjust this week around my schedule, recovery, and available training time."
  );

  // Activity type → single-char strip code
  const STRIP_CODE: Record<string, string> = {
    RUN: "R",
    CROSS_TRAIN: "C",
    STRENGTH: "S",
    MOBILITY: "M",
    YOGA: "Y",
    HIKE: "H",
    REST: "—",
    OTHER: "?"
  };

  const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

  const weekDays: WeekStripDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekMonday);
    d.setUTCDate(weekMonday.getUTCDate() + i);
    const key = dateKey(d);
    const dayActivities = activitiesByDate.get(key) || [];
    const dayLogs = externalByDate.get(key) || [];
    const dayInfo = dayInfoByDate.get(key) || null;
    const inPlan = planDateKeys.has(key);

    const manualStatus = dayInfo?.manualStatus || "OPEN";
    const autoDone = dayActivities.length > 0 && dayActivities.every((a) => a.completed);
    const status: WeekStripDay["status"] = inPlan
      ? (autoDone ? "DONE" : manualStatus as "DONE" | "MISSED" | "PARTIAL" | "OPEN")
      : null;

    const primary = dayActivities.find((a) => a.type !== "REST") || dayActivities[0] || null;
    const activityCode = primary ? (STRIP_CODE[primary.type] ?? "?") : "—";

    // Deduplicated type abbreviations for all non-REST activities (max 3)
    const seenTypes = new Set<string>();
    const activityTypes: string[] = [];
    for (const a of dayActivities) {
      const abbr = ACTIVITY_TYPE_ABBR[a.type as ActivityType] ?? "OTH";
      if (!seenTypes.has(abbr) && activityTypes.length < 3) {
        seenTypes.add(abbr);
        activityTypes.push(abbr);
      }
    }

    // Total planned distance across all activities
    let totalDistKm = 0;
    for (const a of dayActivities) {
      if (a.distance && a.distance > 0) {
        const srcUnit = resolveDistanceUnitFromActivity({ distanceUnit: a.distanceUnit, paceTarget: a.paceTarget, actualPace: a.actualPace, fallbackUnit: viewerUnits }) || viewerUnits;
        const conv = convertDistanceForDisplay(a.distance, srcUnit, viewerUnits);
        if (conv) totalDistKm += conv.value;
      }
    }
    const distanceLabel = totalDistKm > 0
      ? `${formatDistanceNumber(totalDistKm)} ${distanceUnitLabel(viewerUnits)}`
      : null;

    // Total planned duration
    const totalDurMin = dayActivities.reduce((s, a) => s + (a.duration ?? 0), 0);
    const durationLabel = !distanceLabel && totalDurMin > 0 ? `${totalDurMin} min` : null;

    const hasStrava = dayLogs.some((l) => l.provider === "STRAVA");
    const href = buildWeekHref(weekMonday, selectedPlan.id, key, returnToParam);

    return {
      dateISO: key,
      dayLetter: DAY_LETTERS[i],
      dateNum: d.getUTCDate(),
      activityCode,
      activityTypes,
      distanceLabel,
      durationLabel,
      status,
      hasStrava,
      isToday: key === dateKey(today),
      isSelected: key === selectedDateKey,
      inPlan,
      href,
    };
  });

  const weekLabelParts: string[] = [formatMonthLabel(weekMonday)];
  const displayedPlanWeek = weeks.find((week) => {
    const bounds = resolveWeekBounds({
      weekIndex: week.weekIndex,
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      raceDate: selectedPlan.raceDate,
      weekCount: selectedPlan.weekCount,
      allWeekIndexes
    });
    if (!bounds.startDate || !bounds.endDate) return false;
    return weekMonday >= bounds.startDate && weekMonday <= bounds.endDate;
  });
  if (displayedPlanWeek) {
    weekLabelParts.push(`Week ${displayedPlanWeek.weekIndex}`);
  }
  const weekLabel = weekLabelParts.join(" · ");

  const todayDateKey = dateKey(today);
  const todayMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const todayMonthHref = buildCalendarHref(todayMonthStart, selectedPlan.id, todayDateKey, returnToParam);
  const todayWeekHref = buildWeekHref(getWeekMonday(today), selectedPlan.id, todayDateKey, returnToParam);
  const isOnToday = isWeekView
    ? dateKey(weekMonday) === dateKey(getWeekMonday(today))
    : monthParam(monthStart) === monthParam(todayMonthStart);

  return (
    <main
      className={`dash cal-page${!isWeekView ? ' cal-month-view' : ''}${selectedDateKey && !isWeekView ? ' cal-day-open' : ''}`}
      data-debug-id="TRL"
    >
      <ScreenPerfProbe
        screen="calendar"
        actionSelector=".cal-grid a, .cal-view-pill, .cal-month-btn, .wsd-day-link"
        suppressesMobilePrefetch
      />
      <SelectedPlanCookie planId={selectedPlan.id} />
      <CalendarDayTapHandler />
      <div className="dash-grid">
        <AthleteSidebar active="calendar" name={name} selectedPlanId={selectedPlan.id} />

        <section className="dash-center" data-debug-id="TCB">
          <div
            className={`dash-card dash-plan-summary cal-plan-summary-card${selectedPlanBanner ? ' has-banner' : ''}`}
            style={
              selectedPlanBanner
                ? ({
                  '--plan-banner-url': `url("${selectedPlanBanner.url}")`,
                  '--plan-banner-focus-y': `${Math.round((selectedPlanBanner.focusY ?? 0.5) * 100)}%`
                } as any)
                : undefined
            }
          >
            <div className="cal-banner-row">
              <div className="cal-banner-meta">
                <span className="cal-banner-plan-name">{planDisplayName}</span>
                {raceName && <><span className="cal-banner-sep">·</span><span className="cal-banner-meta-value">{raceName}</span></>}
                {raceDateStr && <><span className="cal-banner-sep">·</span><span className="cal-banner-meta-value">{raceDateStr}</span></>}
              </div>
              <a className="cal-banner-view-plan" href={`/plans/${selectedPlan.id}`}>View Plan</a>
            </div>
            {jumpToPlans.length > 0 && (
              <div className="cal-plan-switch cal-plan-switch--nested">
                <span>JUMP TO</span>
                <div className="cal-plan-pills">
                  {jumpToPlans.map((plan) => {
                    const href = buildCalendarHref(monthStart, plan.id, selectedDateKey, returnToParam);
                    return (
                      <Link key={plan.id} href={href} className="cal-plan-pill">
                        {plan.name}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Plan Reference guide — collapsible */}
          <details className="dash-card cal-guide-details">
            <summary className="cal-guide-summary">
              <span>📋 Plan Reference</span>
              <span className="cal-guide-summary-hint">expand</span>
            </summary>
            <div className="cal-guide-body">
              <PlanSummarySection
                summary={selectedPlan.planSummary as PlanSummary | null}
                planId={selectedPlan.id}
                weeklyRuns={weeklyRunData}
                weeklyRunUnit={distanceUnitLabel(viewerUnits)}
                currentWeekIndex={activeCurrentWeekIndex}
              />
            </div>
          </details>

          <div className="dash-card cal-month-card">
            <div className="cal-grid-controls">
              <div className="cal-grid-controls-left">
                <div className="cal-view-toggle" aria-label="Plan views">
                  <Link className="cal-view-pill" href={`/plans/${selectedPlan.id}`}>Plan</Link>
                  <span className="cal-view-pill active">Training Calendar</span>
                </div>
                <div className="cal-view-toggle">
                  <Link
                    className={`cal-view-pill${!isWeekView ? " active" : ""}`}
                    href={monthToggleHref}
                  >Month</Link>
                  <Link
                    className={`cal-view-pill${isWeekView ? " active" : ""}`}
                    href={weekViewHref}
                  >Week</Link>
                </div>
              </div>
              {isWeekView ? (
                <div className="cal-month-nav">
                  <Link className="cal-month-btn" href={prevWeekHref} aria-label="Previous week">&larr; Prev</Link>
                  <strong>{weekLabel}</strong>
                  <Link className="cal-month-btn" href={nextWeekHref} aria-label="Next week">Next &rarr;</Link>
                </div>
              ) : (
                <div className="cal-month-nav">
                  <Link className="cal-month-btn" href={prevMonthHref} aria-label="Previous month">&larr; Prev</Link>
                  <strong>{formatMonthLabel(monthStart)}</strong>
                  <Link className="cal-month-btn" href={nextMonthHref} aria-label="Next month">Next &rarr;</Link>
                </div>
              )}
            </div>
            {isWeekView ? (
              <>
                <WeekStrip
                  days={weekDays}
                  weekLabel={weekLabel}
                  prevWeekHref={prevWeekHref}
                  nextWeekHref={nextWeekHref}
                />
                {selectedDateKey && (
                  <div className="wsd-detail">
                    <div className="cal-detail-header">
                      <span className="cal-detail-date">
                        {selectedDateKey === dateKey(today) ? "TODAY · " : ""}
                        {selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
                      </span>
                      <div className="cal-detail-head-actions">
                        <div className="cal-detail-badges">
                          {selectedDayDone && <span className="cal-detail-badge status-done">✓ Done</span>}
                          {selectedDayMissed && <span className="cal-detail-badge status-missed">✗ Missed</span>}
                          {selectedDayPartial && <span className="cal-detail-badge status-partial">≈ Partial</span>}
                        </div>
                        <Link className="cal-detail-close" href={buildWeekHref(weekMonday, selectedPlan.id, null, returnToParam)} aria-label="Close selected day panel">
                          ✕
                        </Link>
                      </div>
                    </div>
                    <div className="cal-day-details-body">
                      {selectedDayInfo?.rawText && (
                        <div className="cal-day-raw-note">{selectedDayInfo.rawText}</div>
                      )}
                      {selectedPlanActivities.length === 0 && (
                        <p className="cal-day-empty">No planned activities on this day.</p>
                      )}
                      {selectedPlanActivities.length > 0 && (
                        <DayLogCard
                          dayId={selectedDayInfo?.dayId || null}
                          dateISO={selectedDateKey}
                          planId={selectedPlan.id}
                          activities={buildLogActivities(selectedPlanActivities, viewerUnits)}
                          viewerUnits={viewerUnits}
                          dayStatus={selectedDayStatus}
                          missedReason={selectedDayInfo?.missedReason || null}
                          stravaConnected={Boolean(stravaAccount)}
                          enabled={selectedIsPastOrToday}
                          showSyncedStravaSection={false}
                          successRedirectHref={buildWeekHref(weekMonday, selectedPlan.id, null, returnToParam)}
                        />
                      )}
                      {selectedIsPastOrToday && selectedExternalLogs.length > 0 && (
                        <div className="cal-day-detail-section">
                          <div className="cal-day-detail-section-header">
                            <h4>Logged Activities</h4>
                            {stravaAccount && <StravaDaySyncButton dateISO={selectedDateKey} planId={selectedPlan.id} className="cal-strava-sync-btn" />}
                          </div>
                          <div className="cal-log-items-grid">
                          {selectedExternalLogs.map((log) => {
                            const matchLevel = resolveMatchLevel(log);
                            const isMatched = Boolean(log.matchedPlanActivityId);
                            const routePreview = buildStravaRoutePreview({
                              name: log.name,
                              sportType: log.sportType,
                              startTime: log.startTime,
                              distanceM: log.distanceM,
                              movingTimeSec: log.durationSec,
                              elevationGainM: null,
                              raw: log.raw,
                            });
                            return (
                              <div key={log.id} className={logItemClass(matchLevel)}>
                                <div className="cal-day-detail-title">
                                  <strong className="cal-day-log-title">
                                    <ExternalSportIcon provider={log.provider} sportType={log.sportType} className="cal-day-log-icon" />
                                    <span>{log.name}</span>
                                  </strong>
                                  <span className="cal-day-log-provider">
                                    {log.provider === 'STRAVA'
                                      ? <StravaIcon size={13} className="cal-day-log-provider-icon" />
                                      : formatProviderName(log.provider)}
                                    {' · '}{log.startTimeLabel || formatClock(log.startTime)}
                                  </span>
                                </div>
                                <div className="cal-day-detail-meta">
                                  <span>{formatDistanceMeters(log.distanceM, viewerUnits)} · {formatDurationSeconds(log.durationSec)}{log.avgHeartRate ? ` · HR ${log.avgHeartRate} bpm` : ''}</span>
                                  {log.calories ? <span>{Math.round(log.calories)} kcal</span> : null}
                                </div>
                                {routePreview ? (
                                  <CalendarRouteMap
                                    routePoints={routePreview.routePoints}
                                    ariaLabel={routePreview.name ? `${routePreview.name} route` : 'Activity route'}
                                  />
                                ) : (() => {
                                  const photo = getSportPhotoUrl(log.sportType, log.provider, log.raw);
                                  return photo ? (
                                    <div className={`cal-log-activity-photo${photo.isActivityPhoto ? ' is-activity-photo' : ''}`}>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={photo.url} alt={getSportPhotoAlt(log.sportType)} loading="lazy" />
                                    </div>
                                  ) : null;
                                })()}
                                <div className="cal-day-log-match-row">
                                  <span className={matchBadgeClass(matchLevel, isMatched)}>
                                    {matchBadgeLabel(matchLevel, isMatched)}
                                  </span>
                                  {log.equivalenceNote && (
                                    <span className="cal-day-log-match-note">{log.equivalenceNote}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>

            <div className="cal-month-scroll">
            <div className="cal-weekdays">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="cal-weekday">{label}</div>
              ))}
            </div>

            <div className="cal-grid" data-debug-id="TCG">
              {dayCells.map((date) => {
                const key = dateKey(date);
                const dayActivities = activitiesByDate.get(key) || [];
                const dayLogs = externalByDate.get(key) || [];
                const dayInfo = dayInfoByDate.get(key) || null;
                const isToday = key === dateKey(today);
                const isSelected = key === highlightedDateKey;
                const isOutMonth = date.getUTCMonth() !== monthStart.getUTCMonth();
                const inPlan = planDateKeys.has(key);
                const dayManualStatus = dayInfo?.manualStatus || 'OPEN';
                const dayAutoDone = dayActivities.length > 0 && dayActivities.every((activity) => activity.completed);
                const dayStatus: DayStatus = dayAutoDone ? 'DONE' : dayManualStatus;
                const dayDone = dayStatus === 'DONE';
                const dayMissed = dayStatus === 'MISSED';
                const dayPartial = dayStatus === 'PARTIAL';
                const stravaLogs = dayLogs.filter((log) => log.provider === "STRAVA");
                const stravaMarkerLogs = stravaLogs.slice(0, 3);
                const stravaOverflow = Math.max(0, stravaLogs.length - stravaMarkerLogs.length);
                // Collapse session members into one display item per group
                type DisplayActivity = { activity: DatedActivity; sessionCount?: number };
                const displayActivities: DisplayActivity[] = [];
                const seenGroups = new Set<string>();
                for (const activity of dayActivities) {
                  if (activity.sessionGroupId) {
                    if (!seenGroups.has(activity.sessionGroupId)) {
                      seenGroups.add(activity.sessionGroupId);
                      const members = dayActivities.filter(a => a.sessionGroupId === activity.sessionGroupId);
                      displayActivities.push({ activity, sessionCount: members.length });
                    }
                  } else {
                    displayActivities.push({ activity });
                  }
                }
                const moreCount = displayActivities.length > 3 ? displayActivities.length - 3 : 0;
                // Sum planned distances across all activities for the day
                let totalDayDist = 0;
                for (const act of dayActivities) {
                  if (act.distance && act.distance > 0) {
                    const conv = convertDistanceForDisplay(act.distance, act.distanceUnit, viewerUnits);
                    if (conv) totalDayDist += conv.value;
                  }
                }
                const totalDayDistLabel = totalDayDist > 0
                  ? `${formatDistanceNumber(totalDayDist)}${distanceUnitLabel(viewerUnits)}`
                  : null;
                const dayHref = buildCalendarHref(monthStart, selectedPlan.id, key, returnToParam);
                return (
                  <div
                    key={key}
                    className={[
                      "cal-day",
                      isOutMonth ? "out-month" : "",
                      isToday ? "today" : "",
                      isSelected ? "selected" : "",
                      dayDone ? "day-done" : "",
                      dayMissed ? "day-missed" : "",
                      dayPartial ? "day-partial" : "",
                      inPlan ? "in-plan" : ""
                    ].join(" ").trim()}
                    data-day-href={dayHref}
                    data-debug-id="TCD"
                  >
                    <Link className="cal-day-hit" href={dayHref} aria-label={`Open ${new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`}>
                      <div className="cal-day-head">
                        <span className="cal-day-number">{date.getUTCDate()}</span>
                        <div className="cal-day-head-badges">
                          {dayDone && <span className="cal-day-check" title="Day completed">✓</span>}
                          {dayMissed && <span className="cal-day-check missed" title="Day closed as missed">✗</span>}
                          {dayPartial && <span className="cal-day-check partial" title="Day partially completed">✓</span>}
                          {totalDayDistLabel && <span className="cal-day-dist">{totalDayDistLabel}</span>}
                        </div>
                      </div>

                      <div className="cal-day-list" data-debug-id="TAL">
                        {displayActivities.slice(0, 3).map(({ activity, sessionCount }) => {
                          const sessionMembers = sessionCount
                            ? dayActivities.filter(a => a.sessionGroupId === activity.sessionGroupId)
                            : null;
                          const sessionAllDone = sessionMembers?.every(a => a.completed) ?? false;
                          const isCompleted = sessionCount ? sessionAllDone : activity.completed;
                          const isRun = String(activity.type || "").toUpperCase() === "RUN";
                          const plannedDistanceLabel = (() => {
                            if (sessionMembers && sessionMembers.length > 1) {
                              let total = 0;
                              let hasAny = false;
                              for (const member of sessionMembers) {
                                const sourceUnit = resolveDistanceUnitFromActivity({
                                  distanceUnit: member.distanceUnit,
                                  paceTarget: member.paceTarget,
                                  actualPace: member.actualPace,
                                  fallbackUnit: viewerUnits
                                }) || viewerUnits;
                                const converted = convertDistanceForDisplay(member.distance, sourceUnit, viewerUnits);
                                if (converted) {
                                  total += converted.value;
                                  hasAny = true;
                                }
                              }
                              return hasAny ? `${formatDistanceOneDecimal(total)}${distanceUnitLabel(viewerUnits)}` : null;
                            }
                            const sourceUnit = resolveDistanceUnitFromActivity({
                              distanceUnit: activity.distanceUnit,
                              paceTarget: activity.paceTarget,
                              actualPace: activity.actualPace,
                              fallbackUnit: viewerUnits
                            }) || viewerUnits;
                            const converted = convertDistanceForDisplay(activity.distance, sourceUnit, viewerUnits);
                            return converted ? `${formatDistanceOneDecimal(converted.value)}${distanceUnitLabel(converted.unit)}` : null;
                          })();
                          const loggedDistanceLabel = (() => {
                            if (sessionMembers && sessionMembers.length > 1) {
                              let total = 0;
                              let hasAny = false;
                              for (const member of sessionMembers) {
                                const sourceUnit = resolveDistanceUnitFromActivity({
                                  distanceUnit: member.distanceUnit,
                                  paceTarget: member.paceTarget,
                                  actualPace: member.actualPace,
                                  fallbackUnit: viewerUnits,
                                  preferActualPace: true
                                }) || viewerUnits;
                                const converted = convertDistanceForDisplay(member.actualDistance, sourceUnit, viewerUnits);
                                if (converted) {
                                  total += converted.value;
                                  hasAny = true;
                                }
                              }
                              return hasAny ? `${formatDistanceOneDecimal(total)}${distanceUnitLabel(viewerUnits)}` : null;
                            }
                            const sourceUnit = resolveDistanceUnitFromActivity({
                              distanceUnit: activity.distanceUnit,
                              paceTarget: activity.paceTarget,
                              actualPace: activity.actualPace,
                              fallbackUnit: viewerUnits,
                              preferActualPace: true
                            }) || viewerUnits;
                            const converted = convertDistanceForDisplay(activity.actualDistance, sourceUnit, viewerUnits);
                            return converted ? `${formatDistanceOneDecimal(converted.value)}${distanceUnitLabel(converted.unit)}` : null;
                          })();
                          const runDistanceLabel = isRun
                            ? buildDistanceProgressLabel(plannedDistanceLabel, loggedDistanceLabel, distanceUnitLabel(viewerUnits))
                            : null;
                          return (
                            <div
                              key={activity.id}
                              className={`cal-activity type-${activity.type.toLowerCase()}${isCompleted ? " completed" : ""}`}
                              title={sessionCount ? `${getTypeAbbr(activity.type)} ×${sessionCount}` : activity.title}
                            >
                              <span className="cal-activity-title">
                                <span className={`cal-activity-code type-${activity.type.toLowerCase()}`}>
                                  {getTypeAbbr(activity.type)}{sessionCount && sessionCount > 1 ? ` ×${sessionCount}` : ""}
                                </span>
                                {isCompleted && <span className="cal-activity-done-dot" />}
                              </span>
                              {runDistanceLabel && (
                                <span className="cal-run-distance">{runDistanceLabel}</span>
                              )}
                              {activity.type === "RUN" && (() => {
                                const bucket = activity.paceTargetBucket || inferPaceBucketFromText(activity.paceTarget);
                                const bucketShort = bucket ? (PACE_BUCKET_SHORT[bucket] ?? null) : null;
                                const paceDisplay = bucketShort
                                  ? null
                                  : (activity.paceTarget ? convertPaceForDisplay(activity.paceTarget, viewerUnits) : null);
                                if (!bucketShort && !paceDisplay) return null;
                                return (
                                  <span
                                    className={`cal-pace-badge${bucketShort ? ' cal-pace-badge--bucket' : ''}`}
                                    title={activity.paceTarget ?? undefined}
                                  >
                                    {bucketShort ?? paceDisplay}
                                  </span>
                                );
                              })()}
                            </div>
                          );
                        })}
                        {moreCount > 0 && (
                          <span className="cal-more">
                            +{moreCount} more
                          </span>
                        )}
                        {stravaLogs.length > 0 ? (
                          <span className="cal-strava-pill">
                            <StravaIcon size={12} className="cal-strava-pill-logo" />
                            <span className="cal-strava-pill-icons">
                              {stravaMarkerLogs.map((log) => (
                                <ExternalSportIcon
                                  key={log.id}
                                  provider={log.provider}
                                  sportType={log.sportType}
                                  className="cal-strava-icon"
                                />
                              ))}
                              {stravaOverflow > 0 && (
                                <span className="cal-strava-pill-more">+{stravaOverflow}</span>
                              )}
                            </span>
                          </span>
                        ) : dayLogs.length > 0 && (
                          <span className="cal-log-pill">
                            {dayLogs.length} log{dayLogs.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
            </div>{/* cal-month-scroll */}
              </>
            )}
          </div>

          <div className="dash-card cal-type-glossary" aria-label="Activity type glossary">
            <div className="cal-type-glossary-head">
              <strong>Type Glossary</strong>
              <span>Abbreviations used in training log cells</span>
            </div>
            <div className="cal-type-glossary-list">
              {TYPE_GLOSSARY_ORDER.map((type) => (
                <span key={type} className={`cal-type-chip type-${type.toLowerCase()}`}>
                  <em>{getTypeAbbr(type)}</em>
                  <span>{formatType(type)}</span>
                </span>
              ))}
            </div>
          </div>
        </section>

        <aside className="dash-right cal-right" data-debug-id="TSB">
          {selectedDateKey && !isWeekView && <div id="day-details-card" className="dash-card cal-info-card cal-day-details-card is-open" data-debug-id="TDL">

            {/* Header: date + status */}
            <div className="cal-detail-header">
              <span className="cal-detail-date">
                {selectedDateKey === dateKey(today) ? "TODAY · " : ""}
                {selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
              </span>
              <div className="cal-detail-head-actions">
                <div className="cal-detail-badges">
                  {selectedDayDone && <span className="cal-detail-badge status-done">✓ Done</span>}
                  {selectedDayMissed && <span className="cal-detail-badge status-missed">✗ Missed</span>}
                  {selectedDayPartial && <span className="cal-detail-badge status-partial">≈ Partial</span>}
                </div>
                <Link className="cal-detail-close" href={collapseCardHref} aria-label="Close selected day panel">
                  ✕
                </Link>
              </div>
            </div>

            <div className="cal-day-details-body">

            {/* Planned activities + day log (unified DayLogCard) */}
            {selectedPlanActivities.length === 0 && (
              <p className="cal-day-empty">No planned activities on this day.</p>
            )}
            {selectedPlanActivities.length > 0 && (
              <DayLogCard
                dayId={selectedDayInfo?.dayId || null}
                dateISO={selectedDateKey}
                planId={selectedPlan.id}
                activities={buildLogActivities(selectedPlanActivities, viewerUnits)}
                viewerUnits={viewerUnits}
                dayStatus={selectedDayStatus}
                missedReason={selectedDayInfo?.missedReason || null}
                stravaConnected={Boolean(stravaAccount)}
                enabled={selectedIsPastOrToday}
                showSyncedStravaSection={false}
                successRedirectHref={dashboardReturnHref}
              />
            )}

            {/* Logged activities (Strava / external) */}
            {(selectedIsPastOrToday && selectedExternalLogs.length > 0) && (
              <div className="cal-day-detail-section">
                <div className="cal-day-detail-section-header">
                  <h4>Logged Activities</h4>
                  {stravaAccount && <StravaDaySyncButton dateISO={selectedDateKey} planId={selectedPlan.id} className="cal-strava-sync-btn" />}
                </div>
                <div className="cal-log-items-grid">
                {selectedExternalLogs.map((log) => {
                  const matchLevel = resolveMatchLevel(log);
                  const isMatched = Boolean(log.matchedPlanActivityId);
                  const routePreview = buildStravaRoutePreview({
                    name: log.name,
                    sportType: log.sportType,
                    startTime: log.startTime,
                    distanceM: log.distanceM,
                    movingTimeSec: log.durationSec,
                    elevationGainM: null,
                    raw: log.raw,
                  });
                  return (
                    <div key={log.id} className={logItemClass(matchLevel)}>
                      <div className="cal-day-detail-title">
                        <strong className="cal-day-log-title">
                          <ExternalSportIcon
                            provider={log.provider}
                            sportType={log.sportType}
                            className="cal-day-log-icon"
                          />
                          <span>{log.name}</span>
                        </strong>
                        <span className="cal-day-log-provider">
                          {log.provider === 'STRAVA'
                            ? <StravaIcon size={13} className="cal-day-log-provider-icon" />
                            : formatProviderName(log.provider)}
                          {' · '}{log.startTimeLabel || formatClock(log.startTime)}
                        </span>
                      </div>
                      <div className="cal-day-detail-meta">
                        <span>{formatDistanceMeters(log.distanceM, viewerUnits)} · {formatDurationSeconds(log.durationSec)}{log.avgHeartRate ? ` · HR ${log.avgHeartRate} bpm` : ''}</span>
                        {log.calories ? <span>{Math.round(log.calories)} kcal</span> : null}
                      </div>
                      {routePreview ? (
                        <CalendarRouteMap
                          routePoints={routePreview.routePoints}
                          ariaLabel={routePreview.name ? `${routePreview.name} route` : 'Activity route'}
                        />
                      ) : (() => {
                        const photo = getSportPhotoUrl(log.sportType, log.provider, log.raw);
                        return photo ? (
                          <div className={`cal-log-activity-photo${photo.isActivityPhoto ? ' is-activity-photo' : ''}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.url} alt={getSportPhotoAlt(log.sportType)} loading="lazy" />
                          </div>
                        ) : null;
                      })()}
                      <div className="cal-day-log-match-row">
                        <span className={matchBadgeClass(matchLevel, isMatched)}>
                          {matchBadgeLabel(matchLevel, isMatched)}
                        </span>
                        {log.equivalenceNote && (
                          <span className="cal-day-log-match-note">{log.equivalenceNote}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            )}

            {/* Empty state: no external logs (past/today only) */}
            {selectedIsPastOrToday && selectedExternalLogs.length === 0 && (
              <div className="cal-day-detail-section">
                <div className="cal-day-detail-section-header">
                  <h4>Logged Activities</h4>
                  {stravaAccount && <StravaDaySyncButton dateISO={selectedDateKey} planId={selectedPlan.id} className="cal-strava-sync-btn" />}
                </div>
                <p className="cal-day-empty">No synced external logs for this day.</p>
              </div>
            )}
            {!selectedIsPastOrToday && (
              <div className="cal-day-detail-section">
                <h4>Logged Activities</h4>
                <p className="cal-day-empty">Future day. Logs will appear after the activity date.</p>
              </div>
            )}
            </div>
          </div>}

          <div className="dash-card cal-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Quick Actions</span>
            </div>
            {hasSelectedDate && (
              <p className="cal-quick-context">Selected day: {selectedDayLabel}</p>
            )}
            <div className="cal-links">
              <Link href={todayHref}>Go to Today</Link>
              {hasSelectedDate ? (
                <>
                  {selectedIsPastOrToday ? (
                    stravaAccount ? (
                      <StravaDaySyncButton dateISO={selectedDateKey!} planId={selectedPlan.id} className="cal-strava-sync-btn" />
                    ) : (
                      <Link href="/strava">Connect Strava to Sync Selected Day</Link>
                    )
                  ) : (
                    <span className="cal-quick-disabled">Sync Selected Day is available on or after that date.</span>
                  )}
                </>
              ) : (
                <span className="cal-quick-disabled">Select a day on the calendar to sync logs.</span>
              )}
              <Link href={adjustThisWeekHref}>Adjust This Week</Link>
            </div>
          </div>

          <div className="dash-card cal-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Selected Plan</span>
            </div>
            <div className="cal-selected-plan-summary">
              <strong>{sourcePlanName || selectedPlan.name}</strong>
              <span>{selectedPlan.raceName || "Race not set"} · {formatDateLabel(selectedPlan.raceDate)}</span>
            </div>
            <details className="cal-selected-plan-details">
              <summary className="cal-selected-plan-toggle">
                <span className="cal-toggle-label-closed">View details</span>
                <span className="cal-toggle-label-open">Hide details</span>
              </summary>
              <div className="cal-selected-plan-details-body">
                <div className="cal-info-list">
                  <div>
                    <strong>Plan name</strong>
                    <span>{sourcePlanName || selectedPlan.name}</span>
                  </div>
                  <div>
                    <strong>Race</strong>
                    <span>{selectedPlan.raceName || "Not set"}</span>
                  </div>
                  <div>
                    <strong>Race date</strong>
                    <span>{formatDateLabel(selectedPlan.raceDate)}</span>
                  </div>
                  <div>
                    <strong>Training window</strong>
                    <span>{`${formatDateLabel(planStartDate)} - ${formatDateLabel(planEndDate)}`}</span>
                  </div>
                </div>
                <RaceDetailsEditor
                  planId={selectedPlan.id}
                  initialRaceName={selectedPlan.raceName || ""}
                  initialRaceDate={toDateInputValue(selectedPlan.raceDate)}
                  initialStartDate={weekOneStartDate}
                  initialWeekDateAnchor={initialWeekDateAnchor}
                />
              </div>
            </details>
          </div>

          <div className="dash-card cal-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">This Month</span>
            </div>
            <div className="cal-info-list">
              <div>
                <strong>Workouts</strong>
                <span>{monthWorkoutCount}</span>
              </div>
              <div>
                <strong>Completed</strong>
                <span>{monthCompletedCount}</span>
              </div>
              <div>
                <strong>Completion</strong>
                <span>{monthCompletionPct}%</span>
              </div>
              <div>
                <strong>Date alignment</strong>
                <span>
                  {derivedWeekCount > 0 && storedWeekCount === 0
                    ? "Race-derived"
                    : derivedWeekCount > 0
                      ? "Mixed (stored + race-derived)"
                      : "Stored week dates"}
                </span>
              </div>
            </div>
          </div>

        </aside>
      </div>
    </main>
  );
}
