import { prisma } from '@/lib/prisma';

type SourceDoc = {
  id: string;
  planId: string;
  fileName: string | null;
  mimeType: string;
  fileSize: number;
  pageCount: number | null;
  createdAt: Date;
  content?: Buffer;
};

/**
 * Resolves the source PDF for a plan by walking the sourceId chain.
 * A template or derived plan may not have its own PlanSourceDocument,
 * so we follow sourceId pointers (up to 4 hops) to find the original.
 */
const BASE_SELECT = {
  id: true,
  sourceId: true,
  ownerId: true,
  athleteId: true,
  sourceDocument: {
    select: {
      id: true,
      planId: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      pageCount: true,
      createdAt: true,
    },
  },
} as const;

const SELECT_WITH_CONTENT = {
  ...BASE_SELECT,
  sourceDocument: {
    select: { ...BASE_SELECT.sourceDocument.select, content: true },
  },
} as const;

export async function resolveSourceDocument(
  planId: string,
  includeContent: boolean = false
): Promise<{ doc: SourceDoc; resolvedPlanId: string } | null> {
  const selectFields = includeContent ? SELECT_WITH_CONTENT : BASE_SELECT;

  let currentId: string | null = planId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const plan = await prisma.trainingPlan.findUnique({
      where: { id: currentId },
      select: selectFields,
    }) as { id: string; sourceId: string | null; sourceDocument: SourceDoc | null } | null;

    if (!plan) return null;

    if (plan.sourceDocument) {
      return {
        doc: plan.sourceDocument as SourceDoc,
        resolvedPlanId: plan.id,
      };
    }

    currentId = plan.sourceId ?? null;
  }

  return null;
}
