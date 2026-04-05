import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseWeekWithAI, maybeRunParserV4, maybeRunParserV5, maybeRunVisionExtract } from '@/lib/ai-plan-parser';
import { extractPlanGuide } from '@/lib/ai-guide-extractor';
import { extractPdfText } from '@/lib/pdf/extract-text';
import { FLAGS } from '@/lib/feature-flags';
import { populatePlanFromV4 } from '@/lib/parsing/v4-to-plan';
import { enrichLegacyDayDraftsFromProgram } from '@/lib/parsing/legacy-program-enrichment';
import {
  deriveUploadDocumentSignals,
  orchestrateUploadParsing,
  scoreProgramJsonForTables,
  type UploadParserKey,
  type UploadParserRun,
} from '@/lib/parsing/upload-orchestrator';
import { runTimedUploadCandidate } from '@/lib/parsing/upload-candidate-runner';
import { canonicalizeTableLabel, extractWeekNumber, normalizePlanText } from '@/lib/plan-parser-i18n.mjs';
import { normalizeWhitespace, titleCase, planNameFromFilename, decodeActivityText, normalizeMatchText, chooseActivityRawText, expandAlternatives, splitCombinedActivities } from '@/lib/parsing/upload-normalizers';
import { SUBTYPE_TITLES, normalizeSubtypeToken, inferSubtype, mapActivityType, mapAiTypeToActivityType, mapAiSessionTypeToSubtype, mapAiPrimarySportToType } from '@/lib/parsing/activity-type-mapper';
import { type UnitPreference, convertDistanceToStorageUnit, resolveDistanceFromValueUnit, resolveDistanceFromSegmentMetrics, inferDominantDistanceUnit, resolveDistanceFromText, parseStructure, resolveDistanceFromStructure, resolveDurationFromText } from '@/lib/parsing/distance-parser';
import { hasConfiguredAiProvider } from '@/lib/openai';
import { buildProgramDocumentProfile, withParserPipelineProfile, type ProgramDocumentProfile } from '@/lib/plan-document-profile';
import {
  deriveStructuredIntensityTargets,
  extractEffortTargetFromText,
  extractPaceTargetFromText,
  hasConcretePaceValue,
  inferSymbolicPaceBucketFromText,
  paceBucketLabel,
  type PaceBucket
} from '@/lib/intensity-targets';
import { normalizePaceForStorage } from '@/lib/unit-display';
import { deriveSmartActivityTitle, isGenericActivityTitle } from '@/lib/activity-title';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pathToFileURL } from 'url';

export const runtime = 'nodejs';
export const maxDuration = 300;

const execFileAsync = promisify(execFile);
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const TABLE_LABELS = ['WEEK', ...DAY_LABELS];
const ENABLE_AI_WEEK_PARSE = process.env.ENABLE_AI_WEEK_PARSE === 'true' && hasConfiguredAiProvider();

function parseTimeoutMs(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1000) return fallback;
  return Math.floor(parsed);
}

function parseBoundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const UPLOAD_PARSE_TIMEOUT_MS = parseTimeoutMs(process.env.UPLOAD_PARSE_TIMEOUT_MS, 180000);
const UPLOAD_AI_CANDIDATE_TIMEOUT_MS = parseTimeoutMs(process.env.UPLOAD_AI_CANDIDATE_TIMEOUT_MS, 90000);
const UPLOAD_LEGACY_CANDIDATE_TIMEOUT_MS = parseTimeoutMs(process.env.UPLOAD_LEGACY_CANDIDATE_TIMEOUT_MS, 60000);
const AI_WEEK_PARSE_TIMEOUT_MS = parseTimeoutMs(process.env.AI_WEEK_PARSE_TIMEOUT_MS, 8000);
const AI_WEEK_PARSE_TOTAL_BUDGET_MS = parseTimeoutMs(process.env.AI_WEEK_PARSE_TOTAL_BUDGET_MS, 30000);
const AI_WEEK_PARSE_MODEL = process.env.AI_WEEK_PARSE_MODEL?.trim() || undefined;
const AI_WEEK_PARSE_MAX_DAYS = Math.floor(
  parseBoundedNumber(process.env.AI_WEEK_PARSE_MAX_DAYS, 3, 1, DAY_KEYS.length)
);
const PARSE_MIN_QUALITY_SCORE = parseBoundedNumber(process.env.PARSE_MIN_QUALITY_SCORE, 30, 0, 100);
const PARSE_MIN_DAY_COVERAGE = parseBoundedNumber(process.env.PARSE_MIN_DAY_COVERAGE, 0.12, 0, 1);
const PLAN_UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const MAX_PLAN_UPLOADS_PER_WINDOW = 10;
const PDF_MAGIC_PREFIX = '%PDF-';


async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

type ParsedDayEntry = {
  raw?: string | null;
  segments_parsed?: Array<{ type?: string | null }> | null;
};

type ParsedWeekEntry = {
  week_number?: number | null;
  days?: Partial<Record<string, ParsedDayEntry | null>> | null;
};

type ParseQuality = {
  score: number;
  weekCount: number;
  dayCoverage: number;
  populatedDays: number;
  totalDaySlots: number;
  avgCharsPerPopulatedDay: number;
  unknownSegmentRatio: number;
  consecutiveWeekCoverage: number;
};

type ParseCandidate = {
  parser: 'python' | 'node' | 'node-text';
  parsed: ParsedPlanOutput;
  quality: ParseQuality;
};

type ParsedPlanOutput = Record<string, unknown> & {
  weeks: ParsedWeekEntry[];
  glossary?: { note?: string | null } & Record<string, unknown>;
  program_profile?: ProgramDocumentProfile;
  parser?: string;
  parse_debug?: Record<string, unknown>;
  parse_meta?: {
    selectedParser: string;
    quality: ParseQuality;
    selectedDiagnostics?: Record<string, unknown> | null;
    candidates: Array<{
      parser: string;
      quality: ParseQuality;
      diagnostics?: Record<string, unknown> | null;
    }>;
  };
};

function buildProfileFromParsed(planName: string, parsed: ParsedPlanOutput): ProgramDocumentProfile {
  return buildProgramDocumentProfile({
    planName,
    weeks: Array.isArray(parsed.weeks) ? parsed.weeks : []
  });
}

function toParsedDayEntry(value: unknown): ParsedDayEntry {
  if (!value || typeof value !== 'object') return {};
  const raw = typeof (value as { raw?: unknown }).raw === 'string' ? (value as { raw: string }).raw : null;
  const segmentsCandidate = (value as { segments_parsed?: unknown }).segments_parsed;
  const segments = Array.isArray(segmentsCandidate)
    ? segmentsCandidate
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({ type: typeof (entry as { type?: unknown }).type === 'string' ? (entry as { type: string }).type : null }))
    : null;
  return { raw, segments_parsed: segments };
}

function scoreParsedResult(parsed: unknown): ParseQuality {
  const weeks = Array.isArray((parsed as { weeks?: unknown })?.weeks)
    ? ((parsed as { weeks: unknown[] }).weeks as ParsedWeekEntry[])
    : [];

  const weekCount = weeks.length;
  const totalDaySlots = weekCount * DAY_KEYS.length;
  let populatedDays = 0;
  let charCount = 0;
  let unknownSegments = 0;
  let totalSegments = 0;
  const weekNumbers: number[] = [];

  for (let i = 0; i < weeks.length; i += 1) {
    const week = weeks[i];
    const weekNumber = typeof week?.week_number === 'number' && Number.isFinite(week.week_number)
      ? week.week_number
      : i + 1;
    weekNumbers.push(weekNumber);

    const days = week?.days && typeof week.days === 'object' ? week.days : {};
    for (const day of DAY_KEYS) {
      const entry = toParsedDayEntry((days as Record<string, unknown>)[day]);
      const raw = String(entry.raw || '').trim();
      if (raw) {
        populatedDays += 1;
        charCount += raw.length;
      }
      const segments = Array.isArray(entry.segments_parsed) ? entry.segments_parsed : [];
      totalSegments += segments.length;
      unknownSegments += segments.filter((segment) => segment?.type === 'unknown').length;
    }
  }

  const dayCoverage = totalDaySlots > 0 ? populatedDays / totalDaySlots : 0;
  const avgCharsPerPopulatedDay = populatedDays > 0 ? charCount / populatedDays : 0;
  const unknownSegmentRatio = totalSegments > 0 ? unknownSegments / totalSegments : 0;

  const uniqueWeeks = [...new Set(weekNumbers)].sort((a, b) => a - b);
  let longestRun = uniqueWeeks.length > 0 ? 1 : 0;
  let currentRun = uniqueWeeks.length > 0 ? 1 : 0;
  for (let i = 1; i < uniqueWeeks.length; i += 1) {
    if (uniqueWeeks[i] === uniqueWeeks[i - 1] + 1) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 1;
    }
  }
  const consecutiveWeekCoverage = uniqueWeeks.length > 0 ? longestRun / uniqueWeeks.length : 0;

  let score = 0;
  if (weekCount > 0) score += 20;
  if (weekCount >= 2) score += 10;
  if (weekCount >= 4) score += 5;
  if (weekCount >= 8) score += 5;
  score += Math.round(Math.min(1, dayCoverage) * 40);

  if (avgCharsPerPopulatedDay >= 20) score += 10;
  else if (avgCharsPerPopulatedDay >= 8) score += 8;
  else if (avgCharsPerPopulatedDay >= 3) score += 5;
  else if (avgCharsPerPopulatedDay > 0) score += 2;

  score += Math.round(Math.min(1, consecutiveWeekCoverage) * 10);
  if (unknownSegmentRatio > 0.6) score -= 6;
  else if (unknownSegmentRatio > 0.35) score -= 3;
  if (weekCount === 0 || dayCoverage === 0) score = 0;

  return {
    score: Math.min(100, Math.max(0, score)),
    weekCount,
    dayCoverage,
    populatedDays,
    totalDaySlots,
    avgCharsPerPopulatedDay: Number(avgCharsPerPopulatedDay.toFixed(2)),
    unknownSegmentRatio: Number(unknownSegmentRatio.toFixed(3)),
    consecutiveWeekCoverage: Number(consecutiveWeekCoverage.toFixed(3))
  };
}

