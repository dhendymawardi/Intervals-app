# QA Pass Changelog

Scope: bug-fix only, as requested. No UI, UX, features, copy (visually), or design changed. All fixes verified against an actual `npm install && npm run build && npm run start` cycle, plus `next lint`, not just read through.

## 1. Nested `<button>` elements (real HTML-validity + hydration bug)

Found **3 instances** where a `<button>` contained one or more other `<button>` elements — invalid HTML. When the browser parses invalid nested buttons, it silently restructures the DOM (moves/closes the inner button early), which no longer matches the tree React expects to attach to during hydration — this is what would surface as a hydration error/warning in the browser console.

- **`components/IntervalsApp.jsx` — `HomeScreen`'s hero card** (the "One change, new sound" Dorian example). The whole card was a `<button>`, and it renders a `<RelationPanel>` internally, which itself renders **three** `<button>` elements (the "▶ Aeolian" / "▶ This scale" / "▶ Compare" controls). This was the worst instance — one button wrapping three others — and it was also a **functional** bug: tapping any of those three inner buttons would bubble the click up to the outer button and incorrectly navigate to the Dorian mode page instead of (or in addition to) playing audio.
- **`CrossroadRow`** (used on the Aeolian/Natural Minor "Crossroads" panel) — outer row button wrapped an inner ▶ play button.
- **`ByChordRow`** (used in the By Chord results list) — same pattern, outer row button wrapped an inner ▶ play button.

**Fix:** added a `ClickableCard` component — a `<div role="button" tabIndex={0} onClick={...} onKeyDown={...}>` — and used it in place of the outer `<button>` in all three spots. It looks and behaves identically to a button (same classes, same click behavior, `cursor-pointer` added since divs don't get that for free) and additionally supports keyboard activation (Enter/Space), which the previous nested-button version didn't reliably have either, since a `<button>` containing another `<button>` has undefined/broken keyboard behavior in the first place. The real inner `▶` control stays a genuine `<button>` in all three cases — no invalid nesting remains anywhere in the file (verified programmatically, see below).

**Also fixed the underlying bubbling bug:** `MiniPlayButton`'s click handler now calls `e.stopPropagation()`, so tapping ▶ inside the Home hero card plays audio only, without also triggering navigation. This was needed regardless of the HTML fix, since a `<div onClick>` still receives bubbled clicks from its children the same way a `<button>` would.

## 2. React/ESLint warnings

The project shipped without an ESLint config at all, so `next build`'s lint step was silently skipped and nothing was ever actually checked. Added a standard `.eslintrc.json` (`next/core-web-vitals`) and the matching `eslint` / `eslint-config-next` devDependencies, then fixed everything it flagged:

- **`react-hooks/exhaustive-deps` warning** in `useStopReset` — the internal `useEffect` used `setActive` without listing it as a dependency. Added it to the dependency array. (This setter is stable across renders, as all `useState` setters are, so this doesn't change behavior — it satisfies the lint rule correctly rather than suppressing it.)
- **`react/no-unescaped-entities` errors (×3)** — raw apostrophes in JSX text (`don't`, `you're`, `We'll`) are technically invalid JSX text content per this rule. Replaced with `&apos;`, which renders as the exact same character (`'`) — zero visual change, confirmed by re-running the build.

`next lint` now reports **zero warnings or errors**.

## 3. Syntax error "currently preventing compilation"

Could not reproduce this against the delivered project — `npm run build` completed successfully both before and after the fixes above, with no syntax errors at any point. Flagging this rather than silently dropping it: if this was seen locally, it's most likely either (a) a stale `.next` cache (this build was always run from a clean directory with `.next` removed first) or (b) a Node.js version mismatch — this project requires **Node 18.18+** for Next.js 14. If it recurs, the exact Node version and full error output would help track it down.

## 4. Security advisory on the pinned Next.js version

While re-verifying dependencies, `npm audit` flagged several advisories against the Next.js 14.2.x line (the version pinned in this project, 14.2.35, is the latest patch release in that line — there is no newer 14.x that resolves these). The fix path `npm audit` proposes is a jump to Next.js 16, a major version upgrade.

**This was deliberately not done in this pass** — a major framework version bump is exactly the kind of change that can break things and falls outside "bug-fix only, no redesign." Flagging it as a follow-up item rather than making that call unilaterally. See Known Issues below.

## What was verified, and how

- `rm -rf node_modules .next && npm install && npm run build` — clean install, build succeeds, static prerender of `/` confirmed in build output.
- `next lint` — zero warnings/errors.
- `npm run start` — production server starts, responds `HTTP 200`, server log shows no runtime errors.
- Programmatically scanned the **actual server-rendered HTML** (not just the source) for nested `<button>` tags — max nesting depth is 1 (i.e., none) across all 14 buttons rendered on the initial page.
- Diffed the fixed file against the originally-delivered file line-by-line to confirm the changes are scoped to exactly what's listed above — no data, styling, copy (beyond the two invisible entity escapes), or audio-engine code was touched.
- Could not launch a real browser in this environment to visually confirm zero browser-console hydration warnings — see Known Issues.

## Known issues / follow-ups (not fixed in this pass, by design)

1. **Next.js dependency advisories** (see #4 above) — resolving requires a major-version upgrade (14 → 16), which is a larger change than this pass's scope. Recommend as a separate, deliberate upgrade task with its own testing pass, since Next 16 can involve breaking changes.
2. **No real browser was used to confirm hydration is warning-free.** Verification here was: (a) eliminating every nested-button instance at the source level, confirmed via a comment-aware structural scan of the file; (b) confirming the actual server-rendered HTML sent to the browser has zero nested buttons; (c) confirming no non-deterministic or browser-only APIs (`Math.random()`, `window.*`) run during the initial render path (they're all safely inside event handlers or components that only mount after a user click, post-hydration). This is strong indirect evidence the hydration mismatch is resolved, since nested-button DOM correction was the only identified source of one — but it isn't the same as watching a live browser console. If you have the means to load the deployed preview and check DevTools console, that's the last mile of confirmation.
3. **`npm install` prints deprecation warnings** (`inflight`, `rimraf`, `glob`, and `eslint@8.57.1` itself being past EOL) — these come from ESLint 8's own dependency tree, a dev-only dependency that never ships in the production bundle. ESLint 9 exists but isn't yet compatible with `next lint`'s options handling in Next 14 (confirmed by trying it directly). Not a runtime issue; noted for completeness.
