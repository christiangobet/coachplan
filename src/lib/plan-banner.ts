export const PLAN_IMAGE_MAX_COUNT = 12;
export const PLAN_IMAGE_MAX_FILE_BYTES = 5 * 1024 * 1024;

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

const ALLOWED_MIME = new Set(Object.values(EXTENSION_MIME));

export type PlanBannerMeta = {
  imageId: string;
  url: string;
  focusY: number;
};

function normalizeFocusY(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function buildPlanBanner(
  planId: string,
  bannerImageId: string | null | undefined,
  focusY?: number | null
): PlanBannerMeta | null {
  if (!planId || !bannerImageId) return null;
  return {
    imageId: bannerImageId,
    url: `/api/plans/${planId}/images/${bannerImageId}/file`,
    focusY: normalizeFocusY(focusY),
  };
}

export function resolvePlanImageMime(input: { mimeType?: string | null; fileName?: string | null }): string | null {
  const rawMime = (input.mimeType || '').trim().toLowerCase();
  if (ALLOWED_MIME.has(rawMime)) return rawMime;

  const fileName = (input.fileName || '').trim().toLowerCase();
  const match = fileName.match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  return EXTENSION_MIME[match[1]] || null;
}

export function isAllowedPlanImageMime(mimeType: string | null | undefined) {
  if (!mimeType) return false;
  return ALLOWED_MIME.has(mimeType.toLowerCase());
}
