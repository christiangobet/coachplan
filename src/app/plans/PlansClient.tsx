'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import AthleteSidebar from '@/components/AthleteSidebar';
import PlanGuidePanel from '@/components/PlanGuidePanel';
import PlanSummaryCard from '@/components/PlanSummaryCard';
import type { PlanSummary } from '@/lib/types/plan-summary';
import { getFirstName } from '@/lib/display-name';
import { pickSelectedPlan, SELECTED_PLAN_COOKIE } from '@/lib/plan-selection';
import '../dashboard/dashboard.css';
import './plans.css';

type PlanStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
type WeekDateAnchor = 'RACE_DATE' | 'START_DATE';

type Plan = {
  id: string;
  name: string;
  weekCount?: number | null;
  status: PlanStatus;
  progress?: number;
  raceName?: string | null;
  raceDate?: string | null;
  raceType?: string | null;
  difficulty?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  planGuide?: string | null;
  stats?: {
    totalActivities: number;
    completedActivities: number;
    keyActivities: number;
    keyCompleted: number;
  } | null;
  nextActivity?: {
    id: string;
    title: string;
    type: string;
    distance: number | null;
    distanceUnit: string | null;
    duration: number | null;
    weekIndex: number | null;
    dayOfWeek: number | null;
    dateISO: string | null;
  } | null;
  banner?: {
    imageId: string;
    url: string;
  } | null;
};

type Template = {
  id: string;
  name: string;
  weekCount?: number | null;
  isPublic?: boolean;
  raceType?: string | null;
  difficulty?: string | null;
  planGuide?: string | null;
  planSummary?: PlanSummary | null;
  createdAt?: string | null;
  owner?: { name?: string | null } | null;
};

type LibrarySummary = {
  total: number;
  active: number;
  draft: number;
  archived: number;
};

type NextActivityDisplay = {
  dateLabel: string | null;
  title: string;
  distanceLabel: string | null;
  durationLabel: string | null;
};

function statusColor(status: PlanStatus) {
  if (status === 'ACTIVE') return 'var(--d-green)';
  if (status === 'DRAFT') return 'var(--d-amber)';
  return 'var(--d-muted)';
}

function formatRaceDate(value: string | null | undefined) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not set';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatEnumLabel(value: string | null | undefined) {
  if (!value) return null;
  return value
    .toLowerCase()
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function formatType(value: string | null | undefined) {
  if (!value) return 'Session';
  return value.replace(/_/g, ' ').toLowerCase().replace(/(^\w)/, (letter) => letter.toUpperCase());
}

function formatDistance(distance: number | null | undefined, unit: string | null | undefined) {
  if (distance === null || distance === undefined) return null;
  const label = unit ? unit.toLowerCase() : 'km';
  return `${distance.toFixed(1)} ${label}`;
}

