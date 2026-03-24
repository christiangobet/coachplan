import test from "node:test";
import assert from "node:assert/strict";

const { getServerVapidPublicKey } = await import(
  new URL("../src/lib/push-server.ts", import.meta.url).href
);

test("server VAPID key helper prefers VAPID_PUBLIC_KEY over NEXT_PUBLIC_VAPID_PUBLIC_KEY", () => {
  const prevPublic = process.env.VAPID_PUBLIC_KEY;
  const prevNextPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  process.env.VAPID_PUBLIC_KEY = "server-public-key";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "\"broken-client-key$";

  try {
    assert.equal(getServerVapidPublicKey(), "server-public-key");
  } finally {
    process.env.VAPID_PUBLIC_KEY = prevPublic;
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = prevNextPublic;
  }
});

test("server VAPID key helper falls back to NEXT_PUBLIC_VAPID_PUBLIC_KEY", () => {
  const prevPublic = process.env.VAPID_PUBLIC_KEY;
  const prevNextPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  delete process.env.VAPID_PUBLIC_KEY;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "legacy-public-key";

  try {
    assert.equal(getServerVapidPublicKey(), "legacy-public-key");
  } finally {
    process.env.VAPID_PUBLIC_KEY = prevPublic;
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = prevNextPublic;
  }
});
