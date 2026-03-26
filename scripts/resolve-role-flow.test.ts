import test from 'node:test';
import assert from 'node:assert/strict';
const { MAX_RESOLVE_ROLE_RETRIES, decideResolveRoleAction } = await import('../src/lib/auth/resolve-role.ts');

test('retries resolve-role when user is signed in but role context is temporarily unavailable', () => {
  const result = decideResolveRoleAction({
    roleContext: null,
    userId: 'user_123',
    retryCount: 1,
    failure: 'sync_failed'
  });

  assert.deepEqual(result, {
    type: 'retry',
    href: '/auth/resolve-role?retry=2',
    reason: 'sync_failed'
  });
});

test('renders recovery state after retries are exhausted for a signed-in user', () => {
  const result = decideResolveRoleAction({
    roleContext: null,
    userId: 'user_123',
    retryCount: MAX_RESOLVE_ROLE_RETRIES,
    failure: 'auth_unavailable'
  });

  assert.equal(result.type, 'render-recovery');
  assert.equal(result.reason, 'auth_unavailable');
  assert.equal(result.retryHref, '/auth/resolve-role');
  assert.equal(result.signInHref, '/sign-in');
});

test('redirects signed-out users to sign-in immediately', () => {
  const result = decideResolveRoleAction({
    roleContext: null,
    userId: null,
    retryCount: 0,
    failure: 'signed_out'
  });

  assert.deepEqual(result, {
    type: 'redirect',
    href: '/sign-in',
    reason: 'signed_out'
  });
});

test('redirects multi-role users to their current role home when valid', () => {
  const result = decideResolveRoleAction({
    roleContext: {
      userId: 'db_user',
      email: 'athlete@example.com',
      name: 'Athlete',
      role: 'ATHLETE',
      currentRole: 'COACH',
      availableRoles: ['ATHLETE', 'COACH'],
      hasBothRoles: true,
      isActive: true
    },
    userId: 'clerk_user',
    retryCount: 0,
    failure: null
  });

  assert.deepEqual(result, {
    type: 'redirect',
    href: '/coach',
    reason: 'multi_role_current'
  });
});

test('updates current role before redirecting when only one role is available', () => {
  const result = decideResolveRoleAction({
    roleContext: {
      userId: 'db_user',
      email: 'athlete@example.com',
      name: 'Athlete',
      role: 'ATHLETE',
      currentRole: 'COACH',
      availableRoles: ['ATHLETE'],
      hasBothRoles: false,
      isActive: true
    },
    userId: 'clerk_user',
    retryCount: 0,
    failure: null
  });

  assert.deepEqual(result, {
    type: 'update-and-redirect',
    href: '/dashboard',
    role: 'ATHLETE',
    reason: 'single_role_sync'
  });
});
