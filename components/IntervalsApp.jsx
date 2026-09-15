"use client";

import React, { useState, useMemo, useEffect } from "react";
import { ChevronLeft, Home, Layers, GitCompare, Brain, Ear, ChevronRight, ArrowRight, Music2, Play, Pause } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  INTERVAL MATH                                                      */
/* ------------------------------------------------------------------ */

const BASE_SEMI = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
function semitoneOf(deg) {
  let i = 0,
    acc = 0;
  while (deg[i] === "b") {
    acc--;
    i++;
  }
  while (deg[i] === "#") {
    acc++;
    i++;
  }
  const n = parseInt(deg.slice(i), 10);
  return ((BASE_SEMI[n] + acc) % 12 + 12) % 12;
}
const semis = (formula) => formula.map(semitoneOf);
function describeChange(from, to) {
  const dir = semitoneOf(to) > semitoneOf(from) || (semitoneOf(to) === 0 && from !== "1") ? "raise" : "lower";
  return `${dir} the ${from} to ${to}`;
}

/* ------------------------------------------------------------------ */
/*  AUDIO ENGINE — V3.1 Audio Preview, Layers 1 & 2                     */
/*  One fixed root (C4) for every scale so any two scales heard back    */
/*  to back are genuinely comparable. Plain triangle "pluck" — the      */
/*  note content does the teaching, not the timbre.                    */
/* ------------------------------------------------------------------ */

const ROOT_FREQ = 261.63; // C4, fixed for all 21 modes
let audioCtx = null;
let scheduledNodes = [];
let scheduledTimeouts = [];
const stopListeners = new Set();

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function stopAllAudio() {
  scheduledNodes.forEach((n) => {
    try {
      n.stop();
    } catch (e) {}
  });
  scheduledNodes = [];
  scheduledTimeouts.forEach((id) => clearTimeout(id));
  scheduledTimeouts = [];
  stopListeners.forEach((fn) => fn());
}

const freqFor = (semi) => ROOT_FREQ * Math.pow(2, semi / 12);

function pluck(ctx, freq, startTime, dur = 0.4, peak = 0.2) {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + dur + 0.05);
  scheduledNodes.push(osc);
}

function drone(ctx, freq, startTime, dur, peak = 0.06) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.15);
  gain.gain.setValueAtTime(peak, Math.max(startTime + 0.15, startTime + dur - 0.15));
  gain.gain.linearRampToValueAtTime(0.0001, startTime + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + dur + 0.05);
  scheduledNodes.push(osc);
}

// events: [{ time, freqs:[..], dur, highlight:[semis..], color, target, droneFreq, droneGain }]
function schedule(events, onActive) {
  stopAllAudio();
  const ctx = getCtx();
  const base = ctx.currentTime + 0.05;
  let endMs = 0;
  events.forEach((ev) => {
    const t = base + ev.time;
    (ev.freqs || []).forEach((f) => pluck(ctx, f, t, ev.dur ?? 0.4, ev.gain ?? 0.2));
    if (ev.droneFreq) drone(ctx, ev.droneFreq, t, ev.dur ?? 1.2, ev.droneGain);
    const ms = ev.time * 1000 + 60;
    const id = setTimeout(() => onActive(ev.highlight || [], ev.color, ev.target), ms);
    scheduledTimeouts.push(id);
    endMs = Math.max(endMs, ms + (ev.dur ?? 0.4) * 1000);
  });
  const id = setTimeout(() => onActive([], null, null), endMs + 150);
  scheduledTimeouts.push(id);
}

function scaleEvents(formula, startAt, step, color, changedSemis, target) {
  const s = semis(formula);
  const full = [...s, s[0] + 12];
  return full.map((semi, i) => ({
    time: startAt + i * step,
    freqs: [freqFor(semi)],
    dur: step * 1.1,
    highlight: [((semi % 12) + 12) % 12],
    color: changedSemis && changedSemis.has(((semi % 12) + 12) % 12) ? "#8C7CF0" : color,
    target,
  }));
}

function toggleEvents(startAt, fromDegs, toDegs, reps, gap, target) {
  const fromSemis = fromDegs.map(semitoneOf);
  const toSemis = toDegs.map(semitoneOf);
  const events = [];
  let t = startAt;
  const droneDur = reps * gap * 2 + 0.3;
  events.push({ time: t, freqs: [], dur: droneDur, droneFreq: freqFor(-12), droneGain: 0.06, highlight: [], target });
  for (let i = 0; i < reps; i++) {
    events.push({ time: t, freqs: fromSemis.map(freqFor), dur: gap * 0.9, highlight: fromSemis, color: "#5A5548", target });
    t += gap;
    events.push({ time: t, freqs: toSemis.map(freqFor), dur: gap * 0.9, highlight: toSemis, color: "#8C7CF0", target });
    t += gap;
  }
  return { events, endTime: t };
}

function playScaleFor(formula, onHighlight, changedSemis, target) {
  const events = scaleEvents(formula, 0.05, 0.32, target === "other" ? "#8A8272" : "#4FB6A6", changedSemis || null, target || "this");
  schedule(events, (h, c) => onHighlight(h, c));
  return events.length * 320 + 500;
}

function playCompareFor(otherFormula, thisFormula, changes, onHighlight) {
  const step = 0.3;
  const changedSemis = new Set(changes.map(([, to]) => semitoneOf(to)));
  const evA = scaleEvents(otherFormula, 0.1, step, "#8A8272", null, "other");
  const gap1 = 0.1 + (otherFormula.length + 1) * step + 0.4;
  const evB = scaleEvents(thisFormula, gap1, step, "#4FB6A6", changedSemis, "this");
  const gap2 = gap1 + (thisFormula.length + 1) * step + 0.5;
  const fromDegs = changes.map((c) => c[0]);
  const toDegs = changes.map((c) => c[1]);
  const { events: toggleEvs, endTime } = toggleEvents(gap2, fromDegs, toDegs, 3, 0.5, "this");
  schedule([...evA, ...evB, ...toggleEvs], (h, c, t) => onHighlight(h, c, t));
  return endTime * 1000 + 500;
}

function useStopReset(setActive) {
  useEffect(() => {
    const reset = () => setActive({ semis: [], color: null, target: null });
    stopListeners.add(reset);
    return () => stopListeners.delete(reset);
  }, [setActive]);
}

/* ------------------------------------------------------------------ */
/*  DATA                                                                */
/* ------------------------------------------------------------------ */