function formatNextActivity(nextActivity: Plan['nextActivity']): NextActivityDisplay | null {
  if (!nextActivity) return null;
  let dateLabel: string | null = null;
  if (nextActivity.dateISO) {
    const parsed = new Date(`${nextActivity.dateISO}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      dateLabel = parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  }
  return {
    dateLabel,
    title: nextActivity.title || formatType(nextActivity.type),
    distanceLabel: formatDistance(nextActivity.distance, nextActivity.distanceUnit),
    durationLabel: nextActivity.duration ? `${nextActivity.duration} min` : null,
  };
}

function calcTemplateStartHint(raceDateStr: string, weekCount: number): string {
  const race = new Date(raceDateStr);
  const raceSunday = new Date(race);
  raceSunday.setHours(0, 0, 0, 0);
  const day = raceSunday.getDay();
  if (day !== 0) raceSunday.setDate(raceSunday.getDate() + (7 - day));
  const start = new Date(raceSunday);
  start.setDate(start.getDate() - ((weekCount - 1) * 7 + 6));
  return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function calcTemplateEndHint(startDateStr: string, weekCount: number): string {
  const start = new Date(startDateStr);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + weekCount * 7 - 1);
  return end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function matchesTextQuery(query: string, ...fields: Array<string | null | undefined>) {
  if (!query) return true;
  const haystack = fields.filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

function keyCompletionPct(plan: Plan) {
  const keyTotal = plan.stats?.keyActivities ?? 0;
  const keyDone = plan.stats?.keyCompleted ?? 0;
  if (keyTotal <= 0) return null;
  return Math.round((keyDone / keyTotal) * 100);
}

export default function PlansClient() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [myTemplates, setMyTemplates] = useState<Template[]>([]);
  const [publicTemplates, setPublicTemplates] = useState<Template[]>([]);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [athleteName, setAthleteName] = useState('Athlete');
  const [userId, setUserId] = useState<string | null>(null);

  const [initialLoading, setInitialLoading] = useState(true);
  const [plansLoadError, setPlansLoadError] = useState<string | null>(null);
  const [templatesLoadError, setTemplatesLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [raceTypeFilter, setRaceTypeFilter] = useState('ALL');
  const [difficultyFilter, setDifficultyFilter] = useState('ALL');

  const [cookieSelectedPlanId, setCookieSelectedPlanId] = useState<string | null>(null);
  const [expandedMenuId, setExpandedMenuId] = useState<string | null>(null);
  const [expandedGuideId, setExpandedGuideId] = useState<string | null>(null);

  const [assigning, setAssigning] = useState<string | null>(null);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);
  const [savingAsTemplate, setSavingAsTemplate] = useState<string | null>(null);
  const [togglingVisibilityId, setTogglingVisibilityId] = useState<string | null>(null);
  const [groupingPlanId, setGroupingPlanId] = useState<string | null>(null);
  const [groupingResult, setGroupingResult] = useState<{ planId: string; message: string; ok: boolean } | null>(null);

  const [useTemplateId, setUseTemplateId] = useState<string | null>(null);
  const [templateWeekDateAnchor, setTemplateWeekDateAnchor] = useState<WeekDateAnchor>('RACE_DATE');
  const [templateRaceDate, setTemplateRaceDate] = useState('');
  const [templateStartDate, setTemplateStartDate] = useState('');

  const [renamingTemplateId, setRenamingTemplateId] = useState<string | null>(null);
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const viewedEventSent = useRef(false);
  const searchEventRef = useRef('');

  const emitLibraryEvent = (event: string, detail: Record<string, unknown> = {}) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('coachplan:analytics', {
        detail: {
          event,
          source: 'plans_library',
          ...detail,
        },
      })
    );
  };

  const toggleMenu = (planId: string) =>
    setExpandedMenuId((prev) => (prev === planId ? null : planId));

  useEffect(() => {
    if (!expandedMenuId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.plan-card-overflow-menu') && !target.closest('.plan-card-menu-btn')) {
        setExpandedMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedMenuId]);

  useEffect(() => {
    if (!expandedGuideId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.plan-card')) {
        setExpandedGuideId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedGuideId]);

  useEffect(() => {
    if (initialLoading || viewedEventSent.current) return;
    viewedEventSent.current = true;
    emitLibraryEvent('plans_library_viewed', { totalPlans: plans.length });
  }, [initialLoading, plans.length]);

  useEffect(() => {
    if (initialLoading) return;
    emitLibraryEvent('plans_library_filter_changed', {
      raceTypeFilter,
      difficultyFilter,
    });
  }, [initialLoading, raceTypeFilter, difficultyFilter]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      searchEventRef.current = '';
      return;
    }
    if (searchEventRef.current === query) return;
    searchEventRef.current = query;
    emitLibraryEvent('plans_library_search_used', { query });
  }, [searchQuery]);

  const rememberSelectedPlan = (planId: string) => {
    if (!planId) return;
    document.cookie = `${SELECTED_PLAN_COOKIE}=${encodeURIComponent(planId)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setCookieSelectedPlanId(planId);
  };

  const readSelectedPlanCookie = () => {
    const prefix = `${SELECTED_PLAN_COOKIE}=`;
    const raw = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix));
    if (!raw) return null;
    const value = raw.slice(prefix.length);
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setInitialLoading(true);
      setPlansLoadError(null);
      setTemplatesLoadError(null);
      setCookieSelectedPlanId(readSelectedPlanCookie());

      try {
        const [meRes, libraryRes] = await Promise.all([
          fetch('/api/me'),
          fetch('/api/plans/library'),
        ]);

        if (meRes.ok) {
          const meData = await meRes.json().catch(() => null);
          if (!cancelled) {
            setUserId(meData?.id || null);
            if (meData?.name) setAthleteName(getFirstName(meData.name));
          }
        } else if (!cancelled) {
          setUserId(null);
        }

        if (!libraryRes.ok) {
          if (!cancelled) {
            setPlans([]);
            setMyTemplates([]);
            setPublicTemplates([]);
            setPlansLoadError('Could not load plans right now. Refresh to try again.');
            setTemplatesLoadError('Could not load templates right now. Refresh to try again.');
          }
          return;
        }

        const libraryData = await libraryRes.json().catch(() => null);
        if (!cancelled) {
          setPlans(Array.isArray(libraryData?.plans) ? libraryData.plans : []);
          setMyTemplates(Array.isArray(libraryData?.myTemplates) ? libraryData.myTemplates : []);
          setPublicTemplates(Array.isArray(libraryData?.publicTemplates) ? libraryData.publicTemplates : []);
          setSummary(
            libraryData?.summary && typeof libraryData.summary === 'object'
              ? libraryData.summary
              : null
          );
        }
      } catch {
        if (cancelled) return;
        setUserId(null);
        setPlans([]);
        setMyTemplates([]);
        setPublicTemplates([]);
        setPlansLoadError('Could not load plans right now. Check your connection and refresh.');
        setTemplatesLoadError('Could not load templates right now. Check your connection and refresh.');
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUseTemplate = async (templateId: string) => {
    const anchorDate = templateWeekDateAnchor === 'RACE_DATE' ? templateRaceDate : templateStartDate;
    if (!userId || !anchorDate) return;
    setAssigning(templateId);
    setError(null);
    try {
      const payload: Record<string, string> = { templateId, weekDateAnchor: templateWeekDateAnchor };
      if (templateWeekDateAnchor === 'RACE_DATE' && templateRaceDate) payload.raceDate = templateRaceDate;
      if (templateWeekDateAnchor === 'START_DATE' && templateStartDate) payload.startDate = templateStartDate;
      const res = await fetch('/api/plans/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to create plan from template');
      if (data?.planId) {
        emitLibraryEvent('plans_library_primary_action_clicked', {
          action: 'use_template',
          entityId: templateId,
          entityType: 'template',
        });
        window.location.href = `/plans/${data.planId}`;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to assign template');
    } finally {
      setAssigning(null);
    }
  };

  const updatePlanStatus = async (planId: string, status: PlanStatus) => {
    setProcessingPlanId(planId);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to update plan status');
      const nextStatus = (data?.plan?.status || status) as PlanStatus;
      setPlans((prev) => prev.map((plan) => (plan.id === planId ? { ...plan, status: nextStatus } : plan)));
      if (nextStatus === 'ACTIVE') rememberSelectedPlan(planId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update plan status');
    } finally {
      setProcessingPlanId(null);
    }
  };

  const handleSaveAsTemplate = async (planId: string) => {
    setSavingAsTemplate(planId);
    setExpandedMenuId(null);
    try {
      const res = await fetch(`/api/plans/${planId}/save-as-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json().catch(() => null);
      if (data?.template) {
        setMyTemplates((prev) => [data.template, ...prev]);
      }
    } catch {
      // silent
    } finally {
      setSavingAsTemplate(null);
    }
  };

  const handleToggleVisibility = async (tplId: string, currentIsPublic: boolean) => {
    setTogglingVisibilityId(tplId);
    try {
      const res = await fetch(`/api/plans/${tplId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: !currentIsPublic }),
      });
      if (!res.ok) return;
      setMyTemplates((prev) => prev.map((template) => (template.id === tplId ? { ...template, isPublic: !currentIsPublic } : template)));
      if (!currentIsPublic) {
        const template = myTemplates.find((entry) => entry.id === tplId);
        if (template) {
          setPublicTemplates((prev) => [...prev, { ...template, owner: undefined }]);
        }
      } else {
        setPublicTemplates((prev) => prev.filter((entry) => entry.id !== tplId));
      }
    } finally {
      setTogglingVisibilityId(null);
    }
  };

  const handleRenameTemplate = async (tplId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setProcessingPlanId(tplId);
    try {
      const res = await fetch(`/api/plans/${tplId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error('Failed');
      setMyTemplates((prev) => prev.map((template) => (template.id === tplId ? { ...template, name: trimmed } : template)));
      setRenamingTemplateId(null);
    } catch {
      // silent
    } finally {
      setProcessingPlanId(null);
    }
  };

  const handleRenamePlan = async (planId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setProcessingPlanId(planId);
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error('Failed');
      setPlans((prev) => prev.map((plan) => (plan.id === planId ? { ...plan, name: trimmed } : plan)));
      setRenamingPlanId(null);
    } catch {
      // silent
    } finally {
      setProcessingPlanId(null);
    }
  };

  const handleAssignSessionGroups = async (planId: string) => {
    setGroupingPlanId(planId);
    setGroupingResult(null);
    setExpandedMenuId(null);
    try {
      const res = await fetch(`/api/plans/${planId}/assign-session-groups`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed');
      const { daysGrouped = 0, activitiesTagged = 0 } = data ?? {};
      setGroupingResult({
        planId,
        ok: true,
        message:
          daysGrouped === 0
            ? 'No new run sessions found to group.'
            : `Grouped ${activitiesTagged} activities across ${daysGrouped} day${daysGrouped !== 1 ? 's' : ''}.`,
      });
    } catch (err: unknown) {
      setGroupingResult({
        planId,
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to group sessions',
      });
    } finally {
      setGroupingPlanId(null);
    }
  };

  const deletePlan = async (planId: string) => {
    if (!window.confirm('Delete this plan permanently? This cannot be undone.')) return;
    setProcessingPlanId(planId);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to delete plan');
      setPlans((prev) => prev.filter((plan) => plan.id !== planId));
      setMyTemplates((prev) => prev.filter((template) => template.id !== planId));
      setPublicTemplates((prev) => prev.filter((template) => template.id !== planId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete plan');
    } finally {
      setProcessingPlanId(null);
    }
  };

  const activePlans = useMemo(() => plans.filter((plan) => plan.status === 'ACTIVE'), [plans]);
  const draftPlans = useMemo(() => plans.filter((plan) => plan.status === 'DRAFT'), [plans]);
  const archivedPlans = useMemo(() => plans.filter((plan) => plan.status === 'ARCHIVED'), [plans]);

  const focusedPlan = useMemo(
    () => pickSelectedPlan(plans, { cookiePlanId: cookieSelectedPlanId }),
    [plans, cookieSelectedPlanId]
  );
  const focusedPlanId = focusedPlan?.id || null;

  const plansOverviewUnavailable = Boolean(plansLoadError);

  const communityTemplates = useMemo(() => {
    const myIds = new Set(myTemplates.map((template) => template.id));
    return publicTemplates.filter((template) => !myIds.has(template.id));
  }, [myTemplates, publicTemplates]);

  const searchNeedle = searchQuery.trim().toLowerCase();

  const filteredActivePlans = useMemo(
    () =>
      activePlans.filter((plan) => {
        if (!matchesTextQuery(searchNeedle, plan.name, plan.raceName, formatEnumLabel(plan.raceType), formatEnumLabel(plan.difficulty))) return false;
        if (raceTypeFilter !== 'ALL' && (plan.raceType || 'NONE') !== raceTypeFilter) return false;
        if (difficultyFilter !== 'ALL' && (plan.difficulty || 'NONE') !== difficultyFilter) return false;
        return true;
      }),
    [activePlans, searchNeedle, raceTypeFilter, difficultyFilter]
  );

  const filteredDraftPlans = useMemo(
    () =>
      draftPlans.filter((plan) => {
        if (!matchesTextQuery(searchNeedle, plan.name, plan.raceName, formatEnumLabel(plan.raceType), formatEnumLabel(plan.difficulty))) return false;
        if (raceTypeFilter !== 'ALL' && (plan.raceType || 'NONE') !== raceTypeFilter) return false;
        if (difficultyFilter !== 'ALL' && (plan.difficulty || 'NONE') !== difficultyFilter) return false;
        return true;
      }),
    [draftPlans, searchNeedle, raceTypeFilter, difficultyFilter]
  );

  const filteredArchivedPlans = useMemo(
    () =>
      archivedPlans.filter((plan) => {
        if (!matchesTextQuery(searchNeedle, plan.name, plan.raceName, formatEnumLabel(plan.raceType), formatEnumLabel(plan.difficulty))) return false;
        if (raceTypeFilter !== 'ALL' && (plan.raceType || 'NONE') !== raceTypeFilter) return false;
        if (difficultyFilter !== 'ALL' && (plan.difficulty || 'NONE') !== difficultyFilter) return false;
        return true;
      }),
    [archivedPlans, searchNeedle, raceTypeFilter, difficultyFilter]
  );

  const filteredMyTemplates = useMemo(
    () =>
      myTemplates.filter((template) => {
        if (!matchesTextQuery(searchNeedle, template.name, formatEnumLabel(template.raceType), formatEnumLabel(template.difficulty))) return false;
        if (raceTypeFilter !== 'ALL' && (template.raceType || 'NONE') !== raceTypeFilter) return false;
        if (difficultyFilter !== 'ALL' && (template.difficulty || 'NONE') !== difficultyFilter) return false;
        return true;
      }),
    [myTemplates, searchNeedle, raceTypeFilter, difficultyFilter]
  );

  const filteredCommunityTemplates = useMemo(
    () =>
      communityTemplates.filter((template) => {
        if (!matchesTextQuery(searchNeedle, template.name, formatEnumLabel(template.raceType), formatEnumLabel(template.difficulty), template.owner?.name || '')) return false;
        if (raceTypeFilter !== 'ALL' && (template.raceType || 'NONE') !== raceTypeFilter) return false;
        if (difficultyFilter !== 'ALL' && (template.difficulty || 'NONE') !== difficultyFilter) return false;
        return true;
      }),
    [communityTemplates, searchNeedle, raceTypeFilter, difficultyFilter]
  );

  const raceFilterOptions = useMemo(() => {
    const source = [
      ...activePlans,
      ...draftPlans,
      ...archivedPlans,
      ...myTemplates,
      ...communityTemplates,
    ];
    return Array.from(new Set(source.map((item) => item.raceType || 'NONE')));
  }, [activePlans, draftPlans, archivedPlans, myTemplates, communityTemplates]);

  const difficultyFilterOptions = useMemo(() => {
    const source = [
      ...activePlans,
      ...draftPlans,
      ...archivedPlans,
      ...myTemplates,
      ...communityTemplates,
    ];
    return Array.from(new Set(source.map((item) => item.difficulty || 'NONE')));
  }, [activePlans, draftPlans, archivedPlans, myTemplates, communityTemplates]);

  const computedSummary: LibrarySummary = useMemo(
    () => ({
      total: plans.length,
      active: activePlans.length,
      draft: draftPlans.length,
      archived: archivedPlans.length,
    }),
    [plans.length, activePlans.length, draftPlans.length, archivedPlans.length]
  );

  const librarySummary = summary || computedSummary;

  const featuredArchivedPlan = archivedPlans[0] || null;
  const featuredTemplate = communityTemplates[0] || myTemplates[0] || null;

  const trackPrimaryAction = (action: string, entityId: string, entityType: string) => {
    emitLibraryEvent('plans_library_primary_action_clicked', {
      action,
      entityId,
      entityType,
    });
  };

  const renderMetaRow = (items: string[]) => (
    <div className="plans-lib-card-meta">
      {items.map((item, index) => (
        <span className="plans-lib-card-meta-item" key={`${item}-${index}`}>
          {index > 0 && <span className="plans-lib-card-sep" aria-hidden>•</span>}
          <span>{item}</span>
        </span>
      ))}
    </div>
  );

  const renderTemplateSetup = (template: Template) => (
    <div className="plan-template-setup">
      <label className="plan-template-setup-label">
        <span>Calendar alignment</span>
        <div className="plan-template-anchor-toggle">
          <label className="plan-template-anchor-option">
            <input
              type="radio"
              name={`template-anchor-${template.id}`}
              value="RACE_DATE"
              checked={templateWeekDateAnchor === 'RACE_DATE'}
              onChange={() => setTemplateWeekDateAnchor('RACE_DATE')}
            />
            <span>Race date</span>
          </label>
          <label className="plan-template-anchor-option">
            <input
              type="radio"
              name={`template-anchor-${template.id}`}
              value="START_DATE"
              checked={templateWeekDateAnchor === 'START_DATE'}
              onChange={() => setTemplateWeekDateAnchor('START_DATE')}
            />
            <span>Training start date (W1)</span>
          </label>
        </div>
      </label>
      <label className="plan-template-setup-label">
        <span>
          {templateWeekDateAnchor === 'RACE_DATE' ? 'Race date' : 'Training start date (W1)'}
          <span className="plan-template-required"> *</span>
        </span>
        <input
          type="date"
          value={templateWeekDateAnchor === 'RACE_DATE' ? templateRaceDate : templateStartDate}
          onChange={(e) => {
            if (templateWeekDateAnchor === 'RACE_DATE') setTemplateRaceDate(e.target.value);
            else setTemplateStartDate(e.target.value);
          }}
          autoFocus
        />
      </label>
      {templateWeekDateAnchor === 'RACE_DATE' && templateRaceDate && template.weekCount && (
        <p className="plan-template-start-hint">Starts {calcTemplateStartHint(templateRaceDate, template.weekCount)}</p>
      )}
      {templateWeekDateAnchor === 'START_DATE' && templateStartDate && template.weekCount && (
        <p className="plan-template-start-hint">Ends {calcTemplateEndHint(templateStartDate, template.weekCount)}</p>
      )}
      <div className="plan-card-actions">
        <button
          className="dash-btn-primary plan-card-cta"
          onClick={() => handleUseTemplate(template.id)}
          disabled={!(templateWeekDateAnchor === 'RACE_DATE' ? templateRaceDate : templateStartDate) || assigning === template.id}
        >
          {assigning === template.id ? 'Creating...' : 'Create plan'}
        </button>
        <button
          className="plan-template-cancel"
          type="button"
          onClick={() => {
            setUseTemplateId(null);
            setTemplateWeekDateAnchor('RACE_DATE');
            setTemplateRaceDate('');
            setTemplateStartDate('');
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const renderPlanCard = (plan: Plan, mode: 'active' | 'draft' | 'archived') => {
    const nextActivityInfo = formatNextActivity(plan.nextActivity);
    const keyPct = keyCompletionPct(plan);
    const planMeta = [
      plan.weekCount ? `${plan.weekCount} weeks` : 'No week count',
      plan.raceName?.trim() || 'No race name',
      formatRaceDate(plan.raceDate),
    ];
    const nextMetaParts = nextActivityInfo
      ? [nextActivityInfo.dateLabel, nextActivityInfo.distanceLabel, nextActivityInfo.durationLabel].filter(Boolean) as string[]
      : [];
    const bannerStyle = plan.banner?.url
      ? ({ '--plan-banner-url': `url("${plan.banner.url}")` } as CSSProperties)
      : undefined;

    return (
      <div className={`plan-card plan-card--library status-${mode}${plan.id === focusedPlanId ? ' focused' : ''}`} key={plan.id} data-debug-id="PLC">
        <div
          className={`plans-lib-card-banner mode-${mode}${plan.banner?.url ? ' has-banner' : ''}`}
          style={bannerStyle}
        >
          <div className="plan-card-top">
            <span className="plan-status-dot" style={{ background: statusColor(plan.status) }} />
            <span className="plan-status-label">{plan.status}</span>
            {plan.id === focusedPlanId && <span className="plan-focus-badge">Current Plan</span>}
            <button
              className="plan-card-menu-btn"
              onClick={() => toggleMenu(plan.id)}
              aria-label="More actions"
            >
              ···
            </button>
          </div>

          {renamingPlanId === plan.id ? (
            <div className="plan-template-rename plans-lib-inline-edit">
              <input
                className="plan-template-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenamePlan(plan.id);
                  if (e.key === 'Escape') setRenamingPlanId(null);
                }}
                autoFocus
              />
              <div className="plan-template-rename-actions">
                <button
                  className="dash-btn-primary plan-card-cta"
                  onClick={() => handleRenamePlan(plan.id)}
                  disabled={!renameValue.trim() || processingPlanId === plan.id}
                >
                  {processingPlanId === plan.id ? 'Saving…' : 'Save'}
                </button>
                <button className="plan-template-cancel" onClick={() => setRenamingPlanId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <h3 className="plan-card-name">{plan.name}</h3>
          )}

          {renderMetaRow(planMeta)}
        </div>

        {(plan.raceType || plan.difficulty) && (
          <div className="plans-lib-card-tags">
            {plan.raceType && <span className="plans-lib-filter-chip">{formatEnumLabel(plan.raceType)}</span>}
            {plan.difficulty && <span className="plans-lib-filter-chip">{formatEnumLabel(plan.difficulty)}</span>}
          </div>
        )}

        {nextActivityInfo && (
          <div className="plans-lib-next-row">
            <span className="plans-lib-next-label">Next up</span>
            <div className="plans-lib-next-value">
              <span className="plans-lib-next-title">{nextActivityInfo.title}</span>
              <div className="plans-lib-next-meta">
                {nextMetaParts.map((part, index) => (
                  <span className="plans-lib-card-meta-item" key={`${part}-${index}`}>
                    {index > 0 && <span className="plans-lib-card-sep" aria-hidden>•</span>}
                    <span>{part}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="plan-card-progress plans-lib-progress">
          <span>{plan.progress ?? 0}% complete</span>
          <div className="plan-card-progress-track">
            <div className="plan-card-progress-fill" style={{ width: `${plan.progress ?? 0}%` }} />
          </div>
        </div>

        {(plan.stats?.totalActivities || keyPct !== null) && (
          <div className="plans-lib-card-footstats">
            <span>
              {plan.stats?.totalActivities ? `${plan.stats.completedActivities}/${plan.stats.totalActivities} sessions` : '—'}
            </span>
            {keyPct !== null && <span>Key {keyPct}%</span>}
          </div>
        )}

        {expandedGuideId === plan.id && plan.planGuide && (
          <div className="plan-template-guide-body">
            <PlanGuidePanel guideText={plan.planGuide} planId={plan.id} />
          </div>
        )}

        <div className="plan-card-actions">
          {mode === 'active' && (
            <Link
              className="dash-btn-primary plan-card-cta"
              href={`/plans/${plan.id}`}
              onClick={() => {
                rememberSelectedPlan(plan.id);
                trackPrimaryAction('continue_plan', plan.id, 'plan');
              }}
            >
              Continue Plan
            </Link>
          )}

          {mode === 'draft' && (
            <>
              <Link
                className="dash-btn-primary plan-card-cta"
                href={`/plans/${plan.id}/review?fromUpload=1`}
                onClick={() => {
                  rememberSelectedPlan(plan.id);
                  trackPrimaryAction('continue_editing', plan.id, 'plan');
                }}
              >
                Continue Editing
              </Link>
              <Link
                className="dash-btn-ghost plan-card-edit-btn"
                href={`/plans/${plan.id}`}
                onClick={() => rememberSelectedPlan(plan.id)}
              >
                Open Review
              </Link>
            </>
          )}

          {mode === 'archived' && (
            <>
              <Link className="dash-btn-ghost plan-card-edit-btn" href={`/plans/${plan.id}`} onClick={() => rememberSelectedPlan(plan.id)}>
                View Plan
              </Link>
              <button
                className="dash-btn-primary plan-card-cta"
                onClick={() => {
                  void updatePlanStatus(plan.id, 'ACTIVE');
                  trackPrimaryAction('activate_plan', plan.id, 'plan');
                }}
                disabled={processingPlanId === plan.id}
              >
                {processingPlanId === plan.id ? 'Saving…' : 'Activate'}
              </button>
            </>
          )}
        </div>

        {groupingResult?.planId === plan.id && (
          <p className={`plans-lib-inline-status ${groupingResult.ok ? 'ok' : 'error'}`}>
            {groupingResult.message}
          </p>
        )}

        {expandedMenuId === plan.id && (
          <div className="plan-card-overflow-menu">
            {mode === 'active' && (
              <button
                className="plan-card-overflow-item"
                onClick={() => {
                  setRenameValue(plan.name);
                  setRenamingPlanId(plan.id);
                  setExpandedMenuId(null);
                }}
              >
                Rename
              </button>
            )}
            {(mode === 'active' || mode === 'draft') && (
              <Link
                className="plan-card-overflow-item"
                href={`/plans/${plan.id}?mode=edit`}
                onClick={() => {
                  rememberSelectedPlan(plan.id);
                  setExpandedMenuId(null);
                }}
              >
                Edit plan
              </Link>
            )}
            {plan.planGuide && (
              <button
                className="plan-card-overflow-item"
                onClick={() => {
                  setExpandedGuideId((prev) => (prev === plan.id ? null : plan.id));
                  setExpandedMenuId(null);
                }}
              >
                {expandedGuideId === plan.id ? 'Hide guide' : 'Show guide'}
              </button>
            )}
            <button
              className="plan-card-overflow-item"
              onClick={() => handleAssignSessionGroups(plan.id)}
              disabled={groupingPlanId === plan.id}
            >
              {groupingPlanId === plan.id ? 'Grouping…' : 'Group run sessions'}
            </button>
            {mode === 'active' && (
              <button
                className="plan-card-overflow-item"
                onClick={() => {
                  void updatePlanStatus(plan.id, 'DRAFT');
                  setExpandedMenuId(null);
                }}
                disabled={processingPlanId === plan.id}
              >
                {processingPlanId === plan.id ? 'Saving…' : 'Move to draft'}
              </button>
            )}
            {(mode === 'active' || mode === 'draft') && (
              <button
                className="plan-card-overflow-item"
                onClick={() => {
                  void updatePlanStatus(plan.id, 'ARCHIVED');
                  setExpandedMenuId(null);
                }}
                disabled={processingPlanId === plan.id}
              >
                {processingPlanId === plan.id ? 'Saving…' : 'Archive'}
              </button>
            )}
            <button
              className="plan-card-overflow-item"
              onClick={() => handleSaveAsTemplate(plan.id)}
              disabled={savingAsTemplate === plan.id}
            >
              {savingAsTemplate === plan.id ? 'Saving…' : 'Save as template'}
            </button>
            <button
              className="plan-card-overflow-item danger"
              onClick={() => {
                void deletePlan(plan.id);
                setExpandedMenuId(null);
              }}
              disabled={processingPlanId === plan.id}
            >
              {processingPlanId === plan.id ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderTemplateCard = (template: Template, kind: 'my' | 'public') => {
    const isMyTemplate = kind === 'my';
    const ownerLabel = !isMyTemplate && template.owner?.name ? `By ${template.owner.name}` : null;
    const templateMeta = [
      template.weekCount ? `${template.weekCount} weeks` : 'No week count',
      template.raceType ? formatEnumLabel(template.raceType) : null,
      template.difficulty ? formatEnumLabel(template.difficulty) : null,
    ].filter(Boolean) as string[];

    return (
      <div className="plan-card plan-card--library template" key={template.id} data-debug-id="PLC">
        <div className="plan-card-top">
          <span className={`plan-template-badge ${template.isPublic ? 'public' : 'personal'}`}>
            {template.isPublic ? 'Public' : 'Personal'}
          </span>
          {ownerLabel && <span className="plans-lib-owner-label">{ownerLabel}</span>}
          {isMyTemplate && (
            <button
              className="plan-card-menu-btn"
              onClick={() => toggleMenu(template.id)}
              aria-label="More actions"
            >
              ···
            </button>
          )}
        </div>

        {renamingTemplateId === template.id ? (
          <div className="plan-template-rename plans-lib-inline-edit">
            <input
              className="plan-template-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameTemplate(template.id);
                if (e.key === 'Escape') setRenamingTemplateId(null);
              }}
              autoFocus
            />
            <div className="plan-template-rename-actions">
              <button
                className="dash-btn-primary plan-card-cta"
                onClick={() => handleRenameTemplate(template.id)}
                disabled={!renameValue.trim() || processingPlanId === template.id}
              >
                {processingPlanId === template.id ? 'Saving…' : 'Save'}
              </button>
              <button className="plan-template-cancel" onClick={() => setRenamingTemplateId(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <h3 className="plan-card-name">{template.name}</h3>
        )}

        {renderMetaRow(templateMeta)}

        {(template.raceType || template.difficulty) && (
          <div className="plans-lib-card-tags">
            {template.raceType && <span className="plans-lib-filter-chip">{formatEnumLabel(template.raceType)}</span>}
            {template.difficulty && <span className="plans-lib-filter-chip">{formatEnumLabel(template.difficulty)}</span>}
          </div>
        )}

        {expandedGuideId === template.id && (template.planSummary || template.planGuide) && (
          <div className="plan-template-guide-body">
            {template.planSummary && <PlanSummaryCard summary={template.planSummary} planId={template.id} />}
            {template.planGuide && <PlanGuidePanel guideText={template.planGuide} planId={template.id} />}
          </div>
        )}

        {useTemplateId === template.id ? (
          renderTemplateSetup(template)
        ) : (
          <div className="plan-card-actions">
            <button
              className="dash-btn-primary plan-card-cta"
              onClick={() => {
                setUseTemplateId(template.id);
                setTemplateWeekDateAnchor('RACE_DATE');
                setTemplateRaceDate('');
                setTemplateStartDate('');
                trackPrimaryAction('start_use_template', template.id, 'template');
              }}
              disabled={!userId}
            >
              Use template
            </button>
            {(template.planSummary || template.planGuide) && (
              <button
                className="dash-btn-ghost plan-card-edit-btn"
                onClick={() => setExpandedGuideId((prev) => (prev === template.id ? null : template.id))}
              >
                {expandedGuideId === template.id ? 'Hide preview' : 'Preview'}
              </button>
            )}
          </div>
        )}

        {isMyTemplate && expandedMenuId === template.id && (
          <div className="plan-card-overflow-menu">
            <button
              className="plan-card-overflow-item"
              onClick={() => {
                setRenameValue(template.name);
                setRenamingTemplateId(template.id);
                setExpandedMenuId(null);
              }}
            >
              Rename
            </button>
            <button
              className="plan-card-overflow-item"
              onClick={() => {
                void handleToggleVisibility(template.id, Boolean(template.isPublic));
                setExpandedMenuId(null);
              }}
              disabled={togglingVisibilityId === template.id}
            >
              {togglingVisibilityId === template.id ? 'Saving…' : template.isPublic ? 'Make private' : 'Make public'}
            </button>
            {(template.planSummary || template.planGuide) && (
              <button
                className="plan-card-overflow-item"
                onClick={() => {
                  setExpandedGuideId((prev) => (prev === template.id ? null : template.id));
                  setExpandedMenuId(null);
                }}
              >
                {expandedGuideId === template.id ? 'Hide preview' : 'Show preview'}
              </button>
            )}
            <button
              className="plan-card-overflow-item danger"
              onClick={() => {
                void deletePlan(template.id);
                setExpandedMenuId(null);
              }}
              disabled={processingPlanId === template.id}
            >
              {processingPlanId === template.id ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}
      </div>
    );
  };

  const filtersApplied = Boolean(searchNeedle) || raceTypeFilter !== 'ALL' || difficultyFilter !== 'ALL';

  const sectionEmptyText = (defaultCopy: string) =>
    filtersApplied ? 'No matches for the current filters.' : defaultCopy;

  const jumpToSection = (sectionId: string) => {
    if (typeof document === 'undefined') return;
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (initialLoading) {
    return (
      <main className="dash plans-page-shell">
        <div className="dash-grid">
          <AthleteSidebar active="plans" name={athleteName} />
          <section className="dash-center">
            <div className="dash-card plans-shell-header">
              <p className="muted">Loading plans…</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="dash plans-page-shell" data-debug-id="PLN">
      <div className="dash-grid">
        <AthleteSidebar active="plans" name={athleteName} />

        <section className="dash-center">
          <div className="dash-card plans-shell-header plans-lib-hero">
            <div className="plans-header plans-lib-header-row">
              <div>
                <h1>Training Plans</h1>
                <p className="muted">Browse, manage, and continue your training plans.</p>
              </div>
              <div className="plans-lib-header-actions">
                <label className="plans-lib-search" aria-label="Search plans">
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search plans..."
                  />
                </label>
                <Link
                  className="dash-btn-primary plans-lib-upload-btn"
                  href="/upload"
                  onClick={() => trackPrimaryAction('upload_plan', 'upload', 'global')}
                >
                  Upload Plan
                </Link>
              </div>
            </div>

            <div className="plans-lib-segmented" role="group" aria-label="Plan library section shortcuts">
              <span className="plans-lib-shortcuts-label">Jump to</span>
              <button
                type="button"
                className="plans-lib-segment-btn"
                onClick={() => jumpToSection('plans-active')}
              >
                Active <span>{activePlans.length}</span>
              </button>
              <button
                type="button"
                className="plans-lib-segment-btn"
                onClick={() => jumpToSection('plans-draft')}
              >
                Draft <span>{draftPlans.length}</span>
              </button>
              <button
                type="button"
                className="plans-lib-segment-btn"
                onClick={() => jumpToSection('plans-archived')}
              >
                Archived <span>{archivedPlans.length}</span>
              </button>
              <button
                type="button"
                className="plans-lib-segment-btn"
                onClick={() => jumpToSection('plans-my-templates')}
              >
                My Templates <span>{myTemplates.length}</span>
              </button>
              <button
                type="button"
                className="plans-lib-segment-btn"
                onClick={() => jumpToSection('plans-public-templates')}
              >
                Public Templates <span>{communityTemplates.length}</span>
              </button>
            </div>

            {(raceFilterOptions.length > 1 || difficultyFilterOptions.length > 1) && (
              <div className="plans-lib-filter-rows">
                {raceFilterOptions.length > 1 && (
                  <div className="plans-lib-filter-row">
                    <span className="plans-lib-filter-title">Race Type</span>
                    <button
                      type="button"
                      className={`plans-lib-filter-chip${raceTypeFilter === 'ALL' ? ' active' : ''}`}
                      onClick={() => setRaceTypeFilter('ALL')}
                    >
                      All
                    </button>
                    {raceFilterOptions.map((value) => (
                      <button
                        key={`race-filter-${value}`}
                        type="button"
                        className={`plans-lib-filter-chip${raceTypeFilter === value ? ' active' : ''}`}
                        onClick={() => setRaceTypeFilter(value)}
                      >
                        {value === 'NONE' ? 'Unspecified' : formatEnumLabel(value)}
                      </button>
                    ))}
                  </div>
                )}
                {difficultyFilterOptions.length > 1 && (
                  <div className="plans-lib-filter-row">
                    <span className="plans-lib-filter-title">Difficulty</span>
                    <button
                      type="button"
                      className={`plans-lib-filter-chip${difficultyFilter === 'ALL' ? ' active' : ''}`}
                      onClick={() => setDifficultyFilter('ALL')}
                    >
                      All
                    </button>
                    {difficultyFilterOptions.map((value) => (
                      <button
                        key={`difficulty-filter-${value}`}
                        type="button"
                        className={`plans-lib-filter-chip${difficultyFilter === value ? ' active' : ''}`}
                        onClick={() => setDifficultyFilter(value)}
                      >
                        {value === 'NONE' ? 'Unspecified' : formatEnumLabel(value)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <p className="plans-lib-page-error">{error}</p>}
          {plansLoadError && <p className="plans-lib-page-error">{plansLoadError}</p>}
          {templatesLoadError && <p className="plans-lib-page-error">{templatesLoadError}</p>}

          <section className="plans-section plans-shell-section" id="plans-active">
            <h2 className="plans-section-title">Active Plans</h2>
            {filteredActivePlans.length === 0 ? (
              <p className="plans-empty-text">{sectionEmptyText('No active plans. Activate a draft plan to make it your current program.')}</p>
            ) : (
              <div className="plans-grid">{filteredActivePlans.map((plan) => renderPlanCard(plan, 'active'))}</div>
            )}
          </section>

          <section className="plans-section plans-shell-section" id="plans-draft">
            <h2 className="plans-section-title">Draft Plans</h2>
            {filteredDraftPlans.length === 0 ? (
              <p className="plans-empty-text">{sectionEmptyText('No draft plans. Upload a new plan to start editing.')}</p>
            ) : (
              <div className="plans-grid">{filteredDraftPlans.map((plan) => renderPlanCard(plan, 'draft'))}</div>
            )}
          </section>

          <section className="plans-section plans-shell-section" id="plans-archived">
            <h2 className="plans-section-title">Archived Plans</h2>
            {filteredArchivedPlans.length === 0 ? (
              <p className="plans-empty-text">{sectionEmptyText('No archived plans yet.')}</p>
            ) : (
              <div className="plans-grid">{filteredArchivedPlans.map((plan) => renderPlanCard(plan, 'archived'))}</div>
            )}
          </section>

          <section className="plans-section plans-shell-section" id="plans-my-templates">
            <h2 className="plans-section-title">My Templates</h2>
            {filteredMyTemplates.length === 0 ? (
              <p className="plans-empty-text">{sectionEmptyText('No personal templates yet.')}</p>
            ) : (
              <div className="plans-grid">{filteredMyTemplates.map((template) => renderTemplateCard(template, 'my'))}</div>
            )}
          </section>

          <section className="plans-section plans-shell-section" id="plans-public-templates">
            <h2 className="plans-section-title">Public Templates</h2>
            {filteredCommunityTemplates.length === 0 ? (
              <p className="plans-empty-text">{sectionEmptyText('No public templates available right now.')}</p>
            ) : (
              <div className="plans-grid">{filteredCommunityTemplates.map((template) => renderTemplateCard(template, 'public'))}</div>
            )}
          </section>
        </section>

        <aside className="dash-right plans-lib-right-rail">
          <div className="dash-card plans-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Overview</span>
            </div>
            <div className="plans-overview-grid plans-lib-overview-grid">
              <div>
                <strong>{plansOverviewUnavailable ? '—' : librarySummary.total}</strong>
                <span>Total plans</span>
              </div>
              <div>
                <strong>{plansOverviewUnavailable ? '—' : librarySummary.active}</strong>
                <span>Active</span>
              </div>
              <div>
                <strong>{plansOverviewUnavailable ? '—' : librarySummary.draft}</strong>
                <span>Drafts</span>
              </div>
              <div>
                <strong>{plansOverviewUnavailable ? '—' : librarySummary.archived}</strong>
                <span>Archived</span>
              </div>
            </div>
          </div>

          <div className="dash-card plans-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Tips for Drafting</span>
            </div>
            <ul className="plans-lib-tip-list">
              <li>Kickstart from a template</li>
              <li>Set race or start date before activation</li>
              <li>Review key sessions before publishing</li>
            </ul>
          </div>

          <div className="dash-card plans-right-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Actions</span>
            </div>
            <div className="plans-links">
              <Link href="/dashboard"><span>Open today dashboard</span><span className="plans-link-arrow">→</span></Link>
              <Link href="/upload"><span>Upload a PDF plan</span><span className="plans-link-arrow">→</span></Link>
              <Link href="/profile"><span>Update athlete profile</span><span className="plans-link-arrow">→</span></Link>
            </div>
          </div>

          {featuredArchivedPlan && (
            <div className="dash-card plans-right-card plans-lib-featured-card">
              <div className="dash-card-header">
                <span className="dash-card-title">Featured Archived Plan</span>
              </div>
              <h4>{featuredArchivedPlan.name}</h4>
              <p>{featuredArchivedPlan.weekCount ? `${featuredArchivedPlan.weekCount} weeks` : 'No week count'} · {formatRaceDate(featuredArchivedPlan.raceDate)}</p>
              <button
                className="dash-btn-primary"
                onClick={() => {
                  void updatePlanStatus(featuredArchivedPlan.id, 'ACTIVE');
                  trackPrimaryAction('activate_featured_archived', featuredArchivedPlan.id, 'plan');
                }}
                disabled={processingPlanId === featuredArchivedPlan.id}
              >
                {processingPlanId === featuredArchivedPlan.id ? 'Saving…' : 'Activate'}
              </button>
            </div>
          )}

          {!featuredArchivedPlan && featuredTemplate && (
            <div className="dash-card plans-right-card plans-lib-featured-card">
              <div className="dash-card-header">
                <span className="dash-card-title">Featured Template</span>
              </div>
              <h4>{featuredTemplate.name}</h4>
              <p>{featuredTemplate.weekCount ? `${featuredTemplate.weekCount} weeks` : 'No week count'}{featuredTemplate.raceType ? ` · ${formatEnumLabel(featuredTemplate.raceType)}` : ''}</p>
              <button
                className="dash-btn-primary"
                onClick={() => {
                  const isOwnedTemplate = myTemplates.some((template) => template.id === featuredTemplate.id);
                  setUseTemplateId(featuredTemplate.id);
                  setTemplateWeekDateAnchor('RACE_DATE');
                  setTemplateRaceDate('');
                  setTemplateStartDate('');
                  trackPrimaryAction('open_featured_template', featuredTemplate.id, 'template');
                  jumpToSection(isOwnedTemplate ? 'plans-my-templates' : 'plans-public-templates');
                }}
              >
                Use Template
              </button>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
