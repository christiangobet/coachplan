'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { isDayMarkedDone } from '@/lib/day-status';
import ActivityTypeIcon from '@/components/ActivityTypeIcon';
import PlanSidebar from '@/components/PlanSidebar';
import SelectedPlanCookie from '@/components/SelectedPlanCookie';
import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  type DistanceUnit
} from '@/lib/unit-display';
import ActivityForm, { ActivityFormData } from '@/components/PlanEditor/ActivityForm';
import { ActivityPriority } from '@prisma/client';
import '../plans.css';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatType(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function formatWeekRange(startDate: Date | null, endDate: Date | null): string | null {
  if (!startDate) return null;
  const s = new Date(startDate);
  s.setHours(0, 0, 0, 0);

  let e = endDate ? new Date(endDate) : null;
  if (!e) {
    e = new Date(s);
    e.setDate(e.getDate() + 6);
  }
  e.setHours(0, 0, 0, 0);

  const sameYear = s.getFullYear() === e.getFullYear();
  const fmtStart = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  const fmtEnd = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return `${fmtStart(s)} - ${fmtEnd(e)}`;
}

function typeColor(type: string): string {
  switch (type) {
    case 'RUN': return 'var(--accent)';
    case 'STRENGTH': return '#6c5ce7';
    case 'CROSS_TRAIN': return '#0984e3';
    case 'REST': return 'var(--green)';
    case 'MOBILITY': return '#e67e22';
    case 'YOGA': return 'var(--green)';
    case 'HIKE': return '#0984e3';
    default: return 'var(--muted)';
  }
}

type AiTrainerChange =
  | {
    op: 'move_activity';
    activityId: string;
    targetDayId: string;
    reason: string;
  }
  | {
    op: 'edit_activity';
    activityId: string;
    reason: string;
    type?: string;
    title?: string;
    duration?: number | null;
    distance?: number | null;
    distanceUnit?: string | null;
    paceTarget?: string | null;
    effortTarget?: string | null;
    notes?: string | null;
    mustDo?: boolean;
    bailAllowed?: boolean;
    priority?: string | null;
  }
  | {
    op: 'add_activity';
    dayId: string;
    reason: string;
    type: string;
    title: string;
    duration?: number | null;
    distance?: number | null;
    distanceUnit?: string | null;
    paceTarget?: string | null;
    effortTarget?: string | null;
    notes?: string | null;
    mustDo?: boolean;
    bailAllowed?: boolean;
    priority?: string | null;
  }
  | {
    op: 'delete_activity';
    activityId: string;
    reason: string;
  }
  | {
    op: 'extend_plan';
    newStartDate: string;
    reason: string;
  };

type AiTrainerProposal = {
  coachReply: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  riskFlags?: string[];
  followUpQuestion?: string;
  changes: AiTrainerChange[];
};

type AiChangeLookup = {
  dayLabelById: Map<string, string>;
  activityLabelById: Map<string, string>;
};

function describeAiChange(change: AiTrainerChange, lookup: AiChangeLookup) {
  const dayLabel = (dayId: string) => lookup.dayLabelById.get(dayId) || 'a plan day';
  const activityLabel = (activityId: string) => lookup.activityLabelById.get(activityId) || 'a scheduled activity';

  if (change.op === 'extend_plan') {
    const startDate = new Date(`${change.newStartDate}T00:00:00`);
    const startText = Number.isNaN(startDate.getTime())
      ? change.newStartDate
      : startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `Extend plan to start on ${startText} (prepend weeks, keep race date).`;
  }
  if (change.op === 'move_activity') {
    return `Move ${activityLabel(change.activityId)} to ${dayLabel(change.targetDayId)}.`;
  }
  if (change.op === 'delete_activity') {
    return `Remove ${activityLabel(change.activityId)}.`;
  }
  if (change.op === 'add_activity') {
    return `Add ${formatType(change.type)} "${change.title}" on ${dayLabel(change.dayId)}.`;
  }
  const updates: string[] = [];
  if (change.title !== undefined) updates.push('title');
  if (change.type !== undefined) updates.push('type');
  if (change.duration !== undefined) updates.push('duration');
  if (change.distance !== undefined) updates.push('distance');
  if (change.paceTarget !== undefined) updates.push('pace');
  if (change.effortTarget !== undefined) updates.push('effort');
  if (change.notes !== undefined) updates.push('notes');
  if (change.priority !== undefined) updates.push('priority');
  if (change.mustDo !== undefined) updates.push('must-do');
  if (change.bailAllowed !== undefined) updates.push('bail');
  return `Edit ${activityLabel(change.activityId)}${updates.length > 0 ? ` (${updates.join(', ')})` : ''}.`;
}

export default function PlanDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const planId = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<any>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [actualDistance, setActualDistance] = useState('');
  const [actualDuration, setActualDuration] = useState('');
  const [actualPace, setActualPace] = useState('');
  const [actualsError, setActualsError] = useState<string | null>(null);
  const [savingActuals, setSavingActuals] = useState(false);
  const [viewerUnits, setViewerUnits] = useState<DistanceUnit>('MILES');
  const [aiTrainerInput, setAiTrainerInput] = useState('');
  const [aiTrainerProposal, setAiTrainerProposal] = useState<AiTrainerProposal | null>(null);
  const [aiTrainerLoading, setAiTrainerLoading] = useState(false);
  const [aiTrainerApplyingTarget, setAiTrainerApplyingTarget] = useState<'all' | number | null>(null);
  const [aiTrainerError, setAiTrainerError] = useState<string | null>(null);
  const [aiTrainerStatus, setAiTrainerStatus] = useState<string | null>(null);
  const [aiTrainerAppliedRows, setAiTrainerAppliedRows] = useState<Set<number>>(new Set());
  const [showAiTrainer, setShowAiTrainer] = useState(false);
  const aiTrainerApplying = aiTrainerApplyingTarget !== null;

  // -- Edit Mode State --
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingActivity, setEditingActivity] = useState<any>(null);
  const [addingToDayId, setAddingToDayId] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams && searchParams.get('mode') === 'edit') {
      setIsEditMode(true);
    }
  }, [searchParams]);

  const handleSaveActivity = async (data: ActivityFormData) => {
    try {
      if (editingActivity) {
        // Edit existing
        const res = await fetch(`/api/activities/${editingActivity.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to update activity');
        }
        // Refresh plan
        await loadPlan();
      } else if (addingToDayId) {
        // Add new
        const res = await fetch(`/api/plan-days/${addingToDayId}/activities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to add activity');
        }
        await loadPlan();
      }
    } catch (err: any) {
      alert(err.message); // Simple error feedback for now
      throw err;
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    if (!confirm('Are you sure you want to delete this activity?')) return;
    try {
      const res = await fetch(`/api/activities/${activityId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete');
      await loadPlan();
      setEditingActivity(null); // Close form if it was open (though usually delete is from form or list)
    } catch (err: any) {
      alert(err.message);
    }
  };

  const loadPlan = useCallback(async () => {
    if (!planId) return;
    try {
      const res = await fetch(`/api/plans/${planId}`);
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        setError('Server returned non-JSON response.');
        return;
      }
      if (!res.ok) {
        setError(data?.error || 'Failed to load plan.');
        return;
      }
      setViewerUnits(data?.viewerUnits === 'KM' ? 'KM' : 'MILES');
      setPlan(data.plan);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load plan.');
    }
  }, [planId]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    const maybeOpenAiTrainerFromHash = () => {
      if (window.location.hash === '#ai-trainer') {
        setShowAiTrainer(true);
      }
    };
    maybeOpenAiTrainerFromHash();
    window.addEventListener('hashchange', maybeOpenAiTrainerFromHash);
    return () => window.removeEventListener('hashchange', maybeOpenAiTrainerFromHash);
  }, []);

  const applyActivityUpdate = useCallback((activityId: string, updater: (activity: any) => any) => {
    setPlan((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((w: any) => ({
          ...w,
          days: (w.days || []).map((d: any) => ({
            ...d,
            activities: (d.activities || []).map((a: any) =>
              a.id === activityId ? updater(a) : a
            )
          }))
        }))
      };
    });

    setSelectedActivity((prev: any) =>
      prev?.id === activityId ? updater(prev) : prev
    );
  }, []);

  // Toggle activity completion with optimistic update
  const toggleComplete = useCallback(async (activityId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (toggling.has(activityId)) return;

    setToggling((prev) => new Set(prev).add(activityId));

    applyActivityUpdate(activityId, (activity) => ({ ...activity, completed: !activity.completed }));

    try {
      const res = await fetch(`/api/activities/${activityId}/toggle`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to toggle completion');
      const data = await res.json().catch(() => ({}));
      if (data?.activity) {
        applyActivityUpdate(activityId, () => data.activity);
      }
    } catch {
      // Revert on error
      applyActivityUpdate(activityId, (activity) => ({ ...activity, completed: !activity.completed }));
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(activityId);
        return next;
      });
    }
  }, [toggling, applyActivityUpdate]);

  const saveActuals = useCallback(async () => {
    if (!selectedActivity || savingActuals) return;
    setSavingActuals(true);
    setActualsError(null);

    try {
      const res = await fetch(`/api/activities/${selectedActivity.id}/actuals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualDistance: actualDistance.trim(),
          actualDuration: actualDuration.trim(),
          actualPace: actualPace.trim(),
          actualDistanceUnit: viewerUnits
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActualsError(data?.error || 'Failed to save actuals');
        return;
      }

      if (data?.activity) {
        applyActivityUpdate(selectedActivity.id, () => data.activity);
      }
    } catch {
      setActualsError('Failed to save actuals');
    } finally {
      setSavingActuals(false);
    }
  }, [selectedActivity, savingActuals, actualDistance, actualDuration, actualPace, viewerUnits, applyActivityUpdate]);

  const generateAiAdjustment = useCallback(async () => {
    if (!planId) return;
    const message = aiTrainerInput.trim();
    if (!message) {
      setAiTrainerError('Describe what happened so the trainer can adapt the plan.');
      return;
    }
    setAiTrainerLoading(true);
    setAiTrainerError(null);
    setAiTrainerStatus(null);
    try {
      const res = await fetch(`/api/plans/${planId}/ai-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to generate adjustment proposal.');
      }
      setAiTrainerProposal(data?.proposal || null);
      setAiTrainerAppliedRows(new Set());
      if (data?.proposal?.summary) {
        setAiTrainerStatus(data.proposal.summary);
      } else {
        setAiTrainerStatus('Proposal generated. Review and apply if it looks good.');
      }
    } catch (err: unknown) {
      setAiTrainerError(err instanceof Error ? err.message : 'Failed to generate adjustment proposal.');
    } finally {
      setAiTrainerLoading(false);
    }
  }, [aiTrainerInput, planId]);

  const applyAiAdjustment = useCallback(async (changeIndex?: number) => {
    if (!planId || !aiTrainerProposal) return;
    const message = aiTrainerInput.trim();
    if (!message) {
      setAiTrainerError('Describe what happened so the trainer can adapt the plan.');
      return;
    }

    const targetChanges =
      typeof changeIndex === 'number'
        ? aiTrainerProposal.changes.filter((_, idx) => idx === changeIndex && !aiTrainerAppliedRows.has(idx))
        : aiTrainerProposal.changes.filter((_, idx) => !aiTrainerAppliedRows.has(idx));
    if (targetChanges.length === 0) {
      setAiTrainerError('No changes available to apply.');
      return;
    }

    setAiTrainerApplyingTarget(typeof changeIndex === 'number' ? changeIndex : 'all');
    setAiTrainerError(null);
    setAiTrainerStatus(null);
    try {
      const res = await fetch(`/api/plans/${planId}/ai-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          apply: true,
          proposal: {
            ...aiTrainerProposal,
            changes: targetChanges
          }
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to apply plan adjustments.');
      }
      if (typeof changeIndex === 'number') {
        setAiTrainerAppliedRows((prev) => {
          const next = new Set(prev);
          next.add(changeIndex);
          return next;
        });
      } else {
        setAiTrainerAppliedRows((prev) => {
          const next = new Set(prev);
          aiTrainerProposal.changes.forEach((_, idx) => next.add(idx));
          return next;
        });
      }

      const extendedWeeks = Number(data?.extendedWeeks || 0);
      const appliedCount = Number(data?.appliedCount || 0);
      if (extendedWeeks > 0) {
        setAiTrainerStatus(`Applied ${appliedCount} change(s), including ${extendedWeeks} prepended week(s).`);
      } else {
        setAiTrainerStatus(`Applied ${appliedCount} change(s) to the plan.`);
      }
      setSelectedActivity(null);
      await loadPlan();
    } catch (err: unknown) {
      setAiTrainerError(err instanceof Error ? err.message : 'Failed to apply plan adjustments.');
    } finally {
      setAiTrainerApplyingTarget(null);
    }
  }, [aiTrainerInput, aiTrainerProposal, aiTrainerAppliedRows, loadPlan, planId]);

  // Close modal on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedActivity(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (!selectedActivity) return;
    setActualDistance(
      selectedActivity.actualDistance === null || selectedActivity.actualDistance === undefined
        ? ''
        : String(
          convertDistanceForDisplay(
            selectedActivity.actualDistance,
            selectedActivity.distanceUnit,
            viewerUnits
          )?.value ?? selectedActivity.actualDistance
        )
    );
    setActualDuration(
      selectedActivity.actualDuration === null || selectedActivity.actualDuration === undefined
        ? ''
        : String(selectedActivity.actualDuration)
    );
    setActualPace(
      convertPaceForDisplay(
        selectedActivity.actualPace,
        viewerUnits,
        selectedActivity.distanceUnit || viewerUnits
      ) || ''
    );
    setActualsError(null);
  }, [selectedActivity, viewerUnits]);

  const aiChangeLookup = useMemo<AiChangeLookup>(() => {
    const dayLabelById = new Map<string, string>();
    const activityLabelById = new Map<string, string>();
    if (!plan) return { dayLabelById, activityLabelById };

    const sortedWeeks = [...(plan.weeks || [])].sort((a: any, b: any) => a.weekIndex - b.weekIndex);
    const weekIndexes = sortedWeeks.map((week: any) => week.weekIndex);

    for (const week of sortedWeeks) {
      const bounds = resolveWeekBounds({
        weekIndex: week.weekIndex,
        weekStartDate: week.startDate,
        weekEndDate: week.endDate,
        raceDate: plan.raceDate,
        weekCount: plan.weekCount,
        allWeekIndexes: weekIndexes
      });
      for (const day of week.days || []) {
        const date = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
        const dayName = DAY_LABELS[Math.max(0, day.dayOfWeek - 1)] || `Day ${day.dayOfWeek}`;
        const dayText = date
          ? `${dayName} ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : dayName;
        dayLabelById.set(day.id, dayText);

        for (const activity of day.activities || []) {
          const title = typeof activity.title === 'string' && activity.title.trim()
            ? activity.title.trim()
            : formatType(activity.type || 'Workout');
          activityLabelById.set(activity.id, `"${title}" (${dayText})`);
        }
      }
    }

    return { dayLabelById, activityLabelById };
  }, [plan]);

  if (error) {
    return (
      <main className="pcal">
        <SelectedPlanCookie planId={planId} />
        <p style={{ color: 'var(--red)', fontSize: 14 }}>{error}</p>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="pcal">
        <SelectedPlanCookie planId={planId} />
        <p className="muted">Loading...</p>
      </main>
    );
  }

  const statusClass = plan.status === 'ACTIVE' ? 'active' : plan.status === 'DRAFT' ? 'draft' : 'archived';
  const weeks = [...(plan.weeks || [])].sort((a: any, b: any) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = weeks.map((week: any) => week.weekIndex);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Compute plan-level stats
  const allActivities = weeks.flatMap((w: any) =>
    (w.days || []).flatMap((d: any) => d.activities || [])
  );
  const totalActivities = allActivities.length;
  const completedActivities = allActivities.filter((a: any) => a.completed).length;
  const totalMinutes = allActivities.reduce((acc: number, a: any) => acc + (a.duration || 0), 0);
  const completionPct = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;
  const viewerUnitLabel = distanceUnitLabel(viewerUnits);
  const toDisplayDistance = (value: number | null | undefined, unit: string | null | undefined) =>
    convertDistanceForDisplay(value, unit, viewerUnits);
  const formatDisplayDistance = (value: number | null | undefined, unit: string | null | undefined) => {
    const converted = toDisplayDistance(value, unit);
    if (!converted) return null;
    return `${formatDistanceNumber(converted.value)}${distanceUnitLabel(converted.unit)}`;
  };
  const formatDisplayPace = (pace: string | null | undefined, unit: string | null | undefined) =>
    convertPaceForDisplay(pace, viewerUnits, unit || viewerUnits);
  const selectedDistanceDisplay = selectedActivity
    ? toDisplayDistance(selectedActivity.distance, selectedActivity.distanceUnit)
    : null;
  const selectedPaceDisplay = selectedActivity
    ? formatDisplayPace(selectedActivity.paceTarget, selectedActivity.distanceUnit)
    : null;

  return (
    <main className="pcal">
      <SelectedPlanCookie planId={plan.id} />
      <div className="pcal-layout">
        <PlanSidebar planId={plan.id} active="overview" />

        <section className="pcal-main">
          {/* Header */}
          <div className="pcal-header" id="plan-overview">
            <div>
              <h1>{plan.name}</h1>
              <div className="pcal-header-meta">
                <span className={`plan-detail-status ${statusClass}`}>{plan.status}</span>
                <button
                  type="button"
                  className={`btn-light ${isEditMode ? 'active' : ''}`}
                  onClick={() => setIsEditMode(!isEditMode)}
                  style={{ marginLeft: '12px', padding: '4px 12px', fontSize: '12px' }}
                >
                  {isEditMode ? 'Done Editing' : 'Edit Plan'}
                </button>
                {plan.weekCount && (
                  <>
                    <span className="plan-detail-meta-dot" />
                    <span>{plan.weekCount} weeks</span>
                  </>
                )}
                {plan.raceName && (
                  <>
                    <span className="plan-detail-meta-dot" />
                    <span>Race: {plan.raceName}</span>
                  </>
                )}
                {plan.raceDate && (
                  <>
                    <span className="plan-detail-meta-dot" />
                    <span>Date: {new Date(plan.raceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </>
                )}
              </div>
              {plan.sourcePlanName && (
                <div className="pcal-plan-source">Plan source: {plan.sourcePlanName}</div>
              )}
            </div>
          </div>

          <section className="pcal-ai-trainer" id="ai-trainer">
            <div className="pcal-ai-trainer-head">
              <div>
                <h2>AI Trainer</h2>
                <p>Tell the coach what happened (missed day, sickness, fatigue, schedule changes) and get safe adjustments.</p>
              </div>
              <button
                className="cta secondary pcal-ai-trainer-toggle"
                type="button"
                onClick={() => setShowAiTrainer((prev) => !prev)}
              >
                {showAiTrainer ? 'Hide AI Trainer' : 'Open AI Trainer'}
              </button>
            </div>
            {showAiTrainer && (
              <>
                <textarea
                  value={aiTrainerInput}
                  onChange={(e) => setAiTrainerInput(e.target.value)}
                  placeholder="Example: I missed Tuesday intervals and felt sick for two days. Please adjust this week and next week safely."
                  rows={4}
                />
                <div className="pcal-ai-trainer-actions">
                  <button
                    className="cta"
                    type="button"
                    onClick={generateAiAdjustment}
                    disabled={aiTrainerLoading || aiTrainerApplying}
                  >
                    {aiTrainerLoading ? 'Generating…' : 'Generate Adjustment'}
                  </button>
                </div>
                {aiTrainerError && <p className="pcal-ai-trainer-error">{aiTrainerError}</p>}
                {aiTrainerStatus && <p className="pcal-ai-trainer-status">{aiTrainerStatus}</p>}

                {aiTrainerProposal && (
                  <div className="pcal-ai-trainer-proposal">
                    <div className="pcal-ai-trainer-meta">
                      <strong>Coach Reply</strong>
                      <span>Confidence: {aiTrainerProposal.confidence}</span>
                    </div>
                    <p>{aiTrainerProposal.coachReply}</p>
                    {aiTrainerProposal.followUpQuestion && (
                      <p className="pcal-ai-trainer-followup">
                        Follow-up: {aiTrainerProposal.followUpQuestion}
                      </p>
                    )}
                    <div className="pcal-ai-trainer-meta">
                      <strong>Planned Changes ({aiTrainerProposal.changes.length})</strong>
                    </div>
                    {aiTrainerProposal.changes.length === 0 && (
                      <p className="pcal-ai-trainer-followup">
                        This request needs a plan-structure update (weeks/dates), which is not supported in AI Trainer yet.
                      </p>
                    )}
                    <ul className="pcal-ai-trainer-change-list">
                      {aiTrainerProposal.changes.map((change, idx) => (
                        <li
                          key={`${change.op}-${idx}`}
                          className={aiTrainerAppliedRows.has(idx) ? 'is-applied' : ''}
                        >
                          <div className="pcal-ai-trainer-change-head">
                            <span className="pcal-ai-trainer-op">{change.op.replace(/_/g, ' ')}</span>
                            <strong>{describeAiChange(change, aiChangeLookup)}</strong>
                            <button
                              className="cta secondary pcal-ai-trainer-apply-one"
                              type="button"
                              onClick={() => applyAiAdjustment(idx)}
                              disabled={aiTrainerAppliedRows.has(idx) || aiTrainerLoading || aiTrainerApplying}
                            >
                              {aiTrainerAppliedRows.has(idx)
                                ? 'Applied'
                                : aiTrainerApplyingTarget === idx
                                  ? 'Applying…'
                                  : 'Apply'}
                            </button>
                          </div>
                          <p>{change.reason}</p>
                        </li>
                      ))}
                    </ul>
                    <div className="pcal-ai-trainer-apply-all">
                      <button
                        className="cta"
                        type="button"
                        onClick={() => applyAiAdjustment()}
                        disabled={
                          aiTrainerProposal.changes.length === 0
                          || aiTrainerAppliedRows.size >= aiTrainerProposal.changes.length
                          || aiTrainerLoading
                          || aiTrainerApplying
                        }
                      >
                        {aiTrainerApplyingTarget === 'all' ? 'Applying all…' : 'Apply All Changes'}
                      </button>
                    </div>
                    {(aiTrainerProposal.riskFlags || []).length > 0 && (
                      <div className="pcal-ai-trainer-risks">
                        <strong>Risk Flags</strong>
                        <ul>
                          {(aiTrainerProposal.riskFlags || []).map((flag, idx) => (
                            <li key={`${flag}-${idx}`}>{flag}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Stats bar */}
          <div className="pcal-stats">
            <div className="pcal-stat">
              <span className="pcal-stat-value">{completionPct}%</span>
              <span className="pcal-stat-label">Complete</span>
            </div>
            <div className="pcal-stat">
              <span className="pcal-stat-value">{completedActivities}/{totalActivities}</span>
              <span className="pcal-stat-label">Workouts</span>
            </div>
            <div className="pcal-stat">
              <span className="pcal-stat-value">{Math.floor(totalMinutes / 60)}h{totalMinutes % 60 > 0 ? ` ${totalMinutes % 60}m` : ''}</span>
              <span className="pcal-stat-label">Total Time</span>
            </div>
            <div className="pcal-stat">
              <div className="pcal-stat-bar">
                <div className="pcal-stat-bar-fill" style={{ width: `${completionPct}%` }} />
              </div>
            </div>
          </div>

          {/* Calendar column headers */}
          <div className="pcal-col-headers">
            {DAY_LABELS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          {/* Week rows */}
          <div className="pcal-weeks">
            {weeks.map((week: any) => {
              const dayMap = new Map<number, any>();
              for (const day of (week.days || [])) {
                dayMap.set(day.dayOfWeek, day);
              }
              const bounds = resolveWeekBounds({
                weekIndex: week.weekIndex,
                weekStartDate: week.startDate,
                weekEndDate: week.endDate,
                raceDate: plan.raceDate,
                weekCount: plan.weekCount,
                allWeekIndexes
              });
              const weekRange = formatWeekRange(bounds.startDate, bounds.endDate);
              const weekStart = bounds.startDate;
              const weekEnd = bounds.endDate;
              const isCurrentWeek = !!(weekStart && weekEnd && today >= weekStart && today <= weekEnd);

              return (
                <div className={`pcal-week${isCurrentWeek ? ' pcal-week-current' : ''}`} key={week.id}>
                  <div className="pcal-week-label">
                    <div className="pcal-week-head">
                      <span className="pcal-week-num">W{week.weekIndex}</span>
                      {isCurrentWeek && <span className="pcal-week-today-badge">Today</span>}
                    </div>
                    {weekRange && <span className="pcal-week-range">{weekRange}</span>}
                    {!weekRange && <span className="pcal-week-range muted">Dates not set</span>}
                  </div>
                  <div className="pcal-week-grid">
                    {[1, 2, 3, 4, 5, 6, 7].map((dow) => {
                      const day = dayMap.get(dow);
                      const activities = day?.activities || [];
                      const dayDate = getDayDateFromWeekStart(bounds.startDate, dow);
                      const dayManualDone = isDayMarkedDone(day?.notes);
                      const dayDone = dayManualDone || (activities.length > 0 && activities.every((activity: any) => activity.completed));
                      const isToday = dayDate && dayDate.getTime() === today.getTime();
                      const isPast = dayDate && dayDate.getTime() < today.getTime();
                      const showMonthInDate = !!dayDate && (dow === 1 || dayDate.getDate() === 1);

                      return (
                        <div
                          className={`pcal-cell${isToday ? ' pcal-cell-today' : ''}${isPast ? ' pcal-cell-past' : ''}${dayDone ? ' pcal-cell-day-done' : ''}`}
                          key={dow}
                        >
                          {dayDate && (
                            <span className="pcal-cell-date">
                              {showMonthInDate
                                ? dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                : dayDate.getDate()}
                            </span>
                          )}
                          {dayDone && <span className="pcal-cell-day-check" title="Day completed">✓</span>}
                          {isToday && <span className="pcal-cell-today-badge">Today</span>}
                          {activities.length === 0 && !isEditMode && (
                            <span className="pcal-cell-empty" />
                          )}
                          {isEditMode && (
                            <button
                              className="btn-ghost"
                              style={{ width: '100%', padding: '4px', fontSize: '11px', marginTop: '4px', borderStyle: 'dashed' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setAddingToDayId(day?.id || null);
                              }}
                            >
                              + Add
                            </button>
                          )}
                          {activities.map((a: any) => {
                            const details: string[] = [];
                            const plannedDistanceLabel = formatDisplayDistance(a.distance, a.distanceUnit);
                            if (plannedDistanceLabel) details.push(plannedDistanceLabel);
                            if (a.duration) details.push(`${a.duration}m`);
                            const displayPaceTarget = formatDisplayPace(a.paceTarget, a.distanceUnit);
                            if (displayPaceTarget) details.push(displayPaceTarget);
                            if (a.effortTarget) details.push(a.effortTarget);
                            if (a.completed) {
                              const actuals: string[] = [];
                              const actualDistanceLabel = formatDisplayDistance(a.actualDistance, a.distanceUnit);
                              if (actualDistanceLabel) actuals.push(actualDistanceLabel);
                              if (a.actualDuration) actuals.push(`${a.actualDuration}m`);
                              const displayActualPace = formatDisplayPace(a.actualPace, a.distanceUnit);
                              if (displayActualPace) actuals.push(displayActualPace);
                              if (actuals.length > 0) details.push(`Actual ${actuals.join(' · ')}`);
                            }

                            return (
                              <div
                                className={`pcal-activity pcal-activity-clickable${a.completed ? ' pcal-activity-done' : ''}${a.mustDo || a.priority === 'KEY' ? ' pcal-activity-key' : ''}`}
                                key={a.id}
                                onClick={(e) => {
                                  if (isEditMode) {
                                    e.stopPropagation();
                                    setEditingActivity(a);
                                  } else {
                                    setSelectedActivity(a);
                                  }
                                }}
                              >
                                <button
                                  className={`pcal-toggle${a.completed ? ' pcal-toggle-done' : ''}`}
                                  onClick={(e) => toggleComplete(a.id, e)}
                                  aria-label={a.completed ? 'Mark incomplete' : 'Mark complete'}
                                  type="button"
                                />
                                <div className="pcal-activity-content">
                                  <span className="pcal-activity-title">
                                    <ActivityTypeIcon
                                      type={a.type}
                                      className={`pcal-activity-icon type-${String(a.type || 'OTHER').toLowerCase()}`}
                                    />
                                    <span className="pcal-activity-title-text">{a.title}</span>
                                  </span>
                                  {details.length > 0 && (
                                    <span className="pcal-activity-details">
                                      {details.join(' · ')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Activity detail modal */}
      {selectedActivity && (
        <div className="pcal-modal-overlay" onClick={() => setSelectedActivity(null)}>
          <div className="pcal-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="pcal-modal-close"
              onClick={() => setSelectedActivity(null)}
              type="button"
              aria-label="Close"
            >
              &times;
            </button>

            <div className="pcal-modal-type-bar" style={{ background: typeColor(selectedActivity.type) }} />

            <div className="pcal-modal-body">
              <span className="pcal-modal-type">
                <ActivityTypeIcon type={selectedActivity.type} className="pcal-modal-type-icon" />
                {formatType(selectedActivity.type)}
              </span>
              <h2 className="pcal-modal-title">{selectedActivity.title}</h2>

              {/* Stats row */}
              <div className="pcal-modal-stats">
                {selectedDistanceDisplay && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {formatDistanceNumber(selectedDistanceDisplay.value)}
                    </span>
                    <span className="pcal-modal-stat-label">
                      {viewerUnitLabel}
                    </span>
                  </div>
                )}
                {selectedActivity.duration && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {selectedActivity.duration}
                    </span>
                    <span className="pcal-modal-stat-label">min</span>
                  </div>
                )}
                {selectedActivity.paceTarget && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {selectedPaceDisplay}
                    </span>
                    <span className="pcal-modal-stat-label">pace</span>
                  </div>
                )}
                {selectedActivity.effortTarget && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {selectedActivity.effortTarget}
                    </span>
                    <span className="pcal-modal-stat-label">effort</span>
                  </div>
                )}
              </div>

              {/* Instructions / raw text */}
              {selectedActivity.rawText && (
                <div className="pcal-modal-section">
                  <h3 className="pcal-modal-section-title">Instructions</h3>
                  <p className="pcal-modal-text">{selectedActivity.rawText}</p>
                </div>
              )}

              {/* Notes */}
              {selectedActivity.notes && (
                <div className="pcal-modal-section">
                  <h3 className="pcal-modal-section-title">Notes</h3>
                  <p className="pcal-modal-text">{selectedActivity.notes}</p>
                </div>
              )}

              {/* Actuals */}
              <div className="pcal-modal-section">
                <h3 className="pcal-modal-section-title">Actuals</h3>
                {selectedActivity.completed ? (
                  <div className="pcal-modal-actuals-form">
                    <label>
                      Distance ({viewerUnitLabel})
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={actualDistance}
                        onChange={(e) => setActualDistance(e.target.value)}
                        placeholder={
                          selectedDistanceDisplay?.value != null
                            ? String(selectedDistanceDisplay.value)
                            : 'e.g. 8'
                        }
                      />
                    </label>
                    <label>
                      Duration (min)
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={actualDuration}
                        onChange={(e) => setActualDuration(e.target.value)}
                        placeholder={selectedActivity.duration != null ? String(selectedActivity.duration) : 'e.g. 50'}
                      />
                    </label>
                    <label>
                      Pace
                      <input
                        type="text"
                        value={actualPace}
                        onChange={(e) => setActualPace(e.target.value)}
                        placeholder={
                          selectedPaceDisplay
                          || `e.g. ${viewerUnitLabel === 'km' ? '4:40 /km' : '7:30 /mi'}`
                        }
                      />
                    </label>
                    {actualsError && <p className="pcal-modal-form-error">{actualsError}</p>}
                    <button
                      className="pcal-modal-actuals-save"
                      onClick={saveActuals}
                      type="button"
                      disabled={savingActuals}
                    >
                      {savingActuals ? 'Saving…' : 'Save Actuals'}
                    </button>
                  </div>
                ) : (
                  <p className="pcal-modal-text pcal-modal-actuals-hint">
                    Mark this activity complete to log actual distance, duration, and pace.
                  </p>
                )}
              </div>

              {/* Tags */}
              {selectedActivity.tags && Array.isArray(selectedActivity.tags) && selectedActivity.tags.length > 0 && (
                <div className="pcal-modal-tags">
                  {selectedActivity.tags.map((tag: string, i: number) => (
                    <span className="pcal-modal-tag" key={i}>{tag}</span>
                  ))}
                </div>
              )}

              {/* Priority / Key workout badge */}
              {(selectedActivity.mustDo || selectedActivity.priority === 'KEY') && (
                <div className="pcal-modal-badge-row">
                  <span className="pcal-modal-badge">Key Workout</span>
                </div>
              )}

              {/* Complete toggle */}
              <button
                className={`pcal-modal-complete${selectedActivity.completed ? ' pcal-modal-complete-done' : ''}`}
                onClick={(e) => toggleComplete(selectedActivity.id, e)}
                type="button"
              >
                {selectedActivity.completed ? 'Completed — Undo' : 'Mark as Complete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Activity Form Modal */}
      <ActivityForm
        isOpen={!!editingActivity || !!addingToDayId}
        onClose={() => {
          setEditingActivity(null);
          setAddingToDayId(null);
        }}
        onSubmit={handleSaveActivity}
        onDelete={handleDeleteActivity}
        initialData={editingActivity || {}}
        title={editingActivity ? 'Edit Activity' : 'Add Activity'}
        dayId={addingToDayId || undefined}
      />

    </main>
  );
}
