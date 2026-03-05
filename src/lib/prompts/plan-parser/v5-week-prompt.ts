/**
 * V5 Phase 2 — Week extraction prompt template.
 * Call buildWeekPrompt(N, surveyJson) to produce the full prompt for week N.
 */

const WEEK_EXTRACTION_BASE = `You are a training plan parser. Extract ONLY week {{WEEK_NUMBER}} from the training plan text below.

Use the PLAN CONTEXT above to resolve all abbreviations, intensity labels, and zones.

RULES:
1. Output ONLY week {{WEEK_NUMBER}} in the "weeks" array. Do not emit any other weeks.
2. If week {{WEEK_NUMBER}} cannot be found in the text, return: {"week_number": {{WEEK_NUMBER}}, "sessions": [], "not_found": true}
3. Preserve the exact day-of-week assignment from the plan. Do NOT shift sessions to adjacent days. If the plan shows a long run on Saturday, it must have day_of_week: "Sat".
4. For each training day, extract all sessions with these fields:
   - day_of_week: Mon|Tue|Wed|Thu|Fri|Sat|Sun (required — copy exactly from the plan layout)
   - activity_type: Run|Walk|CrossTraining|Strength|Rest|Race|Mobility|Yoga|Hike|Other
   - session_role: descriptive name resolved from abbreviation (e.g. "Long Run", "Tempo Run", "Interval Session", "Easy Run")
   - raw_text: the original text from the plan for this session (copy verbatim)
   - intensity: any pace target, time target, heart rate zone, or RPE label (e.g. "7:30/mi", "HMP", "Z2", "RPE 7"). Never leave null if the plan specifies a pace or effort.
   - distance_km and distance_miles: ALWAYS populate both units. If the plan gives miles, convert to km (multiply by 1.60934). If the plan gives km, convert to miles (divide by 1.60934). For sessions with steps[], set distance = total_distance (WU + quality + CD).
   - total_distance_km / total_distance_miles: full session length including warmup/cooldown
   - quality_distance_km / quality_distance_miles: main quality segment only (e.g. for "WU + 6×400m + CD", quality = 2.4km)
   - steps[]: decompose structured sessions into steps (see SESSION DECOMPOSITION below)

TABLE COLUMN MAPPING:
Training plan tables typically have columns in this order: Week | Mon | Tue | Wed | Thu | Fri | Sat | Sun | TWM
- The columns map strictly left-to-right to Monday through Sunday.
- TWM (or "Total", "Weekly Total", "Total Weekly Mileage") is always the LAST column — it is NOT a day.
- Do NOT emit a session for TWM/Total. Use its value for total_weekly_mileage_min and total_weekly_mileage_max.
- If the total is a single number set both min and max to that value. If a range (e.g. "38-42") set min and max.
- CRITICAL: The column immediately before TWM is Sunday — do NOT treat it as another training day or as TWM.
- The column before Sunday is Saturday. Cross-reference with long_run_day in PLAN CONTEXT to verify.
- If the plan context says long_run_day is "Sat", the long run MUST appear on day_of_week: "Sat", not "Sun".

REST OR CROSS-TRAINING DAYS:
When a day shows "Rest or XT", "Rest; or XT", "Rest or Cross-Training", or any similar phrasing, emit TWO sessions for that day:
1. {"activity_type": "Rest", "optional": false, "day_of_week": "<same day>", "raw_text": "<original text>", ...}
2. {"activity_type": "CrossTraining", "optional": true, "session_role": "Cross Training", "day_of_week": "<same day>", "raw_text": "<original text>", ...}
Never emit only Rest and drop the XT. Both must always be present.

SESSION DECOMPOSITION:
Decompose any structured workout into steps[]. Emit ONE session per structured workout — do NOT split WU/quality/CD into separate sessions. Use these step types (all lowercase):
- warmup: warm-up segment (capture distance_miles or duration_minutes)
- cooldown: cool-down segment (capture distance_miles or duration_minutes)
- interval: single interval rep — use inside a repeat block (capture distance_miles or distance_km per rep, pace_target)
- recovery: easy/jog recovery between reps — use inside a repeat block
- tempo: sustained threshold/tempo effort (capture distance_miles, pace_target)
- easy: easy running segment (capture distance_miles)
- distance: simple distance run without specific intensity (capture distance_miles)
- note: coaching instruction or note (no distance/duration)
- repeat: CONTAINER — { "type": "repeat", "repetitions": N, "steps": [...child steps...] }

TWO FORMATS to handle:
1. Single-block: "1-2 mile WU; T: 1.5 miles @ HMP; 1-2 mile CD" → ONE session with steps: [warmup, tempo, cooldown]
2. Multi-row: WU on row 1, main on row 2, CD on row 3 → group into ONE session with steps[]

REPEAT BLOCKS: When a set repeats N times, wrap it as:
{ "type": "repeat", "repetitions": N, "steps": [ ...child steps... ] }
Example — "4×400m @ 5K pace": { "type": "repeat", "repetitions": 4, "steps": [{ "type": "interval", "distance_miles": 0.25, "pace_target": "5K pace" }] }

DISTANCE RULE FOR STRUCTURED SESSIONS:
When steps[] is non-empty:
- Recurse through repeat blocks: multiply child step distances by repetitions
- Sum all step distances to get total_distance_miles
- quality_distance_miles = sum of interval + tempo + distance steps only (multiply by repetitions for repeat blocks)
- distance_miles = total_distance_miles
- Always convert and emit both _km and _miles

PACE EXTRACTION:
Extract pace from any of these patterns in raw_text or intensity:
- Explicit pace: "7:30/mi", "4:45/km", "5:00 pace"
- Named pace: "HMP" (Half Marathon Pace), "MP" (Marathon Pace), "RP" (Race Pace), "TP" (Tempo Pace)
- Zone: "Z2", "Zone 3", "RPE 7", "easy effort", "conversational"
Set intensity to the extracted string. Use the glossary in PLAN CONTEXT to resolve abbreviations.

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

  // Extract long_run_day from survey for a prominent reminder at the top
  let longRunReminder = '';
  try {
    const survey = JSON.parse(surveyJson) as { plan_structure?: { long_run_day?: string } };
    const lrd = survey?.plan_structure?.long_run_day;
    if (lrd) longRunReminder = `### IMPORTANT: long_run_day = "${lrd}" — the long run MUST be assigned to day_of_week: "${lrd}" every week.\n`;
  } catch { /* ignore */ }

  return [
    '### PLAN CONTEXT',
    surveyJson,
    '',
    longRunReminder,
    prompt,
    '',
    'Training plan text:',
    fullPdfText
  ].filter(Boolean).join('\n');
}
