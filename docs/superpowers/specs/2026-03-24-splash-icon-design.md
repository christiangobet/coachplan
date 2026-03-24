# Spec: Use Real App Icon on PWA Splash Screens

**Date:** 2026-03-24
**Status:** Approved

## Problem

The splash screen generator (`scripts/generate-splash.js`) draws a hand-made SVG triangle as the icon mark. The actual app icon (`public/icons/icon-512.png`) — a clipboard with checklist and running shoe — is never shown on the splash screen, creating a disconnect between the app icon users see on their home screen and the splash screen shown at launch.

## Solution

Embed the real app icon (`icon-512.png`) as a floating image in place of the drawn triangle and its orange box.

## Design

### What changes in `scripts/generate-splash.js`

**Remove:**
- `iconGrad` linear gradient (orange box fill)
- Shadow rect behind the icon box
- Icon box `<rect>` (the orange rounded rectangle)
- `iconClip` clipPath
- Triangle `<polygon>`

**Add:**
- At script startup: read `public/icons/icon-512.png` with `fs.readFileSync`, base64-encode it, store as `ICON_DATA_URL`
- In `buildHtml()`: replace the removed elements with a single SVG `<image>` element:
  - `href`: the base64 data URL
  - Position: centered at `(cx - iconSize/2, cy - iconSize/2)`
  - Size: `iconSize × iconSize` (unchanged — `base * 0.18`)

**Keep unchanged:**
- Background, elevation profile, training bars
- Orange radial glow halo behind the icon
- Wordmark and tagline
- All fades and vignette

### Why base64

`page.setContent()` in Playwright has no base URL, so relative file paths in SVG `<image href>` don't resolve. Base64 encoding the icon once at startup and embedding it as a data URL is the simplest reliable approach.

## Scope

Single file change: `scripts/generate-splash.js`
Then re-run `node scripts/generate-splash.js` to regenerate all 14 splash PNGs.
