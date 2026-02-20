// Server-side only — reads prompt files from disk at runtime.
import { readFile } from 'fs/promises';
import path from 'path';

/**
 * Load a prompt text file relative to src/lib/prompts/.
 * Example: loadPrompt('plan-parser/v4_master.txt')
 */
export async function loadPrompt(relativePath: string): Promise<string> {
  const absolute = path.join(process.cwd(), 'src', 'lib', 'prompts', relativePath);
  const content = await readFile(absolute, 'utf-8');
  return content.trim();
}