function selectBestParseCandidate(candidates: ParseCandidate[]) {
  const parserPriority: Record<ParseCandidate['parser'], number> = {
    python: 0,
    node: 1,
    'node-text': 2
  };
  const sorted = [...candidates].sort((a, b) => {
    if (b.quality.score !== a.quality.score) return b.quality.score - a.quality.score;
    if (b.quality.dayCoverage !== a.quality.dayCoverage) return b.quality.dayCoverage - a.quality.dayCoverage;
    if (b.quality.weekCount !== a.quality.weekCount) return b.quality.weekCount - a.quality.weekCount;
    if (a.parser === b.parser) return 0;
    return parserPriority[a.parser] - parserPriority[b.parser];
  });
  return sorted[0];
}


type ActivityDraft = {
  planId: string;
  dayId: string;
  type: string;
  subtype: string | null;
  title: string;
  rawText: string | null;
  notes?: string | null;
  sessionInstructions?: string | null;
  distance: number | null;
  distanceUnit: 'MILES' | 'KM' | null;
  duration: number | null;
  paceTarget?: string | null;
  effortTarget?: string | null;
  paceTargetMode?: 'SYMBOLIC' | 'NUMERIC' | 'RANGE' | 'HYBRID' | 'UNKNOWN' | null;
  paceTargetBucket?: PaceBucket | null;
  paceTargetMinSec?: number | null;
  paceTargetMaxSec?: number | null;
  paceTargetUnit?: 'MILES' | 'KM' | null;
  effortTargetType?: 'RPE' | 'HR_ZONE' | 'HR_BPM' | 'TEXT' | null;
  effortTargetMin?: number | null;
  effortTargetMax?: number | null;
  effortTargetZone?: number | null;
  effortTargetBpmMin?: number | null;
  effortTargetBpmMax?: number | null;
  structure?: any;
  tags?: any;
  priority: string | null;
  bailAllowed: boolean;
  mustDo: boolean;
  sessionGroupId?: string | null;
  sessionOrder?: number | null;
  coachingNote?: string | null;
  sessionFocus?: 'tempo' | 'threshold' | 'recovery' | 'long_run' | 'race_sim' | 'strength' | 'other' | null;
};

function ensureDistanceConsistency(activity: ActivityDraft): ActivityDraft {
  if (activity.distance === null || activity.distanceUnit === null) {
    return { ...activity, distance: null, distanceUnit: null, paceTargetUnit: null };
  }
  return activity;
}

function withStructuredIntensityTargets(activity: ActivityDraft): ActivityDraft {
  const structured = deriveStructuredIntensityTargets({
    paceTarget: activity.paceTarget ?? null,
    effortTarget: activity.effortTarget ?? null,
    fallbackUnit: activity.distanceUnit
  });
  return {
    ...activity,
    ...structured
  };
}


function normalizeTargetText(value: unknown) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function paceBucketFromSubtype(subtype: string | null | undefined): PaceBucket | null {
  if (!subtype) return null;
  if (subtype === 'recovery') return 'RECOVERY';
  if (subtype === 'easy-run') return 'EASY';
  if (subtype === 'lrl') return 'LONG';
  if (subtype === 'race' || subtype === 'training-race' || subtype === 'time-trial') return 'RACE';
  if (subtype === 'tempo' || subtype === 'progression' || subtype === 'fast-finish') return 'TEMPO';
  if (subtype === 'interval' || subtype === 'hills' || subtype === 'hill-pyramid' || subtype === 'incline-treadmill') return 'INTERVAL';
  return null;
}

function deriveDeterministicIntensityTargets(args: {
  rawText: string;
  metrics: Record<string, unknown>;
  activityType: string;
  subtype: string | null;
}) {
  const { rawText, metrics, activityType, subtype } = args;
  const metricPaceTarget = normalizeTargetText(metrics?.pace_target);
  const metricEffortTarget = normalizeTargetText(metrics?.effort_target);
  const textPaceTarget = extractPaceTargetFromText(rawText);
  const textEffortTarget = extractEffortTargetFromText(rawText);
  const subtypeBucket = paceBucketFromSubtype(subtype);
  const subtypePaceTarget = activityType === 'RUN' && subtypeBucket
    ? paceBucketLabel(subtypeBucket)
    : null;

  return {
    paceTarget: metricPaceTarget ?? textPaceTarget ?? subtypePaceTarget ?? null,
    effortTarget: metricEffortTarget ?? textEffortTarget ?? null
  };
}

function choosePaceTarget(baseTarget: string | null | undefined, aiTarget: string | null | undefined) {
  const base = normalizeTargetText(baseTarget);
  const ai = normalizeTargetText(aiTarget);
  if (!base) return ai;
  if (!ai) return base;

  const baseConcrete = hasConcretePaceValue(base);
  const aiConcrete = hasConcretePaceValue(ai);
  if (baseConcrete !== aiConcrete) return aiConcrete ? ai : base;

  const baseSymbolic = inferSymbolicPaceBucketFromText(base) !== null;
  const aiSymbolic = inferSymbolicPaceBucketFromText(ai) !== null;
  if (baseSymbolic !== aiSymbolic) return aiSymbolic ? ai : base;

  if (ai.length >= base.length + 6) return ai;
  return base;
}

function chooseEffortTarget(baseTarget: string | null | undefined, aiTarget: string | null | undefined) {
  const base = normalizeTargetText(baseTarget);
  const ai = normalizeTargetText(aiTarget);
  if (!base) return ai;
  if (!ai) return base;
  if (ai.length >= base.length + 6) return ai;
  return base;
}

function scoreDayForAiPass(rawText: string) {
  const text = normalizeWhitespace(rawText || '');
  if (!text) return 0;

  const normalized = normalizePlanText(text).toLowerCase();
  let score = 0;

  if (/[★♥]/.test(text)) score += 2;
  if (/[;|]/.test(text)) score += 2;
  if (/\b(?:wu|cd|xt|str|rst|mob|yog|hik|rp|mp|ns|ff)\b/i.test(normalized)) score += 3;
  if (/\b(?:lr|lrl)\b/i.test(normalized)) score += 2;
  if (/\b(?:e|t|i)\s*:/i.test(normalized)) score += 2;
  if (/\b\d+\s*x\s*\d+(?:\.\d+)?\b/i.test(normalized)) score += 2;
  if (/\([^)]*\d[^)]*\)/.test(text)) score += 1;
  if (text.length > 44) score += 1;
  if ((text.match(/\d+(?:\.\d+)?\s*(?:miles?|mi|km|meters?|metres?|m)\b/gi) || []).length > 1) score += 1;

  return score;
}

function selectAiTargetDayKeys(rawDays: Record<string, string>, maxDays: number) {
  return DAY_KEYS
    .map((dayKey) => {
      const rawText = rawDays[dayKey] || '';
      return { dayKey, score: scoreDayForAiPass(rawText) };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxDays))
    .map((candidate) => candidate.dayKey);
}

function scoreActivityMatch(base: ActivityDraft, ai: ActivityDraft) {
  let score = 0;

  if (base.type === ai.type) score += 4;
  if (base.subtype && ai.subtype && base.subtype === ai.subtype) score += 4;

  const baseRaw = normalizeMatchText(base.rawText);
  const aiRaw = normalizeMatchText(ai.rawText);
  if (baseRaw && aiRaw) {
    if (baseRaw === aiRaw) score += 8;
    else if (baseRaw.includes(aiRaw) || aiRaw.includes(baseRaw)) score += 5;
  }

  const baseTitle = normalizeMatchText(base.title);
  const aiTitle = normalizeMatchText(ai.title);
  if (baseTitle && aiTitle) {
    if (baseTitle === aiTitle) score += 3;
    else if (baseTitle.includes(aiTitle) || aiTitle.includes(baseTitle)) score += 2;
  }

  if (base.distance !== null && ai.distance !== null && base.distanceUnit && ai.distanceUnit && base.distanceUnit === ai.distanceUnit) {
    const delta = Math.abs(base.distance - ai.distance);
    if (delta < 0.2) score += 2;
    else if (delta < 0.5) score += 1;
  }

  return score;
}

