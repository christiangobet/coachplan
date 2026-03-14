import type { ChatMessage } from "./plan-chat-types";

function toTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function mergeChatHistoryMessages(
  existingMessages: ChatMessage[],
  incomingMessages: ChatMessage[],
) {
  const mergedById = new Map<string, ChatMessage>();
  for (const message of existingMessages) {
    mergedById.set(message.id, message);
  }
  for (const message of incomingMessages) {
    mergedById.set(message.id, message);
  }
  return [...mergedById.values()].sort((left, right) => {
    const timeDelta = toTimestamp(left.createdAt) - toTimestamp(right.createdAt);
    if (timeDelta !== 0) return timeDelta;
    return left.id.localeCompare(right.id);
  });
}

export function orderCoachHistoryMessages(messages: ChatMessage[]) {
  return [...messages].sort((left, right) => {
    const timeDelta = toTimestamp(right.createdAt) - toTimestamp(left.createdAt);
    if (timeDelta !== 0) return timeDelta;
    return right.id.localeCompare(left.id);
  });
}

export function formatCoachHistoryTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Recent";
  return timestamp.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
