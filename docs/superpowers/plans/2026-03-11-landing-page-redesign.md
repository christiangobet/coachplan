# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current landing page with a Dark Premium redesign — split hero with app mockup, 3-step How It Works, features, testimonials, and a strong bottom CTA.

**Architecture:** Two files replaced wholesale. `page.module.css` provides all scoped styles using CSS custom class names. `page.tsx` is a Next.js async server component with no client state — Clerk redirect logic unchanged, `Image` and `Link` from Next.js, no BrandLogo dependency (inline SVG logo mark instead for full design control).

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules, Figtree font (global via `globals.css`)

---

## Chunk 1: CSS + TSX

### Task 1: Replace page.module.css

**Files:**
- Modify: `src/app/page.module.css` (full replacement)

- [ ] **Step 1: Replace the full file with the new styles**

Write this exact content to `src/app/page.module.css`:

```css
/* ===== BASE ===== */
.landing {
  background: #070c16;
  color: #f5f8ff;
  min-height: 100vh;
}

/* ===== NAV ===== */
.nav {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(7, 12, 22, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.navInner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 48px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.navBrand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.navLogo {
  width: 30px;
  height: 30px;
  background: linear-gradient(135deg, #fc4c02, #e03d00);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.navWordmark {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f5f8ff;
}

.navActions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btnGhost {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #cbd5e1;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: border-color 0.15s, color 0.15s;
}

.btnGhost:hover {
  border-color: rgba(252, 76, 2, 0.5);
  color: #fff;
}

.btnPrimary {
  padding: 8px 18px;
  border-radius: 8px;
  background: #fc4c02;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  transition: background 0.15s;
}

.btnPrimary:hover {
  background: #e54400;
}

/* ===== HERO ===== */
.heroOuter {
  position: relative;
  overflow: hidden;
}

.heroOuter::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 60% at 15% 50%, rgba(252, 76, 2, 0.12), transparent),
    radial-gradient(ellipse 40% 60% at 85% 30%, rgba(38, 90, 200, 0.08), transparent);
  pointer-events: none;
}

.heroInner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 80px 48px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  align-items: center;
  position: relative;
  z-index: 1;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(252, 76, 2, 0.15);
  border: 1px solid rgba(252, 76, 2, 0.35);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fc8c5a;
  margin-bottom: 20px;
}

.eyebrow::before {
  content: '●';
  font-size: 7px;
  color: #fc4c02;
}

.heroTitle {
  font-size: clamp(38px, 4.5vw, 62px);
  font-weight: 900;
  line-height: 1.02;
  letter-spacing: -0.04em;
  color: #f5f8ff;
  margin-bottom: 20px;
}

.heroTitle em {
  font-style: normal;
  color: #fc4c02;
}

.heroDesc {
  font-size: 17px;
  line-height: 1.65;
  color: #94a3b8;
  max-width: 46ch;
  margin-bottom: 32px;
}

.heroCtas {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.ctaMain {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 24px;
  border-radius: 10px;
  background: #fc4c02;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 8px 24px rgba(252, 76, 2, 0.35);
  transition: background 0.18s, transform 0.18s, box-shadow 0.18s;
}

.ctaMain:hover {
  background: #e54400;
  transform: translateY(-1px);
  box-shadow: 0 12px 30px rgba(252, 76, 2, 0.45);
}

.ctaSec {
  display: inline-flex;
  align-items: center;
  padding: 14px 20px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #cbd5e1;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: border-color 0.18s, color 0.18s;
}

.ctaSec:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: #fff;
}

.socialProof {
  font-size: 13px;
  color: #334155;
  letter-spacing: 0.01em;
}

/* Hero column containers */
.heroCopy {
  /* left column — layout handled by heroInner grid */
}

.heroVisual {
  /* right column — layout handled by heroInner grid */
}

/* App mockup — hero right */
.appFrame {
  background: #0f1729;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
}

.appTopbar {
  background: #111f38;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.planLabel {
  font-size: 10px;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 3px;
}

.planName {
  font-size: 15px;
  font-weight: 800;
  color: #f5f8ff;
  letter-spacing: -0.01em;
}

.raceBadge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(252, 76, 2, 0.12);
  border: 1px solid rgba(252, 76, 2, 0.25);
  border-radius: 8px;
  padding: 6px 10px;
}

.raceDot {
  width: 6px;
  height: 6px;
  background: #fc4c02;
  border-radius: 50%;
  flex-shrink: 0;
}

.raceText {
  font-size: 11px;
  font-weight: 700;
  color: #fc8c5a;
  white-space: nowrap;
}

.weekHeader {
  padding: 12px 18px 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.weekLabel {
  font-size: 12px;
  font-weight: 700;
  color: #f5f8ff;
}

.weekMeta {
  font-size: 11px;
  color: #475569;
}

.daysGrid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 5px;
  padding: 6px 12px 12px;
}

.day {
  border-radius: 8px;
  padding: 8px 4px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  text-align: center;
}

.dayDone {
  background: rgba(15, 138, 71, 0.1);
  border-color: rgba(15, 138, 71, 0.25);
}

.dayActive {
  background: rgba(252, 76, 2, 0.1);
  border-color: rgba(252, 76, 2, 0.25);
}

.dayRest {
  opacity: 0.35;
}

.dayLabel {
  font-size: 9px;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  margin-bottom: 5px;
}

.dayDone .dayLabel {
  color: #22c55e;
}

.dayType {
  font-size: 8px;
  font-weight: 700;
  color: #f5f8ff;
  margin-bottom: 3px;
  line-height: 1.2;
}

.dayDist {
  font-size: 8px;
  color: #64748b;
}

.dayDone .dayDist {
  color: #4ade80;
}

.progressWrap {
  padding: 0 12px 14px;
}

.progressLabels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #475569;
  margin-bottom: 5px;
}

.progressTrack {
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
}

.progressFill {
  height: 100%;
  width: 65%;
  background: linear-gradient(90deg, #fc4c02, #ff7a3d);
  border-radius: 2px;
}

.stravaRow {
  margin: 0 12px 12px;
  background: rgba(252, 76, 2, 0.06);
  border: 1px solid rgba(252, 76, 2, 0.15);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stravaLeft {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stravaIcon {
  width: 20px;
  height: 20px;
  background: #fc4c02;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stravaText {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
}

.stravaSync {
  font-size: 11px;
  font-weight: 700;
  color: #fc4c02;
}

/* Social proof pills — mobile only */
.proofPills {
  display: none;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 0 0;
}

.proofPill {
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: #475569;
}

/* ===== TESTIMONIAL STRIP ===== */
.testimonialStrip {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.015);
}

.testimonialStripInner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 28px 48px;
  display: flex;
  gap: 32px;
  align-items: center;
}

.testimonial {
  flex: 1;
  min-width: 0;
}

.tDivider {
  width: 1px;
  height: 44px;
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.tQuote {
  font-size: 13px;
  font-style: italic;
  color: #94a3b8;
  line-height: 1.55;
  margin-bottom: 6px;
}

.tAuthor {
  font-size: 11px;
  font-weight: 700;
  color: #475569;
}

/* ===== SHARED SECTION ===== */
.section {
  max-width: 1280px;
  margin: 0 auto;
  padding: 80px 48px;
}

.sectionHead {
  margin-bottom: 48px;
}

.sectionEyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(252, 76, 2, 0.12);
  border: 1px solid rgba(252, 76, 2, 0.25);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #fc8c5a;
  margin-bottom: 14px;
}

.sectionTitle {
  font-size: clamp(26px, 3.5vw, 40px);
  font-weight: 900;
  letter-spacing: -0.035em;
  line-height: 1.05;
  color: #f5f8ff;
  margin-bottom: 10px;
}

.sectionSub {
  font-size: 16px;
  color: #64748b;
  line-height: 1.6;
  max-width: 52ch;
}

.sectionDivider {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 48px;
}

.sectionDividerLine {
  height: 1px;
  background: rgba(255, 255, 255, 0.05);
}

/* ===== HOW IT WORKS ===== */
.steps {
  display: flex;
  flex-direction: column;
  position: relative;
}

.steps::before {
  content: '';
  position: absolute;
  left: 27px;
  top: 28px;
  bottom: 28px;
  width: 2px;
  background: linear-gradient(180deg, #fc4c02 0%, rgba(252, 76, 2, 0.15) 100%);
  z-index: 0;
}

.step {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 24px;
  align-items: start;
  padding: 20px 0;
  position: relative;
  z-index: 1;
}

.stepNum {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 900;
  flex-shrink: 0;
}

.stepNumActive {
  background: #fc4c02;
  color: #fff;
  box-shadow: 0 0 0 6px rgba(252, 76, 2, 0.15);
}

.stepNumMid {
  background: #111f38;
  border: 2px solid rgba(252, 76, 2, 0.4);
  color: #fc8c5a;
}

.stepNumDim {
  background: #111f38;
  border: 2px solid rgba(252, 76, 2, 0.2);
  color: #334155;
}

.stepBody {
  padding-top: 8px;
}

.stepLabel {
  font-size: 11px;
  font-weight: 700;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 5px;
}

.stepTitle {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f5f8ff;
  margin-bottom: 8px;
}

.stepDesc {
  font-size: 14px;
  color: #64748b;
  line-height: 1.65;
  max-width: 52ch;
  margin-bottom: 14px;
}

.stepDetail {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px;
  color: #94a3b8;
}

.stepDetail strong {
  color: #f5f8ff;
  font-weight: 700;
}

.stepTag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(15, 138, 71, 0.15);
  border: 1px solid rgba(15, 138, 71, 0.3);
  font-size: 10px;
  font-weight: 700;
  color: #4ade80;
}

/* ===== FEATURES ===== */
.featuresGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.featCard {
  background: #0f1729;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 16px;
  padding: 24px;
  transition: border-color 0.2s;
}

.featCard:hover {
  border-color: rgba(252, 76, 2, 0.3);
}

.featIcon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  font-size: 20px;
}

.featIconOrange {
  background: rgba(252, 76, 2, 0.15);
  border: 1px solid rgba(252, 76, 2, 0.2);
}

.featIconBlue {
  background: rgba(38, 90, 200, 0.15);
  border: 1px solid rgba(38, 90, 200, 0.2);
}

.featIconGreen {
  background: rgba(15, 138, 71, 0.15);
  border: 1px solid rgba(15, 138, 71, 0.2);
}

.featTitle {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f5f8ff;
  margin-bottom: 8px;
}

.featDesc {
  font-size: 13px;
  color: #64748b;
  line-height: 1.65;
}

/* ===== BOTTOM CTA ===== */
.bottomCtaOuter {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 48px 80px;
}

.bottomCta {
  position: relative;
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid rgba(252, 76, 2, 0.2);
  background: linear-gradient(135deg, #111826 0%, #1a2540 60%, #0f1e38 100%);
  padding: 72px 48px;
  text-align: center;
}

.bottomCta::before {
  content: '';
  position: absolute;
  top: -60px;
  left: 50%;
  transform: translateX(-50%);
  width: 400px;
  height: 200px;
  background: radial-gradient(ellipse, rgba(252, 76, 2, 0.22), transparent 70%);
  pointer-events: none;
}

.bottomCta::after {
  content: '';
  position: absolute;
  bottom: -40px;
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  height: 150px;
  background: radial-gradient(ellipse, rgba(38, 90, 200, 0.12), transparent 70%);
  pointer-events: none;
}

.ctaEyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(252, 76, 2, 0.12);
  border: 1px solid rgba(252, 76, 2, 0.25);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #fc8c5a;
  margin-bottom: 20px;
  position: relative;
  z-index: 1;
}

.ctaTitle {
  font-size: clamp(28px, 4vw, 48px);
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1.05;
  color: #f5f8ff;
  margin-bottom: 14px;
  position: relative;
  z-index: 1;
}

.ctaTitle em {
  font-style: normal;
  color: #fc4c02;
}

.ctaDesc {
  font-size: 16px;
  color: #64748b;
  line-height: 1.6;
  max-width: 44ch;
  margin: 0 auto 32px;
  position: relative;
  z-index: 1;
}

.ctaButtons {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
  margin-bottom: 16px;
}

.ctaMainLg {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 15px 28px;
  border-radius: 11px;
  background: #fc4c02;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 8px 28px rgba(252, 76, 2, 0.4);
  transition: background 0.18s, transform 0.18s, box-shadow 0.18s;
}

.ctaMainLg:hover {
  background: #e54400;
  transform: translateY(-1px);
  box-shadow: 0 12px 36px rgba(252, 76, 2, 0.5);
}

.ctaSecLg {
  display: inline-flex;
  align-items: center;
  padding: 15px 24px;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #94a3b8;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: border-color 0.18s, color 0.18s;
}

.ctaSecLg:hover {
  border-color: rgba(255, 255, 255, 0.28);
  color: #f5f8ff;
}

.ctaFootnote {
  font-size: 12px;
  color: #334155;
  position: relative;
  z-index: 1;
  margin-bottom: 28px;
}

.ctaStats {
  display: flex;
  justify-content: center;
  gap: 48px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 28px;
  position: relative;
  z-index: 1;
  flex-wrap: wrap;
}

.ctaStatVal {
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: #f5f8ff;
}

.ctaStatVal em {
  font-style: normal;
  color: #fc4c02;
}

.ctaStatLabel {
  font-size: 11px;
  color: #475569;
  margin-top: 2px;
  font-weight: 600;
}

/* ===== FOOTER ===== */
.footer {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.footerInner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 40px 48px 48px;
}

.footerTop {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 32px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}

.footerBrandRow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.footerLogo {
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, #fc4c02, #e03d00);
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.footerWordmark {
  font-size: 14px;
  font-weight: 800;
  color: #f5f8ff;
  letter-spacing: -0.01em;
}

.footerTagline {
  font-size: 12px;
  color: #334155;
  line-height: 1.5;
  max-width: 28ch;
}

.footerLinks {
  display: flex;
  gap: 40px;
  flex-wrap: wrap;
}

.footerColTitle {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #334155;
  margin-bottom: 12px;
}

.footerCol a {
  display: block;
  font-size: 13px;
  color: #1e2d3d;
  text-decoration: none;
  margin-bottom: 8px;
  transition: color 0.15s;
}

.footerCol a:hover {
  color: #fc4c02;
}

.footerBottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  flex-wrap: wrap;
  gap: 10px;
}

.footerCopy {
  font-size: 12px;
  color: #1e2d3d;
}

.footerLegal {
  display: flex;
  gap: 16px;
}

.footerLegal a {
  font-size: 12px;
  color: #1e2d3d;
  text-decoration: none;
  transition: color 0.15s;
}

.footerLegal a:hover {
  color: #475569;
}

/* ===== RESPONSIVE ===== */
@media (max-width: 768px) {
  .navInner {
    padding: 0 20px;
  }

  .heroInner {
    grid-template-columns: 1fr;
    padding: 40px 20px 20px;
    gap: 24px;
  }

  .heroDesc {
    font-size: 15px;
  }

  .socialProof {
    display: none;
  }

  .proofPills {
    display: flex;
  }

  .testimonialStripInner {
    flex-direction: column;
    padding: 24px 20px;
    gap: 16px;
  }

  .tDivider {
    width: 100%;
    height: 1px;
  }

  .section {
    padding: 56px 20px;
  }

  .sectionDivider {
    padding: 0 20px;
  }

  .steps::before {
    left: 23px;
  }

  .step {
    grid-template-columns: 48px 1fr;
    gap: 16px;
  }

  .stepNum {
    width: 48px;
    height: 48px;
    font-size: 17px;
  }

  .stepTitle {
    font-size: 17px;
  }

  .featuresGrid {
    grid-template-columns: 1fr;
  }

  .bottomCtaOuter {
    padding: 0 20px 56px;
  }

  .bottomCta {
    padding: 44px 24px;
    border-radius: 18px;
  }

  .ctaStats {
    gap: 24px;
  }

  .footerInner {
    padding: 32px 20px 40px;
  }

  .footerTop {
    flex-direction: column;
    gap: 24px;
  }

  .footerLinks {
    gap: 24px;
  }

  .footerBottom {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 480px) {
  .heroCtas {
    flex-direction: column;
  }

  .ctaMain,
  .ctaSec {
    width: 100%;
    justify-content: center;
  }

  .ctaButtons {
    flex-direction: column;
    align-items: stretch;
  }

  .ctaMainLg,
  .ctaSecLg {
    width: 100%;
    justify-content: center;
  }

  .ctaStats {
    gap: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ctaMain,
  .ctaSec,
  .ctaMainLg,
  .ctaSecLg,
  .btnGhost,
  .btnPrimary,
  .featCard,
  .footerCol a,
  .footerLegal a {
    transition: none;
  }

  .ctaMain:hover,
  .ctaMainLg:hover {
    transform: none;
  }
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `npm run typecheck`
Expected: 0 errors (CSS modules don't affect typecheck, but ensures no TS breakage from the file change)

---

### Task 2: Replace page.tsx

**Files:**
- Modify: `src/app/page.tsx` (full replacement)

- [ ] **Step 1: Replace the full file**

Write this exact content to `src/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import Link from 'next/link';
import styles from './page.module.css';

