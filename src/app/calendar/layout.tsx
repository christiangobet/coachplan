import { requireRolePage } from '@/lib/role-guards';

export default async function CalendarLayout({ children }: { children: React.ReactNode }) {
  await requireRolePage('ATHLETE');
  return children;
}
