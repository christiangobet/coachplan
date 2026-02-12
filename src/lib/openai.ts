type JsonSchemaFormat = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
  description?: string;
};

type OpenAIResponse = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  output_text?: string;
  error?: { message?: string };
};

function extractOutputText(data: OpenAIResponse) {
  if (data.output_text) return data.output_text;
  const items = data.output || [];
  const parts = items.flatMap((item) => item.content || []);
  return parts
    .filter((part) => part.type === "output_text" || part.type === "text")
    .map((part) => part.text || "")
    .join("")
    .trim();
}

export async function openaiJsonSchema<T>(opts: {
  input: string;
  schema: JsonSchemaFormat;
  model: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: opts.model,
      input: opts.input,
      response_format: {
        type: "json_schema",
        name: opts.schema.name,
        schema: opts.schema.schema,
        strict: opts.schema.strict ?? true,
        description: opts.schema.description
      }
    })
  });

  const data = (await res.json()) as OpenAIResponse;
  if (!res.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed.");
  }

  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI response missing output text.");
  return JSON.parse(text) as T;
}
