import test from "node:test";
import assert from "node:assert/strict";

// We test the module logic by exercising its public interface with a mocked Anthropic client.
// The actual Anthropic call is mocked via module-level injection.

test("extractPlanMd returns the text content from the Claude response", async () => {
  const fakeBuffer = Buffer.from("%PDF-1.4 fake content");
  const expectedMd = "## Glossary\n| Code | Full |\n\n## Week 1\n| Day | Session |\n";

  // Mock the Anthropic SDK
  const mockCreate = async (params: unknown) => {
    const p = params as { messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }> };
    const firstContent = p.messages[0].content[0] as { type: string; source?: { data: string } };
    assert.equal(firstContent.type, "document");
    assert.equal(firstContent.source?.data, fakeBuffer.toString("base64"));
    return { content: [{ type: "text", text: expectedMd }] };
  };

  const { extractPlanMd } = await import("../src/lib/pdf/pdf-to-md.ts");
  const result = await extractPlanMd(fakeBuffer, mockCreate as never);
  assert.equal(result, expectedMd.trim());
});

test("extractPlanMd throws a descriptive error when Claude returns no text block", async () => {
  const fakeBuffer = Buffer.from("%PDF-1.4 fake content");

  const mockCreate = async () => ({
    content: [{ type: "tool_use", id: "tu_1" }]
  });

  const { extractPlanMd } = await import("../src/lib/pdf/pdf-to-md.ts");
  await assert.rejects(
    () => extractPlanMd(fakeBuffer, mockCreate as never),
    /no text block/i
  );
});
