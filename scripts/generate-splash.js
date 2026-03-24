#!/usr/bin/env node
/**
 * Generates all iOS/Android PWA splash screen PNGs from an HTML template.
 * Uses Playwright headless Chromium to render at exact pixel dimensions.
 *
 * Usage: node scripts/generate-splash.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SIZES = [
  { w: 640,  h: 1136 },
  { w: 750,  h: 1334 },
  { w: 828,  h: 1792 },
  { w: 1080, h: 2340 },
  { w: 1125, h: 2436 },
  { w: 1170, h: 2532 },
  { w: 1179, h: 2556 },
  { w: 1242, h: 2208 },
  { w: 1242, h: 2688 },
  { w: 1284, h: 2778 },
  { w: 1290, h: 2796 },
  { w: 1488, h: 2266 },
  { w: 1536, h: 2048 },
  { w: 2048, h: 2732 },
];

const OUT_DIR = path.join(__dirname, '../public/splash');

function buildHtml(w, h) {
  // Scale font/icon sizes relative to the narrower dimension so it looks
  // right on all screen sizes (small phones to large iPads).
  const base = Math.min(w, h);
  const iconSize   = Math.round(base * 0.18);
  const iconRadius = Math.round(iconSize * 0.25);
  const wordSize   = Math.round(base * 0.045);
  const tagSize    = Math.round(base * 0.022);
  const glowR      = Math.round(base * 0.28);

  // Bar heights (Mon–Sun workload pattern)
  const barHeights = [28, 55, 80, 42, 95, 18, 65]; // percent

  const bars = barHeights.map((pct) => {
    const bh = Math.round((h * 0.38) * (pct / 100));
    return `<rect x="0" y="${h - bh}" width="100%" height="${bh}" rx="${Math.round(base * 0.006)}"
      fill="url(#barGrad)"/>`;
  }).join('');

  const barW = Math.round(w / 7);
  const barGroups = barHeights.map((pct, i) => {
    const bh = Math.round((h * 0.38) * (pct / 100));
    const x = Math.round(i * barW + barW * 0.1);
    const bw = Math.round(barW * 0.72);
    return `<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="${Math.round(base * 0.006)}" fill="url(#barGrad)"/>`;
  }).join('\n');

  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);

  // Triangle icon vertices (centered)
  const triH = Math.round(iconSize * 0.55);
  const triW = Math.round(iconSize * 0.65);
  const t1x = cx, t1y = cy - triH;
  const t2x = cx + triW, t2y = cy + triH;
  const t3x = cx - triW, t3y = cy + triH;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: #070c16; }
  @import url('https://fonts.googleapis.com/css2?family=Figtree:wght@900&display=swap');
  * { font-family: 'Figtree', -apple-system, BlinkMacSystemFont, sans-serif; }
</style>
</head>
<body>
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- gradient for elevation fill (blue) -->
    <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#265ac8" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#265ac8" stop-opacity="0.02"/>
    </linearGradient>
    <!-- gradient for bars (orange) -->
    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fc4c02" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#fc4c02" stop-opacity="0.08"/>
    </linearGradient>
    <!-- icon gradient -->
    <linearGradient id="iconGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fc4c02"/>
      <stop offset="100%" stop-color="#c93600"/>
    </linearGradient>
    <!-- radial glow behind icon -->
    <radialGradient id="iconGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fc4c02" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#fc4c02" stop-opacity="0"/>
    </radialGradient>
    <!-- bottom orange ambient glow -->
    <radialGradient id="bottomGlow" cx="50%" cy="100%" r="60%">
      <stop offset="0%" stop-color="#fc4c02" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#fc4c02" stop-opacity="0"/>
    </radialGradient>
    <!-- top fade to dark -->
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#070c16" stop-opacity="1"/>
      <stop offset="100%" stop-color="#070c16" stop-opacity="0"/>
    </linearGradient>
    <!-- bottom fade to dark -->
    <linearGradient id="botFade" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#070c16" stop-opacity="1"/>
      <stop offset="35%" stop-color="#070c16" stop-opacity="0"/>
    </linearGradient>
    <!-- center vignette -->
    <radialGradient id="vignette" cx="50%" cy="50%" r="50%">
      <stop offset="25%" stop-color="#070c16" stop-opacity="0"/>
      <stop offset="100%" stop-color="#070c16" stop-opacity="0.65"/>
    </radialGradient>
    <!-- icon rounded rect clip -->
    <clipPath id="iconClip">
      <rect x="${cx - Math.round(iconSize/2)}" y="${cy - Math.round(iconSize/2)}"
            width="${iconSize}" height="${iconSize}" rx="${iconRadius}"/>
    </clipPath>
  </defs>

  <!-- Base background -->
  <rect width="${w}" height="${h}" fill="#070c16"/>

  <!-- Elevation profile (blue layer, back) -->
  <path d="M0 ${h * 0.9}
    Q${w*0.12} ${h*0.88} ${w*0.22} ${h*0.8}
    Q${w*0.33} ${h*0.72} ${w*0.42} ${h*0.65}
    Q${w*0.50} ${h*0.58} ${w*0.55} ${h*0.50}
    Q${w*0.62} ${h*0.40} ${w*0.68} ${h*0.34}
    Q${w*0.76} ${h*0.27} ${w*0.84} ${h*0.22}
    Q${w*0.92} ${h*0.17} ${w} ${h*0.14}
    L${w} ${h} L0 ${h} Z"
    fill="url(#elevGrad)" opacity="0.9"/>
  <!-- Elevation stroke line -->
  <path d="M0 ${h * 0.9}
    Q${w*0.12} ${h*0.88} ${w*0.22} ${h*0.8}
    Q${w*0.33} ${h*0.72} ${w*0.42} ${h*0.65}
    Q${w*0.50} ${h*0.58} ${w*0.55} ${h*0.50}
    Q${w*0.62} ${h*0.40} ${w*0.68} ${h*0.34}
    Q${w*0.76} ${h*0.27} ${w*0.84} ${h*0.22}
    Q${w*0.92} ${h*0.17} ${w} ${h*0.14}"
    fill="none" stroke="#265ac8" stroke-width="${Math.round(base*0.003)}" opacity="0.7"/>

  <!-- Weekly training bars (orange, in front of elevation) -->
  ${barGroups}

  <!-- Fades -->
  <rect width="${w}" height="${Math.round(h*0.52)}" fill="url(#topFade)"/>
  <rect y="${Math.round(h*0.72)}" width="${w}" height="${Math.round(h*0.28)}" fill="url(#botFade)"/>
  <rect width="${w}" height="${h}" fill="url(#vignette)"/>

  <!-- Bottom ambient orange glow -->
  <rect width="${w}" height="${h}" fill="url(#bottomGlow)"/>

  <!-- Icon glow halo -->
  <ellipse cx="${cx}" cy="${cy}" rx="${glowR}" ry="${glowR}"
    fill="url(#iconGlow)"/>

  <!-- Icon box background -->
  <rect x="${cx - Math.round(iconSize/2)}" y="${cy - Math.round(iconSize/2)}"
        width="${iconSize}" height="${iconSize}" rx="${iconRadius}"
        fill="url(#iconGrad)"/>

  <!-- Icon box shadow approximation (subtle darker rect behind) -->
  <rect x="${cx - Math.round(iconSize/2) + Math.round(base*0.005)}"
        y="${cy - Math.round(iconSize/2) + Math.round(base*0.015)}"
        width="${iconSize}" height="${iconSize}" rx="${iconRadius}"
        fill="rgba(0,0,0,0.3)" style="filter:blur(${Math.round(base*0.02)}px)"/>

  <!-- Triangle logo mark (re-drawn on top) -->
  <rect x="${cx - Math.round(iconSize/2)}" y="${cy - Math.round(iconSize/2)}"
        width="${iconSize}" height="${iconSize}" rx="${iconRadius}"
        fill="url(#iconGrad)"/>
  <polygon points="${t1x},${t1y} ${t2x},${t2y} ${t3x},${t3y}"
           fill="white" opacity="0.92"/>

  <!-- Wordmark -->
  <text x="${cx}" y="${cy + Math.round(iconSize/2) + Math.round(base*0.065)}"
        text-anchor="middle"
        font-family="Figtree, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
        font-size="${wordSize}" font-weight="900"
        letter-spacing="${Math.round(wordSize * -0.03)}px"
        fill="#f5f8ff">MyTrainingPlan</text>

  <!-- Tagline -->
  <text x="${cx}" y="${cy + Math.round(iconSize/2) + Math.round(base*0.1)}"
        text-anchor="middle"
        font-family="Figtree, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
        font-size="${tagSize}" font-weight="600"
        fill="#475569"
        letter-spacing="${Math.round(tagSize * 0.07)}px">TRAIN SMART · RACE READY</text>

</svg>
</body>
</html>`;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page    = await context.newPage();

  for (const { w, h } of SIZES) {
    const outPath = path.join(OUT_DIR, `splash-${w}x${h}.png`);
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(buildHtml(w, h), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200); // let fonts settle
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`✓ ${w}x${h} → ${path.basename(outPath)}`);
  }

  await browser.close();
  console.log('\nAll splash screens generated.');
})();
