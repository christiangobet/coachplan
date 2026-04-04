import test from "node:test";
import assert from "node:assert/strict";

const { createNdjsonStream } = await import(
  new URL("../src/lib/ndjson-stream.ts", import.meta.url).href
);
type NdjsonStreamTools = import("../src/lib/ndjson-stream.ts").NdjsonStreamTools;

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("createNdjsonStream keeps the final event when work closes early and cleanup closes again", async () => {
  const stream = createNdjsonStream(async ({ emit, close }: NdjsonStreamTools) => {
    emit({ type: "plan_error", message: "LLM 429: insufficient_quota" });
    close();
  });

  const events = await readStream(stream);

  assert.deepEqual(events, [
    { type: "plan_error", message: "LLM 429: insufficient_quota" },
  ]);
});

test("createNdjsonStream emits thrown errors as NDJSON instead of rejecting the reader", async () => {
  const stream = createNdjsonStream(async () => {
    throw new Error("upstream failed");
  });

  const events = await readStream(stream);

  assert.deepEqual(events, [{ type: "error", message: "upstream failed" }]);
});

test("createNdjsonStream preserves ordered multi-stage events in a workbench-style stream", async () => {
  const stream = createNdjsonStream(async ({ emit }) => {
    emit({ type: "stage_start", stage: "cluster" });
    emit({ type: "stage_progress", stage: "cluster", message: "Grouping evidence" });
    emit({ type: "stage_complete", stage: "cluster" });
    emit({ type: "complete", final_adjustments: [] });
  });

  const events = await readStream(stream);

  assert.deepEqual(events, [
    { type: "stage_start", stage: "cluster" },
    { type: "stage_progress", stage: "cluster", message: "Grouping evidence" },
    { type: "stage_complete", stage: "cluster" },
    { type: "complete", final_adjustments: [] },
  ]);
});
