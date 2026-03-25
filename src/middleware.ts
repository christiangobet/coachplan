import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextFetchEvent, NextRequest, NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/privacy(.*)',
  '/terms(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/auth/resolve-role(.*)',
  '/api/integrations/strava/webhook(.*)'
]);
const hasClerkEnv = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
);

const handler = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const pathname = req.nextUrl.pathname;

  if (!hasClerkEnv && isPublicRoute(req)) {
    const res = NextResponse.next();
    res.headers.set('x-pathname', pathname);
    return res;
  }
  if (!hasClerkEnv) {
    return new NextResponse('Authentication is unavailable', { status: 503 });
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
    const errRes = new NextResponse('Authentication failed', { status: 503 });
    errRes.headers.set('x-pathname', pathname);
    return errRes;
  }
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)', '/(api|trpc)(.*)']
};