const FAMILIES = {
  major: {
    key: "major",
    name: "Major Scale Family",
    root: "Major Scale",
    blurb: "Seven modes, one set of notes. Each starts on a different degree of the Major scale — same pitches, different center of gravity.",
    modes: [
      { slug: "ionian", name: "Ionian (Major)", formula: ["1", "2", "3", "4", "5", "6", "7"], tier: "core",
        character: ["Bright", "Resolved", "Familiar"], chords: ["Maj7"], uses: ["Pop", "Folk", "Classical"],
        useWhen: "Use over a Imaj7 chord sitting still as the tonic — the default 'we've arrived' sound.",
        closestRelative: { other: "lydian", changes: [["#4", "4"]], effect: "Lowering Lydian's raised 4th grounds the scale — Ionian is what you get once that floating quality resolves back to earth." } },
      { slug: "dorian", name: "Dorian", formula: ["1", "2", "b3", "4", "5", "6", "b7"], tier: "core",
        character: ["Cool", "Groovy", "Bittersweet"], chords: ["m7", "m6"], uses: ["Jazz", "Funk", "Modal rock"],
        useWhen: "Use over a static m7 vamp, especially in jazz, funk, or modal rock — works even with no resolving V chord.",
        closestRelative: { other: "aeolian", changes: [["b6", "6"]], effect: "Raising Aeolian's 6th removes some of its heaviness — Dorian still sounds minor, but brighter and more optimistic." } },
      { slug: "phrygian", name: "Phrygian", formula: ["1", "b2", "b3", "4", "5", "b6", "b7"], tier: "core",
        character: ["Dark", "Exotic", "Spanish"], chords: ["m7", "7sus b9"], uses: ["Flamenco", "Metal", "Film"],
        useWhen: "Use over a m7 or sus chord where you want a dark, Spanish or Middle-Eastern edge.",
        closestRelative: { other: "aeolian", changes: [["2", "b2"]], effect: "Lowering Aeolian's 2nd right next to the root adds a sharp, unresolved edge Natural Minor doesn't have." } },
      { slug: "lydian", name: "Lydian", formula: ["1", "2", "3", "#4", "5", "6", "7"], tier: "core",
        character: ["Floating", "Dreamy", "Bright"], chords: ["Maj7", "Maj7#11"], uses: ["Film score", "Dream pop", "Fusion"],
        useWhen: "Use over a Maj7 chord you want to feel open and unresolved — a IVmaj7 in a major key, or under a cinematic pad.",
        closestRelative: { other: "ionian", changes: [["4", "#4"]], effect: "Raising Ionian's 4th removes Major's strongest pull toward the root, leaving a wide-open, cinematic quality." } },
      { slug: "mixolydian", name: "Mixolydian", formula: ["1", "2", "3", "4", "5", "6", "b7"], tier: "core",
        character: ["Relaxed", "Dominant", "Rootsy"], chords: ["7", "9", "13"], uses: ["Blues", "Rock", "Funk"],
        useWhen: "Use over any dominant 7 chord that isn't resolving yet — blues turnarounds, funk vamps, a V7 in a major key.",
        closestRelative: { other: "ionian", changes: [["7", "b7"]], effect: "Lowering Ionian's 7th removes its leading tone, trading resolution for groove." } },
      { slug: "aeolian", name: "Aeolian (Natural Minor)", formula: ["1", "2", "b3", "4", "5", "b6", "b7"], tier: "core",
        character: ["Dark", "Moody", "Unresolved"], chords: ["m7", "Maj7"], uses: ["Rock", "Pop", "Cinematic"],
        useWhen: "Use over a static m7 or m(add9) vamp in a minor key with no strong pull to resolve.",
        crossroads: [
          { slug: "dorian", changes: [["b6", "6"]] },
          { slug: "phrygian", changes: [["2", "b2"]] },
          { slug: "harmonic-minor", changes: [["b7", "7"]] },
        ] },
      { slug: "locrian", name: "Locrian", formula: ["1", "b2", "b3", "4", "b5", "b6", "b7"], tier: "core",
        character: ["Unstable", "Tense", "Rare"], chords: ["m7b5"], uses: ["Jazz ii–V passages", "Metal"],
        useWhen: "Use briefly over a m7b5 chord functioning as ii in a major-key ii–V–I — rarely held as a full tonal center.",
        closestRelative: { other: "phrygian", changes: [["5", "b5"]], effect: "Flattening Phrygian's 5th removes the last stable pillar of the scale — Locrian can't sit still as 'home' the way other modes can." } },
    ],
  },
  melodicMinor: {
    key: "melodicMinor",
    name: "Melodic Minor Family",
    root: "Melodic Minor",
    blurb: "Take Natural Minor and smooth out its climb by raising the 6th and 7th. Every mode below is a rotation of that one adjustment.",
    modes: [
      { slug: "melodic-minor", name: "Melodic Minor", formula: ["1", "2", "b3", "4", "5", "6", "7"], tier: "core",
        character: ["Dark", "Hopeful", "Modern"], chords: ["mMaj7", "m6"], uses: ["Jazz", "Fusion", "Film music"],
        useWhen: "Use over a minor tonic chord (mMaj7 or m6) at the end of a minor ii–V–i, for a smoother top end than Natural Minor.",
        closestRelative: { other: "harmonic-minor", changes: [["b6", "6"]], effect: "Melodic Minor and Harmonic Minor are actually one note apart — raise Harmonic Minor's b6 and the awkward step-and-a-half gap near the top disappears." } },
      { slug: "dorian-b2", name: "Dorian b2", formula: ["1", "b2", "b3", "4", "5", "6", "b7"], tier: "extended",
        character: ["Tense", "Exotic", "Moody"], chords: ["m7", "7susb9"], uses: ["Modal jazz", "Tension cues"],
        useWhen: "Use over a m7 (often sus) chord as the ii in a minor ii–V, when you want Phrygian-style tension without losing Dorian's brightness.",
        closestRelative: { other: "dorian", changes: [["2", "b2"]], effect: "Flattening Dorian's 2nd right above the root adds Phrygian-style tension to its brightness — a hybrid of two different minor colors." } },
      { slug: "lydian-augmented", name: "Lydian Augmented", formula: ["1", "2", "3", "#4", "#5", "6", "7"], tier: "extended",
        character: ["Shimmering", "Ethereal", "Unresolved"], chords: ["Maj7#5"], uses: ["Impressionist jazz", "Ambient"],
        useWhen: "Use over a Maj7#5 chord, usually a bIII or bVI in a minor-key context, for maximum floating tension.",
        closestRelative: { other: "lydian", changes: [["5", "#5"]], effect: "Raising Lydian's 5th on top of its floating #4 pushes an already-unresolved scale even further from home." } },
      { slug: "lydian-dominant", name: "Lydian Dominant", formula: ["1", "2", "3", "#4", "5", "6", "b7"], tier: "core",
        character: ["Bright", "Bold", "Hip"], chords: ["7#11", "9#11"], uses: ["Jazz", "Funk", "Fusion vamps"],
        useWhen: "Use over a dominant 7#11 chord — a non-resolving V7 in fusion, or a tritone-substitute dominant.",
        closestRelative: { other: "mixolydian", changes: [["4", "#4"]], effect: "Raising the 4th on top of Mixolydian adds tension above the dominant chord — a hallmark of modern jazz and fusion vamps." } },
      { slug: "mixolydian-b6", name: "Mixolydian b6", formula: ["1", "2", "3", "4", "5", "b6", "b7"], tier: "extended",
        character: ["Bittersweet", "Cinematic"], chords: ["7", "7b13"], uses: ["Film", "Latin jazz"],
        useWhen: "Use over a dominant 7 chord resolving to a minor tonic, when you want the dominant's groove with a minor-key shadow.",
        closestRelative: { other: "mixolydian", changes: [["6", "b6"]], effect: "Darkening Mixolydian's 6th adds a minor-key shadow over an otherwise groove-based dominant sound." } },
      { slug: "locrian-2", name: "Locrian #2", formula: ["1", "2", "b3", "4", "b5", "b6", "b7"], tier: "core",
        character: ["Suspended", "Introspective"], chords: ["m7b5"], uses: ["Jazz minor ii–V–i"],
        useWhen: "Use over a m7b5 chord as the ii in a minor ii–V–i — the standard choice ahead of resolving to minor.",
        closestRelative: { other: "locrian", changes: [["b2", "2"]], effect: "Restoring Locrian's 2nd gives it a usable center of gravity — the standard scale for minor ii–V progressions." } },
      { slug: "altered", name: "Altered (Super Locrian)", formula: ["1", "b2", "b3", "b4", "b5", "b6", "b7"], tier: "core",
        character: ["Tense", "Chromatic", "Outside"], chords: ["7alt"], uses: ["Bebop", "Modern jazz resolution"],
        useWhen: "Use over an altered dominant (7alt) resolving down a fifth to a minor tonic — built to maximize tension right before that resolution.",
        closestRelative: { other: "ultra-locrian", changes: [["bb7", "b7"]], effect: "Altered and Ultra Locrian differ by a single note — raise Ultra Locrian's diminished 7th and the tension eases slightly into the Altered scale." } },
    ],
  },
  harmonicMinor: {
    key: "harmonicMinor",
    name: "Harmonic Minor Family",
    root: "Harmonic Minor",
    blurb: "Natural Minor has no leading tone, so it never pulls hard to the root. Raise the b7 and it does — that one change powers every mode here.",
    modes: [
      { slug: "harmonic-minor", name: "Harmonic Minor", formula: ["1", "2", "b3", "4", "5", "b6", "7"], tier: "core",
        character: ["Exotic", "Tense", "Classical"], chords: ["mMaj7", "7", "dim7"], uses: ["Classical", "Metal", "Flamenco"],
        useWhen: "Use over the V7 in a minor key for a strong pull back to a minor tonic — or over the tonic mMaj7/m6 itself.",
        closestRelative: { other: "aeolian", changes: [["b7", "7"]], effect: "Raising just the 7th restores a leading tone — minor keys now get a proper dominant chord to resolve from." } },
      { slug: "locrian-nat6", name: "Locrian Natural 6", formula: ["1", "b2", "b3", "4", "b5", "6", "b7"], tier: "extended",
        character: ["Unusual", "Ambiguous"], chords: ["m7b5"], uses: ["Jazz minor ii–V", "Film"],
        useWhen: "Use over a m7b5 ii chord in a minor ii–V–i when you want a softer half-diminished color than plain Locrian.",
        closestRelative: { other: "locrian", changes: [["b6", "6"]], effect: "Restoring Locrian's 6th gives it just enough stability to function under half-diminished chords in a minor ii–V–i." } },
      { slug: "ionian-5", name: "Ionian #5", formula: ["1", "2", "3", "4", "#5", "6", "7"], tier: "extended",
        character: ["Lush", "Unsettled"], chords: ["Maj7#5"], uses: ["Modern jazz", "Classical"],
        useWhen: "Use sparingly over a Maj7#5 chord built on the bIII of a harmonic minor key.",
        closestRelative: { other: "ionian", changes: [["5", "#5"]], effect: "Raising Ionian's 5th adds a lush, unsettled shimmer without touching its otherwise resolved character." } },
      { slug: "dorian-4", name: "Dorian #4", formula: ["1", "2", "b3", "#4", "5", "6", "b7"], tier: "extended",
        character: ["Folky", "Exotic"], chords: ["m6", "m(maj7)"], uses: ["Klezmer", "Gypsy jazz"],
        useWhen: "Use over a m6 or m(maj7) chord for an Eastern-European, Klezmer-style folk color.",
        closestRelative: { other: "dorian", changes: [["4", "#4"]], effect: "Raising Dorian's 4th adds a sharp, exotic edge — the sound of Klezmer and Eastern-European folk fiddling." } },
      { slug: "phrygian-dominant", name: "Phrygian Dominant", formula: ["1", "b2", "3", "4", "5", "b6", "b7"], tier: "core",
        character: ["Fiery", "Flamenco", "Middle Eastern"], chords: ["7", "7b9"], uses: ["Flamenco", "Metal", "Middle Eastern styles"],
        useWhen: "Use over the V7 in a minor key, or a static Phrygian-flavored vamp, for flamenco or Middle-Eastern color.",
        closestRelative: { other: "phrygian", changes: [["b3", "3"]], effect: "Raising Phrygian's 3rd turns its minor darkness into a dominant chord sound — the defining color of flamenco." } },
      { slug: "lydian-2", name: "Lydian #2", formula: ["1", "#2", "3", "#4", "5", "6", "7"], tier: "extended",
        character: ["Bright", "Unusual"], chords: ["Maj7#11"], uses: ["Contemporary jazz"],
        useWhen: "Use sparingly over a Maj7#11 chord built on the bVI of a harmonic minor key.",
        closestRelative: { other: "lydian", changes: [["2", "#2"]], effect: "Raising Lydian's 2nd on top of its floating #4 pushes an already-bright scale into rarer territory." } },
      { slug: "ultra-locrian", name: "Ultra Locrian", formula: ["1", "b2", "b3", "b4", "b5", "b6", "bb7"], tier: "extended",
        character: ["Extremely tense", "Chromatic"], chords: ["dim7"], uses: ["Avant-garde jazz"],
        useWhen: "Use very sparingly over a dim7 or 7alt chord when you want maximum tension beyond even the Altered scale.",
        closestRelative: { other: "altered", changes: [["b7", "bb7"]], effect: "Lowering the Altered scale's 7th even further creates the darkest, most unstable sound in the entire system." } },
    ],
  },
};

