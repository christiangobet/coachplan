type NdjsonValue = unknown;

export type NdjsonStreamTools = {
  emit: (value: NdjsonValue) => boolean;
  close: () => void;
  isClosed: () => boolean;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createNdjsonStream(
  run: (tools: NdjsonStreamTools) => Promise<void> | void
) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The consumer may already have disconnected; treat close as best-effort.
        }
      };

      const emit = (value: NdjsonValue) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      try {
        await run({ emit, close, isClosed: () => closed });
      } catch (error) {
        emit({ type: "error", message: getErrorMessage(error) });
      } finally {
        close();
      }
    },
  });
}
