/**
 * ai-summary-extractor.ts
 *
 * Extracts a structured PlanSummary JSON object from full plan text.
 * Runs after extractPlanGuide as a second AI pass.
 */

import { resolveAIProvider, getDefaultAiModel } from "./openai";
import type { PlanSummary } from "./types/plan-summary";

const SUMMARY_SYSTEM_PROMPT = `You are a training plan analyst. Extract a structured summary from the training plan text.

Return ONLY a valid JSON object — no markdown, no code blocks, no explanation.

Schema:
{
  "title": string,           // e.g. "16-Week Marathon Training Plan"
  "weeksTotal": number,      // total weeks in the plan
  "categories": string[],    // e.g. ["Marathon"], ["Half Marathon", "Trail"]
  "phases": [
    { "name": string, "weeks": [startWeek, endWeek], "focus": string }
  ],
  "loadCurve": {
    "points": number[],      // exactly weeksTotal values, each 0.0–1.0 (relative training load, 1.0 = peak week)
    "peakWeek": number,      // 1-indexed week of highest load
    "raceWeek": number       // 1-indexed race/taper week (last week if unknown)
  },
  "typicalWeek": [
    {
      "day": "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun",
      "label": string,       // e.g. "Easy Run", "Quality + Hills", "Long Run", "Rest"
      "tag": string,         // short badge: "RUN", "STR", "REST", "CROSS", "LONG", "QUALITY"
      "intensity": "easy" | "quality" | "rest" | "long" | "recovery" | "cross"
    }
  ],
  "principle": string,       // key coaching philosophy, 1 sentence
  "footerNote": string       // scheduling note, 1 sentence
}

Rules:
- typicalWeek must have exactly 7 entries (Mon–Sun)
- loadCurve.points must have exactly weeksTotal entries
- Normalize loadCurve.points so the maximum value is 1.0
- If a field cannot be determined, omit it or use a sensible default`;

export async function extractPlanSummary(
  rawText: string,
  { throwOnError = false } = {}
): Promise<PlanSummary | null> {
  if (!rawText?.trim()) {
    if (throwOnError) throw new Error("Plan text is empty");
    return null;
  }

  try {
    const provider = resolveAIProvider();
    const model = getDefaultAiModel(provider);

    let raw = "";
    if (provider === "cloudflare") {
      raw = await extractWithCloudflare(rawText, model);
    } else if (provider === "gemini") {
      raw = await extractWithGemini(rawText, model);
    } else {
      raw = await extractWithOpenAI(rawText, model);
    }

    return parseSummaryJSON(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[extractPlanSummary] Extraction failed:", message);
    if (throwOnError) throw err;
    return null;
  }
}

function parseSummaryJSON(raw: string): PlanSummary | null {
  if (!raw?.trim()) return null;
  // Strip markdown code fences if present
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(cleaned) as Partial<PlanSummary>;
    if (
      typeof obj.title !== "string" ||
      typeof obj.weeksTotal !== "number" ||
      !Array.isArray(obj.phases) ||
      !Array.isArray(obj.typicalWeek)
    ) {
      console.warn("[extractPlanSummary] Response missing required fields");
      return null;
    }
    return obj as PlanSummary;
  } catch {
    console.warn("[extractPlanSummary] Failed to parse JSON response:", cleaned.slice(0, 200));
    return null;
  }
}

async function extractWithOpenAI(rawText: string, model: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: rawText },
      ],
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } })?.error?.message ||
      `OpenAI API error ${res.status}`;
    throw new Error(msg);
  }
  return extractText(data);
}

async function extractWithCloudflare(rawText: string, model: string): Promise<string> {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiToken || !accountId) return "";

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/responses`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: rawText },
      ],
      max_tokens: 2000,
    }),
  });

  const data = (await res.json()) as { result?: unknown };
  return extractText(data?.result ?? data);
}

async function extractWithGemini(rawText: string, model: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${SUMMARY_SYSTEM_PROMPT}\n\n${rawText}` }],
        },
      ],
      generationConfig: { maxOutputTokens: 2000 },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } })?.error?.message ||
      `Gemini API error ${res.status}`;
    throw new Error(msg);
  }
  return extractText(data);
}

type AnyResponse = Record<string, unknown>;

function extractText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as AnyResponse;

  if (typeof d.output_text === "string" && d.output_text.trim()) return d.output_text.trim();

  if (Array.isArray(d.output)) {
    const parts = (d.output as AnyResponse[])
      .flatMap((item) => (Array.isArray(item.content) ? (item.content as AnyResponse[]) : []))
      .filter((p) => p.type === "output_text" || p.type === "text")
      .map((p) => String(p.text || ""))
      .join("")
      .trim();
    if (parts) return parts;
  }

  if (Array.isArray(d.choices)) {
    const text = (d.choices as AnyResponse[])
      .map((c) => {
        const msg = c.message as AnyResponse | undefined;
        return typeof msg?.content === "string" ? msg.content : "";
      })
      .join("")
      .trim();
    if (text) return text;
  }

  if (Array.isArray(d.candidates)) {
    const text = (d.candidates as AnyResponse[])
      .flatMap((c) => {
        const content = c.content as AnyResponse | undefined;
        return Array.isArray(content?.parts) ? (content!.parts as AnyResponse[]) : [];
      })
      .map((p) => String(p.text || ""))
      .join("")
      .trim();
    if (text) return text;
  }

  return "";
}