function mergeActivityDraft(base: ActivityDraft, ai: ActivityDraft): ActivityDraft {
  const preferBaseSubtype = Boolean(base.subtype && base.subtype !== 'unknown');
  const mergedType = base.type === 'OTHER' ? (ai.type || base.type) : base.type;
  const mergedSubtype = preferBaseSubtype ? base.subtype : (ai.subtype ?? base.subtype);
  const baseIsGenericTitle = isGenericActivityTitle(base.title, mergedType);
  const baseIsOtherType = base.type === 'OTHER';
  const mergedRawText = chooseActivityRawText(base.rawText, ai.rawText);
  const mergedStructure = base.structure || ai.structure || null;
  const mergedSessionInstructions = ai.sessionInstructions ?? base.sessionInstructions ?? null;
  const preferredTitle = baseIsGenericTitle && ai.title ? ai.title : base.title;
  const mergedTitle = deriveSmartActivityTitle({
    currentTitle: preferredTitle,
    activityType: mergedType,
    subtype: mergedSubtype,
    structure: mergedStructure,
    sessionInstructions: mergedSessionInstructions,
    rawText: mergedRawText,
    fallbackTitle: preferredTitle
  });

  return ensureDistanceConsistency({
    ...base,
    type: baseIsOtherType ? (ai.type || base.type) : base.type,
    subtype: mergedSubtype,
    title: mergedTitle,
    rawText: mergedRawText,
    sessionInstructions: mergedSessionInstructions,
    distance: base.distance ?? ai.distance,
    distanceUnit: base.distanceUnit ?? ai.distanceUnit,
    duration: base.duration ?? ai.duration,
    paceTarget: choosePaceTarget(base.paceTarget, ai.paceTarget),
    effortTarget: chooseEffortTarget(base.effortTarget, ai.effortTarget),
    structure: mergedStructure,
    tags: base.tags || ai.tags || null,
    priority: base.priority ?? ai.priority ?? null,
    bailAllowed: base.bailAllowed || ai.bailAllowed,
    mustDo: base.mustDo || ai.mustDo
  });
}

function mergeDayActivitiesWithAI(baseActivities: ActivityDraft[], aiActivities: ActivityDraft[]) {
  if (!aiActivities.length) return baseActivities;
  if (!baseActivities.length) return aiActivities;

  const usedAi = new Set<number>();
  const merged: ActivityDraft[] = [];

  for (const base of baseActivities) {
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < aiActivities.length; i += 1) {
      if (usedAi.has(i)) continue;
      const score = scoreActivityMatch(base, aiActivities[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore >= 4) {
      usedAi.add(bestIdx);
      merged.push(mergeActivityDraft(base, aiActivities[bestIdx]));
    } else {
      merged.push(base);
    }
  }

  for (let i = 0; i < aiActivities.length; i += 1) {
    if (!usedAi.has(i)) merged.push(aiActivities[i]);
  }

  return merged;
}

function buildDeterministicActivities(args: {
  planId: string;
  dayId: string;
  entry: any;
  inferredDistanceUnit: UnitPreference;
  storageDistanceUnit: UnitPreference;
}) {
  const { planId, dayId, entry, inferredDistanceUnit, storageDistanceUnit } = args;
  const drafts: ActivityDraft[] = [];

  const segments = entry?.segments_parsed?.length
    ? entry.segments_parsed
    : [
      {
        text: entry?.raw || '',
        type: entry?.type_guess || 'unknown',
        metrics: entry?.metrics || {}
      }
    ];

  for (const seg of segments) {
    const splitSegments = splitCombinedActivities(seg.text || '');
    const variants = splitSegments.flatMap((segmentText) => expandAlternatives(segmentText));
    for (const variantText of variants) {
      const originalText = variantText.trim();
      if (!originalText) continue;

      const cleanText = originalText.replace(/[★♥]/g, '').trim();
      const decodedText = decodeActivityText(cleanText || originalText);
      const inferred = inferSubtype(decodedText || originalText);
      const normalizedSegSubtype = normalizeSubtypeToken(seg.type || null);
      const subtype = inferred !== 'unknown' ? inferred : (normalizedSegSubtype || 'unknown');
      const activityType = mapActivityType(subtype);
      const mustDo = originalText.includes('★');
      const bailAllowed = originalText.includes('♥');

      const metrics = seg.metrics || {};
      const parsedDistance = resolveDistanceFromSegmentMetrics(metrics, decodedText || originalText);
      const duration =
        metrics?.duration_minutes ??
        metrics?.duration_minutes_range?.[1] ??
        resolveDurationFromText(decodedText || originalText) ??
        null;

      const structure = parseStructure(decodedText || originalText);
      const structuredDistance = parsedDistance.distance === null
        ? resolveDistanceFromStructure(structure)
        : parsedDistance;
      const textDistance = structuredDistance.distance === null
        ? resolveDistanceFromText(decodedText || originalText, inferredDistanceUnit)
        : structuredDistance;
      const storageDistance = convertDistanceToStorageUnit(textDistance, storageDistanceUnit);
      const title =
        activityType === 'REST'
          ? 'Rest Day'
          : SUBTYPE_TITLES[subtype] || titleCase(subtype === 'unknown' ? 'Workout' : subtype);
      const rawText = decodedText || cleanText || originalText;
      const smartTitle = deriveSmartActivityTitle({
        currentTitle: title,
        activityType,
        subtype,
        structure: structure || null,
        rawText,
        fallbackTitle: title
      });
      const intensityTargets = deriveDeterministicIntensityTargets({
        rawText: decodedText || originalText,
        metrics,
        activityType,
        subtype
      });

      drafts.push(ensureDistanceConsistency({
        planId,
        dayId,
        type: activityType,
        subtype,
        title: smartTitle,
        rawText,
        distance: storageDistance.distance,
        distanceUnit: storageDistance.distanceUnit,
        duration,
        paceTarget: normalizePaceForStorage(
          intensityTargets.paceTarget,
          storageDistance.distanceUnit ?? storageDistanceUnit
        ),
        effortTarget: intensityTargets.effortTarget,
        structure: structure || null,
        priority: mustDo ? 'KEY' : bailAllowed ? 'OPTIONAL' : null,
        mustDo,
        bailAllowed
      }));
    }
  }

  if (drafts.length >= 2) {
    const groupId = randomUUID();
    drafts.forEach((d, i) => { d.sessionGroupId = groupId; d.sessionOrder = i + 1; });
  }

  return drafts;
}

function buildAiActivities(args: {
  planId: string;
  dayId: string;
  dayRawText: string;
  aiActivities: any[];
  inferredDistanceUnit: UnitPreference;
  storageDistanceUnit: UnitPreference;
}) {
  const { planId, dayId, dayRawText, aiActivities, inferredDistanceUnit, storageDistanceUnit } = args;
  const drafts: ActivityDraft[] = [];

  for (const a of aiActivities) {
    const sourceRawText = normalizeWhitespace(String(a.raw_text || dayRawText || ''));
    const decodedRawText = decodeActivityText(sourceRawText);
    const instructionText = normalizeWhitespace(String(a.instruction_text || ''));
    const sessionInstructions = instructionText || null;
    const displayRawText = decodedRawText || null;
    const normalizedSubtype = normalizeSubtypeToken(a.subtype || null);
    const sessionSubtype = mapAiSessionTypeToSubtype(a.session_type || null);
    const inferredSubtype = inferSubtype(displayRawText || String(a.title || ''));
    const effectiveSubtype =
      normalizedSubtype && normalizedSubtype !== 'unknown'
        ? normalizedSubtype
        : sessionSubtype
          ? sessionSubtype
        : inferredSubtype !== 'unknown'
          ? inferredSubtype
          : null;
    const aiType = mapAiTypeToActivityType(a.type || null);
    const primarySportType = mapAiPrimarySportToType(a.primary_sport || null);
    const effectiveType = aiType === 'OTHER' && primarySportType ? primarySportType : aiType;
    const aiDistance = resolveDistanceFromValueUnit(
      a.metrics?.distance?.value ?? null,
      a.metrics?.distance?.unit ?? null,
      decodedRawText || dayRawText || ''
    );
    const fallbackTextDistance = aiDistance.distance === null
      ? resolveDistanceFromText(decodedRawText || dayRawText || '', inferredDistanceUnit)
      : aiDistance;
    const storageDistance = convertDistanceToStorageUnit(fallbackTextDistance, storageDistanceUnit);
    const aiDuration = a.metrics?.duration_min ?? resolveDurationFromText(decodedRawText || dayRawText || '') ?? null;
    const normalizedTitle = normalizeWhitespace(String(a.title || ''));
    const intensityType = String(a.target_intensity?.type || '').trim().toLowerCase();
    const intensityValue = normalizeWhitespace(String(a.target_intensity?.value || ''));
    const paceFromTarget = intensityType === 'pace' ? intensityValue : null;
    const effortFromTarget = intensityType && intensityType !== 'pace'
      ? `${intensityType.toUpperCase()}: ${intensityValue}`.trim()
      : null;
    const inferredPriority = a.is_key_session === true
      ? 'KEY'
      : a.priority
        ? String(a.priority).toUpperCase()
        : null;
    const warmupCooldownTag = a.warmup_cooldown_included === true ? ['warmup_cooldown_included'] : [];
    const existingTags = Array.isArray(a.tags) ? a.tags : [];
    const fallbackTitle = effectiveSubtype
      ? SUBTYPE_TITLES[effectiveSubtype] || titleCase(effectiveSubtype)
      : 'Workout';
    const smartTitle = deriveSmartActivityTitle({
      currentTitle: normalizedTitle || fallbackTitle,
      activityType: effectiveType,
      subtype: effectiveSubtype,
      sessionType: a.session_type || null,
      structure: a.structure || null,
      sessionInstructions,
      rawText: displayRawText,
      fallbackTitle
    });
    const textPaceTarget = extractPaceTargetFromText(displayRawText || decodedRawText || dayRawText || '');
    const textEffortTarget = extractEffortTargetFromText(displayRawText || decodedRawText || dayRawText || '');
    drafts.push(ensureDistanceConsistency({
      planId,
      dayId,
      type: effectiveType,
      subtype: effectiveSubtype,
      title: smartTitle,
      rawText: displayRawText,
      sessionInstructions,
      distance: storageDistance.distance,
      distanceUnit: storageDistance.distanceUnit,
      duration: aiDuration,
      paceTarget: normalizePaceForStorage(
        choosePaceTarget(a.metrics?.pace_target ?? paceFromTarget, textPaceTarget),
        storageDistance.distanceUnit ?? storageDistanceUnit
      ),
      effortTarget: chooseEffortTarget(a.metrics?.effort_target ?? effortFromTarget, textEffortTarget),
      structure: a.structure || null,
      tags: [...existingTags, ...warmupCooldownTag],
      priority: inferredPriority,
      bailAllowed: Boolean(a.constraints?.bail_allowed),
      mustDo: Boolean(a.constraints?.must_do)
    }));
  }

  return drafts;
}

type PdfTextItem = {
  str: string;
  x: number;
  y: number;
};

type RowCluster = {
  y: number;
  items: PdfTextItem[];
};

type TableHeader = {
  y: number;
  columns: number[];
  twmColumn: number | null;
};

type WeekDayBuckets = Record<string, string[]>;

type DayTextSegment = {
  dayKey: string;
  content: string;
};

type TextFallbackDiagnostics = {
  pagesScanned: number;
  rowClusters: number;
  weekMarkersFound: number;
  dayMarkersFound: number;
  linesAssigned: number;
  continuationLines: number;
  linesDroppedNoWeek: number;
  linesDroppedNoDay: number;
};

type PendingImplicitLine = {
  dayKey: string;
  content: string;
  continuation: boolean;
};


function clusterRows(items: PdfTextItem[], tolerance = 2): RowCluster[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const clusters: RowCluster[] = [];

  for (const item of sorted) {
    const cluster = clusters.find((c) => Math.abs(c.y - item.y) <= tolerance);
    if (!cluster) {
      clusters.push({ y: item.y, items: [item] });
      continue;
    }
    cluster.items.push(item);
  }

  return clusters
    .map((cluster) => ({
      y: cluster.y,
      items: cluster.items.sort((a, b) => a.x - b.x)
    }))
    .sort((a, b) => b.y - a.y);
}

function splitRowItemsByLargeXGaps(items: PdfTextItem[], pageWidth: number) {
  if (items.length <= 1) return [items];

  const sorted = [...items].sort((a, b) => a.x - b.x);
  const gapThreshold = Math.max(110, Math.min(220, pageWidth * 0.18));
  const segments: PdfTextItem[][] = [];
  let current: PdfTextItem[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const xGap = next.x - prev.x;
    if (xGap > gapThreshold) {
      segments.push(current);
      current = [next];
      continue;
    }
    current.push(next);
  }

  if (current.length) segments.push(current);
  return segments;
}

function buildColumnBoundaries(columns: number[], twmColumn: number | null, pageWidth: number) {
  const sorted = [...columns].sort((a, b) => a - b);
  const boundaries: number[] = [];
  const leadingGap = sorted.length > 1 ? Math.max(20, (sorted[1] - sorted[0]) * 0.5) : 28;
  boundaries.push(Math.max(0, sorted[0] - leadingGap));

  for (let i = 1; i < sorted.length; i += 1) {
    boundaries.push((sorted[i - 1] + sorted[i]) / 2);
  }

  const defaultTrailingGap = sorted.length > 1 ? Math.max(26, (sorted[sorted.length - 1] - sorted[sorted.length - 2]) * 0.8) : 48;
  const trailingBoundary = twmColumn && twmColumn > sorted[sorted.length - 1]
    ? (sorted[sorted.length - 1] + twmColumn) / 2
    : Math.min(pageWidth - 2, sorted[sorted.length - 1] + defaultTrailingGap);
  boundaries.push(trailingBoundary);

  return boundaries;
}

function getColumnIndexForX(x: number, boundaries: number[]) {
  if (!Number.isFinite(x)) return -1;
  if (boundaries.length < 2) return -1;
  if (x < boundaries[0] || x >= boundaries[boundaries.length - 1]) return -1;
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    if (x >= boundaries[i] && x < boundaries[i + 1]) return i;
  }
  return -1;
}

