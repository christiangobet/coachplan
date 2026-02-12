"use client";

import { SignIn, useUser } from '@clerk/nextjs';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SignInPage() {
  const { isSignedIn } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (isSignedIn) router.replace('/dashboard');
  }, [isSignedIn, router]);

  return (
    <main style={{ maxWidth: 560, margin: '40px auto' }}>
      <SignIn routing="path" path="/sign-in" afterSignInUrl="/dashboard" redirectUrl="/dashboard" />
    </main>
  );
}
