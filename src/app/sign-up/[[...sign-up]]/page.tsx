"use client";

import { SignUp, useUser } from '@clerk/nextjs';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SignUpPage() {
  const { isSignedIn } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (isSignedIn) router.replace('/dashboard');
  }, [isSignedIn, router]);

  return (
    <main style={{ maxWidth: 560, margin: '40px auto' }}>
      <SignUp routing="path" path="/sign-up" afterSignUpUrl="/dashboard" redirectUrl="/dashboard" />
    </main>
  );
}
