import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextFetchEvent, NextRequest, NextResponse } from 'next/server';

const isAdminRoute = createRouteMatcher(['/admin(.*)', '/api/admin(.*)']);
const hasClerkEnv = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
);

const handler = clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req)) {
    await auth.protect();
  }
});

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const pathname = req.nextUrl.pathname;

  if (!hasClerkEnv) {
    const res = NextResponse.next();
    res.headers.set('x-pathname', pathname);
    return res;
  }

  try {
    const res = await handler(req, event);
    if (res) {
      res.headers.set('x-pathname', pathname);
      return res;
    }
    const fallback = NextResponse.next();
    fallback.headers.set('x-pathname', pathname);
    return fallback;
  } catch (error) {
    console.error('Middleware auth failure', error);
    const errRes = NextResponse.next();
    errRes.headers.set('x-pathname', pathname);
    return errRes;
  }
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)', '/(api|trpc)(.*)']
};