const ALL_MODES = Object.values(FAMILIES).flatMap((f) => f.modes.map((m) => ({ ...m, familyKey: f.key })));
const findMode = (slug) => ALL_MODES.find((m) => m.slug === slug);
const familyOf = (slug) => Object.values(FAMILIES).find((f) => f.modes.some((m) => m.slug === slug));
const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100) - 20] || ["th", "st", "nd", "rd"][n % 100] || "th");

const EXTRA = {
  "pentatonic-major": { name: "Pentatonic Major", formula: ["1", "2", "3", "5", "6"] },
  "pentatonic-minor": { name: "Pentatonic Minor", formula: ["1", "b3", "4", "5", "b7"] },
  blues: { name: "Blues", formula: ["1", "b3", "4", "b5", "5", "b7"] },
};
function resolveScale(slug) {
  return findMode(slug) || EXTRA[slug];
}

const QUICK_COMPARES = [
  { a: "aeolian", b: "dorian", label: "Natural Minor vs Dorian" },
  { a: "aeolian", b: "melodic-minor", label: "Natural Minor vs Melodic Minor" },
  { a: "melodic-minor", b: "harmonic-minor", label: "Melodic Minor vs Harmonic Minor" },
  { a: "ionian", b: "lydian", label: "Major vs Lydian" },
  { a: "ionian", b: "mixolydian", label: "Major vs Mixolydian" },
  { a: "pentatonic-minor", b: "blues", label: "Pentatonic Minor vs Blues" },
  { a: "mixolydian", b: "lydian-dominant", label: "Mixolydian vs Lydian Dominant" },
];

const CHORD_QUALITIES = [
  { key: "maj7", label: "Maj7", sub: "Major tonic, resolved", match: ["Maj7"] },
  { key: "dom7", label: "7 / 9 / 13", sub: "Plain dominant, not resolving", match: ["7", "9", "13"] },
  { key: "m7", label: "m7 / m6", sub: "Static minor", match: ["m7", "m6"] },
  { key: "mmaj7", label: "mMaj7 / m(maj7)", sub: "Minor tonic, jazz", match: ["mMaj7", "m(maj7)"] },
  { key: "m7b5", label: "m7b5", sub: "Half-diminished, minor ii", match: ["m7b5"] },
  { key: "altdom", label: "7alt / 7b9 / 7b13", sub: "Altered dominant, resolving to minor", match: ["7alt", "7b9", "7b13"] },
  { key: "lyddom", label: "7#11 / 9#11", sub: "Lydian dominant color", match: ["7#11", "9#11"] },
  { key: "majsharp", label: "Maj7#11 / Maj7#5", sub: "Bright, unresolved tonic", match: ["Maj7#11", "Maj7#5"] },
  { key: "dim7", label: "dim7", sub: "Fully diminished", match: ["dim7"] },
];

/* ------------------------------------------------------------------ */
/*  DIFF / SUMMARY ENGINE (Compare screen)                              */
/* ------------------------------------------------------------------ */

