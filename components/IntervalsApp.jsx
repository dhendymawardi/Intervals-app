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
