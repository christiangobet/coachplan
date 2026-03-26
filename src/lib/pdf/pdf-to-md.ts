// Server-side only — calls Anthropic API.
import Anthropic from '@anthropic-ai/sdk';
import { VISION_EXTRACTION_PROMPT } from '../prompts/plan-parser/vision-extraction-prompt.ts';

export type AnthropicCreateFn = InstanceType<typeof Anthropic>['messages']['create'];

const MODEL = 'claude-sonnet-4-5-20251022';
const MAX_TOKENS = 16384;

/**
 * Convert a PDF buffer to an enriched Markdown training plan document.
 *
 * Uses Claude's native PDF document input — no page rendering, no canvas dependency.
 * The returned string matches the canonical MD format defined by VISION_EXTRACTION_PROMPT.
 *
 * @param pdfBuffer Raw PDF bytes.
 * @param createFn  Anthropic messages.create — injectable for testing (defaults to real client).
 */
export async function extractPlanMd(
  pdfBuffer: Buffer,
  createFn?: AnthropicCreateFn
): Promise<string> {
  const client = createFn ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const create = createFn ?? client!.messages.create.bind(client!.messages);

  const response = await create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBuffer.toString('base64')
            }
          } as never,
          {
            type: 'text',
            text: VISION_EXTRACTION_PROMPT
          }
        ]
      }
    ]
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[pdf-to-md] Claude returned no text block — check model and prompt');
  }

  return textBlock.text.trim();
}
