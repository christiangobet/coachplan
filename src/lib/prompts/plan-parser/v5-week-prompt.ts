/**
 * V5 Phase 2 — Week extraction prompt template.
 * Call buildWeekPrompt(N, surveyJson) to produce the full prompt for week N.
 */

const WEEK_EXTRACTION_BASE = `You are a training plan parser. Extract ONLY week {{WEEK_NUMBER}} from the training plan text below.

Use the PLAN CONTEXT above to resolve all abbreviations, intensity labels, and zones.

RULES:
1. Output ONLY week {{WEEK_NUMBER}} in the "weeks" array. Do not emit any other weeks.
2. If week {{WEEK_NUMBER}} cannot be found in the text, return: {"week_number": {{WEEK_NUMBER}}, "sessions": [], "not_found": true}
3. For each training day, extract all sessions with these fields:
   - day_of_week: Mon|Tue|Wed|Thu|Fri|Sat|Sun (required)
   - activity_type: Run|Walk|CrossTraining|Strength|Rest|Race|Mobility|Yoga|Hike|Other
   - session_role: descriptive name (e.g. "Long Run", "Tempo Run", "Interval Session")
   - raw_text: the original text from the plan for this session
   - intensity: pace target, heart rate zone, or RPE label if specified
   - distance_km and distance_miles: total session distance in both units (convert if plan uses one unit)
   - total_distance_km / total_distance_miles: same as distance — full session length including warmup/cooldown
   - quality_distance_km / quality_distance_miles: the main quality segment ONLY (e.g. for "WU + 6×400m + CD", quality = 6×400m = 2.4km)
   - steps[]: decompose structured sessions into steps (see SESSION DECOMPOSITION below)

SESSION DECOMPOSITION:
Decompose any structured workout into steps[]. Use these step types:
- WarmUp: warm-up segment
- CoolDown: cool-down segment
- Interval: repeats (set repeat count, distance or duration per rep)
- Tempo: sustained threshold/tempo effort
- Easy: easy running segment
- Distance: simple distance run without specific intensity
- Note: coaching instruction or note (no distance/duration)

TWO FORMATS to handle:
1. Single-block: "WU + 6×400m @ 5k pace + CD" → split by + and semicolons into steps
2. Multi-row: WU on row 1, main on row 2, CD on row 3 → group into ONE session with steps[]

DUAL DISTANCE RULE:
When steps[] is non-empty, always emit both quality_distance_* and total_distance_*.
- quality_distance = sum of Interval/Tempo/Distance step distances only
- total_distance = quality_distance + WarmUp + CoolDown distances (estimate WU/CD as 1-2km each if not specified)

OUTPUT FORMAT:
Minified JSON only. No markdown, no prose.`;

export function buildWeekPrompt(weekNumber: number): string {
  return WEEK_EXTRACTION_BASE.replaceAll('{{WEEK_NUMBER}}', String(weekNumber));
}

export function buildWeekInput(
  weekNumber: number,
  surveyJson: string,
  fullPdfText: string
): string {
  const prompt = buildWeekPrompt(weekNumber);
  return [
    '### PLAN CONTEXT',
    surveyJson,
    '',
    prompt,
    '',
    'Training plan text:',
    fullPdfText
  ].join('\n');
}
