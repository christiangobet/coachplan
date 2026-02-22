import { redirect } from 'next/navigation';
import { getCurrentUserRoleContext, getRoleHomePath } from '@/lib/user-roles';
import PlansClient from './PlansClient';

export default async function PlansPage() {
  let roleContext = null;
  try {
    roleContext = await getCurrentUserRoleContext();
  } catch (error) {
    console.error('Failed to resolve role context on plans page', error);
  }

  if (!roleContext) {
    redirect('/sign-in?redirect_url=%2Fplans');
  }

  if (roleContext.currentRole !== 'ATHLETE') {
    redirect(getRoleHomePath(roleContext.currentRole));
  }

  return <PlansClient />;
}
