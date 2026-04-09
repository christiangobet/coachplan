/**
 * One-time data fix: re-parse the extracted markdown for plan cmnq97nze0008kjekag54rppi
 * using the fixed markdown parser that splits compound ' + ' sessions into multiple activities.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/fix-monday-compound-sessions.ts
 */
import { PrismaClient } from "@prisma/client";
import { parseMarkdownProgram } from "../src/lib/parsing/markdown-program-parser.ts";
import { resetPlanSchedule } from "../src/lib/parsing/reset-plan-schedule.ts";
import { populatePlanFromV4 } from "../src/lib/parsing/v4-to-plan.ts";

const PLAN_ID = "cmnq97nze0008kjekag54rppi";

async function main() {
  const prisma = new PrismaClient();

  try {
    // 1. Fetch the extracted markdown artifact
    const mdArtifact = await prisma.parseArtifact.findFirst({
      where: {
        artifactType: "EXTRACTED_MD",
        parseJob: { planId: PLAN_ID },
      },
      select: { json: true },
      orderBy: { createdAt: "desc" },
    });

    if (!mdArtifact) {
      console.error("No EXTRACTED_MD artifact found for plan", PLAN_ID);
      process.exit(1);
    }

    const md = (mdArtifact.json as { md: string }).md;
    if (!md) {
      console.error("EXTRACTED_MD artifact has no .md field");
      process.exit(1);
    }

    // 2. Fetch plan name
    const plan = await prisma.trainingPlan.findUnique({
      where: { id: PLAN_ID },
      select: { name: true },
    });

    console.log("Re-parsing plan:", plan?.name, `(${PLAN_ID})`);
    console.log("Extracted MD length:", md.length, "chars");

    // 3. Parse with the fixed markdown parser
    const parsed = await parseMarkdownProgram({ markdown: md, planName: plan?.name });

    console.log("Parsed weeks:", parsed.weeks.length);

    // Show Monday sessions from first 4 weeks
    for (const week of parsed.weeks.slice(0, 4)) {
      const monSessions = week.sessions.filter((s) => s.day_of_week === "Mon");
      console.log(`  Week ${week.week_number} Monday: ${monSessions.length} session(s)`);
      for (const s of monSessions) {
        console.log(`    [${s.activity_type}] ${s.raw_text?.slice(0, 80)}`);
      }
    }

    // 4. Reset and repopulate
    console.log("\nResetting plan schedule...");
    await resetPlanSchedule(PLAN_ID);

    console.log("Repopulating from parsed data...");
    const result = await populatePlanFromV4(PLAN_ID, parsed, {
      parserPipeline: {
        persistenceSource: "markdown-primary",
        mdParseStatus: "succeeded",
        extractedMdAttempted: true,
      },
    });

    console.log(`Done: ${result.weeksCreated} weeks, ${result.activitiesCreated} activities created.`);

    // 5. Verify Monday week 1
    const week1 = await prisma.planWeek.findFirst({
      where: { planId: PLAN_ID, weekIndex: 1 },
      include: {
        days: {
          where: { dayOfWeek: 1 },
          include: { activities: true },
        },
      },
    });
    console.log("\nVerification — Week 1 Monday:");
    for (const day of week1?.days ?? []) {
      console.log("  Activities:", day.activities.length);
      for (const act of day.activities) {
        console.log(`    [${act.type}] ${act.title} | rawText: ${act.rawText?.slice(0, 80)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
