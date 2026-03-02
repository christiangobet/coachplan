import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import ParserPromptsClient from './ParserPromptsClient';
import '../admin.css';

export default async function ParserPromptsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const prompts = await prisma.parserPrompt.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true, text: true }
  });

  const promptsWithMeta = prompts.map(p => ({
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    charCount: p.text.length,
    text: p.text
  }));

  return (
    <main className="admin-page">
      <section className="admin-hero">
        <div>
          <h1>Prompt Manager</h1>
          <p>Create, edit, and activate AI parser prompt versions without redeploying.</p>
        </div>
        <div className="admin-hero-badge">Prompt Manager</div>
      </section>

      <ParserPromptsClient initialPrompts={promptsWithMeta} />
    </main>
  );
}
