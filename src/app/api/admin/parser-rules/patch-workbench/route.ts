import { requireAdminAccess } from '@/lib/admin';
import { PATCH_WORKBENCH_ARTIFACTS } from '@/lib/parser-rules/patch-workbench';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await requireAdminAccess();
  if (!access.ok) return new Response('Unauthorized', { status: 401 });

  return Response.json({
    status: 'not_implemented',
    artifacts: PATCH_WORKBENCH_ARTIFACTS,
  }, { status: 501 });
}

export async function POST() {
  const access = await requireAdminAccess();
  if (!access.ok) return new Response('Unauthorized', { status: 401 });

  return Response.json({
    status: 'not_implemented',
    artifacts: PATCH_WORKBENCH_ARTIFACTS,
  }, { status: 501 });
}
