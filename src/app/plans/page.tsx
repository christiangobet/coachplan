import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import PlansClient from './PlansClient';

export default async function PlansPage() {
  let user = null;
  try {
    user = await currentUser();
  } catch (error) {
    console.error('Failed to resolve current user on plans page', error);
  }

  if (!user) {
    redirect('/sign-in?redirect_url=%2Fplans');
  }

  return <PlansClient />;
}
