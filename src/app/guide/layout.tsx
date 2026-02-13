import { requireRolePage } from '@/lib/role-guards';

export default async function GuideLayout({ children }: { children: React.ReactNode }) {
  await requireRolePage('ATHLETE');
  return children;
}
