import { requireRolePage } from '@/lib/role-guards';

export default async function PlansLayout({ children }: { children: React.ReactNode }) {
  await requireRolePage('ATHLETE');
  return children;
}
