import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";

export default async function Home() {
  const user = await currentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main>
      <section className="card white">
        <div className="section-title">
          <h1>Training Plan</h1>
        </div>
        <p className="muted">
          Ochsner-inspired clarity for athletes and coaches. Upload a PDF plan, align to race day,
          and track weekly progress with clean, structured views.
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a className="cta" href="/sign-in">Sign in</a>
          <a className="cta secondary" href="/plans">View plans</a>
        </div>
      </section>

      <section className="container" style={{ marginTop: 24 }}>
        <div className="grid-3">
          <div className="card">
            <div className="section-title">
              <h3>Clear weekly blocks</h3>
            </div>
            <p className="muted">Structured weeks that mirror your training plan format.</p>
          </div>
          <div className="card">
            <div className="section-title">
              <h3>Race-day alignment</h3>
            </div>
            <p className="muted">Auto‑align Week 1 so the final week ends on race weekend.</p>
          </div>
          <div className="card">
            <div className="section-title">
              <h3>Coach + athlete flow</h3>
            </div>
            <p className="muted">Assign plans, track adherence, and log actuals.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