export default async function Home() {
  let user = null;
  try {
    user = await currentUser();
  } catch (error) {
    console.error('Failed to resolve current user on landing page', error);
  }

  if (user) {
    redirect('/auth/resolve-role');
  }

  return (
    <div className={styles.landing}>

      {/* ===== NAV ===== */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <Link href="/" className={styles.navBrand}>
            <div className={styles.navLogo}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L13 12H1L7 1Z" fill="white" />
              </svg>
            </div>
            <span className={styles.navWordmark}>MyTrainingPlan</span>
          </Link>
          <div className={styles.navActions}>
            <Link href="/sign-in" className={styles.btnGhost}>Sign in</Link>
            <Link href="/sign-up" className={styles.btnPrimary}>Create account →</Link>
          </div>
        </div>
      </nav>

      {/* ===== HERO ===== */}
      <section className={styles.heroOuter}>
        <div className={styles.heroInner}>

          {/* Left: copy */}
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>For endurance athletes</span>
            <h1 className={styles.heroTitle}>
              Training plans as sharp as <em>race day.</em>
            </h1>
            <p className={styles.heroDesc}>
              Drop in your PDF plan, set your race date, and get a structured
              week-by-week schedule that keeps you on track through the whole build.
            </p>
            <div className={styles.heroCtas}>
              <Link href="/sign-up" className={styles.ctaMain}>Start for free →</Link>
              <Link href="/sign-in" className={styles.ctaSec}>Sign in</Link>
            </div>
            <p className={styles.socialProof}>
              Works with any PDF training plan · Align to your race in minutes
            </p>
            {/* Mobile-only social proof pills */}
            <div className={styles.proofPills}>
              <span className={styles.proofPill}>✓ Any PDF plan</span>
              <span className={styles.proofPill}>⚡ Race-aligned</span>
              <span className={styles.proofPill}>🔗 Strava sync</span>
            </div>
          </div>

          {/* Right: app mockup */}
          <div className={styles.heroVisual}>
            <div className={styles.appFrame}>
              <div className={styles.appTopbar}>
                <div>
                  <div className={styles.planLabel}>Active plan</div>
                  <div className={styles.planName}>City Marathon Build</div>
                </div>
                <div className={styles.raceBadge}>
                  <div className={styles.raceDot} />
                  <span className={styles.raceText}>Race: Oct 19 · 38 days</span>
                </div>
              </div>
              <div className={styles.weekHeader}>
                <span className={styles.weekLabel}>Week 8 of 16</span>
                <span className={styles.weekMeta}>Sep 9 – Sep 15</span>
              </div>
              <div className={styles.daysGrid}>
                {[
                  { label: 'Mon', type: 'Easy',   dist: '6mi ✓',  state: 'done'   },
                  { label: 'Tue', type: 'Tempo',  dist: '8mi ✓',  state: 'done'   },
                  { label: 'Wed', type: 'Long',   dist: '14mi',   state: 'active' },
                  { label: 'Thu', type: 'Rest',   dist: '—',      state: 'rest'   },
                  { label: 'Fri', type: 'Easy',   dist: '5mi',    state: ''       },
                  { label: 'Sat', type: 'Stride', dist: '4×100',  state: ''       },
                  { label: 'Sun', type: 'Rest',   dist: '—',      state: 'rest'   },
                ].map(({ label, type, dist, state }) => (
                  <div
                    key={label}
                    className={[
                      styles.day,
                      state === 'done'   ? styles.dayDone   : '',
                      state === 'active' ? styles.dayActive : '',
                      state === 'rest'   ? styles.dayRest   : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <div className={styles.dayLabel}>{label}</div>
                    <div className={styles.dayType}>{type}</div>
                    <div className={styles.dayDist}>{dist}</div>
                  </div>
                ))}
              </div>
              <div className={styles.progressWrap}>
                <div className={styles.progressLabels}>
                  <span>Build progress</span>
                  <span>65% complete</span>
                </div>
                <div className={styles.progressTrack}>
                  <div className={styles.progressFill} />
                </div>
              </div>
              <div className={styles.stravaRow}>
                <div className={styles.stravaLeft}>
                  <div className={styles.stravaIcon}>
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="white">
                      <path d="M9 3l3 7h-2L8 6 6 10H4l3-7h2z" />
                    </svg>
                  </div>
                  <span className={styles.stravaText}>Strava connected · Last sync 2h ago</span>
                </div>
                <span className={styles.stravaSync}>Sync now</span>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ===== TESTIMONIAL STRIP ===== */}
      <div className={styles.testimonialStrip}>
        <div className={styles.testimonialStripInner}>
          <div className={styles.testimonial}>
            <p className={styles.tQuote}>
              &ldquo;Had my full race calendar set up in under 3 minutes. Incredible.&rdquo;
            </p>
            <div className={styles.tAuthor}>— James T., Ironman athlete</div>
          </div>
          <div className={styles.tDivider} />
          <div className={styles.testimonial}>
            <p className={styles.tQuote}>
              &ldquo;Finally a tool that gets how runners think about their build weeks.&rdquo;
            </p>
            <div className={styles.tAuthor}>— Sarah M., Marathon runner · BQ 2024</div>
          </div>
          <div className={styles.tDivider} />
          <div className={styles.testimonial}>
            <p className={styles.tQuote}>
              &ldquo;My athletes love the shared plan and weekly completion tracking.&rdquo;
            </p>
            <div className={styles.tAuthor}>— Coach Priya N., Running coach</div>
          </div>
        </div>
      </div>

      {/* ===== HOW IT WORKS ===== */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionEyebrow}>How it works</div>
          <h2 className={styles.sectionTitle}>From PDF to race-ready<br />in three steps.</h2>
          <p className={styles.sectionSub}>No manual data entry. No reformatting. Drop in your plan and go.</p>
        </div>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={`${styles.stepNum} ${styles.stepNumActive}`}>1</div>
            <div className={styles.stepBody}>
              <div className={styles.stepLabel}>Step one</div>
              <div className={styles.stepTitle}>Upload your PDF plan</div>
              <p className={styles.stepDesc}>
                Drop in any coach-written PDF — Hal Higdon, Jack Daniels, your personal coach&rsquo;s
                plan. AI extracts every workout, week by week, into a clean structured schedule.
              </p>
              <div className={styles.stepDetail}>
                <strong>~2 min</strong> average parse time · <span className={styles.stepTag}>AI-powered</span>
              </div>
            </div>
          </div>
          <div className={styles.step}>
            <div className={`${styles.stepNum} ${styles.stepNumMid}`}>2</div>
            <div className={styles.stepBody}>
              <div className={styles.stepLabel}>Step two</div>
              <div className={styles.stepTitle}>Set your race date</div>
              <p className={styles.stepDesc}>
                Pick your event and date. The entire schedule shifts automatically so your peak
                training week lands exactly on race weekend — no manual math, no spreadsheets.
              </p>
              <div className={styles.stepDetail}>
                <strong>Automatic</strong> week alignment · supports multiple races
              </div>
            </div>
          </div>
          <div className={styles.step}>
            <div className={`${styles.stepNum} ${styles.stepNumDim}`}>3</div>
            <div className={styles.stepBody}>
              <div className={styles.stepLabel}>Step three</div>
              <div className={styles.stepTitle}>Execute. Log. Repeat.</div>
              <p className={styles.stepDesc}>
                Check off workouts daily, log your actual distance and pace, and connect Strava
                to auto-import runs. See your build progress at a glance — all the way to the line.
              </p>
              <div className={styles.stepDetail}>
                🔗 Strava sync · <strong>Daily</strong> execution log
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* divider */}
      <div className={styles.sectionDivider}>
        <div className={styles.sectionDividerLine} />
      </div>

      {/* ===== FEATURES ===== */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionEyebrow}>Features</div>
          <h2 className={styles.sectionTitle}>Everything in one<br />training command center.</h2>
          <p className={styles.sectionSub}>Built for athletes who take their training seriously.</p>
        </div>
        <div className={styles.featuresGrid}>
          <article className={styles.featCard}>
            <div className={`${styles.featIcon} ${styles.featIconOrange}`}>📄</div>
            <h3 className={styles.featTitle}>Upload &amp; Parse</h3>
            <p className={styles.featDesc}>
              AI extracts workouts from any PDF plan — distance, pace targets, effort levels,
              and rest days — into a clean structured calendar.
            </p>
          </article>
          <article className={styles.featCard}>
            <div className={`${styles.featIcon} ${styles.featIconBlue}`}>🏁</div>
            <h3 className={styles.featTitle}>Race-Day Alignment</h3>
            <p className={styles.featDesc}>
              Set a race date and the full schedule shifts automatically. Peak week always lands
              on race weekend. Works across multiple events in a single season.
            </p>
          </article>
          <article className={styles.featCard}>
            <div className={`${styles.featIcon} ${styles.featIconGreen}`}>👥</div>
            <h3 className={styles.featTitle}>Coach Sync</h3>
            <p className={styles.featDesc}>
              Coaches share plans with athletes, track weekly completion, and keep feedback
              in one place — no more chasing athletes across email and DMs.
            </p>
          </article>
        </div>
      </section>

      {/* ===== BOTTOM CTA ===== */}
      <div className={styles.bottomCtaOuter}>
        <div className={styles.bottomCta}>
          <div className={styles.ctaEyebrow}>Start today</div>
          <h2 className={styles.ctaTitle}>
            Your next race is already <em>waiting.</em>
          </h2>
          <p className={styles.ctaDesc}>
            Import your plan, set your race date, and make every workout in the build count.
          </p>
          <div className={styles.ctaButtons}>
            <Link href="/sign-up" className={styles.ctaMainLg}>Create free account →</Link>
            <Link href="/sign-in" className={styles.ctaSecLg}>Sign in</Link>
          </div>
          <p className={styles.ctaFootnote}>Free to start · No credit card required</p>
          <div className={styles.ctaStats}>
            <div>
              <div className={styles.ctaStatVal}><em>2</em> min</div>
              <div className={styles.ctaStatLabel}>PDF to structured plan</div>
            </div>
            <div>
              <div className={styles.ctaStatVal}>Auto</div>
              <div className={styles.ctaStatLabel}>Race-week alignment</div>
            </div>
            <div>
              <div className={styles.ctaStatVal}>Daily</div>
              <div className={styles.ctaStatLabel}>Execution tracking</div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== FOOTER ===== */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerTop}>
            <div>
              <div className={styles.footerBrandRow}>
                <div className={styles.footerLogo}>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1L13 12H1L7 1Z" fill="white" />
                  </svg>
                </div>
                <span className={styles.footerWordmark}>MyTrainingPlan</span>
              </div>
              <p className={styles.footerTagline}>
                Training plans as sharp as race day. Built for endurance athletes and coaches.
              </p>
            </div>
            <div className={styles.footerLinks}>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Product</div>
                <Link href="/#how-it-works">How it works</Link>
                <Link href="/#features">For coaches</Link>
                <Link href="/strava">Strava integration</Link>
              </div>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Account</div>
                <Link href="/sign-up">Create account</Link>
                <Link href="/sign-in">Sign in</Link>
              </div>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Legal</div>
                <Link href="/privacy">Privacy Policy</Link>
                <Link href="/terms">Terms of Service</Link>
              </div>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <span className={styles.footerCopy}>© {new Date().getFullYear()} mytrainingplan.io</span>
            <div className={styles.footerLegal}>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: 0 errors. If you see `Property 'heroVisual' does not exist` — add `.heroVisual {}` to page.module.css.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```
Expected: 0 errors or warnings on `page.tsx`. The `Image` import is removed — that is intentional (app mockup uses pure CSS/HTML, no `<Image>` needed).

- [ ] **Step 4: Visual verification — desktop**

Start dev server: `npm run dev` (runs on http://localhost:3001)

Open http://localhost:3001 in browser. Verify:
- [ ] Dark `#070c16` background — no white flash
- [ ] Sticky nav: logo mark + wordmark left, Sign in + Create account right
- [ ] Hero: left copy with orange eyebrow pill, headline with orange "race day.", orange CTA with glow
- [ ] Hero right: dark app frame showing 7-day week grid, green done days, orange active day, progress bar, Strava row
- [ ] Testimonial strip below hero: 3 quotes side by side
- [ ] How It Works: 3 steps connected by orange vertical line
- [ ] Features: 3 dark cards in a row, orange hover border
- [ ] Bottom CTA: dark card with orange glow, "Your next race is already waiting.", stats strip
- [ ] Footer: logo + tagline left, 3 link columns right

- [ ] **Step 5: Visual verification — mobile**

In browser DevTools, set viewport to 390px (iPhone 14).

Verify:
- [ ] Hero stacks: copy on top, app mockup below (full width)
- [ ] Social proof pills appear ("✓ Any PDF plan", "⚡ Race-aligned", "🔗 Strava sync")
- [ ] Desktop social proof text line is hidden
- [ ] Hero CTA buttons go full width at ≤480px
- [ ] Testimonials stack vertically (3 separate rows)
- [ ] How It Works steps render correctly at 48px step circles
- [ ] Feature cards stack to 1 column
- [ ] Bottom CTA: buttons go full width at ≤480px
- [ ] Footer: brand stacks above link columns

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/page.module.css
git commit -m "feat: full landing page redesign — dark premium, split hero, how it works, testimonials"
```

---

## Post-implementation follow-up tasks (separate work items)

These are out of scope for this plan but should be tracked:

1. **App week view reskin** — update `/plans/[id]` calendar and `/calendar` day cards to match the dark-card, colour-coded day states shown in the hero mockup
2. **Real testimonials** — replace the 3 placeholder quotes once real user feedback is collected
3. **Hero image** — consider replacing the static app mockup with a real screenshot of the running app once it matches the mockup design
