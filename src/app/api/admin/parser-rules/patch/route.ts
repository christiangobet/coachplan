import { NextRequest } from 'next/server';
import { requireAdminAccess } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { resolveAIProvider, getDefaultAiModel, hasConfiguredAiProvider } from '@/lib/openai';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const PATCH_WORKBENCH_ROUTE = '/api/admin/parser-rules/patch-workbench';

const OUT_DIR = path.join(process.cwd(), 'scripts', 'parser-analysis');

export interface PatchSuggestion {
  after_section: string;
  insert_text: string;
  rationale: string;
  source_issue: string;
  approved: boolean;
}

const PATCH_SYSTEM = `You are an expert at improving LLM parser prompts.
Given a current parser prompt and analysis findings from multiple training PDFs,
suggest targeted text insertions to fix the identified parsing issues.

Return ONLY a JSON array. No markdown, no text outside the array.`;

function buildPatchUserPrompt(promptText: string, aggregate: unknown): string {
  return `Current parser prompt:
<prompt>
${promptText}
</prompt>

Analysis findings from ${(aggregate as any)?.top_issues?.length ?? 0} issue categories:
${JSON.stringify(aggregate, null, 2)}

Suggest insertions to fix the top parsing issues. For each suggestion, identify:
- The EXACT section heading or line from the prompt to insert after (copy it verbatim)
- The text to insert immediately after that section
- Why this fixes the issue
- Which finding motivated it

Return a JSON array with this EXACT structure:
[
  {
    "after_section": "<exact line from the prompt to anchor after, e.g. 'RULES FOR WEEK TABLES:' or '9. Do NOT invent, infer, or add content that is not present in the PDF.'>",
    "insert_text": "<exact text to insert — write it ready to paste>",
    "rationale": "<one sentence why this improves parsing>",
    "source_issue": "<the finding or issue this addresses>"
  }
]

Rules:
- Anchor to a line that actually exists in the prompt (copy it exactly).
- Keep each insertion concise and actionable — max 3 sentences.
- Suggest 3–7 patches total, prioritising highest-impact issues.
- Do NOT re-add rules that already exist in the prompt.`;
}

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return new Response('Unauthorized', { status: 401 });

  const body = await req.json() as { server?: string; model?: string };
  const isCloud = body.server === 'cloud';
  const server = isCloud ? 'cloud' : (body.server ?? 'http://localhost:8080').replace(/\/$/, '');
  const model  = body.model ?? 'local';

  if (isCloud && !hasConfiguredAiProvider()) {
    return Response.json({ error: 'Cloud AI not configured — set OPENAI_API_KEY in .env.local.' }, { status: 400 });
  }

  // Load active prompt from DB
  const activePrompt = await prisma.parserPrompt.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, text: true },
  });
  if (!activePrompt) {
    return Response.json({ error: 'No active prompt in DB. Seed it first via /admin/parser-prompts.' }, { status: 400 });
  }

  // Load aggregate findings
  const aggregatePath = path.join(OUT_DIR, 'aggregate.json');
  if (!existsSync(aggregatePath)) {
    return Response.json({ error: 'No aggregate.json found. Run analysis first.' }, { status: 400 });
  }
  let aggregate: unknown;
  try {
    aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8'));
  } catch {
    return Response.json({ error: 'Failed to parse aggregate.json.' }, { status: 500 });
  }

  // Call LLM (cloud or local)
  let raw: string;
  try {
    let url: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let modelName: string;
    if (isCloud) {
      const provider = resolveAIProvider();
      modelName = getDefaultAiModel(provider);
      url = 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY!}`;
    } else {
      url = `${server}/v1/chat/completions`;
      modelName = model;
    }
    const res = await fetch(url, {
      method:  'POST',
      headers,
      body: JSON.stringify({
        model:           modelName,
        messages: [
          { role: 'system', content: PATCH_SYSTEM },
          { role: 'user',   content: buildPatchUserPrompt(activePrompt.text, aggregate) },
        ],
        temperature:     0.1,
        max_tokens:      isCloud ? 8192 : 4096,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return Response.json({ error: `LLM error ${res.status}: ${txt.slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    raw = data.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    return Response.json({ error: `Cannot reach LLM at ${server}: ${(err as Error).message}` }, { status: 502 });
  }

  // Strip markdown fences + repair common LLM JSON issues
  function extractJson(s: string): string {
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const start = s.search(/[\[{]/);
    return start !== -1 ? s.slice(start) : s;
  }
  function repairJson(s: string): string {
    s = s.replace(/\/\/[^\n"]*/g, '');
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    s = s.replace(/,(\s*[}\]])/g, '$1');
    s = s.replace(/"((?:[^"\\]|\\.)*)"/g, (_m, inner: string) =>
      `"${inner.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
    );
    return s;
  }

  // Parse suggestions — handle both array and { suggestions: [...] }
  let parsed: unknown;
  try {
    parsed = JSON.parse(repairJson(extractJson(raw)));
  } catch {
    return Response.json({ error: 'LLM returned non-JSON response.', raw }, { status: 502 });
  }
  const rawArr = Array.isArray(parsed) ? parsed : (parsed as any)?.suggestions ?? (parsed as any)?.patches ?? [];
  const suggestions: PatchSuggestion[] = rawArr.map((s: any) => ({
    after_section: String(s.after_section ?? ''),
    insert_text:   String(s.insert_text ?? ''),
    rationale:     String(s.rationale ?? ''),
    source_issue:  String(s.source_issue ?? ''),
    approved:      true,
  }));

  return Response.json({
    suggestions,
    base_prompt_name: activePrompt.name,
    base_prompt_id:   activePrompt.id,
  });
}
