import { requireRolePage } from '@/lib/role-guards';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireRolePage('ATHLETE');
  return children;
}
