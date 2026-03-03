/**
 * V5 Phase 1 — Survey prompt.
 * Instructs the model to read the full PDF and produce a compact plan context document:
 * structure metadata, glossary, intensity zones, coaching notes.
 * Does NOT ask for training sessions.
 */
export const V5_SURVEY_PROMPT = `You are a training plan analyst. Your task is to read the full training plan text below and produce a compact PLAN CONTEXT document.

IMPORTANT RULES:
- Do NOT extract individual training sessions or workouts.
- Do NOT emit week-by-week data.
- Your only job is to understand the plan's LANGUAGE and SHAPE.

WHAT TO PRODUCE:
1. plan_structure — layout type, total weeks, training days per week, units (km/miles/mixed), race distance target, long run day, anchor days (e.g. which day tempo/interval sessions fall on), rest pattern.
2. glossary — every abbreviation or shorthand used in the plan, with a full description. Be exhaustive: if an abbreviation appears anywhere in the text, it must be in the glossary. Example: {"LRL": "Long Run Light — easy long run at conversational pace", "WU": "Warm-up — 10-15 min easy running"}.
3. intensity_zones — named zones or labels (e.g. Tempo, Z2, Easy, Threshold) with a brief description of what they mean in this plan.
4. coaching_notes — key structural notes from the coach (e.g. "Long runs build to 35km in week 16", "Never run hard 2 days in a row", taper strategy, cutback weeks).

LAYOUT TYPES:
- sequential_table: weeks listed as rows/sections, days as columns
- calendar_grid: actual calendar layout month by month
- symbolic: uses symbols/codes (e.g. A, B, C) mapped in a legend
- frequency_based: describes sessions by frequency per week, not by specific day

If layout_type is "frequency_based", set anchor_days to null and set day_of_week_inferred to false.

OUTPUT FORMAT:
Minified JSON only. No markdown, no prose. Max ~800 tokens.
If plan_length_weeks cannot be determined with confidence, make your best estimate based on the content.`;
