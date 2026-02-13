'use client';

import { useEffect, useMemo, useState } from 'react';

type RolePreset = 'ATHLETE' | 'COACH' | 'ADMIN' | 'ATHLETE_COACH';
type RoleFilter = 'ALL' | 'ATHLETE' | 'COACH' | 'ADMIN';
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: 'ATHLETE' | 'COACH' | 'ADMIN';
  currentRole: 'ATHLETE' | 'COACH' | 'ADMIN';
  hasBothRoles: boolean;
  isActive: boolean;
  createdAt: string;
  deactivatedAt: string | null;
};

function rolePresetFromUser(user: AdminUser): RolePreset {
  if (user.role === 'ADMIN') return 'ADMIN';
  if (user.hasBothRoles) return 'ATHLETE_COACH';
  return user.role;
}

function rolePresetLabel(value: RolePreset) {
  if (value === 'ATHLETE_COACH') return 'Athlete + Coach';
  if (value === 'ATHLETE') return 'Athlete';
  if (value === 'COACH') return 'Coach';
  return 'Admin';
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export default function UserManagementPanel() {
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        if (roleFilter !== 'ALL') params.set('role', roleFilter);
        if (statusFilter !== 'ALL') params.set('status', statusFilter);

        const res = await fetch(`/api/admin/users?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load users');
          setUsers([]);
          return;
        }
        setUsers(data.users || []);
      } catch {
        setError('Failed to load users');
        setUsers([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [q, roleFilter, statusFilter, refreshNonce]);

  const activeCount = useMemo(() => users.filter((user) => user.isActive).length, [users]);

  async function patchUser(userId: string, payload: { rolePreset?: RolePreset; isActive?: boolean }) {
    setSavingUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Update failed');
        return;
      }
      setUsers((prev) => prev.map((user) => (user.id === userId ? data.user : user)));
      setRefreshNonce((n) => n + 1);
    } catch {
      setError('Update failed');
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <section className="admin-user-management">
      <div className="admin-user-head">
        <div>
          <h3>User Management</h3>
          <p>Search users, update role posture, and activate/deactivate accounts.</p>
        </div>
        <div className="admin-user-summary">
          <span>{users.length} shown</span>
          <span>{activeCount} active</span>
        </div>
      </div>

      <div className="admin-user-filters">
        <label>
          Search
          <input
            type="text"
            placeholder="Name or email"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </label>
        <label>
          Role
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
          >
            <option value="ALL">All roles</option>
            <option value="ATHLETE">Athlete</option>
            <option value="COACH">Coach</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
      </div>

      {error && <p className="admin-user-error">{error}</p>}

      {loading ? (
        <p className="admin-user-loading">Loading users...</p>
      ) : (
        <div className="admin-user-table-wrap">
          <table className="admin-user-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Created</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="admin-user-empty">
                    No users match your filters.
                  </td>
                </tr>
              )}

              {users.map((user) => {
                const disabled = savingUserId === user.id;
                const rolePreset = rolePresetFromUser(user);
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="admin-user-cell-main">
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                        <span className="admin-user-cell-sub">Current env: {user.currentRole}</span>
                      </div>
                    </td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td>
                      <select
                        value={rolePreset}
                        onChange={(event) =>
                          patchUser(user.id, { rolePreset: event.target.value as RolePreset })
                        }
                        disabled={disabled}
                      >
                        <option value="ATHLETE">Athlete</option>
                        <option value="COACH">Coach</option>
                        <option value="ATHLETE_COACH">Athlete + Coach</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <span className="admin-user-cell-sub">{rolePresetLabel(rolePreset)}</span>
                    </td>
                    <td>
                      <span className={`admin-user-status ${user.isActive ? 'active' : 'inactive'}`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                      {!user.isActive && user.deactivatedAt && (
                        <span className="admin-user-cell-sub">
                          Since {formatDate(user.deactivatedAt)}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className={`admin-user-toggle ${user.isActive ? 'deactivate' : 'activate'}`}
                        type="button"
                        onClick={() => patchUser(user.id, { isActive: !user.isActive })}
                        disabled={disabled}
                      >
                        {disabled
                          ? 'Saving...'
                          : user.isActive
                            ? 'Deactivate'
                            : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
