import { requireRolePage } from '@/lib/role-guards';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRolePage('ADMIN');
  return children;
}
