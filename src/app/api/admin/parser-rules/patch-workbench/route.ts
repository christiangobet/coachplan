import { NextRequest } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { requireAdminAccess } from '@/lib/admin';
import { createNdjsonStream } from '@/lib/ndjson-stream';
import { prisma } from '@/lib/prisma';
import { getDefaultAiModel } from '@/lib/openai';
import {
  PATCH_WORKBENCH_ARTIFACT_DIR,
  PATCH_WORKBENCH_ARTIFACTS,
  buildEvidenceLedger,
  buildFinalAdjustmentBundle,
  clusterIssues,
  critiquePatchCandidates,
  draftPatchCandidates,
  evaluatePatchCandidates,
} from '@/lib/parser-rules/patch-workbench';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FINAL_BUNDLE_FILENAME = 'final-adjustment-bundle.json';

type StageRunnerInput = {
  stage: string;
  prompt: string;
  schema: {
    name: string;
    schema: Record<string, unknown>;
  };
};

type RouteBody = {
  server?: string;
  model?: string;
};

function extractJson(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = raw.search(/[\[{]/);
  return start === -1 ? raw : raw.slice(start);
}

function repairJson(raw: string) {
  let value = raw.replace(/\/\/[^\n"]*/g, '');
  value = value.replace(/\/\*[\s\S]*?\*\//g, '');
  value = value.replace(/,(\s*[}\]])/g, '$1');
  value = value.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, inner: string) =>
    `"${inner.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
  );
  return value;
}

async function readLlmErrorMessage(res: Response) {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { error?: { message?: string }; errors?: Array<{ message?: string }> };
    return data.error?.message ?? data.errors?.[0]?.message ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200) || `HTTP ${res.status}`;
  }
}

async function runLocalStage<T>({
  prompt,
  schema,
  server,
  model,
}: StageRunnerInput & { server: string; model: string }): Promise<T> {
  const response = await fetch(`${server.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'Return only strict JSON that matches the requested schema exactly.',
        },
        {
          role: 'user',
          content: [
            prompt,
            'JSON schema to follow exactly:',
            JSON.stringify(schema.schema),
          ].join('\n\n'),
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM ${response.status}: ${await readLlmErrorMessage(response)}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`LLM response missing content for stage ${schema.name}.`);
  }

  return JSON.parse(repairJson(extractJson(content))) as T;
}

function buildStageRunner(server: string, model: string) {
  if (server === 'cloud') {
    return undefined;
  }

  return <T>(input: StageRunnerInput) => runLocalStage<T>({
    ...input,
    server,
    model,
  });
}

function artifactPath(filename: string) {
  return path.join(PATCH_WORKBENCH_ARTIFACT_DIR, filename);
}

function readArtifact<T>(filename: string): T | null {
  const fullPath = artifactPath(filename);
  if (!existsSync(fullPath)) return null;

  return JSON.parse(readFileSync(fullPath, 'utf8')) as T;
}

export async function GET() {
  const access = await requireAdminAccess();
  if (!access.ok) return new Response('Unauthorized', { status: 401 });

  const finalBundle = readArtifact(FINAL_BUNDLE_FILENAME);
  if (!finalBundle) {
    return Response.json({ error: 'No saved final adjustment bundle. Run the patch workbench first.' }, { status: 404 });
  }

  return Response.json({
    final_bundle: finalBundle,
    review: readArtifact(PATCH_WORKBENCH_ARTIFACTS.patchReview),
    evaluation: readArtifact(PATCH_WORKBENCH_ARTIFACTS.patchEval),
    candidates: readArtifact(PATCH_WORKBENCH_ARTIFACTS.patchCandidates),
  });
}

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return new Response('Unauthorized', { status: 401 });

  const body = await req.json() as RouteBody;
  const server = body.server === 'cloud' ? 'cloud' : (body.server ?? 'http://localhost:8080');
  const model = body.model ?? (server === 'cloud' ? getDefaultAiModel() : 'local');

  const activePrompt = await prisma.parserPrompt.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, text: true, updatedAt: true },
  });
  if (!activePrompt) {
    return Response.json({ error: 'No active prompt in DB. Seed it first via /admin/parser-prompts.' }, { status: 400 });
  }

  const runStage = buildStageRunner(server, model);

  const stream = createNdjsonStream(async ({ emit }) => {
    emit({ type: 'stage_start', stage: 'evidence_ledger' });
    const ledger = await buildEvidenceLedger();
    emit({ type: 'stage_complete', stage: 'evidence_ledger', row_count: ledger.rows.length });

    emit({ type: 'stage_start', stage: 'cluster_issues' });
    emit({ type: 'stage_progress', stage: 'cluster_issues', message: 'Grouping saved evidence into issue clusters.' });
    const clusters = await clusterIssues({
      ledger,
      promptText: activePrompt.text,
      runStage,
    });
    emit({ type: 'stage_complete', stage: 'cluster_issues', cluster_count: clusters.clusters.length });

    emit({ type: 'stage_start', stage: 'draft_patch_candidates' });
    emit({ type: 'stage_progress', stage: 'draft_patch_candidates', message: 'Drafting candidate prompt insertions.' });
    const candidates = await draftPatchCandidates({
      ledger,
      clusters,
      promptText: activePrompt.text,
      runStage,
    });
    for (const candidate of candidates.candidates.slice(0, 5)) {
      emit({ type: 'candidate_preview', candidate });
    }
    emit({ type: 'stage_complete', stage: 'draft_patch_candidates', candidate_count: candidates.candidates.length });

    emit({ type: 'stage_start', stage: 'critique_patch_candidates' });
    emit({ type: 'stage_progress', stage: 'critique_patch_candidates', message: 'Applying deterministic and model-assisted review checks.' });
    const review = await critiquePatchCandidates({
      ledger,
      clusters,
      candidates,
      promptText: activePrompt.text,
      runStage,
    });
    emit({
      type: 'stage_complete',
      stage: 'critique_patch_candidates',
      accepted_count: review.accepted_candidates.length,
      rejected_count: review.rejected_candidates.length,
    });

    emit({ type: 'stage_start', stage: 'evaluate_patch_candidates' });
    emit({ type: 'stage_progress', stage: 'evaluate_patch_candidates', message: 'Evaluating coverage gain and risk.' });
    const evaluation = await evaluatePatchCandidates({
      ledger,
      clusters,
      candidates,
      review,
      promptText: activePrompt.text,
      runStage,
    });
    for (const result of evaluation.evaluated_candidates) {
      emit({ type: 'eval_result', evaluation: result });
    }
    emit({ type: 'stage_complete', stage: 'evaluate_patch_candidates', evaluated_count: evaluation.evaluated_candidates.length });

    emit({ type: 'stage_start', stage: 'final_adjustment_bundle' });
    const finalBundle = await buildFinalAdjustmentBundle({
      ledger,
      clusters,
      candidates,
      review,
      evaluation,
      promptText: activePrompt.text,
    });
    emit({ type: 'stage_complete', stage: 'final_adjustment_bundle', final_adjustment_count: finalBundle.final_adjustments.length });

    emit({
      type: 'complete',
      final_bundle: finalBundle,
      prompt: {
        id: activePrompt.id,
        name: activePrompt.name,
        updatedAt: activePrompt.updatedAt,
      },
    });
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
