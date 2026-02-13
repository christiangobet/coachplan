import { requireRolePage } from '@/lib/role-guards';

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  await requireRolePage('COACH');
  return children;
}