function isLikelyFootnoteOnly(text: string) {
  const t = normalizeWhitespace(text);
  if (!t) return true;
  if (/^\d{1,2}$/.test(t)) return true;
  if (/^[\[(]?\d{1,2}[\])]?$/.test(t)) return true;
  if (/^[★♥]+$/.test(t)) return true;
  return false;
}

function isRepeatedTableHeaderRow(cells: string[]) {
  const canonical = cells
    .map((cell) => canonicalizeTableLabel(cell))
    .filter((label): label is string => Boolean(label));
  if (!canonical.length) return false;
  const names = new Set(canonical);
  return TABLE_LABELS.every((label) => names.has(label));
}

function findTableHeader(items: PdfTextItem[]) {
  const labels = items
    .map((item) => ({
      item,
      canonical: canonicalizeTableLabel(item.str)
    }))
    .filter((entry): entry is { item: PdfTextItem; canonical: string } => Boolean(entry.canonical));
  const mondayRows = labels.filter((entry) => entry.canonical === 'MONDAY');

  for (const monday of mondayRows) {
    const row = labels.filter((entry) => Math.abs(entry.item.y - monday.item.y) <= 2);
    const names = new Set(row.map((entry) => entry.canonical));
    if (!TABLE_LABELS.every((label) => names.has(label))) continue;

    // Intentionally ignore trailing summary columns like TWM (total weekly mileage).
    // Parsing anchors only map to WEEK + weekday columns.
    const columns = TABLE_LABELS.map((label) => {
      const candidates = row
        .filter((entry) => entry.canonical === label)
        .sort((a, b) => a.item.x - b.item.x);
      return candidates[0]?.item.x ?? 0;
    });

    const twmCandidates = row
      .filter((entry) => entry.canonical === 'TWM')
      .sort((a, b) => a.item.x - b.item.x);

    const twmColumn = twmCandidates[0]?.item.x ?? null;
    return { y: monday.item.y, columns, twmColumn } as TableHeader;
  }

  return null;
}

function createWeekDayBuckets(): WeekDayBuckets {
  return DAY_KEYS.reduce((acc, day) => {
    acc[day] = [];
    return acc;
  }, {} as WeekDayBuckets);
}

function ensureWeekBucket(weeks: Map<number, WeekDayBuckets>, weekNumber: number) {
  if (!weeks.has(weekNumber)) {
    weeks.set(weekNumber, createWeekDayBuckets());
  }
  return weeks.get(weekNumber)!;
}

function dayKeyFromLabel(label: string): string | null {
  const normalized = normalizePlanText(label || '').toLowerCase().trim();
  const dayNumber = normalized.match(/^day\s*([1-7])$/i);
  if (dayNumber) {
    const index = Number(dayNumber[1]) - 1;
    return DAY_KEYS[index] || null;
  }

  const canonical = canonicalizeTableLabel(normalized);
  if (!canonical) return null;
  const dayIndex = DAY_LABELS.indexOf(canonical);
  if (dayIndex < 0) return null;
  return DAY_KEYS[dayIndex];
}

function extractDaySegmentsFromLine(line: string): DayTextSegment[] {
  const text = normalizeWhitespace(line);
  if (!text) return [];

  const markerRegex = /\b(Day\s*[1-7]|[A-Za-zÀ-ÿ]{2,12})\b\s*:\s*/gi;
  const validMarkers = [...text.matchAll(markerRegex)]
    .map((match) => {
      const label = match[1] || '';
      const dayKey = dayKeyFromLabel(label);
      return {
        index: match.index ?? -1,
        marker: match[0] || '',
        dayKey
      };
    })
    .filter((marker) => marker.index >= 0 && marker.dayKey);

  if (validMarkers.length > 0) {
    return validMarkers.map((marker, index) => {
      const start = marker.index + marker.marker.length;
      const end = index + 1 < validMarkers.length ? validMarkers[index + 1].index : text.length;
      return {
        dayKey: marker.dayKey as string,
        content: normalizeWhitespace(text.slice(start, end))
      };
    });
  }

  const lineStartMarker = text.match(/^(?:[-*•]\s*)?(Day\s*[1-7]|[A-Za-zÀ-ÿ]{2,12})\b\.?\s*(?:[:\-]\s*)?(.*)$/i);
  if (!lineStartMarker) return [];
  const dayKey = dayKeyFromLabel(lineStartMarker[1] || '');
  if (!dayKey) return [];

  return [{
    dayKey,
    content: normalizeWhitespace(lineStartMarker[2] || '')
  }];
}

