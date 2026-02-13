import { UserRole } from '@prisma/client';
import { redirect } from 'next/navigation';
import { chooseRoleAction } from './actions';
import { getCurrentUserRoleContext, getRoleLabel } from '@/lib/user-roles';
import './select-role.css';

const roleDescriptions: Record<UserRole, string> = {
  ATHLETE: 'Track daily workouts, view your plan calendar, and monitor progress.',
  COACH: 'Create templates, assign plans, and manage your athletes.',
  ADMIN: 'Access platform-level operations and oversight metrics.'
};

export default async function SelectRolePage() {
  const roleContext = await getCurrentUserRoleContext();
  if (!roleContext) redirect('/sign-in');

  if (roleContext.availableRoles.length <= 1) {
    redirect('/auth/resolve-role');
  }

  return (
    <main className="role-select-page">
      <section className="role-select-card">
        <div className="role-select-head">
          <h1>Choose your environment</h1>
          <p>Signed in as {roleContext.email}. Select the role you want to use for this session.</p>
        </div>

        <div className="role-select-grid">
          {roleContext.availableRoles.map((role) => (
            <form action={chooseRoleAction} key={role} className="role-option-form">
              <input type="hidden" name="role" value={role} />
              <button className="role-option-btn" type="submit">
                <span className="role-option-name">{getRoleLabel(role)}</span>
                <span className="role-option-desc">{roleDescriptions[role]}</span>
              </button>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
