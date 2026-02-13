import { NextResponse } from 'next/server';
import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';

function parseRoleFilter(input: string | null): UserRole | null {
  if (input === 'ATHLETE' || input === 'COACH' || input === 'ADMIN') return input;
  return null;
}

export async function GET(req: Request) {
  const access = await requireRoleApi('ADMIN');
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const roleFilter = parseRoleFilter(searchParams.get('role'));
  const statusFilter = searchParams.get('status');

  const andFilters: Prisma.UserWhereInput[] = [];
  if (q) {
    andFilters.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } }
      ]
    });
  }
  if (roleFilter === 'ADMIN') {
    andFilters.push({ role: 'ADMIN' });
  } else if (roleFilter === 'COACH') {
    andFilters.push({ OR: [{ role: 'COACH' }, { hasBothRoles: true }] });
  } else if (roleFilter === 'ATHLETE') {
    andFilters.push({ role: 'ATHLETE' });
  }
  if (statusFilter === 'ACTIVE') andFilters.push({ isActive: true });
  if (statusFilter === 'INACTIVE') andFilters.push({ isActive: false });

  const where: Prisma.UserWhereInput = andFilters.length > 0
    ? { AND: andFilters }
    : {};

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      currentRole: true,
      hasBothRoles: true,
      isActive: true,
      createdAt: true,
      deactivatedAt: true
    }
  });

  return NextResponse.json({
    users,
    meta: {
      count: users.length
    }
  });
}