function diffFormulas(a, b) {
  if (a.length === b.length) {
    const changes = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changes.push([a[i], b[i]]);
    return { type: "substitute", changes };
  }
  const aS = new Set(semis(a));
  const bS = new Set(semis(b));
  return { type: "addRemove", added: b.filter((d) => !aS.has(semitoneOf(d))), removed: a.filter((d) => !bS.has(semitoneOf(d))) };
}
function findCuratedEffect(slugA, slugB) {
  for (const slug of [slugA, slugB]) {
    const m = findMode(slug);
    if (m?.closestRelative && [m.closestRelative.other, slug].sort().join() === [slugA, slugB].sort().join()) return m.closestRelative.effect;
  }
  return null;
}
function summarize(scaleA, scaleB, slugA, slugB) {
  const curated = findCuratedEffect(slugA, slugB);
  if (curated) return curated;
  const d = diffFormulas(scaleA.formula, scaleB.formula);
  if (d.type === "substitute") {
    if (d.changes.length === 0) return `${scaleB.name} and ${scaleA.name} share the exact same intervals.`;
    return `${scaleB.name} changes the ${d.changes.map((c) => `${c[0]} → ${c[1]}`).join(" and ")} degree${d.changes.length > 1 ? "s" : ""} of ${scaleA.name}.`;
  }
  const bits = [];
  if (d.added.length) bits.push(`adds ${d.added.join(", ")}`);
  if (d.removed.length) bits.push(`removes ${d.removed.join(", ")}`);
  return `${scaleB.name} ${bits.join(" and ")} compared to ${scaleA.name}.`;
}

/* ------------------------------------------------------------------ */
/*  INTERVAL RULER — now with a pulsing "active" ring for playback      */
/* ------------------------------------------------------------------ */

