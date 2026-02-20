"use client";

import WorkoutDetailCard from "@/components/WorkoutDetailCard";

export default function WorkoutCardDemoPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f0f0f2",
        padding: "48px 24px 80px",
        fontFamily: "Figtree, sans-serif",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Page header */}
        <div style={{ marginBottom: 40 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "#fc4c02",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Component Preview
          </p>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: "#18181f",
              letterSpacing: "-0.035em",
              margin: 0,
            }}
          >
            Workout Detail Card
          </h1>
          <p
            style={{
              marginTop: 8,
              color: "#6b6b76",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            All states — upcoming, completed with actuals, and rest day
          </p>
        </div>

        {/* Card grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
            gap: 24,
            alignItems: "start",
          }}
        >
          {/* ── 1. KEY RUN — upcoming ── */}
          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "#a0a0ad",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Key workout · upcoming
            </p>
            <WorkoutDetailCard
              title="Long Run"
              type="RUN"
              weekLabel="Week 8"
              date="2026-02-22"
              distance={18}
              distanceUnit="MILES"
              duration={150}
              paceTarget="8:45–9:10 /mi"
              effortTarget="Easy, conversational pace throughout. Z2 effort."
              notes="Stay disciplined on effort — this isn't a race. Stop for water at mile 9 if warm."
              priority="KEY"
              mustDo
              onComplete={() => alert("Open log modal")}
              onEdit={() => alert("Open edit modal")}
            />
          </div>

          {/* ── 2. COMPLETED RUN with actuals ── */}
          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "#a0a0ad",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Key workout · completed with actuals
            </p>
            <WorkoutDetailCard
              title="Tempo Intervals"
              type="RUN"
              subtype="Track"
              weekLabel="Week 7"
              date="2026-02-14"
              distance={10}
              distanceUnit="MILES"
              duration={75}
              paceTarget="7:00–7:20 /mi"
              effortTarget="Threshold — comfortably hard. RPE 7–8."
              notes="3×2mi at tempo w/ 90s rest. Warm up 1mi, cool down 1mi."
              priority="KEY"
              completed
              completedAt="2026-02-14"
              actualDistance={10.2}
              actualDuration={73}
              actualPace="7:08 /mi"
              onComplete={() => alert("Open update modal")}
              onEdit={() => alert("Open edit modal")}
            />
          </div>

          {/* ── 3. MEDIUM STRENGTH ── */}
          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "#a0a0ad",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Strength · medium priority
            </p>
            <WorkoutDetailCard
              title="Gym — Legs & Core"
              type="STRENGTH"
              weekLabel="Week 8"
              date="2026-02-21"
              duration={50}
              effortTarget="Moderate. Focus on single-leg stability and hip strength."
              notes="Squats, RDLs, step-ups, Copenhagen planks. Avoid failure — stop at RPE 8."
              priority="MEDIUM"
              bailAllowed
              onComplete={() => alert("Open log modal")}
              onEdit={() => alert("Open edit modal")}
            />
          </div>

          {/* ── 4. REST DAY ── */}
          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "#a0a0ad",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Rest day · optional mobility
            </p>
            <WorkoutDetailCard
              title="Rest & Recovery"
              type="REST"
              weekLabel="Week 8"
              date="2026-02-23"
              duration={20}
              effortTarget="Completely optional — foam roll, stretch, or walk."
              priority="OPTIONAL"
              completed
              completedAt="2026-02-23"
              onComplete={() => alert("Update")}
              onEdit={() => alert("Edit")}
            />
          </div>

          {/* ── 5. MISSED workout (actual < 75%) ── */}
          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "#a0a0ad",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Medium run · partial completion
            </p>
            <WorkoutDetailCard
              title="Medium Aerobic Run"
              type="RUN"
              weekLabel="Week 6"
              date="2026-02-10"
              distance={12}
              distanceUnit="MILES"
              duration={105}
              paceTarget="9:00–9:30 /mi"
              effortTarget="Aerobic base — keep HR under 145 bpm."
              priority="MEDIUM"
              completed
              completedAt="2026-02-10"
              actualDistance={8.5}
              actualDuration={72}
              actualPace="9:22 /mi"
              onComplete={() => alert("Update actuals")}
              onEdit={() => alert("Edit")}
            />
          </div>

          {/* ── 6. HIKE — no metrics ── */}
          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "#a0a0ad",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Cross-training · upcoming
            </p>
            <WorkoutDetailCard
              title="Trail Hike"
              type="HIKE"
              weekLabel="Week 8"
              date="2026-02-22"
              distance={6}
              distanceUnit="MILES"
              duration={180}
              effortTarget="Easy — this is active recovery. No racing."
              notes="Choose a scenic route with 1,000–1,500ft of gain. Good shoes required."
              priority="OPTIONAL"
              onComplete={() => alert("Log")}
              onEdit={() => alert("Edit")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
