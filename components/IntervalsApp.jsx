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
    color: changedSemis && changedSemis.has(((semi % 12) + 12) % 12) ? "#6D5CE7" : color,
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
    events.push({ time: t, freqs: fromSemis.map(freqFor), dur: gap * 0.9, highlight: fromSemis, color: "#78716C", target });
    t += gap;
    events.push({ time: t, freqs: toSemis.map(freqFor), dur: gap * 0.9, highlight: toSemis, color: "#6D5CE7", target });
    t += gap;
  }
  return { events, endTime: t };
}

function playScaleFor(formula, onHighlight, changedSemis, target) {
  const events = scaleEvents(formula, 0.05, 0.32, target === "other" ? "#78716C" : "#158073", changedSemis || null, target || "this");
  schedule(events, (h, c) => onHighlight(h, c));
  return events.length * 320 + 500;
}

function playCompareFor(otherFormula, thisFormula, changes, onHighlight) {
  const step = 0.3;
  const changedSemis = new Set(changes.map(([, to]) => semitoneOf(to)));
  const evA = scaleEvents(otherFormula, 0.1, step, "#78716C", null, "other");
  const gap1 = 0.1 + (otherFormula.length + 1) * step + 0.4;
  const evB = scaleEvents(thisFormula, gap1, step, "#158073", changedSemis, "this");
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
        useWhen: "
