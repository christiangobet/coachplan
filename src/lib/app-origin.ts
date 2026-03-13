const APP_ORIGIN_ENV_KEYS = [
  'APP_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SITE_URL',
  'SITE_URL'
] as const;

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function resolveCanonicalAppOrigin(requestOrigin: string): string {
  for (const key of APP_ORIGIN_ENV_KEYS) {
    const resolved = normalizeOrigin(process.env[key]);
    if (resolved) return resolved;
  }
  return normalizeOrigin(requestOrigin) || requestOrigin;
}

export function buildAbsoluteAppUrl(pathname: string, requestOrigin: string): string {
  return new URL(pathname, resolveCanonicalAppOrigin(requestOrigin)).toString();
}
