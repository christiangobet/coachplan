import { requireRolePage } from '@/lib/role-guards';

export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  await requireRolePage('ATHLETE');
  return children;
}
