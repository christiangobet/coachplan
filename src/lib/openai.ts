type JsonSchemaFormat = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
  description?: string;
};

type AIProvider = "openai" | "cloudflare" | "gemini";

type ResponsePart = {
  type?: string;
  text?: string;
};

type OpenAIResponse = {
  output?: Array<{ content?: ResponsePart[] }>;
  output_text?: string;
  choices?: Array<{ message?: { content?: string | ResponsePart[] } }>;
  candidates?: Array<{ content?: { parts?: ResponsePart[] } }>;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
};

type WrappedProviderResponse = OpenAIResponse & {
  result?: OpenAIResponse;
};

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_CLOUDFLARE_MODEL = "@cf/openai/gpt-oss-20b";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export function resolveAIProvider(): AIProvider {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (raw === "cloudflare") return "cloudflare";
  if (raw === "gemini") return "gemini";
  return "openai";
}

export function hasConfiguredAiProvider(provider = resolveAIProvider()) {
  if (provider === "cloudflare") {
    return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
  }
  if (provider === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY);
  }
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getDefaultAiModel(provider = resolveAIProvider()) {
  if (provider === "cloudflare") {
    return process.env.CLOUDFLARE_AI_MODEL || DEFAULT_CLOUDFLARE_MODEL;
  }
  if (provider === "gemini") {
    return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  }
  return process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

function unwrapProviderResponse(data: WrappedProviderResponse): OpenAIResponse {
  if (data && data.result && typeof data.result === "object") {
    return data.result;
  }
  return data;
}

function extractErrorMessage(data: WrappedProviderResponse) {
  const payload = unwrapProviderResponse(data);
  if (payload.error?.message) return payload.error.message;
  if (Array.isArray(payload.errors) && payload.errors[0]?.message) {
    return payload.errors[0].message;
  }
  return null;
}

function extractOutputText(data: OpenAIResponse) {
  if (data.output_text && typeof data.output_text === "string") {
    return data.output_text.trim();
  }

  const outputItems = data.output || [];
  const outputParts = outputItems.flatMap((item) => item.content || []);
  const outputText = outputParts
    .filter((part) => part.type === "output_text" || part.type === "text")
    .map((part) => part.text || "")
    .join("")
    .trim();
  if (outputText) return outputText;

  const choiceText = (data.choices || [])
    .map((choice) => choice.message?.content)
    .map((content) => {
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return "";
      return content.map((part) => part.text || "").join("");
    })
    .join("")
    .trim();
  if (choiceText) return choiceText;

  const candidateText = (data.candidates || [])
    .map((candidate) => candidate.content?.parts || [])
    .flatMap((parts) => parts)
    .map((part) => part.text || "")
    .join("")
    .trim();
  return candidateText;
}

type JsonSchemaRequest = {
  input: string;
  schema: JsonSchemaFormat;
  model: string;
  maxOutputTokens?: number;
};

function buildResponseFormat(schema: JsonSchemaFormat, style: "openai" | "cloudflare_nested") {
  if (style === "cloudflare_nested") {
    return {
      type: "json_schema",
      json_schema: {
        name: schema.name,
        schema: schema.schema,
        strict: schema.strict ?? true,
        description: schema.description
      }
    };
  }
  return {
    type: "json_schema",
    name: schema.name,
    schema: schema.schema,
    strict: schema.strict ?? true,
    description: schema.description
  };
}

function stripJsonFences(text: string): string {
  // Remove ```json ... ``` or ``` ... ``` fences (anywhere in the string)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Fallback: extract the outermost { ... } block
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1);

  return text;
}

async function requestJsonSchema<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  extraHeaders?: Record<string, string>
) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(extraHeaders || {})
    },
    body: JSON.stringify(payload)
  });

  const data = (await res.json()) as WrappedProviderResponse;
  if (!res.ok) {
    throw new Error(extractErrorMessage(data) || "AI request failed.");
  }

  const text = extractOutputText(unwrapProviderResponse(data));
  if (!text) throw new Error("AI response missing output text.");

  try {
    return JSON.parse(stripJsonFences(text)) as T;
  } catch {
    // Log the first 500 chars of the raw response to help diagnose future issues
    console.error("[openai] JSON parse failed. Raw response preview:", text.slice(0, 500));
    throw new Error("AI response was not valid JSON.");
  }
}

async function openAIJsonSchema<T>(opts: JsonSchemaRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return requestJsonSchema<T>(
    "https://api.openai.com/v1/responses",
    {
      model: opts.model,
      input: opts.input,
      response_format: buildResponseFormat(opts.schema, "openai"),
      ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {})
    },
    {
      Authorization: `Bearer ${apiKey}`
    }
  );
}

async function cloudflareJsonSchema<T>(opts: JsonSchemaRequest) {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiToken) {
    throw new Error("CLOUDFLARE_API_TOKEN is not set.");
  }
  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is not set.");
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/responses`;

  try {
    return await requestJsonSchema<T>(
      endpoint,
      {
        model: opts.model,
        input: opts.input,
        response_format: buildResponseFormat(opts.schema, "openai")
      },
      {
        Authorization: `Bearer ${apiToken}`
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const canRetryWithNestedSchema = message.includes("response_format")
      || message.includes("json_schema")
      || message.includes("schema");
    if (!canRetryWithNestedSchema) throw error;

    return requestJsonSchema<T>(
      endpoint,
      {
        model: opts.model,
        input: opts.input,
        response_format: buildResponseFormat(opts.schema, "cloudflare_nested")
      },
      {
        Authorization: `Bearer ${apiToken}`
      }
    );
  }
}

async function geminiJsonSchema<T>(opts: JsonSchemaRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    opts.model
  )}:generateContent`;

  try {
    return await requestJsonSchema<T>(
      endpoint,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: opts.input }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: opts.schema.schema
        }
      },
      {
        "x-goog-api-key": apiKey
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const shouldRetryWithoutSchema = message.includes("schema")
      || message.includes("responsejsonschema")
      || message.includes("generationconfig");
    if (!shouldRetryWithoutSchema) throw error;

    const fallbackInput = [
      opts.input,
      "Return only strict JSON. Do not include markdown fences or extra text.",
      `JSON schema to follow exactly: ${JSON.stringify(opts.schema.schema)}`
    ].join("\n\n");

    return requestJsonSchema<T>(
      endpoint,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: fallbackInput }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      },
      {
        "x-goog-api-key": apiKey
      }
    );
  }
}

export async function openaiJsonSchema<T>(opts: {
  input: string;
  schema: JsonSchemaFormat;
  model?: string;
  maxOutputTokens?: number;
}) {
  const provider = resolveAIProvider();
  const model = opts.model || getDefaultAiModel(provider);
  if (provider === "cloudflare") {
    return cloudflareJsonSchema<T>({
      ...opts,
      model
    });
  }
  if (provider === "gemini") {
    return geminiJsonSchema<T>({
      ...opts,
      model
    });
  }
  return openAIJsonSchema<T>({
    ...opts,
    model
  });
}
