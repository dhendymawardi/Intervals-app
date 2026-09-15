# Intervals

A mobile-first learning app that teaches guitar scales and modes through **interval relationships** rather than fretboard shapes — Scale Families, Closest Relative, Parent Scale, Crossroads, By Chord, Compare, Quiz, and Audio Preview (V3.1).

Built with Next.js 14 (App Router), React, Tailwind CSS, and the Web Audio API. No backend, no database, no environment variables.

## QA / stability pass (this version)

This project has been through a production-readiness pass: no nested `<button>` elements anywhere (fixed via a `ClickableCard` helper — a `div` with button semantics — for the three spots that needed a clickable container around a real nested button), no React/ESLint warnings (`next lint` is clean), and a verified `npm install && npm run build && npm run start` cycle. See the changelog delivered alongside this project for the full list of fixes. No UI, UX, or functionality changed — this was a bug-fix-only pass.

## Project structure

```
app/
  layout.js       Root layout, fonts, metadata
  page.js         Renders the app
  globals.css     Tailwind layers + fonts + the audio pulse-ring animation
components/
  IntervalsApp.jsx  The entire app (client component)
```

`IntervalsApp.jsx` is a single client component ("use client") because it uses React state and the browser's Web Audio API (AudioContext) for the Audio Preview feature. Everything else is static — all scale, family, and chord data is hardcoded in that file, no fetching, no CMS.

## Local development

Requires Node.js 18.18+ (Next.js 14 requirement).

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Production build (sanity check before deploying)

```bash
npm run build
npm run start
```

This has already been run once during development of this project — `npm run build` completes cleanly and the app is statically prerendered (see the build output: `○ /` marked as Static).

## Deploying to Vercel

**Option A — Vercel CLI**
```bash
npm install -g vercel
vercel
```
Follow the prompts. Vercel auto-detects Next.js — no configuration needed.

**Option B — Git + Vercel dashboard**
1. Push this project to a GitHub/GitLab/Bitbucket repo.
2. Go to https://vercel.com/new and import the repo.
3. Framework Preset: **Next.js** (auto-detected). Build Command / Output Directory: leave as default.
4. Deploy. No environment variables are required.

## Notes on Audio Preview

- Uses the native Web Audio API only — no audio files, no external services.
- Audio only starts from a user gesture (a tap on a Play/Compare button), per browser autoplay policy — this is already how every control in the app is wired, so no special handling was needed.
- Nothing here requires HTTPS-only browser permissions (no mic/camera), so it works the same on Vercel's default deployment as it does locally.

## What's intentionally not included

Per the product scope this app was designed against: no fretboard/CAGED visualization, no MIDI input, no AI generation, no backing tracks, no login, no database. Layer 3 of Audio Preview ("Hear the Character" — short musical phrases per mode) is designed but not yet implemented; see the by-mode `closestRelative` / `crossroads` data in `IntervalsApp.jsx` for where that would hook in.
