import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node strip-types test runner resolves the TypeScript source file directly.
const { resolveCanonicalAppOrigin } = await import('../src/lib/app-origin.ts');

function withEnv(overrides: Record<string, string | undefined>, run: () => void) {
  const previousEntries = Object.keys(overrides).map((key) => [key, process.env[key]] as const);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previousEntries) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('prefers APP_URL over the incoming request origin', () => {
  withEnv({ APP_URL: 'https://www.mytrainingplan.io' }, () => {
    assert.equal(
      resolveCanonicalAppOrigin('http://localhost:3001'),
      'https://www.mytrainingplan.io'
    );
  });
});

test('normalizes APP_URL to its origin when it includes a path', () => {
  withEnv({ APP_URL: 'https://www.mytrainingplan.io/mobile' }, () => {
    assert.equal(
      resolveCanonicalAppOrigin('http://localhost:3001'),
      'https://www.mytrainingplan.io'
    );
  });
});

test('falls back to the request origin when no canonical app url is configured', () => {
  withEnv(
    {
      APP_URL: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_SITE_URL: undefined,
      SITE_URL: undefined
    },
    () => {
      assert.equal(
        resolveCanonicalAppOrigin('http://localhost:3001'),
        'http://localhost:3001'
      );
    }
  );
});
