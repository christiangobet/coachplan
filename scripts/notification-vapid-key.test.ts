import test from "node:test";
import assert from "node:assert/strict";

const { decodeVapidPublicKey } = await import(
  new URL("../src/lib/push-client.ts", import.meta.url).href
);

test("decodeVapidPublicKey strips env formatting artifacts and returns a Uint8Array", () => {
  const decoded = decodeVapidPublicKey("  \"\n_-AA\n\"  ");

  assert.ok(decoded instanceof Uint8Array);
  assert.deepEqual(Array.from(decoded), [255, 224, 0]);
});

test("decodeVapidPublicKey rejects an empty sanitized key", () => {
  assert.throws(
    () => decodeVapidPublicKey(" \" \n\t \" "),
    /valid VAPID public key/i
  );
});
