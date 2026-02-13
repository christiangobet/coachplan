import { requireRolePage } from '@/lib/role-guards';

export default async function UploadLayout({ children }: { children: React.ReactNode }) {
  await requireRolePage('ATHLETE');
  return children;
}
