/**
 * ai-guide-extractor.ts
 *
 * Pass 1 of the two-pass PDF parser:
 * Extracts a structured Plan Context Document (planGuide) from the full PDF text.
 * The guide is later passed to parseWeekWithAI so it can resolve abbreviations
 * and produce richer instruction_text.
 */

import { resolveAIProvider, getDefaultAiModel } from "./openai";

const GUIDE_SYSTEM_PROMPT = `You are a training plan analyst. Extract all reusable knowledge from the following training plan text.
Output plain text organized under these headings (omit any heading if no content found):

PLAN OVERVIEW
- Total number of weeks
- Training phases and their week ranges (e.g. Base: weeks 1-4, Build: weeks 5-10, Peak: weeks 11-14, Taper: weeks 15-16)
- Target race type and distance (if stated)
- Athlete level this plan targets (if stated)
- Overall load progression logic (e.g. 3 weeks build + 1 recovery)
- Typical week structure (which days are rest, quality, long run)

GLOSSARY & ABBREVIATIONS
- One entry per line: ABBREV = full definition (e.g. E = Easy run at conversational pace)
- Include pace labels, effort labels, session type codes, workout notation

PACE ZONES
- One entry per line: Label = pace range or HR range or RPE (e.g. Easy = 6:00-6:30/km or 65-70% HR max)

NAMED SESSIONS & CIRCUITS
- For each named session/circuit: name followed by full description or exercise list

GENERAL INSTRUCTIONS
- Coach notes, adaptation rules, what to do when sick or tired, how to handle missed sessions`;

/**
 * Extract a structured Plan Context Document from the full PDF text.
 *
 * With throwOnError=false (default): returns "" on failure — safe for upload flows.
 * With throwOnError=true: throws on failure — use when caller needs the error message.
 */
export async function extractPlanGuide(rawText: string, { throwOnError = false } = {}): Promise<string> {
  if (!rawText?.trim()) {
    if (throwOnError) throw new Error("PDF text is empty — nothing to extract from");
    return "";
  }

  try {
    const provider = resolveAIProvider();
    const model = getDefaultAiModel(provider);

    if (provider === "cloudflare") {
      return await extractWithCloudflare(rawText, model);
    }
    if (provider === "gemini") {
      return await extractWithGemini(rawText, model);
    }
    return await extractWithOpenAI(rawText, model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[extractPlanGuide] Guide extraction failed:", message);
    if (throwOnError) throw err;
    return "";
  }
}

async function extractWithOpenAI(rawText: string, model: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: GUIDE_SYSTEM_PROMPT },
        { role: "user", content: rawText }
      ],
      max_tokens: 2000
    })
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } })?.error?.message || `OpenAI API error ${res.status}`;
    throw new Error(msg);
  }

  return extractTextFromResponse(data);
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
      Authorization: `Bearer ${apiToken}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: GUIDE_SYSTEM_PROMPT },
        { role: "user", content: rawText }
      ],
      max_tokens: 2000
    })
  });

  const data = (await res.json()) as { result?: unknown };
  const inner = data?.result ?? data;
  return extractTextFromResponse(inner);
}

async function extractWithGemini(rawText: string, model: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${GUIDE_SYSTEM_PROMPT}\n\n${rawText}` }]
        }
      ],
      generationConfig: { maxOutputTokens: 2000 }
    })
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } })?.error?.message || `Gemini API error ${res.status}`;
    throw new Error(msg);
  }

  return extractTextFromResponse(data);
}

type AnyResponse = Record<string, unknown>;

function extractTextFromResponse(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as AnyResponse;

  // OpenAI Responses API: { output_text: "..." }
  if (typeof d.output_text === "string" && d.output_text.trim()) {
    return d.output_text.trim();
  }

  // OpenAI Responses API: { output: [{ content: [{ type: "output_text", text: "..." }] }] }
  if (Array.isArray(d.output)) {
    const parts = (d.output as AnyResponse[])
      .flatMap((item) => (Array.isArray(item.content) ? (item.content as AnyResponse[]) : []))
      .filter((part) => part.type === "output_text" || part.type === "text")
      .map((part) => String(part.text || ""))
      .join("")
      .trim();
    if (parts) return parts;
  }

  // Chat completions: { choices: [{ message: { content: "..." } }] }
  if (Array.isArray(d.choices)) {
    const text = (d.choices as AnyResponse[])
      .map((c) => {
        const msg = c.message as AnyResponse | undefined;
        if (!msg) return "";
        return typeof msg.content === "string" ? msg.content : "";
      })
      .join("")
      .trim();
    if (text) return text;
  }

  // Gemini: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
  if (Array.isArray(d.candidates)) {
    const text = (d.candidates as AnyResponse[])
      .flatMap((c) => {
        const content = c.content as AnyResponse | undefined;
        return Array.isArray(content?.parts) ? (content!.parts as AnyResponse[]) : [];
      })
      .map((part) => String(part.text || ""))
      .join("")
      .trim();
    if (text) return text;
  }

  return "";
}
