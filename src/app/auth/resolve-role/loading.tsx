import styles from '../../auth.module.css';

export default function ResolveRoleLoading() {
  return (
    <main className={styles.authPage}>
      <div className={styles.authShell}>
        <section className={styles.formPane}>
          <div className={styles.formCard}>
            <h2>Setting up your account…</h2>
            <p>We are checking your roles and sending you to the right workspace.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
