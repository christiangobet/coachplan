# Splash Screen Real Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-drawn SVG triangle placeholder in `scripts/generate-splash.js` with the real app icon (`public/icons/icon-512.png`), then regenerate all 14 splash PNGs.

**Architecture:** Read and base64-encode `icon-512.png` once at startup; embed it as a `data:image/png;base64,...` data URL inside each splash screen's SVG `<image>` element. Remove the orange box, shadow rect, and triangle polygon that were serving as the placeholder.

**Tech Stack:** Node.js, Playwright (headless Chromium), SVG

---

### Task 1: Embed the real icon in the splash generator

**Files:**
- Modify: `scripts/generate-splash.js`

- [ ] **Step 1: Add icon loading at the top of the script**

At the top of `scripts/generate-splash.js`, after the existing `const` declarations (after line 30), add:

```js
const ICON_DATA_URL = 'data:image/png;base64,' +
  fs.readFileSync(path.join(__dirname, '../public/icons/icon-512.png')).toString('base64');
```

- [ ] **Step 2: Remove the orange box, shadow, and triangle from `buildHtml()`**

In `buildHtml()`, remove the following blocks entirely:

1. The `iconGrad` gradient definition (lines 94–97):
```html
<!-- icon gradient -->
<linearGradient id="iconGrad" ...>...</linearGradient>
```

2. The `iconClip` clipPath definition (lines 124–127):
```html
<clipPath id="iconClip">...</clipPath>
```

3. The icon box shadow rect (lines 173–177):
```html
<!-- Icon box shadow approximation ... -->
<rect x="..." ... fill="rgba(0,0,0,0.3)" .../>
```

4. The first icon box background rect (lines 169–171):
```html
<!-- Icon box background -->
<rect x="..." ... fill="url(#iconGrad)"/>
```

5. The second icon box rect + triangle polygon (lines 180–184):
```html
<!-- Triangle logo mark (re-drawn on top) -->
<rect ... fill="url(#iconGrad)"/>
<polygon points="..." fill="white" opacity="0.92"/>
```

Also remove the unused `iconRadius` variable (line 38):
```js
const iconRadius = Math.round(iconSize * 0.25);
```

- [ ] **Step 3: Add the real icon `<image>` element in place of the removed elements**

After the `<!-- Icon glow halo -->` ellipse (currently around line 165), add:

```js
  <!-- Real app icon -->
  <image href="${ICON_DATA_URL}"
    x="${cx - Math.round(iconSize/2)}" y="${cy - Math.round(iconSize/2)}"
    width="${iconSize}" height="${iconSize}"/>
```

This goes inside the template literal in `buildHtml()`, replacing the removed blocks.

- [ ] **Step 4: Verify the script runs without errors (dry run)**

```bash
cd /Users/christiangobet/CODEX/coachplan
node -e "require('./scripts/generate-splash.js')" 2>&1 | head -5
```

Actually run it properly:
```bash
node scripts/generate-splash.js 2>&1 | head -20
```

Expected output: 14 lines like `✓ 640x1136 → splash-640x1136.png` followed by `All splash screens generated.`

- [ ] **Step 5: Visually verify one splash PNG**

Open one of the regenerated files to confirm the real icon appears:
```bash
open public/splash/splash-1179x2556.png
```

Confirm: the running shoe/clipboard icon is visible, centered, with no orange box behind it.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-splash.js public/splash/
git commit -m "feat: use real app icon on PWA splash screens

Replace hand-drawn SVG triangle with actual icon-512.png.
Icon floats freely on dark background with orange glow halo.
All 14 device sizes regenerated."
```