function extractWeekHeading(line: string) {
  const text = normalizeWhitespace(line);
  if (!text) return null;

  const explicit = text.match(/^(?:week|wk|woche|semaine|semana|sem)\s*[:#-]?\s*(\d{1,2})\b[.:;\-]?\s*(.*)$/i);
  if (explicit) {
    return {
      weekNumber: Number(explicit[1]),
      remainder: normalizeWhitespace(explicit[2] || '')
    };
  }

  const weekNumber = extractWeekNumber(text);
  if (!weekNumber) return null;
  if (!/\b(?:week|wk|woche|semaine|semana|sem)\b/i.test(normalizePlanText(text))) return null;

  const remainder = normalizeWhitespace(
    text.replace(/^(?:.*?\b(?:week|wk|woche|semaine|semana|sem)\b\s*[:#-]?\s*\d{1,2}\b[.:;\-]?)/i, '')
  );
  return { weekNumber, remainder };
}

function buildParsedWeeks(weeks: Map<number, WeekDayBuckets>) {
  return [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekNumber, dayValues]) => ({
      week_number: weekNumber,
      days: DAY_KEYS.reduce((acc, day) => {
        const raw = normalizeWhitespace((dayValues[day] || []).join(' '))
          .replace(/\b([A-Za-z]+)-([A-Za-z]+)\b/g, '$1$2');
        acc[day] = { raw };
        return acc;
      }, {} as Record<string, { raw: string }>)
    }));
}

function hasStrongImplicitWeekSignal(daySequence: string[]) {
  if (!daySequence.length) return false;
  const deduped = daySequence.filter((day, index) => index === 0 || day !== daySequence[index - 1]);
  const uniqueDays = new Set(deduped);
  if (uniqueDays.size >= 5) return true;
  for (let i = 0; i <= deduped.length - 3; i += 1) {
    if (deduped[i] === 'monday' && deduped[i + 1] === 'tuesday' && deduped[i + 2] === 'wednesday') {
      return true;
    }
  }
  return false;
}

async function parseTextStructuredWeeks(pdf: any) {
  const weeks = new Map<number, WeekDayBuckets>();
  const diagnostics: TextFallbackDiagnostics = {
    pagesScanned: pdf.numPages,
    rowClusters: 0,
    weekMarkersFound: 0,
    dayMarkersFound: 0,
    linesAssigned: 0,
    continuationLines: 0,
    linesDroppedNoWeek: 0,
    linesDroppedNoDay: 0
  };

  let activeWeek: number | null = null;
  let activeDay: string | null = null;
  let nextImplicitWeek = 1;
  let pendingImplicitActiveDay: string | null = null;
  let pendingImplicitLines: PendingImplicitLine[] = [];
  let pendingImplicitDaySequence: string[] = [];

  const resetPendingImplicit = () => {
    pendingImplicitActiveDay = null;
    pendingImplicitLines = [];
    pendingImplicitDaySequence = [];
  };

  const flushPendingImplicitToWeek = (weekBucket: WeekDayBuckets) => {
    for (const pending of pendingImplicitLines) {
      const content = normalizeWhitespace(pending.content || '');
      if (!content || isLikelyFootnoteOnly(content)) continue;
      weekBucket[pending.dayKey].push(content);
      diagnostics.linesAssigned += 1;
      if (pending.continuation) diagnostics.continuationLines += 1;
    }
    resetPendingImplicit();
  };

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const items: PdfTextItem[] = (textContent.items as any[])
      .map((item) => ({
        str: String(item.str || '').trim(),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0)
      }))
      .filter((item) => item.str && item.y > 35);
    const pageWidth = Number((page as { view?: number[] }).view?.[2] || 1000);

    const rowTexts = clusterRows(items)
      .flatMap((cluster) => splitRowItemsByLargeXGaps(cluster.items, pageWidth)
        .map((segment) => normalizeWhitespace(segment.map((item) => item.str).join(' '))))
      .filter(Boolean);

    diagnostics.rowClusters += rowTexts.length;

    for (const rowTextValue of rowTexts) {
      let rowText = normalizeWhitespace(rowTextValue);
      if (!rowText || isLikelyFootnoteOnly(rowText)) continue;
      if (/^(?:page\s*)?\d+\s*(?:of\s*\d+)?$/i.test(rowText)) continue;

      const weekHeading = extractWeekHeading(rowText);
      if (weekHeading) {
        resetPendingImplicit();
        activeWeek = weekHeading.weekNumber;
        nextImplicitWeek = Math.max(nextImplicitWeek, activeWeek + 1);
        ensureWeekBucket(weeks, activeWeek);
        diagnostics.weekMarkersFound += 1;
        activeDay = null;
        rowText = weekHeading.remainder;
        if (!rowText) continue;
      }

      const daySegments = extractDaySegmentsFromLine(rowText);
      if (daySegments.length > 0) {
        if (!activeWeek) {
          for (const segment of daySegments) {
            diagnostics.dayMarkersFound += 1;
            pendingImplicitActiveDay = segment.dayKey;
            pendingImplicitDaySequence.push(segment.dayKey);
            const content = normalizeWhitespace(segment.content);
            if (!content || isLikelyFootnoteOnly(content)) continue;
            pendingImplicitLines.push({
              dayKey: segment.dayKey,
              content,
              continuation: false
            });
          }

          if (hasStrongImplicitWeekSignal(pendingImplicitDaySequence)) {
            activeWeek = nextImplicitWeek;
            nextImplicitWeek += 1;
            const promotedActiveDay = pendingImplicitActiveDay;
            const weekBucket = ensureWeekBucket(weeks, activeWeek);
            flushPendingImplicitToWeek(weekBucket);
            activeDay = promotedActiveDay;
          }
          continue;
        }

        const weekBucket = ensureWeekBucket(weeks, activeWeek);
        let assignedInLine = 0;
        for (const segment of daySegments) {
          diagnostics.dayMarkersFound += 1;
          activeDay = segment.dayKey;
          const content = normalizeWhitespace(segment.content);
          if (!content || isLikelyFootnoteOnly(content)) continue;
          weekBucket[segment.dayKey].push(content);
          assignedInLine += 1;
        }
        if (assignedInLine > 0) diagnostics.linesAssigned += 1;
        continue;
      }

      if (!activeWeek) {
        if (pendingImplicitActiveDay) {
          pendingImplicitLines.push({
            dayKey: pendingImplicitActiveDay,
            content: rowText,
            continuation: true
          });
          continue;
        }
        diagnostics.linesDroppedNoWeek += 1;
        continue;
      }
      if (!activeDay) {
        diagnostics.linesDroppedNoDay += 1;
        continue;
      }

      const weekBucket = ensureWeekBucket(weeks, activeWeek);
      weekBucket[activeDay].push(rowText);
      diagnostics.linesAssigned += 1;
      diagnostics.continuationLines += 1;
    }
  }

  return { weeks, diagnostics };
}

async function parsePdfToJsonNode(pdfPath: string, name: string): Promise<ParsedPlanOutput> {
  const bytes = await fs.readFile(pdfPath);
  const workerPath = path.join(
    process.cwd(),
    'node_modules',
    'pdfjs-dist',
    'legacy',
    'build',
    'pdf.worker.mjs'
  );
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const loadingTask = (pdfjsLib as any).getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true
  });
  const pdf = await loadingTask.promise;
  const weeks = new Map<number, Record<string, string[]>>();
  const tableDiagnostics = {
    pagesScanned: pdf.numPages,
    pagesWithHeader: 0,
    rowClusters: 0,
    rowsAssigned: 0,
    rowsDroppedNoWeek: 0,
    rowsDroppedHeader: 0,
    weekMarkersFound: 0,
    tokenTotal: 0,
    tokenAssigned: 0
  };
  let carryWeekNumber: number | null = null;

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const items: PdfTextItem[] = (textContent.items as any[])
      .map((item) => ({
        str: String(item.str || '').trim(),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0)
      }))
      .filter((item) => item.str);

    const header = findTableHeader(items);
    if (!header) continue;
    tableDiagnostics.pagesWithHeader += 1;
    const pageWidth = Number((page as { view?: number[] }).view?.[2] || 1000);
    const boundaries = buildColumnBoundaries(header.columns, header.twmColumn, pageWidth);

    const bodyItems = items.filter((item) => (
      item.y < header.y - 3
      && item.y > 55
      && item.x >= boundaries[0] - 4
      && item.x < boundaries[boundaries.length - 1] + 4
    ));

    const rows = clusterRows(bodyItems).map((cluster) => {
      const cellParts: string[][] = Array.from({ length: 8 }, () => []);
      let assignedCount = 0;

      for (const item of cluster.items) {
        tableDiagnostics.tokenTotal += 1;
        const columnIndex = getColumnIndexForX(item.x, boundaries);
        if (columnIndex < 0 || columnIndex >= cellParts.length) continue;
        cellParts[columnIndex].push(item.str);
        assignedCount += 1;
        tableDiagnostics.tokenAssigned += 1;
      }

      return {
        y: cluster.y,
        cells: cellParts.map((parts) => normalizeWhitespace(parts.join(' '))),
        assignedCount
      };
    }).filter((row) => row.cells.some(Boolean));

    tableDiagnostics.rowClusters += rows.length;
    let activeWeek = carryWeekNumber;

    for (const row of rows) {
      if (isRepeatedTableHeaderRow(row.cells)) {
        tableDiagnostics.rowsDroppedHeader += 1;
        continue;
      }

      const weekFromCell = extractWeekNumber(row.cells[0] || '');
      if (weekFromCell) {
        activeWeek = weekFromCell;
        carryWeekNumber = weekFromCell;
        tableDiagnostics.weekMarkersFound += 1;
      }

      const dayCells = row.cells.slice(1, 1 + DAY_KEYS.length);
      if (!dayCells.some((cell) => cell.length > 0)) continue;

      if (!activeWeek) {
        tableDiagnostics.rowsDroppedNoWeek += 1;
        continue;
      }
      const weekNumber = activeWeek;

      if (!weeks.has(weekNumber)) {
        weeks.set(weekNumber, DAY_KEYS.reduce((acc, day) => {
          acc[day] = [];
          return acc;
        }, {} as Record<string, string[]>));
      }

      const bucket = weeks.get(weekNumber)!;
      let rowStored = false;
      for (let i = 0; i < DAY_KEYS.length; i += 1) {
        const cell = dayCells[i];
        if (!cell || isLikelyFootnoteOnly(cell)) continue;
        const cellLabel = canonicalizeTableLabel(cell);
        if (cellLabel && (TABLE_LABELS.includes(cellLabel) || cellLabel === 'TWM')) continue;
        bucket[DAY_KEYS[i]].push(cell);
        rowStored = true;
      }
      if (rowStored || row.assignedCount > 0) {
        tableDiagnostics.rowsAssigned += 1;
      }
    }
  }

  let parseMode: 'table' | 'text' = 'table';
  let parsedWeeks = buildParsedWeeks(weeks);
  let textFallbackDiagnostics: TextFallbackDiagnostics | null = null;

  if (!parsedWeeks.length) {
    const fallback = await parseTextStructuredWeeks(pdf);
    parsedWeeks = buildParsedWeeks(fallback.weeks);
    textFallbackDiagnostics = fallback.diagnostics;
    if (parsedWeeks.length) {
      parseMode = 'text';
    }
  }

  if (!parsedWeeks.length) {
    throw new Error('Node parser found no recognizable week/day content in this PDF.');
  }
  const programProfile = buildProgramDocumentProfile({
    planName: name,
    weeks: parsedWeeks
  });

  return {
    source_pdf: path.basename(pdfPath),
    program_name: name,
    generated_at: new Date().toISOString(),
    parser: 'node',
    parse_debug: {
      parser: 'node',
      parseMode,
      diagnostics: {
        ...(parseMode === 'table'
          ? {
            ...tableDiagnostics,
            tokenAssignmentRate: tableDiagnostics.tokenTotal > 0
              ? Number((tableDiagnostics.tokenAssigned / tableDiagnostics.tokenTotal).toFixed(3))
              : 0
          }
          : (textFallbackDiagnostics || {}))
      }
    },
    weeks: parsedWeeks,
    program_profile: programProfile,
    glossary: {
      sections: [],
      entries: {},
      review_needed: [],
      note: parseMode === 'table'
        ? 'Parsed with Node fallback parser (table mode).'
        : 'Parsed with Node fallback parser (text-structured mode).'
    }
  };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [plans, myTemplates] = await Promise.all([
    prisma.trainingPlan.findMany({
      where: { athleteId: user.id, isTemplate: false },
      orderBy: { createdAt: 'desc' },
      include: {
        activities: {
          select: { completed: true }
        }
      }
    }),
    prisma.trainingPlan.findMany({
      where: { isTemplate: true, ownerId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        weekCount: true,
        isPublic: true,
        planGuide: true,
        planSummary: true,
        createdAt: true,
      }
    }),
  ]);

  const plansWithProgress = plans.map(({ activities, ...plan }) => {
    const total = activities.length;
    const completed = activities.filter((a) => a.completed).length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { ...plan, progress };
  });

  return NextResponse.json({ plans: plansWithProgress, myTemplates });
}

