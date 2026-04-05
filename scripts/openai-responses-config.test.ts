import test from "node:test";
import assert from "node:assert/strict";

test("openaiJsonSchema sends structured output config under text.format for the Responses API", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalProvider = process.env.AI_PROVIDER;

  let requestBody: Record<string, unknown> | null = null;

  process.env.OPENAI_API_KEY = "test-key";
  process.env.AI_PROVIDER = "openai";

  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({
      output_text: "{\"ok\":true}",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const { openaiJsonSchema } = await import("../src/lib/openai.ts");

    const result = await openaiJsonSchema<{ ok: boolean }>({
      input: "Return json",
      model: "gpt-4o-mini",
      schema: {
        name: "test_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean" },
          },
          required: ["ok"],
        },
        strict: true,
      },
    });

    assert.deepEqual(result, { ok: true });
    assert.ok(requestBody, "expected request body to be captured");
    const payload = requestBody as Record<string, unknown> & {
      text?: unknown;
      response_format?: unknown;
    };
    assert.equal("response_format" in payload, false, "Responses API payload should not use response_format");
    assert.deepEqual(payload.text, {
      format: {
        type: "json_schema",
        name: "test_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean" },
          },
          required: ["ok"],
        },
        strict: true,
      },
    });
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
  }
});
