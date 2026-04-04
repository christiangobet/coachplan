import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { requireAdminAccess } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import {
  PATCH_WORKBENCH_ARTIFACT_DIR,
  PATCH_WORKBENCH_ARTIFACTS,
  type FinalAdjustmentBundle,
} from '@/lib/parser-rules/patch-workbench';

export const dynamic = 'force-dynamic';
export const PATCH_WORKBENCH_ROUTE = '/api/admin/parser-rules/patch-workbench';

export interface PatchSuggestion {
  after_section: string;
  insert_text: string;
  rationale: string;
  source_issue: string;
  approved: boolean;
}

function readFinalBundle() {
  const bundlePath = path.join(
    PATCH_WORKBENCH_ARTIFACT_DIR,
    PATCH_WORKBENCH_ARTIFACTS.finalAdjustmentBundle,
  );

  if (!existsSync(bundlePath)) {
    return null;
  }

  return JSON.parse(readFileSync(bundlePath, 'utf8')) as FinalAdjustmentBundle;
}

export async function POST() {
  const access = await requireAdminAccess();
  if (!access.ok) return new Response('Unauthorized', { status: 401 });

  const finalBundle = readFinalBundle();
  if (!finalBundle) {
    return Response.json({
      deprecated: true,
      compatibility: true,
      error: 'No saved final bundle found. Run the patch workbench first.',
      patch_workbench_route: PATCH_WORKBENCH_ROUTE,
    }, { status: 409 });
  }

  const activePrompt = await prisma.parserPrompt.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const suggestions: PatchSuggestion[] = finalBundle.final_adjustments.map((adjustment) => ({
    after_section: adjustment.after_section,
    insert_text: adjustment.insert_text,
    rationale: adjustment.rationale,
    source_issue: adjustment.candidate_id,
    approved: true,
  }));

  return Response.json({
    deprecated: true,
    compatibility: true,
    message: 'Legacy patch endpoint now returns the latest saved parser-rules patch workbench bundle.',
    patch_workbench_route: PATCH_WORKBENCH_ROUTE,
    final_bundle: finalBundle,
    suggestions,
    base_prompt_name: activePrompt?.name ?? '',
    base_prompt_id: activePrompt?.id ?? '',
    artifact: 'final-adjustment-bundle.json',
  });
}
