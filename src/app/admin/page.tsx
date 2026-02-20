import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminStats, requireAdminAccess } from '@/lib/admin';
import UserManagementPanel from './UserManagementPanel';
import './admin.css';

export default async function AdminPage() {
  const access = await requireAdminAccess();

  if (!access.ok) {
    if (access.reason === 'unauthorized') redirect('/sign-in');
    redirect('/auth/resolve-role');
  }

  const stats = await getAdminStats();

  return (
    <main className="admin-page">
      <section className="admin-hero">
        <div>
          <h1>Admin Backend</h1>
          <p>Core operational metrics for users, plans, and training execution.</p>
        </div>
        <div className="admin-hero-badge">Admin Access</div>
      </section>

      <section className="admin-grid">
        <article className="admin-card">
          <h2>Users</h2>
          <div className="admin-metric">{stats.users.total}</div>
          <div className="admin-subgrid">
            <div><strong>{stats.users.active}</strong><span>Active</span></div>
            <div><strong>{stats.users.inactive}</strong><span>Inactive</span></div>
            <div><strong>{stats.users.athletes}</strong><span>Athletes</span></div>
            <div><strong>{stats.users.coaches}</strong><span>Coaches</span></div>
            <div><strong>{stats.users.admins}</strong><span>Admins</span></div>
            <div><strong>{stats.users.joinedLast7Days}</strong><span>New (7d)</span></div>
          </div>
        </article>

        <article className="admin-card">
          <h2>Plans</h2>
          <div className="admin-metric">{stats.plans.total}</div>
          <div className="admin-subgrid">
            <div><strong>{stats.plans.active}</strong><span>Active</span></div>
            <div><strong>{stats.plans.draft}</strong><span>Draft</span></div>
            <div><strong>{stats.plans.templates}</strong><span>Templates</span></div>
            <div><strong>{stats.plans.createdLast7Days}</strong><span>New (7d)</span></div>
          </div>
        </article>

        <article className="admin-card">
          <h2>Workouts</h2>
          <div className="admin-metric">{stats.workouts.completionRate}%</div>
          <div className="admin-subgrid">
            <div><strong>{stats.workouts.total}</strong><span>Total</span></div>
            <div><strong>{stats.workouts.completed}</strong><span>Completed</span></div>
          </div>
        </article>
      </section>

      <UserManagementPanel />

      <section className="admin-actions">
        <h3>Next Admin Modules</h3>
        <div className="admin-links">
          <span className="admin-link-placeholder">User Management</span>
          <span className="admin-link-placeholder">Plan Moderation</span>
          <Link className="admin-link" href="/admin/parse-debug">Upload/Parse Monitor</Link>
          <Link className="admin-link" href="/dashboard">Back to Athlete Dashboard</Link>
        </div>
      </section>
    </main>
  );
}