async function parsePdfToJson(planId: string, pdfPath: string, name: string): Promise<ParsedPlanOutput> {
  if (process.env.VERCEL) {
    const nodeParsed = await parsePdfToJsonNode(pdfPath, name);
    const nodeQuality = scoreParsedResult(nodeParsed);
    const programProfile = nodeParsed.program_profile || buildProfileFromParsed(name, nodeParsed);
    return {
      ...nodeParsed,
      program_profile: programProfile,
      parse_meta: {
        selectedParser: 'node',
        quality: nodeQuality,
        selectedDiagnostics: (nodeParsed.parse_debug as Record<string, unknown>) || null,
        candidates: [{
          parser: 'node',
          quality: nodeQuality,
          diagnostics: (nodeParsed.parse_debug as Record<string, unknown>) || null
        }]
      }
    };
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'parse_plan_pdf.py');
  const outputDir = path.join(os.tmpdir(), 'coachplan', 'parsed');
  const outputPath = path.join(outputDir, `${planId}.json`);
  await fs.mkdir(outputDir, { recursive: true });

  let pythonParsed: ParsedPlanOutput | null = null;
  let pythonFailureReason: string | null = null;
  try {
    await execFileAsync(
      'python3',
      [
        scriptPath,
        '--input',
        pdfPath,
        '--output',
        outputPath,
        '--name',
        name
      ],
      { timeout: 180000, maxBuffer: 8 * 1024 * 1024 }
    );
    const raw = await fs.readFile(outputPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const parsedRecord = parsed as Record<string, unknown>;
      const weeks = Array.isArray(parsedRecord.weeks) ? parsedRecord.weeks as ParsedWeekEntry[] : [];
      pythonParsed = { ...parsedRecord, weeks, parser: 'python' };
    } else {
      pythonFailureReason = 'Python parser returned an invalid JSON payload.';
    }
  } catch (error) {
    const err = error as Error & { stderr?: string; message: string };
    // Log stderr server-side only; never expose to client
    if (err.stderr?.trim()) console.error('[python-parser] stderr:', err.stderr.trim());
    pythonFailureReason = 'Python parser failed';
  }

  let nodeParsed: ParsedPlanOutput | null = null;
  let nodeFailureReason: string | null = null;
  try {
    nodeParsed = await parsePdfToJsonNode(pdfPath, name);
  } catch (nodeError) {
    // Log details server-side only; never expose raw error messages to the client
    console.error('[node-parser] failure:', nodeError instanceof Error ? nodeError.message : nodeError);
    nodeFailureReason = 'Node parser failed';
  }

  const candidates: ParseCandidate[] = [];
  if (pythonParsed) {
    candidates.push({
      parser: 'python',
      parsed: pythonParsed,
      quality: scoreParsedResult(pythonParsed)
    });
  }
  if (nodeParsed) {
    candidates.push({
      parser: 'node',
      parsed: nodeParsed,
      quality: scoreParsedResult(nodeParsed)
    });
  }

  const viable = candidates.filter((candidate) => candidate.quality.weekCount > 0);
  if (!viable.length) {
    throw new Error(
      `PDF parse failed. Python parser: ${pythonFailureReason || 'no usable output'}. Node fallback: ${nodeFailureReason || 'no usable output'}.`
    );
  }

  const selected = selectBestParseCandidate(viable);
  const programProfile = selected.parsed.program_profile || buildProfileFromParsed(name, selected.parsed);
  return {
    ...selected.parsed,
    program_profile: programProfile,
    parse_meta: {
      selectedParser: selected.parser,
      quality: selected.quality,
      selectedDiagnostics: (selected.parsed.parse_debug as Record<string, unknown>) || null,
      candidates: candidates.map((candidate) => ({
        parser: candidate.parser,
        quality: candidate.quality,
        diagnostics: (candidate.parsed.parse_debug as Record<string, unknown>) || null
      }))
    }
  };
}

