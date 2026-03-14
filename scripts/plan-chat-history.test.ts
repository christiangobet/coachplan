import test from "node:test";
import assert from "node:assert/strict";

import type { ChatMessage } from "../src/lib/plan-chat-types";

const {
  formatCoachHistoryTimestamp,
  mergeChatHistoryMessages,
  orderCoachHistoryMessages,
} = await import(
  new URL("../src/lib/plan-chat-history.ts", import.meta.url).href
);

function createMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? "msg-1",
    planId: overrides.planId ?? "plan-1",
    role: overrides.role ?? "coach",
    content: overrides.content ?? "Hello",
    metadata: overrides.metadata ?? null,
    createdAt: overrides.createdAt ?? "2026-03-14T09:00:00.000Z",
  };
}

test("orders coach history messages from newest to oldest", () => {
  const ordered = orderCoachHistoryMessages([
    createMessage({ id: "oldest", createdAt: "2026-03-13T08:00:00.000Z" }),
    createMessage({ id: "newest", createdAt: "2026-03-14T08:00:00.000Z" }),
    createMessage({ id: "middle", createdAt: "2026-03-13T20:00:00.000Z" }),
  ]);

  assert.deepEqual(
    ordered.map((message: ChatMessage) => message.id),
    ["newest", "middle", "oldest"],
  );
});

test("keeps invalid timestamps at the end of coach history", () => {
  const ordered = orderCoachHistoryMessages([
    createMessage({ id: "invalid", createdAt: "not-a-date" }),
    createMessage({ id: "valid", createdAt: "2026-03-14T08:00:00.000Z" }),
  ]);

  assert.deepEqual(
    ordered.map((message: ChatMessage) => message.id),
    ["valid", "invalid"],
  );
});

test("merges chat history messages by id in chronological order", () => {
  const merged = mergeChatHistoryMessages(
    [
      createMessage({ id: "first", createdAt: "2026-03-14T08:00:00.000Z" }),
      createMessage({ id: "second", createdAt: "2026-03-14T09:00:00.000Z" }),
    ],
    [
      createMessage({ id: "second", content: "Updated", createdAt: "2026-03-14T09:00:00.000Z" }),
      createMessage({ id: "third", createdAt: "2026-03-14T10:00:00.000Z" }),
    ],
  );

  assert.deepEqual(
    merged.map((message: ChatMessage) => `${message.id}:${message.content}`),
    ["first:Hello", "second:Updated", "third:Hello"],
  );
});

test("formats a visible date tag for coach history turns", () => {
  const formatted = formatCoachHistoryTimestamp("2026-03-14T09:05:00.000Z");

  assert.notEqual(formatted, "");
  assert.notEqual(formatted, "Recent");
});