function IntervalRuler({ formula, size = "md", diffAgainst = null, dim = false, activeSemitones = [], activeColor = null }) {
  const s = semis(formula);
  const diffSemis = new Set(diffAgainst ? semis(diffAgainst) : []);
  const W = 320;
  const H = size === "sm" ? 46 : 78;
  const pad = 14;
  const step = (W - pad * 2) / 11;
  const x = (i) => pad + i * step;
  const y = H - (size === "sm" ? 14 : 22);
  const labelY = size === "sm" ? y - 12 : y - 18;
  const r = size === "sm" ? 4.5 : 6.5;
  const active = dim ? "#5A5548" : "#4FB6A6";
  const changed = "#8C7CF0";
  const pairs = [];
  for (let i = 0; i < s.length - 1; i++) pairs.push([s[i], s[i + 1]]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: "block" }}>
      <line x1={x(0)} y1={y} x2={x(11)} y2={y} stroke="#2A2620" strokeWidth="1.5" />
      {Array.from({ length: 12 }).map((_, i) => (
        <line key={i} x1={x(i)} y1={y - 4} x2={x(i)} y2={y + 4} stroke="#2A2620" strokeWidth="1" />
      ))}
      {pairs.map(([a, b], i) => {
        const gap = b - a;
        return <line key={i} x1={x(a)} y1={y} x2={x(b)} y2={y} stroke={active} strokeWidth={size === "sm" ? 2 : 3} strokeDasharray={gap === 1 ? "3 3" : undefined} opacity={gap === 1 ? 0.6 : 1} />;
      })}
      {s.map((n, i) => {
        const isNew = diffAgainst && !diffSemis.has(n);
        const isRoot = formula[i] === "1";
        const isPlaying = activeSemitones.includes(n);
        return (
          <g key={i}>
            {isPlaying && <circle cx={x(n)} cy={y} r={r + 6} fill="none" stroke={activeColor || "#4FB6A6"} strokeWidth="2" className="pulse-ring" />}
            <circle cx={x(n)} cy={y} r={isRoot ? r + 1.5 : r} fill={isRoot ? "#F2EDE4" : isNew ? changed : active} stroke={isNew ? "#0E0D0C" : "none"} strokeWidth={isNew ? 2 : 0} />
            <text x={x(n)} y={labelY} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize={size === "sm" ? 10 : 12} fontWeight={isRoot ? 700 : 500} fill={isNew ? changed : isRoot ? "#F2EDE4" : "#B8AF9F"}>
              {formula[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  SHARED UI                                                          */
/* ------------------------------------------------------------------ */

function Tag({ children, tone = "teal" }) {
  const styles = tone === "teal" ? "bg-[#122421] text-[#4FB6A6] border-[#1F4A43]" : "bg-[#211D33] text-[#8C7CF0] border-[#3A3363]";
  return <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-medium border ${styles}`}>{children}</span>;
}
function TierBadge({ tier }) {
  return tier === "core" ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#4FB6A6] bg-[#122421] border border-[#1F4A43] rounded-full px-2 py-0.5">Core</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#8A7F72] bg-[#1A1712] border border-[#2A2620] rounded-full px-2 py-0.5">Extended</span>
  );
}
function ScreenHeader({ title, onBack, eyebrow, right }) {
  return (
    <div className="sticky top-0 z-10 bg-[#0E0D0C]/95 backdrop-blur border-b border-[#211E17] px-4 py-3.5 flex items-center gap-3">
      {onBack ? (
        <button onClick={onBack} className="p-1 -ml-1 text-[#B8AF9F] hover:text-[#F2EDE4] active:scale-95 transition">
          <ChevronLeft size={22} />
        </button>
      ) : (
        <div className="w-[22px]" />
      )}
      <div className="flex-1 min-w-0">
        {eyebrow && <p className="text-[10px] tracking-[0.14em] uppercase text-[#6B6459]">{eyebrow}</p>}
        <h1 className="text-[18px] text-[#F2EDE4] truncate font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{title}</h1>
      </div>
      {right}
    </div>
  );
}
function Section({ title, children, last }) {
  return (
    <div className={last ? "mb-2" : "mb-6"}>
      {title && <p className="text-[11px] tracking-[0.14em] uppercase text-[#6B6459] mb-2.5">{title}</p>}
      {children}
    </div>
  );
}

/* A click/keyboard-activatable card that is NOT a <button>. Used anywhere
   the card needs to contain a real interactive <button> of its own (e.g. a
   mini play control) — nesting <button> inside <button> is invalid HTML,
   gets corrected by the browser's parser, and causes a hydration mismatch
   since the corrected DOM no longer matches what React expects to attach
   to. This preserves identical appearance and click behavior, and adds
   proper keyboard activation (native buttons get this for free; divs
   don't), which the plain <button> version didn't have either. */
function ClickableCard({ onClick, className = "", children }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </div>
  );
}

/* Small pill play button — manages its own "playing" state via its own timer, */
/* not via the global stop signal, so starting one button doesn't immediately  */
/* flip its own indicator back off (only cuts audio from anything else). */
function MiniPlayButton({ label, onPlay, primary }) {
  const [playing, setPlaying] = useState(false);
  const handle = (e) => {
    e.stopPropagation();
    setPlaying(true);
    const total = onPlay();
    setTimeout(() => setPlaying(false), total);
  };
  return (
    <button onClick={handle} disabled={playing} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium border transition active:scale-95 disabled:opacity-60 ${primary ? "bg-[#211D33] border-[#3A3363] text-[#8C7CF0]" : "bg-[#122421] border-[#1F4A43] text-[#4FB6A6]"}`}>
      {playing ? <Pause size={12} /> : <Play size={12} />} {label}
    </button>
  );
}

/* Ruler + "Play Scale" button — Layer 1 */
function ScaleWithPlayer({ formula }) {
  const [active, setActive] = useState({ semis: [], color: null });
  useStopReset(setActive);
  const [playing, setPlaying] = useState(false);
  const handlePlay = () => {
    setPlaying(true);
    const total = playScaleFor(formula, (h, c) => setActive({ semis: h, color: c }), null, "this");
    setTimeout(() => setPlaying(false), total);
  };
  return (
    <div>
      <IntervalRuler formula={formula} activeSemitones={active.semis} activeColor={active.color} />
      <p className="text-center font-mono text-[15px] tracking-[0.25em] text-[#4FB6A6] mt-3 mb-4">{formula.join("  ")}</p>
      <button onClick={handlePlay} disabled={playing} className="mx-auto flex items-center gap-2 bg-[#122421] border border-[#1F4A43] text-[#4FB6A6] rounded-full px-4 py-2 text-[12.5px] font-medium active:scale-95 transition disabled:opacity-60">
        {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Playing…" : "Play Scale"}
      </button>
    </div>
  );
}

function RelationPanel({ otherName, otherFormula, thisFormula, changes, effect }) {
  const [active, setActive] = useState({ target: null, semis: [], color: null });
  useStopReset(setActive);
  const changedSemis = new Set(changes.map(([, to]) => semitoneOf(to)));
  return (
    <div className="bg-[#151209] border border-[#211E17] rounded-xl p-4">
      <p className="text-[12px] font-mono text-[#8A8272] mb-1">{otherName}</p>
      <IntervalRuler formula={otherFormula} size="sm" dim activeSemitones={active.target === "other" ? active.semis : []} activeColor={active.color} />
      <p className="text-center font-mono text-[11px] text-[#6B6459] mt-1">{otherFormula.join(" ")}</p>
      <div className="flex items-center justify-center my-2">
        <div className="w-px h-4 bg-[#3A362E]" />
      </div>
      <p className="text-[12px] font-mono text-[#4FB6A6] mb-1">This scale</p>
      <IntervalRuler formula={thisFormula} size="sm" diffAgainst={otherFormula} activeSemitones={active.target === "this" ? active.semis : []} activeColor={active.color} />
      <p className="text-center font-mono text-[11px] text-[#6B6459] mt-1">{thisFormula.join(" ")}</p>

      <div className="flex flex-wrap gap-2 mt-3.5">
        <MiniPlayButton label={otherName} onPlay={() => playScaleFor(otherFormula, (h, c) => setActive({ target: "other", semis: h, color: c }), null, "other")} />
        <MiniPlayButton label="This scale" onPlay={() => playScaleFor(thisFormula, (h, c) => setActive({ target: "this", semis: h, color: c }), changedSemis, "this")} />
        <MiniPlayButton primary label="Compare" onPlay={() => playCompareFor(otherFormula, thisFormula, changes, (h, c, t) => setActive({ target: t, semis: h, color: c }))} />
      </div>

      <div className="mt-3 pt-3 border-t border-[#211E17] flex flex-wrap gap-1.5">
        {changes.map(([f, t]) => (
          <Tag key={f + t} tone="violet">{f} → {t}</Tag>
        ))}
      </div>
      {effect && <p className="text-[13px] text-[#B8AF9F] leading-relaxed mt-3">{effect}</p>}
      <p className="text-[10.5px] text-[#6B6459] mt-3">Compare plays {otherName}, then this scale, then loops just the changed note against a low root so your ear can isolate it.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HOME                                                                */
/* ------------------------------------------------------------------ */

function HomeScreen({ onOpenMode, onGoFamilies, onGoCompare, onGoChord, onGoQuiz }) {
  const dorian = findMode("dorian");
  const other = findMode(dorian.closestRelative.other);
  return (
    <div className="pb-6">
      <div className="px-5 pt-8 pb-6">
        <p className="text-[11px] tracking-[0.18em] uppercase text-[#4FB6A6] font-medium mb-2">Intervals</p>
        <h1 className="text-[28px] leading-[1.15] text-[#F2EDE4] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
          Scales don&apos;t stand alone.
          <br />
          They relate.
        </h1>
        <p className="text-[14px] text-[#9C948A] leading-relaxed max-w-[36ch]">Every scale here is one interval change away from another. Now you can hear it, not just see it.</p>
      </div>

      <ClickableCard onClick={() => onOpenMode("dorian")} className="mx-5 mb-5 block w-[calc(100%-40px)] text-left bg-[#151209] border border-[#211E17] rounded-2xl p-5 active:scale-[0.99] transition">
        <p className="text-[11px] tracking-[0.14em] uppercase text-[#6B6459] mb-3">One change, new sound — tap Compare and listen</p>
        <RelationPanel otherName={other.name} otherFormula={other.formula} thisFormula={dorian.formula} changes={dorian.closestRelative.changes} effect={dorian.closestRelative.effect} />
      </ClickableCard>

      <div className="mx-5 mb-5 bg-[#122421] border border-[#1F4A43] rounded-xl p-4">
        <p className="text-[13px] text-[#DCEFEA] leading-relaxed">
          <span className="font-semibold">The families connect.</span> Natural Minor is a mode of Major — and the
          parent of both minor families. Raise its 7th and you get Harmonic Minor. Raise its 6th and 7th too and you
          get Melodic Minor. Those two are themselves only one note apart.
        </p>
      </div>

      <button onClick={onGoChord} className="mx-5 mb-8 block w-[calc(100%-40px)] text-left bg-[#211D33] border border-[#3A3363] rounded-xl p-4 active:scale-[0.98] transition">
        <div className="flex items-center gap-2 mb-1.5">
          <Music2 size={16} className="text-[#8C7CF0]" />
          <p className="text-[14px] font-semibold text-[#F2EDE4]">What should I play over this chord?</p>
        </div>
        <p className="text-[12px] text-[#B4A9D9] leading-snug">Pick a chord quality, get the scales that fit it — and why.</p>
      </button>

      <div className="px-5 mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-[#F2EDE4]">Scale Families</p>
        <button onClick={onGoFamilies} className="text-[12px] text-[#4FB6A6] flex items-center gap-0.5">
          Explore all <ChevronRight size={13} />
        </button>
      </div>
      <div className="px-5 space-y-2 mb-8">
        {Object.values(FAMILIES).map((f) => {
          const core = f.modes.filter((m) => m.tier === "core").length;
          const ext = f.modes.length - core;
          return (
            <button key={f.key} onClick={onGoFamilies} className="w-full flex items-center justify-between bg-[#151209] border border-[#211E17] rounded-xl px-4 py-3 active:scale-[0.98] transition">
              <div>
                <p className="text-[13.5px] font-semibold text-[#F2EDE4]">{f.name}</p>
                <p className="text-[11px] text-[#8A7F72] mt-0.5">
                  {core} core{ext ? ` · ${ext} extended` : ""}
                </p>
              </div>
              <ChevronRight size={16} className="text-[#6B6459]" />
            </button>
          );
        })}
      </div>

      <div className="px-5 grid grid-cols-2 gap-3 mb-3">
        <button onClick={onGoCompare} className="bg-[#151209] border border-[#211E17] rounded-xl p-4 text-left active:scale-[0.97] transition">
          <GitCompare size={18} className="text-[#4FB6A6] mb-3" />
          <p className="text-[14px] font-semibold text-[#F2EDE4] mb-1">Compare Scales</p>
          <p className="text-[11px] text-[#8A7F72] leading-snug">See and hear what separates two scales.</p>
        </button>
        <button onClick={onGoQuiz} className="bg-[#151209] border border-[#211E17] rounded-xl p-4 text-left active:scale-[0.97] transition">
          <Brain size={18} className="text-[#8C7CF0] mb-3" />
          <p className="text-[14px] font-semibold text-[#F2EDE4] mb-1">Interval Quiz</p>
          <p className="text-[11px] text-[#8A7F72] leading-snug">Change one degree — name what you get.</p>
        </button>
      </div>
      <div className="px-5">
        <div className="bg-[#131110] border border-dashed border-[#211E17] rounded-xl p-4 flex items-center gap-3 opacity-60">
          <Ear size={18} className="text-[#6B6459]" />
          <div>
            <p className="text-[13px] font-semibold text-[#B8AF9F]">Ear Training</p>
            <p className="text-[11px] text-[#6B6459]">Coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FAMILIES + FAMILY DETAIL                                            */
/* ------------------------------------------------------------------ */

function FamiliesScreen({ onOpenFamily }) {
  return (
    <div className="px-5 pt-6 pb-6 space-y-4">
      {Object.values(FAMILIES).map((f) => {
        const core = f.modes.filter((m) => m.tier === "core").length;
        return (
          <button key={f.key} onClick={() => onOpenFamily(f.key)} className="w-full text-left bg-[#151209] border border-[#211E17] rounded-2xl p-5 active:scale-[0.99] transition">
            <p className="text-[16px] font-semibold text-[#F2EDE4] mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{f.name}</p>
            <p className="text-[12.5px] text-[#8A7F72] leading-relaxed mb-4">{f.blurb}</p>
            <IntervalRuler formula={f.modes[0].formula} size="sm" />
            <p className="text-[11px] text-[#6B6459] mt-3">
              {core} core · {f.modes.length - core} extended · {f.modes.length} modes total
            </p>
          </button>
        );
      })}
    </div>
  );
}

function ChainNode({ m, i, onOpenMode }) {
  return (
    <button onClick={() => onOpenMode(m.slug)} className={`shrink-0 w-[132px] bg-[#151209] border rounded-xl p-3 text-left active:scale-95 transition ${m.tier === "extended" ? "border-[#211E17] opacity-70" : "border-[#211E17]"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] text-[#6B6459]">Mode {i + 1}</p>
        <TierBadge tier={m.tier} />
      </div>
      <p className="text-[13px] font-semibold text-[#F2EDE4] mb-2 leading-tight">{m.name}</p>
      <IntervalRuler formula={m.formula} size="sm" dim={m.tier === "extended"} />
    </button>
  );
}

function FamilyDetailScreen({ familyKey, onOpenMode }) {
  const f = FAMILIES[familyKey];
  return (
    <div className="pb-6">
      <div className="px-5 pt-5 pb-5">
        <p className="text-[13px] text-[#B8AF9F] leading-relaxed">{f.blurb}</p>
      </div>
      <div className="px-5 mb-2">
        <p className="text-[11px] tracking-[0.14em] uppercase text-[#6B6459] mb-3">The Chain</p>
        <div className="flex items-stretch gap-2 overflow-x-auto no-scrollbar pb-2">
          {f.modes.map((m, i) => (
            <React.Fragment key={m.slug}>
              <ChainNode m={m} i={i} onOpenMode={onOpenMode} />
              {i < f.modes.length - 1 && (
                <div className="flex items-center shrink-0">
                  <ArrowRight size={14} className="text-[#3A362E]" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="px-5 mt-4 space-y-3">
        {f.modes.map((m) => (
          <button key={m.slug} onClick={() => onOpenMode(m.slug)} className="w-full text-left bg-[#151209] border border-[#211E17] rounded-xl p-4 active:scale-[0.99] transition flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[14px] font-semibold text-[#F2EDE4]">{m.name}</p>
                <TierBadge tier={m.tier} />
              </div>
              <p className="text-[12px] text-[#8A7F72] truncate">{m.character.join(" · ")}</p>
            </div>
            <ChevronRight size={16} className="text-[#6B6459] shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MODE DETAIL                                                        */
/* ------------------------------------------------------------------ */

function CrossroadRow({ baseMode, targetSlug, changes, onOpen }) {
  const target = findMode(targetSlug);
  const [active, setActive] = useState({ semis: [], color: null });
  useStopReset(setActive);
  const [playing, setPlaying] = useState(false);
  const handlePlay = (e) => {
    e.stopPropagation();
    setPlaying(true);
    const total = playCompareFor(baseMode.formula, target.formula, changes, (h, c) => setActive({ semis: h, color: c }));
    setTimeout(() => setPlaying(false), total);
  };
  return (
    <ClickableCard onClick={() => onOpen(targetSlug)} className="w-full text-left bg-[#151209] border border-[#211E17] rounded-xl p-3.5 active:scale-[0.98] transition">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-semibold text-[#F2EDE4]">→ {target.name}</p>
        <div className="flex items-center gap-2">
          <Tag tone="violet">{changes[0][0]} → {changes[0][1]}</Tag>
          <button onClick={handlePlay} disabled={playing} className="p-1.5 rounded-full bg-[#122421] border border-[#1F4A43] text-[#4FB6A6] disabled:opacity-60">
            {playing ? <Pause size={11} /> : <Play size={11} />}
          </button>
        </div>
      </div>
      <IntervalRuler formula={target.formula} size="sm" diffAgainst={baseMode.formula} activeSemitones={active.semis} activeColor={active.color} />
    </ClickableCard>
  );
}

function ModeDetailScreen({ slug, onOpenMode, onCompare }) {
  const m = findMode(slug);
  if (!m) return null;
  const family = familyOf(slug);
  const isRoot = family.modes[0].slug === slug;
  const degree = family.modes.findIndex((x) => x.slug === slug) + 1;

  return (
    <div className="px-5 pt-6 pb-10">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[11px] tracking-[0.14em] uppercase text-[#6B6459]">{family.name}</p>
        <TierBadge tier={m.tier} />
      </div>
      <h2 className="text-[24px] text-[#F2EDE4] mb-5" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>{m.name}</h2>

      <div className="bg-[#151209] border border-[#211E17] rounded-2xl p-5 mb-6">
        <ScaleWithPlayer formula={m.formula} />
      </div>

      {m.crossroads ? (
        <Section title="Crossroads — One Note From Three Scales">
          <p className="text-[13px] text-[#B8AF9F] leading-relaxed mb-3">Natural Minor sits at the center of the whole system. Change just one note and you land in a different family entirely — tap ▶ on any row to hear it happen.</p>
          <div className="space-y-3">
            {m.crossroads.map((c) => (
              <CrossroadRow key={c.slug} baseMode={m} targetSlug={c.slug} changes={c.changes} onOpen={onOpenMode} />
            ))}
          </div>
        </Section>
      ) : (
        <Section title="Closest Relative">
          <RelationPanel
            otherName={findMode(m.closestRelative.other).name}
            otherFormula={findMode(m.closestRelative.other).formula}
            thisFormula={m.formula}
            changes={m.closestRelative.changes}
            effect={m.closestRelative.effect}
          />
        </Section>
      )}

      <Section title="Parent Scale">
        <div className="bg-[#151209] border border-[#211E17] rounded-xl p-4">
          {isRoot ? (
            <p className="text-[13px] text-[#B8AF9F] leading-relaxed">
              This is the root of the {family.name} — every other mode here is a rotation of these exact seven notes, just starting from a different degree.
            </p>
          ) : (
            <p className="text-[13px] text-[#B8AF9F] leading-relaxed">
              {m.name} is the <span className="text-[#F2EDE4] font-medium">{ordinal(degree)}</span> mode of{" "}
              <span className="text-[#F2EDE4] font-medium">{family.root}</span> — same seven notes, starting {ordinal(degree)} degree in.
            </p>
          )}
        </div>
      </Section>

      <Section title="When To Use It">
        <p className="text-[13.5px] text-[#B8AF9F] leading-relaxed">{m.useWhen}</p>
      </Section>

      <button onClick={() => onCompare(slug, m.closestRelative ? m.closestRelative.other : m.crossroads[0].slug)} className="w-full mb-6 flex items-center justify-center gap-2 bg-[#151209] border border-[#211E17] rounded-xl py-3 text-[13px] font-medium text-[#4FB6A6] active:scale-[0.98] transition">
        <GitCompare size={15} /> Compare with another scale
      </button>

      <Section title="Sound Character">
        <div className="flex flex-wrap gap-1.5">
          {m.character.map((c) => (
            <Tag key={c}>{c}</Tag>
          ))}
        </div>
      </Section>

      <Section title="Common Chords">
        <div className="flex flex-wrap gap-1.5">
          {m.chords.map((c) => (
            <span key={c} className="font-mono text-[13px] text-[#F2EDE4] bg-[#151209] border border-[#211E17] rounded-lg px-2.5 py-1">{c}</span>
          ))}
        </div>
      </Section>

      <Section title="Common Uses" last>
        <div className="flex flex-wrap gap-1.5">
          {m.uses.map((c) => (
            <Tag key={c} tone="violet">{c}</Tag>
          ))}
        </div>
      </Section>

      <div className="mt-2">
        <p className="text-[11px] tracking-[0.14em] uppercase text-[#6B6459] mb-3">Rest of {family.name}</p>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {family.modes.filter((x) => x.slug !== slug).map((x) => (
            <button key={x.slug} onClick={() => onOpenMode(x.slug)} className="shrink-0 bg-[#151209] border border-[#211E17] rounded-lg px-3.5 py-2.5 text-[12.5px] text-[#B8AF9F] active:scale-95 transition">
              {x.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  BY CHORD                                                            */
/* ------------------------------------------------------------------ */

function ByChordRow({ m, onOpenMode }) {
  const [active, setActive] = useState({ semis: [], color: null });
  useStopReset(setActive);
  const [playing, setPlaying] = useState(false);
  const handlePlay = (e) => {
    e.stopPropagation();
    setPlaying(true);
    const total = playScaleFor(m.formula, (h, c) => setActive({ semis: h, color: c }), null, "this");
    setTimeout(() => setPlaying(false), total);
  };
  return (
    <ClickableCard onClick={() => onOpenMode(m.slug)} className="w-full text-left bg-[#151209] border border-[#211E17] rounded-xl p-4 active:scale-[0.98] transition">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold text-[#F2EDE4]">{m.name}</p>
          <TierBadge tier={m.tier} />
        </div>
        <button onClick={handlePlay} disabled={playing} className="p-1.5 rounded-full bg-[#122421] border border-[#1F4A43] text-[#4FB6A6] disabled:opacity-60">
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
      </div>
      <IntervalRuler formula={m.formula} size="sm" dim={m.tier === "extended"} activeSemitones={active.semis} activeColor={active.color} />
      <p className="text-[12.5px] text-[#B8AF9F] leading-relaxed mt-2.5">{m.useWhen}</p>
    </ClickableCard>
  );
}

function ByChordScreen({ onOpenMode }) {
  const [quality, setQuality] = useState(null);
  const q = CHORD_QUALITIES.find((x) => x.key === quality);
  const matches = q ? ALL_MODES.filter((m) => m.chords.some((c) => q.match.includes(c))) : [];

  if (!q) {
    return (
      <div className="px-5 pt-6 pb-6">
        <p className="text-[13px] text-[#B8AF9F] leading-relaxed mb-5">Pick the chord you&apos;re looking at. We&apos;ll show which scales fit it, and why.</p>
        <div className="space-y-2.5">
          {CHORD_QUALITIES.map((c) => (
            <button key={c.key} onClick={() => setQuality(c.key)} className="w-full text-left bg-[#151209] border border-[#211E17] rounded-xl px-4 py-3.5 flex items-center justify-between active:scale-[0.98] transition">
              <div>
                <p className="font-mono text-[15px] text-[#F2EDE4] font-semibold">{c.label}</p>
                <p className="text-[11.5px] text-[#8A7F72] mt-0.5">{c.sub}</p>
              </div>
              <ChevronRight size={16} className="text-[#6B6459]" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-6 pb-6">
      <button onClick={() => setQuality(null)} className="text-[12px] text-[#4FB6A6] mb-4 flex items-center gap-1">
        <ChevronLeft size={14} /> All chord qualities
      </button>
      <p className="font-mono text-[20px] text-[#F2EDE4] font-semibold mb-1">{q.label}</p>
      <p className="text-[12.5px] text-[#8A7F72] mb-5">{q.sub}</p>
      <div className="space-y-3">
        {matches.map((m) => (
          <ByChordRow key={m.slug} m={m} onOpenMode={onOpenMode} />
        ))}
        {matches.length === 0 && <p className="text-[13px] text-[#6B6459]">No scales tagged for this quality yet.</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  COMPARE                                                             */
/* ------------------------------------------------------------------ */

function CompareScreen({ initialLeft, initialRight }) {
  const [left, setLeft] = useState(initialLeft || "aeolian");
  const [right, setRight] = useState(initialRight || "dorian");
  const scaleA = resolveScale(left);
  const scaleB = resolveScale(right);
  const [active, setActive] = useState({ target: null, semis: [], color: null });
  useStopReset(setActive);

  const diff = diffFormulas(scaleA.formula, scaleB.formula);
  const changes = diff.type === "substitute" ? diff.changes : null;

  return (
    <div className="px-5 pt-6 pb-10">
      <p className="text-[11px] tracking-[0.14em] uppercase text-[#6B6459] mb-3">Quick Comparisons</p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-4 mb-2">
        {QUICK_COMPARES.map((qc) => (
          <button key={qc.label} onClick={() => { setLeft(qc.a); setRight(qc.b); }} className={`shrink-0 rounded-full px-3.5 py-2 text-[12px] border transition ${left === qc.a && right === qc.b ? "bg-[#122421] border-[#1F4A43] text-[#4FB6A6]" : "bg-[#151209] border-[#211E17] text-[#B8AF9F]"}`}>
            {qc.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <PickerButton value={left} onChange={setLeft} exclude={right} label="Scale A" />
        <PickerButton value={right} onChange={setRight} exclude={left} label="Scale B" />
      </div>

      <div className="bg-[#151209] border border-[#211E17] rounded-2xl p-5 mb-5">
        <p className="text-[12px] font-mono text-[#8A7F72] mb-2">{scaleA.name}</p>
        <IntervalRuler formula={scaleA.formula} dim activeSemitones={active.target === "other" ? active.semis : []} activeColor={active.color} />
        <p className="text-center font-mono text-[13px] text-[#8A7F72] mt-2 tracking-[0.2em]">{scaleA.formula.join("  ")}</p>
        <div className="my-4 h-px bg-[#211E17]" />
        <p className="text-[12px] font-mono text-[#4FB6A6] mb-2">{scaleB.name}</p>
        <IntervalRuler formula={scaleB.formula} diffAgainst={scaleA.formula} activeSemitones={active.target === "this" ? active.semis : []} activeColor={active.color} />
        <p className="text-center font-mono text-[13px] mt-2 tracking-[0.2em]">
          {scaleB.formula.map((d, i) => (
            <span key={i} className={semis(scaleA.formula).includes(semitoneOf(d)) ? "text-[#4FB6A6]" : "text-[#8C7CF0]"}>
              {d}
              {i < scaleB.formula.length - 1 ? "  " : ""}
            </span>
          ))}
        </p>

        <div className="flex flex-wrap gap-2 mt-4">
          <MiniPlayButton label={scaleA.name} onPlay={() => playScaleFor(scaleA.formula, (h, c) => setActive({ target: "other", semis: h, color: c }), null, "other")} />
          <MiniPlayButton label={scaleB.name} onPlay={() => playScaleFor(scaleB.formula, (h, c) => setActive({ target: "this", semis: h, color: c }), changes ? new Set(changes.map((c) => semitoneOf(c[1]))) : null, "this")} />
          {changes && changes.length > 0 && (
            <MiniPlayButton primary label="Compare" onPlay={() => playCompareFor(scaleA.formula, scaleB.formula, changes, (h, c, t) => setActive({ target: t, semis: h, color: c }))} />
          )}
        </div>
      </div>

      <div className="bg-[#122421] border border-[#1F4A43] rounded-xl p-4">
        <p className="text-[13px] text-[#DCEFEA] leading-relaxed">{summarize(scaleA, scaleB, left, right)}</p>
      </div>
    </div>
  );
}

function PickerButton({ value, onChange, exclude, label }) {
  const [open, setOpen] = useState(false);
  const scale = resolveScale(value);
  const options = [...ALL_MODES.map((m) => ({ slug: m.slug, name: m.name })), ...Object.entries(EXTRA).map(([slug, v]) => ({ slug, name: v.name }))];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="w-full bg-[#151209] border border-[#211E17] rounded-xl px-3.5 py-3 text-left active:scale-[0.98] transition">
        <p className="text-[10px] uppercase tracking-wider text-[#6B6459] mb-0.5">{label}</p>
        <p className="text-[13.5px] font-semibold text-[#F2EDE4] truncate">{scale.name}</p>
      </button>
      {open && (
        <div className="absolute z-20 top-full mt-1.5 left-0 right-0 bg-[#1A1712] border border-[#211E17] rounded-xl shadow-xl max-h-64 overflow-y-auto">
          {options.filter((s) => s.slug !== exclude).map((s) => (
            <button key={s.slug} onClick={() => { onChange(s.slug); setOpen(false); }} className={`w-full text-left px-3.5 py-2.5 text-[13px] hover:bg-[#211E17] transition ${s.slug === value ? "text-[#4FB6A6]" : "text-[#B8AF9F]"}`}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  QUIZ                                                                */
/* ------------------------------------------------------------------ */

function buildQuizPool() {
  return ALL_MODES.map((m) => {
    const rel = m.closestRelative || { other: m.crossroads[0].slug, changes: m.crossroads[0].changes };
    const base = findMode(rel.other);
    const [from, to] = rel.changes[0];
    const distractSlugs = ALL_MODES.map((x) => x.slug).filter((s) => s !== m.slug && s !== base.slug);
    return { baseSlug: base.slug, change: describeChange(from, to), answerSlug: m.slug, distractSlugs };
  });
}
const QUIZ_POOL = buildQuizPool();

function QuizScreen() {
  const questions = useMemo(() => {
    const shuffled = [...QUIZ_POOL].sort(() => Math.random() - 0.5).slice(0, 6);
    return shuffled.map((q) => {
      const base = findMode(q.baseSlug);
      const answer = findMode(q.answerSlug);
      const distractors = [...q.distractSlugs].sort(() => Math.random() - 0.5).slice(0, 3).map((s) => findMode(s).name);
      const options = [answer.name, ...distractors].sort(() => Math.random() - 0.5);
      return { base, change: q.change, correct: answer.name, options };
    });
  }, []);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState(null);
  const [active, setActive] = useState({ semis: [], color: null });
  useStopReset(setActive);

  if (i >= questions.length) {
    return (
      <div className="px-5 pt-16 text-center">
        <p className="text-[13px] uppercase tracking-widest text-[#6B6459] mb-3">Quiz Complete</p>
        <p className="text-[40px] text-[#F2EDE4] mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>{score}/{questions.length}</p>
        <p className="text-[13px] text-[#8A7F72]">{score === questions.length ? "Perfect — you're thinking in relationships now." : "Revisit the family chains for the ones you missed."}</p>
      </div>
    );
  }

  const q = questions[i];
  return (
    <div className="px-5 pt-8">
      <p className="text-[11px] uppercase tracking-widest text-[#6B6459] mb-4">Question {i + 1} of {questions.length}</p>
      <div className="bg-[#151209] border border-[#211E17] rounded-xl p-4 mb-5">
        <p className="text-[12px] font-mono text-[#8A7F72] mb-1">{q.base.name}</p>
        <IntervalRuler formula={q.base.formula} size="sm" dim activeSemitones={active.semis} activeColor={active.color} />
        <p className="text-center font-mono text-[11px] text-[#6B6459] mt-1">{q.base.formula.join(" ")}</p>
        <div className="flex justify-center mt-2.5">
          <MiniPlayButton label="Play it" onPlay={() => playScaleFor(q.base.formula, (h, c) => setActive({ semis: h, color: c }), null, "this")} />
        </div>
      </div>
      <h2 className="text-[18px] text-[#F2EDE4] mb-6 leading-snug" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>If we {q.change}, what do we get?</h2>
      <div className="space-y-3">
        {q.options.map((opt) => {
          const isCorrect = opt === q.correct;
          const show = picked !== null;
          return (
            <button key={opt} disabled={picked !== null} onClick={() => { setPicked(opt); if (isCorrect) setScore((s) => s + 1); }} className={`w-full text-left border rounded-xl px-4 py-3.5 text-[14px] transition ${show ? (isCorrect ? "border-[#1F4A43] bg-[#122421] text-[#DCEFEA]" : opt === picked ? "border-[#5A3A63] bg-[#241726] text-[#E8C9EC]" : "border-[#211E17] text-[#6B6459]") : "border-[#211E17] bg-[#151209] text-[#F2EDE4] active:scale-[0.98]"}`}>
              {opt}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <button onClick={() => { setI((n) => n + 1); setPicked(null); }} className="mt-6 w-full bg-[#4FB6A6] text-[#0E1E1B] font-semibold rounded-xl py-3.5 text-[14px] active:scale-[0.98] transition">
          {i + 1 < questions.length ? "Next question" : "See results"}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  APP SHELL                                                          */
/* ------------------------------------------------------------------ */

const NAV = [
  { key: "home", label: "Home", icon: Home },
  { key: "families", label: "Families", icon: Layers },
  { key: "chord", label: "By Chord", icon: Music2 },
  { key: "quiz", label: "Quiz", icon: Brain },
];

export default function IntervalsApp() {
  const [tab, setTab] = useState("home");
  const [modeSlug, setModeSlug] = useState(null);
  const [familyKey, setFamilyKey] = useState(null);
  const [compareState, setCompareState] = useState(null);
  const [quizKey, setQuizKey] = useState(0);

  const openMode = (slug) => {
    setCompareState(null);
    setModeSlug(slug);
  };
  const openFamily = (key) => {
    setModeSlug(null);
    setCompareState(null);
    setFamilyKey(key);
  };
  const openCompare = (l, r) => setCompareState({ left: l, right: r });

  const goTab = (key) => {
    stopAllAudio();
    setModeSlug(null);
    setFamilyKey(null);
    setCompareState(null);
    if (key === "quiz") setQuizKey((k) => k + 1);
    setTab(key);
  };

  const titles = { home: "Intervals", families: "Scale Families", chord: "By Chord", quiz: "Interval Quiz" };

  let header, content;
  if (compareState) {
    header = <ScreenHeader title="Compare Scales" onBack={() => { stopAllAudio(); setCompareState(null); }} />;
    content = <CompareScreen initialLeft={compareState.left} initialRight={compareState.right} />;
  } else if (modeSlug) {
    const m = findMode(modeSlug);
    header = <ScreenHeader title={m.name} eyebrow={familyOf(modeSlug).name} onBack={() => { stopAllAudio(); setModeSlug(null); }} />;
    content = <ModeDetailScreen slug={modeSlug} onOpenMode={openMode} onCompare={openCompare} />;
  } else if (familyKey) {
    header = <ScreenHeader title={FAMILIES[familyKey].name} onBack={() => { stopAllAudio(); setFamilyKey(null); }} />;
    content = <FamilyDetailScreen familyKey={familyKey} onOpenMode={openMode} />;
  } else {
    header = tab !== "home" ? <ScreenHeader title={titles[tab]} /> : null;
    content =
      tab === "home" ? (
        <HomeScreen onOpenMode={openMode} onGoFamilies={() => goTab("families")} onGoCompare={() => openCompare("aeolian", "dorian")} onGoChord={() => goTab("chord")} onGoQuiz={() => goTab("quiz")} />
      ) : tab === "families" ? (
        <FamiliesScreen onOpenFamily={openFamily} />
      ) : tab === "chord" ? (
        <ByChordScreen onOpenMode={openMode} />
      ) : (
        <QuizScreen key={quizKey} />
      );
  }

  return (
    <div className="w-full h-full min-h-[100dvh] bg-[#0E0D0C] flex justify-center">
      <div className="w-full max-w-[420px] bg-[#0E0D0C] min-h-[100dvh] flex flex-col relative">
        {header}
        <div className="flex-1 overflow-y-auto">{content}</div>
        <div className="sticky bottom-0 bg-[#0E0D0C]/95 backdrop-blur border-t border-[#211E17] flex px-2 py-2">
          {NAV.map(({ key, label, icon: Icon }) => {
            const active = tab === key && !modeSlug && !familyKey && !compareState;
            return (
              <button key={key} onClick={() => goTab(key)} className="flex-1 flex flex-col items-center gap-1 py-1.5 rounded-lg">
                <Icon size={19} strokeWidth={2} color={active ? "#4FB6A6" : "#6B6459"} />
                <span className={`text-[10px] font-medium ${active ? "text-[#4FB6A6]" : "text-[#6B6459]"}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