function parseOptionalDateInput(input: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (input === null || input === undefined || input === '') {
    return { ok: true, value: null };
  }
  if (typeof input !== 'string') {
    return { ok: false };
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

function looksLikePdfBuffer(buffer: Buffer) {
  if (buffer.byteLength < PDF_MAGIC_PREFIX.length) return false;
  return buffer.subarray(0, PDF_MAGIC_PREFIX.length).toString('ascii') === PDF_MAGIC_PREFIX;
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { units: true }
  });
  const userDefaultDistanceUnit: UnitPreference = dbUser?.units === 'KM' ? 'KM' : 'MILES';

  const contentType = req.headers.get('content-type') || '';
  let name = '';
  let raceName: string | null = null;
  let raceDateInput: unknown = null;
  let file: File | null = null;
  let uploadedPdfBuffer: Buffer | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    name = String(form.get('name') || '').trim();
    raceName = form.get('raceName') ? String(form.get('raceName')).trim() : null;
    raceDateInput = form.get('raceDate');
    const maybeFile = form.get('file');
    if (maybeFile instanceof File) file = maybeFile;
    if (file && file.size > 0 && file.name) {
      name = planNameFromFilename(file.name);
    }
  } else {
    const body = await req.json();
    name = String(body?.name || '').trim();
    raceName = body?.raceName ? String(body.raceName).trim() : null;
    raceDateInput = body?.raceDate ?? null;
  }

  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const parsedRaceDate = parseOptionalDateInput(raceDateInput);
  if (!parsedRaceDate.ok) {
    return NextResponse.json({ error: 'raceDate must be an ISO date string or null' }, { status: 400 });
  }

  const raceDate = parsedRaceDate.value;

  if (file && file.size > 0) {
    const recentUploadCount = await prisma.planSourceDocument.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - PLAN_UPLOAD_WINDOW_MS)
        },
        plan: {
          is: {
            ownerId: user.id
          }
        }
      }
    });

    if (recentUploadCount >= MAX_PLAN_UPLOADS_PER_WINDOW) {
      return NextResponse.json(
        { error: 'Too many uploads. Please wait before uploading another PDF.' },
        { status: 429 }
      );
    }

    uploadedPdfBuffer = Buffer.from(await file.arrayBuffer());
    if (!looksLikePdfBuffer(uploadedPdfBuffer)) {
      return NextResponse.json({ error: 'Uploaded file must be a valid PDF' }, { status: 400 });
    }
  }

  const plan = await prisma.trainingPlan.create({
    data: {
      name,
      raceName: raceName || null,
      raceDate: raceDate,
      isTemplate: false,
      status: 'DRAFT',
      ownerId: user.id,
      athleteId: user.id
    }
  });

  let parseWarning: string | null = null;
  let v4PromptName: string | null = null;
  if (file && file.size > 0) {
    const uploadDir = path.join(os.tmpdir(), 'coachplan', 'uploads');

    try {
      await fs.mkdir(uploadDir, { recursive: true });
      const buffer = uploadedPdfBuffer;
      if (!buffer) {
        throw new Error('Uploaded file must be a valid PDF');
      }
      const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
      await prisma.planSourceDocument.upsert({
        where: { planId: plan.id },
        create: {
          planId: plan.id,
          fileName: file.name || `${name}.pdf`,
          mimeType: 'application/pdf',
          fileSize: buffer.byteLength,
          checksumSha256,
          content: buffer
        },
        update: {
          fileName: file.name || `${name}.pdf`,
          mimeType: 'application/pdf',
          fileSize: buffer.byteLength,
          checksumSha256,
          content: buffer
        }
      });
      const pdfPath = path.join(uploadDir, `${plan.id}.pdf`);
      await fs.writeFile(pdfPath, buffer);

      // Extract guide first so the orchestrator and candidate parsers share the same context artifact.
      let planGuide = '';
      let pdfFullText = '';
      let visionSeedRun: UploadParserRun | null = null;
      let visionExtractedMd: string | null = null;
      try {
        ({ fullText: pdfFullText } = await extractPdfText(buffer));
      } catch { /* non-fatal */ }

      if (FLAGS.PARSER_VISION_EXTRACT) {
        visionSeedRun = await runTimedUploadCandidate({
          parser: 'vision',
          kind: 'program',
          timeoutMs: UPLOAD_AI_CANDIDATE_TIMEOUT_MS,
          timeoutMessage: 'Vision parser timed out before completion.',
          onTimeout: async () => {
            await prisma.parseJob.updateMany({
              where: {
                planId: plan.id,
                parserVersion: 'vision-v1',
                status: 'RUNNING',
              },
              data: {
                status: 'FAILED',
                errorMessage: 'Vision parser timed out before completion.',
              },
            });
          },
          run: async () => {
            const { data, parseWarning: visionWarning, extractedMd } = await maybeRunVisionExtract(buffer, plan.id);
            visionExtractedMd = extractedMd;
            return {
              parser: 'vision',
              kind: 'program',
              viable: Boolean(data),
              quality: scoreProgramJsonForTables(data),
              data,
              warning: visionWarning,
            } satisfies UploadParserRun;
          },
        });
      }

      try {
        const guideSource = visionExtractedMd || pdfFullText;
        if (guideSource) {
          planGuide = await extractPlanGuide(guideSource);
          if (planGuide) {
            await prisma.trainingPlan.update({ where: { id: plan.id }, data: { planGuide } });
          }
        }
      } catch { /* non-fatal */ }

      const parserCandidates: UploadParserKey[] = [];
      if (FLAGS.PARSER_VISION_EXTRACT) parserCandidates.push('vision');
      if (FLAGS.PARSER_V5) parserCandidates.push('v5');
      if (FLAGS.PARSER_V4) parserCandidates.push('v4');
      parserCandidates.push('legacy');

      const orchestrated = await withTimeout(
        orchestrateUploadParsing({
          signals: deriveUploadDocumentSignals(visionExtractedMd || pdfFullText || name),
          budgetMs: UPLOAD_PARSE_TIMEOUT_MS,
          candidates: parserCandidates,
          seedRuns: visionSeedRun ? [visionSeedRun] : [],
          runCandidate: async (parser) => {
            if (parser === 'vision') {
              if (visionSeedRun) return visionSeedRun;
              return runTimedUploadCandidate({
                parser,
                kind: 'program',
                timeoutMs: UPLOAD_AI_CANDIDATE_TIMEOUT_MS,
                timeoutMessage: 'Vision parser timed out before completion.',
                onTimeout: async () => {
                  await prisma.parseJob.updateMany({
                    where: {
                      planId: plan.id,
                      parserVersion: 'vision-v1',
                      status: 'RUNNING',
                    },
                    data: {
                      status: 'FAILED',
                      errorMessage: 'Vision parser timed out before completion.',
                    },
                  });
                },
                run: async () => {
                  const { data, parseWarning } = await maybeRunVisionExtract(buffer, plan.id);
                  return {
                    parser,
                    kind: 'program',
                    viable: Boolean(data),
                    quality: scoreProgramJsonForTables(data),
                    data,
                    warning: parseWarning,
                  } satisfies UploadParserRun;
                },
              });
            }

            if (parser === 'v5') {
              return runTimedUploadCandidate({
                parser,
                kind: 'program',
                timeoutMs: UPLOAD_AI_CANDIDATE_TIMEOUT_MS,
                timeoutMessage: 'Parser V5 timed out before completion.',
                onTimeout: async () => {
                  await prisma.parseJob.updateMany({
                    where: {
                      planId: plan.id,
                      parserVersion: 'v5',
                      status: 'RUNNING',
                    },
                    data: {
                      status: 'FAILED',
                      errorMessage: 'Parser V5 timed out before completion.',
                    },
                  });
                },
                run: async () => {
                  const { data, parseWarning } = await maybeRunParserV5(buffer, plan.id);
                  return {
                    parser,
                    kind: 'program',
                    viable: Boolean(data),
                    quality: scoreProgramJsonForTables(data),
                    data,
                    warning: parseWarning,
                  } satisfies UploadParserRun;
                },
              });
            }

            if (parser === 'v4') {
              return runTimedUploadCandidate({
                parser,
                kind: 'program',
                timeoutMs: UPLOAD_AI_CANDIDATE_TIMEOUT_MS,
                timeoutMessage: 'Parser V4 timed out before completion.',
                onTimeout: async () => {
                  await prisma.parseJob.updateMany({
                    where: {
                      planId: plan.id,
                      parserVersion: 'v4',
                      status: 'RUNNING',
                    },
                    data: {
                      status: 'FAILED',
                      errorMessage: 'Parser V4 timed out before completion.',
                    },
                  });
                },
                run: async () => {
                  const { data, promptName, parseWarning } = await maybeRunParserV4(buffer, plan.id, planGuide);
                  return {
                    parser,
                    kind: 'program',
                    viable: Boolean(data),
                    quality: scoreProgramJsonForTables(data),
                    data,
                    promptName,
                    warning: parseWarning,
                  } satisfies UploadParserRun;
                },
              });
            }

            return runTimedUploadCandidate({
              parser,
              kind: 'legacy',
              timeoutMs: UPLOAD_LEGACY_CANDIDATE_TIMEOUT_MS,
              timeoutMessage: 'Legacy parser timed out before completion.',
              run: async () => {
                const parsed = await parsePdfToJson(plan.id, pdfPath, name);
                const parseMeta = parsed && typeof parsed === 'object'
                  ? (parsed as {
                    parse_meta?: {
                      selectedParser?: string;
                      quality?: ParseQuality;
                      selectedDiagnostics?: Record<string, unknown> | null;
                      candidates?: Array<{
                        parser: string;
                        quality: ParseQuality;
                        diagnostics?: Record<string, unknown> | null;
                      }>;
                    };
                  }).parse_meta
                  : undefined;
                const parseQuality = parseMeta?.quality || scoreParsedResult(parsed);
                const viable = parseQuality.weekCount > 0
                  && parseQuality.score >= PARSE_MIN_QUALITY_SCORE
                  && parseQuality.dayCoverage >= PARSE_MIN_DAY_COVERAGE;
                return {
                  parser,
                  kind: 'legacy',
                  viable,
                  quality: {
                    score: parseQuality.score,
                    weekCount: parseQuality.weekCount,
                    dayCoverage: parseQuality.dayCoverage,
                  },
                  data: parsed,
                  warning: viable
                    ? null
                    : `Parsed content confidence too low (parser=legacy, score=${parseQuality.score}, weekCount=${parseQuality.weekCount}, dayCoverage=${parseQuality.dayCoverage.toFixed(2)}).`,
                } satisfies UploadParserRun;
              },
            });
          },
        }),
        UPLOAD_PARSE_TIMEOUT_MS,
        'PDF parse timed out. Please try a smaller/simpler PDF.'
      );

      v4PromptName = orchestrated.promptName;
      const finalWarning = orchestrated.candidateRuns.find((run) => run.parser === orchestrated.finalParser)?.warning ?? null;
      const bestProgramEnricher =
        orchestrated.candidateRuns
          .filter((run): run is Extract<UploadParserRun, { kind: 'program' }> => run.kind === 'program' && Boolean(run.data))
          .sort((left, right) => right.quality.score - left.quality.score)[0] ?? null;
      if (finalWarning) parseWarning = finalWarning;

      console.info('[UploadParser] Orchestrated parse complete', {
        planId: plan.id,
        selectedBaseParser: orchestrated.selectedBaseParser,
        finalParser: orchestrated.finalParser,
        resultKind: orchestrated.resultKind,
        usedFallback: orchestrated.usedFallback,
        usedEnrichers: orchestrated.usedEnrichers,
        candidateRuns: orchestrated.candidateRuns.map((run) => ({
          parser: run.parser,
          kind: run.kind,
          viable: run.viable,
          score: run.quality.score,
          warning: run.warning,
          promptName: run.promptName ?? null,
        })),
      });

      if (orchestrated.resultKind === 'program' && orchestrated.program) {
        const persistenceSource = orchestrated.finalParser === 'vision'
          ? 'markdown-primary'
          : 'candidate-program';
        const { weeksCreated, activitiesCreated } = await populatePlanFromV4(plan.id, orchestrated.program, {
          parserPipeline: {
            persistenceSource,
            mdParseStatus: visionSeedRun?.viable ? 'succeeded' : (visionExtractedMd ? 'available' : 'missing'),
            extractedMdAttempted: FLAGS.PARSER_VISION_EXTRACT,
          },
        });
        console.info('[UploadParser] Populated plan from orchestrated program parser', {
          planId: plan.id,
          parser: orchestrated.finalParser,
          weeksCreated,
          activitiesCreated,
          usedEnrichers: orchestrated.usedEnrichers,
        });
      }

      if (orchestrated.resultKind === 'legacy' && orchestrated.legacy) {
      const parsed = orchestrated.legacy as ParsedPlanOutput;
      const parseMeta = parsed && typeof parsed === 'object'
        ? (parsed as {
          parse_meta?: {
            selectedParser?: string;
            quality?: ParseQuality;
            selectedDiagnostics?: Record<string, unknown> | null;
            candidates?: Array<{
              parser: string;
              quality: ParseQuality;
              diagnostics?: Record<string, unknown> | null;
            }>;
          };
        }).parse_meta
        : undefined;
      const parseQuality = parseMeta?.quality || scoreParsedResult(parsed);
      const selectedParser = parseMeta?.selectedParser
        || (typeof (parsed as { parser?: unknown })?.parser === 'string' ? String((parsed as { parser?: unknown }).parser) : 'unknown');
      if (
        parseQuality.weekCount === 0
        || parseQuality.score < PARSE_MIN_QUALITY_SCORE
        || parseQuality.dayCoverage < PARSE_MIN_DAY_COVERAGE
      ) {
        throw new Error(
          `Parsed content confidence too low (parser=${selectedParser}, score=${parseQuality.score}, weekCount=${parseQuality.weekCount}, dayCoverage=${parseQuality.dayCoverage.toFixed(2)}).`
        );
      }
      console.info('Plan parse quality', {
        planId: plan.id,
        parser: selectedParser,
        quality: parseQuality,
        diagnostics: parseMeta?.selectedDiagnostics || null,
        candidates: parseMeta?.candidates || null
      });
      const weeks = Array.isArray(parsed?.weeks) ? parsed.weeks : [];
      const parsedProgramProfile = (parsed as { program_profile?: unknown })?.program_profile;
      const programProfile = parsedProgramProfile && typeof parsedProgramProfile === 'object'
        ? parsedProgramProfile as ProgramDocumentProfile
        : buildProgramDocumentProfile({ planName: name, weeks });

      const weekRecords: { id: string }[] = [];
      for (let i = 0; i < weeks.length; i += 1) {
        weekRecords.push(
          await prisma.planWeek.create({
            data: {
              planId: plan.id,
              weekIndex: i + 1
            }
          })
        );
      }

      const activities: any[] = [];
      const aiEnrichmentStartedAt = Date.now();
      let aiBudgetExceeded = false;
      for (let i = 0; i < weeks.length; i += 1) {
        const week = weeks[i];
        const weekId = weekRecords[i]?.id;
        const rawDays: Record<string, string> = {};
        DAY_KEYS.forEach((key) => {
          rawDays[key] = week?.days?.[key]?.raw || '';
        });
        const weekDefaultDistanceUnit = inferDominantDistanceUnit(Object.values(rawDays), userDefaultDistanceUnit);
        const aiTargetDayKeys = ENABLE_AI_WEEK_PARSE
          ? selectAiTargetDayKeys(rawDays, AI_WEEK_PARSE_MAX_DAYS)
          : [];
        const aiTargetSet = new Set(aiTargetDayKeys);

        let aiWeek = null;
        const aiElapsedMs = Date.now() - aiEnrichmentStartedAt;
        const aiBudgetRemainingMs = Math.max(0, AI_WEEK_PARSE_TOTAL_BUDGET_MS - aiElapsedMs);
        const canRunAiWeekParse = ENABLE_AI_WEEK_PARSE && aiTargetDayKeys.length > 0 && aiBudgetRemainingMs >= 1200;
        if (canRunAiWeekParse) {
          const aiInputDays: Record<string, string> = {};
          DAY_KEYS.forEach((key) => {
            aiInputDays[key] = aiTargetSet.has(key) ? rawDays[key] : '';
          });
          try {
            aiWeek = await withTimeout(
              parseWeekWithAI({
                planName: name,
                weekNumber: i + 1,
                days: aiInputDays,
                legend: parsed?.glossary?.note || undefined,
                planGuide: planGuide || undefined,
                programProfile,
                model: AI_WEEK_PARSE_MODEL
              }),
              Math.min(AI_WEEK_PARSE_TIMEOUT_MS, aiBudgetRemainingMs),
              'AI week parse timed out.'
            );
          } catch {
            aiWeek = null;
          }
        } else if (ENABLE_AI_WEEK_PARSE && aiTargetDayKeys.length > 0) {
          aiBudgetExceeded = true;
        }

        for (let d = 0; d < DAY_KEYS.length; d += 1) {
          const key = DAY_KEYS[d];
          const entry = week?.days?.[key];
          if (!entry) continue;

          const day = await prisma.planDay.create({
            data: {
              planId: plan.id,
              weekId,
              dayOfWeek: d + 1,
              rawText: entry.raw || null
            }
          });
          const dayDefaultDistanceUnit = inferDominantDistanceUnit(
            [entry.raw || '', ...Object.values(rawDays)],
            weekDefaultDistanceUnit
          );

          const aiActivities = aiTargetSet.has(key)
            ? (aiWeek?.days?.[key]?.activities || [])
            : [];
          const deterministicActivities = buildDeterministicActivities({
            planId: plan.id,
            dayId: day.id,
            entry,
            inferredDistanceUnit: dayDefaultDistanceUnit,
            storageDistanceUnit: userDefaultDistanceUnit
          });
          const aiDrafts = aiActivities.length
            ? buildAiActivities({
              planId: plan.id,
              dayId: day.id,
              dayRawText: entry.raw || '',
              aiActivities,
              inferredDistanceUnit: dayDefaultDistanceUnit,
              storageDistanceUnit: userDefaultDistanceUnit
            })
            : [];
          const mergedActivities = aiDrafts.length
            ? mergeDayActivitiesWithAI(deterministicActivities, aiDrafts)
            : deterministicActivities;
          const enrichedFromProgram = enrichLegacyDayDraftsFromProgram({
            planId: plan.id,
            dayId: day.id,
            sourceUnits: bestProgramEnricher?.data?.program?.source_units,
            weekNumber: i + 1,
            dayOfWeek: d + 1,
            baseActivities: mergedActivities,
            program: bestProgramEnricher?.data ?? null,
          });

          if (enrichedFromProgram.dayNotes) {
            await prisma.planDay.update({
              where: { id: day.id },
              data: { notes: enrichedFromProgram.dayNotes },
            });
          }

          activities.push(
            ...enrichedFromProgram.activities.map((activity) => withStructuredIntensityTargets(activity))
          );
        }
      }

      if (activities.length) {
        await prisma.planActivity.createMany({ data: activities });
      }

      await prisma.trainingPlan.update({
        where: { id: plan.id },
        data: {
          weekCount: weeks.length || null,
          parseProfile: withParserPipelineProfile(programProfile, {
            persistence_source: bestProgramEnricher ? 'legacy-fallback-with-md-enrichment' : 'legacy-fallback',
            md_parse_status: visionSeedRun?.viable ? 'succeeded' : (visionExtractedMd ? 'available' : (FLAGS.PARSER_VISION_EXTRACT ? 'failed' : 'missing')),
            extracted_md_attempted: FLAGS.PARSER_VISION_EXTRACT,
          }),
          status: 'DRAFT'
        }
      });

      // Draft upload/review mode: defer calendar date materialization until activation.
      if (aiBudgetExceeded) {
        console.info('AI enrichment budget reached; remaining weeks will use deterministic parser only.', {
          planId: plan.id,
          budgetMs: AI_WEEK_PARSE_TOTAL_BUDGET_MS
        });
      }
      } // end if (legacy parser path)

      if (orchestrated.resultKind === 'none' || (!orchestrated.program && !orchestrated.legacy)) {
        throw new Error('No viable parser output was produced by the upload orchestrator.');
      }
    } catch (error) {
      const reason = (error as Error).message || 'Unknown parser error';
      parseWarning = reason;
      console.error('Plan parse failed, creating fallback editable skeleton', { planId: plan.id, reason });
      try {
        await prisma.parseJob.updateMany({
          where: {
            planId: plan.id,
            status: 'RUNNING',
          },
          data: {
            status: 'FAILED',
            errorMessage: reason,
          },
        });
      } catch (jobUpdateError) {
        console.error('Could not mark running parse jobs as failed', {
          planId: plan.id,
          error: jobUpdateError instanceof Error ? jobUpdateError.message : String(jobUpdateError),
        });
      }

      const existingWeeks = await prisma.planWeek.count({ where: { planId: plan.id } });
      if (existingWeeks === 0) {
        const fallbackWeek = await prisma.planWeek.create({
          data: {
            planId: plan.id,
            weekIndex: 1
          }
        });

        await prisma.planDay.createMany({
          data: Array.from({ length: 7 }).map((_, idx) => ({
            planId: plan.id,
            weekId: fallbackWeek.id,
            dayOfWeek: idx + 1,
            rawText: idx === 0
              ? 'Parser fallback mode: add/edit activities manually for this plan.'
              : null
          }))
        });

        await prisma.trainingPlan.update({
          where: { id: plan.id },
          data: {
            weekCount: 1,
            status: 'DRAFT'
          }
        });
      }
    }
  }

  const latestPlan = await prisma.trainingPlan.findUnique({
    where: { id: plan.id }
  });

  return NextResponse.json({
    plan: latestPlan || plan,
    parseWarning,
    parserPromptName: v4PromptName
  });
}
