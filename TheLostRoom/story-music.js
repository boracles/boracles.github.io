// The told story becomes a looping piece, in this browser: no speech recognition, no network, nothing saved.
// A port of the headset's StoryMusic. The speaker's intonation becomes the melody, their syllables ring as
// music-box notes, a few of their own phrases surface in their natural voice and melt into the chord. Their
// pitch, pace and dynamics choose the key, the harmonic pace and the balance of instruments.
// Runs as a Web Worker: postMessage({ voice: Float32Array at 16 kHz, melt }) → { samples, rate, summary } or { error }.

const SampleRate = 16000, Out = 22050;
const Hop = 320, Win = 512;
const PitchRate = SampleRate / 2, PitchHop = Hop / 2, PitchWin = Win / 2;
const Lively = [[50, 57, 61, 64, 66, 69, 73], [47, 54, 57, 61, 62, 66, 69], [43, 50, 54, 57, 59, 62, 66], [45, 52, 57, 59, 61, 64, 69]];
const Still = [[50, 57, 61, 64, 66, 69, 73], [43, 50, 54, 57, 59, 62, 66], [47, 54, 57, 61, 62, 66, 69], [43, 50, 54, 57, 59, 62, 66]];
const TableSize = 4096;
const MaxSeconds = 120, MinSeconds = 1.5;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = v => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const log2 = Math.log2;

function hann(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
  return w;
}
const Hann = hann(Win), PitchHann = hann(PitchWin);
const HumTable = (() => {
  const t = new Float32Array(TableSize + 1);
  for (let i = 0; i <= TableSize; i++) {
    const th = 2 * Math.PI * i / TableSize;
    t[i] = Math.sin(th) + 0.18 * Math.sin(2 * th) + 0.05 * Math.sin(3 * th);
  }
  return t;
})();

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[clamp(Math.round(q * (sorted.length - 1)), 0, sorted.length - 1)];
}
function peakOf(data) { let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i])); return peak; }
function scale(data, g) { for (let i = 0; i < data.length; i++) data[i] *= g; }
function normalize(data, to = 1) { const peak = peakOf(data); if (peak < 1e-9) return; scale(data, to / peak); }
function addNormalized(into, layer, gain) {
  const peak = peakOf(layer); if (peak < 1e-9) return;
  const g = gain / peak; for (let i = 0; i < into.length; i++) into[i] += layer[i] * g;
}

class Biquad {
  constructor(kind, freq, q, rate) {
    const w = 2 * Math.PI * freq / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
    let b0, b1, b2;
    if (kind === 'low') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
    else if (kind === 'high') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; }   // band-pass, 0 dB at the centre
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * cos / a0; this.a2 = (1 - alpha) / a0;
  }
  process(data) {
    const { b0, b1, b2, a1, a2 } = this;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < data.length; i++) {
      const x = data[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; data[i] = y;
    }
  }
}

// Freeverb-style room: parallel damped combs into series all-passes.
class Reverb {
  constructor(rate, feedback, damp) {
    const combTuning = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], passTuning = [556, 441, 341, 225];
    const s = rate / 44100;
    this.feedback = feedback; this.damp = damp;
    this.combs = combTuning.map(n => new Float32Array(Math.max(1, Math.round(n * s))));
    this.passes = passTuning.map(n => new Float32Array(Math.max(1, Math.round(n * s))));
    this.ci = new Int32Array(this.combs.length); this.pi = new Int32Array(this.passes.length);
    this.store = new Float32Array(this.combs.length);
  }
  tick(input) {
    const x = input * 0.015; let sum = 0;
    const { combs, passes, ci, pi, store, feedback, damp } = this;
    for (let i = 0; i < combs.length; i++) {
      const buf = combs[i], y = buf[ci[i]];
      store[i] = y * (1 - damp) + store[i] * damp;
      buf[ci[i]] = x + store[i] * feedback; if (++ci[i] >= buf.length) ci[i] = 0;
      sum += y;
    }
    for (let i = 0; i < passes.length; i++) {
      const buf = passes[i], b = buf[pi[i]];
      buf[pi[i]] = sum + b * 0.5; sum = b - sum; if (++pi[i] >= buf.length) pi[i] = 0;
    }
    return sum;
  }
}

// Too long: keep the fullest two-second stretches, in the order they were told. Too short: repeat it.
function fit(voice) {
  const max = MaxSeconds * SampleRate, min = MinSeconds * SampleRate;
  if (voice.length < min) {
    const longer = new Float32Array(min);
    for (let i = 0; i < min; i++) longer[i] = voice[i % voice.length];
    return longer;
  }
  if (voice.length <= max) return voice;
  const block = 2 * SampleRate, blocks = Math.floor(voice.length / block), keep = Math.floor(max / block);
  const loudness = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) { let e = 0; for (let i = b * block; i < (b + 1) * block; i++) e += voice[i] * voice[i]; loudness[b] = e; }
  const order = [...loudness.keys()].sort((a, b) => loudness[b] - loudness[a]);
  const chosen = new Uint8Array(blocks); for (let k = 0; k < keep; k++) chosen[order[k]] = 1;
  const fitted = new Float32Array(keep * block); let at = 0;
  for (let b = 0; b < blocks; b++) if (chosen[b]) { fitted.set(voice.subarray(b * block, (b + 1) * block), at); at += block; }
  return fitted;
}

// The fallback: a slow, quiet chord pad that swells where the voice was loud. Plain arithmetic, cannot fail.
function plain(voice) {
  const Seconds = 24, n = Math.floor(Seconds * Out), music = new Float32Array(n), chords = Still;
  const step = SampleRate / 10, steps = Math.max(1, Math.floor(voice.length / step));
  const envelope = new Float32Array(steps); let loudest = 1e-6;
  for (let s = 0; s < steps; s++) {
    let e = 0; for (let i = s * step; i < Math.min(voice.length, (s + 1) * step); i++) e += voice[i] * voice[i];
    envelope[s] = Math.sqrt(e / step); loudest = Math.max(loudest, envelope[s]);
  }
  for (let i = 0; i < n; i++) {
    const t = i / Out, chord = chords[Math.floor(t / (Seconds / chords.length)) % chords.length];
    const position = t / Seconds * (steps - 1), s0 = Math.floor(position), s1 = Math.min(steps - 1, s0 + 1);
    const level = lerp(envelope[s0], envelope[s1], position - s0) / loudest, swell = .35 + .65 * level;
    let sample = 0;
    for (let k = 0; k < 4; k++) sample += Math.sin(2 * Math.PI * hz(chord[k]) * t) * (k === 0 ? .5 : .3);
    const edge = Math.min(1, Math.min(t, Seconds - t) / 1.5);   // loops without a click
    music[i] = sample * .18 * swell * edge;
  }
  return music;
}

const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);

function compute(source, melt) {
  const x = Float32Array.from(source);
  const peak = peakOf(x);
  if (peak < 1e-4) throw new Error('The recording is silent.');
  scale(x, 1 / peak);
  new Biquad('high', 70, 0.707, SampleRate).process(x);
  const p = { voice: x, melt, onsets: [], phrases: [] };
  self.postMessage({progress:.08});
  p.chord = t => p.chords[Math.floor(t / p.chordSec) % p.chords.length];
  analyse(p); choose(p);
  self.postMessage({progress:.3});

  const total = Math.max(p.loopSec, x.length / SampleRate * p.stretch) + 6, n = Math.ceil(total * Out);
  const mix = new Float32Array(n), near = new Float32Array(n), far = new Float32Array(n);
  let layer = new Float32Array(n);
  pad(p, mix); scale(mix, 0.55);
  self.postMessage({progress:.45});
  hum(p, layer); addNormalized(near, layer, p.humGain); layer.fill(0);
  chimes(p, layer); addNormalized(near, layer, p.chimeGain); layer.fill(0);
  self.postMessage({progress:.65});
  phrases(p, layer, far); addNormalized(near, layer, 0.4);
  layer = null;
  normalize(far, 0.35);

  const room = new Reverb(Out, 0.80, 0.35), hall = new Reverb(Out, 0.90, 0.45);
  self.postMessage({progress:.8});
  for (let i = 0; i < n; i++) {
    const a = near[i], b = far[i];
    mix[i] += 0.6 * a + 0.4 * room.tick(a) + 0.3 * b + 0.7 * hall.tick(b);
  }
  // Fold everything past the loop back onto its start, so the tail flows into the beginning.
  const loop = Math.round(p.loopSec * Out), folded = new Float32Array(loop);
  for (let i = 0; i < n; i++) folded[i % loop] += mix[i];
  normalize(folded, 0.85);
  self.postMessage({progress:.98});
  // A folded reverb tail can leave a non-zero jump at the loop boundary.
  const edge = Math.min(Math.floor(Out / 50), Math.floor(folded.length / 2));
  for (let i = 0; i < edge; i++) {
    const gain = .5 - .5 * Math.cos(Math.PI * i / Math.max(1, edge - 1));
    folded[i] *= gain; folded[folded.length - 1 - i] *= gain;
  }
  const summary = `[StoryMusic] raw f0 ${p.medianHz.toFixed(0)}Hz spread ${p.spread.toFixed(2)}st rate ${p.rate.toFixed(2)}/s range ${p.range.toFixed(1)}dB pauses ${(p.pauses * 100).toFixed(0)}% | key ${p.transpose} st, chord ${p.chordSec.toFixed(1)}s, loop ${p.loopSec.toFixed(0)}s, stretch ${p.stretch.toFixed(2)}, onsets ${p.onsets.length}, phrases ${p.phrases.length}, chimes ${p.chimeGain.toFixed(2)}, hum ${p.humGain.toFixed(2)}, ${p.lively ? 'lively' : 'still'}`;
  return { samples: folded, summary };
}

// ---------- analysis: loudness, pitch, syllable onsets, phrases ----------
function analyse(p) {
  const x = p.voice;
  p.frames = Math.max(0, Math.floor((x.length - Win) / Hop));
  p.energy = new Float32Array(p.frames); p.pitch = new Float32Array(p.frames); p.env = new Float32Array(p.frames);
  for (let f = 0; f < p.frames; f++) {
    let e = 0; const o = f * Hop;
    for (let i = 0; i < Win; i++) { const v = x[o + i] * Hann[i]; e += v * v; }
    p.energy[f] = Math.sqrt(e / Win);
  }
  p.threshold = percentile(p.energy, 0.6);

  // Pitch only where someone is speaking, on an 8 kHz copy: a quarter of the work per frame.
  const low = Float32Array.from(x); new Biquad('low', 3400, 0.707, SampleRate).process(low);
  const y = new Float32Array(Math.floor(low.length / 2)); for (let i = 0; i < y.length; i++) y[i] = low[i * 2];
  const frame = new Float32Array(PitchWin);
  const minLag = Math.floor(PitchRate / 400), maxLag = Math.floor(PitchRate / 75);
  const corr = new Float32Array(maxLag + 2);
  for (let f = 0; f < p.frames; f++) {
    if (p.energy[f] < p.threshold) continue;
    const o = f * PitchHop; if (o + PitchWin > y.length) break;
    let e = 0;
    for (let i = 0; i < PitchWin; i++) { frame[i] = y[o + i] * PitchHann[i]; e += frame[i] * frame[i]; }
    if (e < 1e-8) continue;
    let bestLag = 0, best = 0;
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let acc = 0;
      for (let i = 0; i + lag < PitchWin; i++) acc += frame[i] * frame[i + lag];
      corr[Math.min(lag, corr.length - 1)] = acc;
      if (lag >= minLag && lag <= maxLag && acc > best) { best = acc; bestLag = lag; }
    }
    if (bestLag === 0 || best / e <= 0.45) continue;
    // Parabolic peak refinement: 8 kHz lags alone are too coarse for a sung line.
    const a = corr[bestLag - 1], b = corr[bestLag], c = corr[Math.min(bestLag + 1, corr.length - 1)];
    const d = a - 2 * b + c, shift = Math.abs(d) > 1e-12 ? 0.5 * (a - c) / d : 0;
    p.pitch[f] = PitchRate / (bestLag + clamp(shift, -0.5, 0.5));
  }

  for (let f = 0; f < p.frames; f++) {
    let sum = 0, count = 0;
    for (let k = -1; k <= 1; k++) if (f + k >= 0 && f + k < p.frames) { sum += p.energy[f + k]; count++; }
    p.env[f] = sum / count;
  }
  for (let f = 2; f < p.frames - 2; f++) {
    let before = 0, c = 0;
    for (let k = Math.max(0, f - 6); k < f; k++) { before += p.env[k]; c++; }
    before /= Math.max(1, c);
    if (p.env[f] > p.threshold * 1.2 && p.env[f] >= p.env[f - 1] && p.env[f] > p.env[f + 1] && p.env[f] > 1.25 * before)
      if (!p.onsets.length || f - p.onsets[p.onsets.length - 1] > 11) p.onsets.push(f);
  }
  // Phrases: speech runs separated by pauses over 0.3 s, 1.2-4.5 s long; the longest in each quarter.
  const spans = []; let start = -1, gap = 0;
  for (let f = 0; f < p.frames; f++) {
    if (p.env[f] > p.threshold * 0.8) { if (start < 0) start = f; gap = 0; }
    else if (start >= 0 && ++gap > 15) { spans.push([start, f - gap]); start = -1; }
  }
  if (start >= 0) spans.push([start, p.frames - 1]);
  const frameSec = Hop / SampleRate;
  for (let q = 0; q < 4; q++) {
    const lo = q * p.frames / 4, hi = (q + 1) * p.frames / 4; let pick = null;
    for (const s of spans) {
      const len = (s[1] - s[0]) * frameSec;
      if (s[0] < lo || s[0] >= hi || len < 1.2 || len > 4.5) continue;
      if (!pick || s[1] - s[0] > pick[1] - pick[0]) pick = s;
    }
    if (pick) p.phrases.push(pick);
  }
}

// ---------- the voice chooses the frame of the piece ----------
function choose(p) {
  const voiced = [], semis = [];
  for (const f of p.pitch) if (f > 0) { voiced.push(f); semis.push(12 * log2(f / 440)); }
  const median = voiced.length ? percentile(voiced, 0.5) : 160; p.medianHz = median;
  // The key follows the speaker's register, kept within a fifth of D.
  const t = Math.round(12 * log2(median / 146.83));
  p.transpose = ((t % 12) + 12) % 12; if (p.transpose > 6) p.transpose -= 12;
  // Expressive intonation gets the moving progression; a level voice gets a stiller one.
  let spread = 0;
  if (semis.length > 1) { let m = 0; for (const s of semis) m += s; m /= semis.length; for (const s of semis) spread += (s - m) * (s - m); spread = Math.sqrt(spread / semis.length); }
  p.spread = spread; p.lively = spread > 3;
  p.chords = (p.lively ? Lively : Still).map(chord => chord.map(n => n + p.transpose));
  // Fast, continuous talk turns the chords faster; slow, halting telling lets each chord stay longer.
  let active = 0; for (const e of p.env) if (e > p.threshold * 0.8) active++;
  const activeSec = Math.max(1, active * Hop / SampleRate);
  p.rate = p.onsets.length / activeSec; p.pauses = 1 - activeSec / (p.voice.length / SampleRate);
  const slowness = 0.5 * clamp01((4.5 - p.rate) / 2.5) + 0.5 * clamp01((p.pauses - 0.3) / 0.4);
  p.chordSec = 6 + 4 * slowness;
  p.loopSec = p.chordSec * 8;
  p.stretch = clamp(p.loopSec * 0.92 / (p.voice.length / SampleRate), 0.8, 1.6);
  // A voice with strong rises and falls gets brighter music-box accents; an even one leans on the hum.
  const loud = []; for (const e of p.env) if (e > p.threshold * 0.8) loud.push(e);
  p.range = loud.length > 4 ? 20 * Math.log10(percentile(loud, 0.9) / Math.max(1e-6, percentile(loud, 0.3))) : 8;
  const k01 = clamp01((p.range - 4) / 6);
  p.chimeGain = lerp(0.4, 0.7, k01); p.humGain = lerp(0.7, 0.45, k01);
}

// ---------- instruments (oscillators by rotation and table lookup, not per-sample sin) ----------
const frameTime = (p, f) => f * Hop / SampleRate * p.stretch;

function nearestChordTone(p, f0, t, low, high) {
  const m = 69 + 12 * log2(f0 / 440);
  const target = m + 12 * Math.round(((low + high) * 0.5 - m) / 12);
  const chord = p.chord(t); let best = low, bestD = Infinity;
  for (let c = low; c <= high; c++) {
    let tone = false; for (const n of chord) if (((n - c) % 12 + 12) % 12 === 0) { tone = true; break; }
    if (tone && Math.abs(c - target) < bestD) { bestD = Math.abs(c - target); best = c; }
  }
  return best;
}

function pad(p, o) {
  const seg = Math.round(p.chordSec * Out), fade = 3 * Out;
  for (let start = 0; start < o.length; start += seg) {
    const notes = p.chord(start / Out), length = Math.min(seg + fade, o.length - start);
    for (const note of notes) {
      const m = note < 57 + p.transpose ? note + 12 : note;    // lift the lowest voices: less muddy, less ominous
      const w = 1 / (1 + (m - 50) / 18), step = 2 * Math.PI * hz(m) / Out;
      const cs = Math.cos(step), sn = Math.sin(step); let re = 1, im = 0;
      for (let i = 0; i < length; i++) {
        let e;
        if (i < fade) { e = i / fade; e *= e; }
        else if (i >= seg) { e = 1 - (i - seg) / fade; e *= e; }
        else e = 1;
        const s = im, c = re;
        o[start + i] += (s + 0.3 * s * c) * w * e;           // sin + 0.15 sin 2θ
        const r = re * cs - im * sn; im = re * sn + im * cs; re = r;
      }
    }
  }
  new Biquad('low', 2800, 0.707, Out).process(o);
  normalize(o);
}

function hum(p, o) {
  // A soft ocarina sings the speaker's intonation, quantised to the chord, breathing with their loudness.
  const onsetSet = new Set(p.onsets);
  const freq = new Float32Array(p.frames), amp = new Float32Array(p.frames);
  let note = -1, last = hz(69 + p.transpose);
  for (let f = 0; f < p.frames; f++) {
    if (onsetSet.has(f)) note = -1;
    if (p.pitch[f] > 0 && note < 0) note = nearestChordTone(p, p.pitch[f], frameTime(p, f), 69 + p.transpose, 81 + p.transpose);
    if (note >= 0) last = hz(note);
    freq[f] = last; amp[f] = p.env[f];
  }
  const norm = Math.max(1e-6, percentile(amp, 0.98));
  for (let f = 0; f < p.frames; f++) amp[f] = Math.pow(clamp01(amp[f] / norm), 1.3);
  const glide = 1 - Math.exp(-1 / (0.025 * Out)), breathe = 1 - Math.exp(-1 / (0.06 * Out));
  let fNow = p.frames > 0 ? freq[0] : last, aNow = 0, phase = 0;
  const vs = Math.sin(2 * Math.PI * 4.8 / Out), vc = Math.cos(2 * Math.PI * 4.8 / Out); let vRe = 1, vIm = 0;
  const framesPerSample = SampleRate / Hop / (p.stretch * Out);
  for (let i = 0; i < o.length; i++) {
    const f = Math.floor(i * framesPerSample);
    const fTarget = f < p.frames ? freq[f] : fNow, aTarget = f < p.frames ? amp[f] : 0;
    fNow += (fTarget - fNow) * glide; aNow += (aTarget - aNow) * breathe;
    phase += fNow * (1 + 0.004 * vIm) / Out; if (phase >= 1) phase -= 1;
    const r = vRe * vc - vIm * vs; vIm = vRe * vs + vIm * vc; vRe = r;
    const idx = phase * TableSize, k = Math.floor(idx), frac = idx - k;
    o[i] = (HumTable[k] + (HumTable[k + 1] - HumTable[k]) * frac) * aNow;
  }
}

function chimes(p, o) {
  // Each syllable rings as a music-box note on the speaker's pitch.
  const loud = Math.max(1e-6, percentile(p.env, 0.97));
  const length = 3 * Out, attack = Math.round(0.006 * Out);
  const d1 = Math.exp(-1 / (1.4 * Out)), d2 = Math.exp(-1 / (0.6 * Out)), d3 = Math.exp(-1 / (0.18 * Out));
  for (let k = 0; k < p.onsets.length; k++) {
    const f = p.onsets[k], t = frameTime(p, f);
    const around = []; for (let j = f; j < Math.min(p.frames, f + 5); j++) if (p.pitch[j] > 0) around.push(p.pitch[j]);
    let note;
    if (around.length) note = nearestChordTone(p, percentile(around, 0.5), t, 74 + p.transpose, 91 + p.transpose);
    else { const chord = p.chord(t); note = chord[chord.length - 1 - k % 3] + 12; }
    const vel = 0.45 + 0.55 * Math.min(1, p.env[f] / loud);
    const w = 2 * Math.PI * hz(note) / Out;
    const c1 = Math.cos(w), s1 = Math.sin(w), c3 = Math.cos(4.2 * w), s3 = Math.sin(4.2 * w);
    let re1 = 1, im1 = 0, re3 = 1, im3 = 0, a1 = vel, a2 = 0.35 * vel, a3 = 0.08 * vel;
    const at = Math.round(t * Out);
    for (let i = 0; i < length && at + i < o.length; i++) {
      const s = im1, c = re1, rise = i < attack ? i / attack : 1;
      o[at + i] += rise * (a1 * s + a2 * 2 * s * c + a3 * im3);
      a1 *= d1; a2 *= d2; a3 *= d3;
      let r = re1 * c1 - im1 * s1; im1 = re1 * s1 + im1 * c1; re1 = r;
      r = re3 * c3 - im3 * s3; im3 = re3 * s3 + im3 * c3; re3 = r;
    }
  }
}

function phrases(p, dry, melt) {
  // A few phrases surface in the speaker's own, unaltered voice; when melting they dissolve into the chord.
  for (const span of p.phrases) {
    const s0 = span[0] * Hop, s1 = Math.min(p.voice.length, span[1] * Hop + Win);
    const seg = Float32Array.from(p.voice.subarray(s0, s1));
    new Biquad('high', 120, 0.707, SampleRate).process(seg);
    new Biquad('low', 5000, 0.707, SampleRate).process(seg);
    const warm = Math.tanh(1.4); let pk = 1e-6;
    for (let i = 0; i < seg.length; i++) { seg[i] = Math.tanh(seg[i] * 1.4) / warm; pk = Math.max(pk, Math.abs(seg[i])); }
    const at = Math.round(frameTime(p, span[0]) * Out);
    const n = Math.round(seg.length * Out / SampleRate);
    if (at + n + 6 * Out >= dry.length) continue;
    const ringing = p.melt ? new Float32Array(n + Math.floor(1.5 * Out)) : null;
    for (let i = 0; i < n; i++) {
      const src = i * SampleRate / Out, j = Math.floor(src);
      const v = lerp(seg[j], seg[Math.min(j + 1, seg.length - 1)], src - j) / pk;
      const k = i / n;
      let d = p.melt ? Math.pow(clamp01((1 - k) / 0.45), 1.5) : Math.min(1, (1 - k) * n / (0.9 * Out));
      d *= Math.min(1, i / (0.3 * Out));
      dry[at + i] += v * d;
      if (ringing) ringing[i] = v * clamp01((k - 0.25) / 0.5);
    }
    if (ringing) {
      // The same words, ringing only on the chord's tones.
      const tuned = new Float32Array(ringing.length), band = new Float32Array(ringing.length);
      for (const note of p.chord(at / Out))
        for (let oct = 0; oct <= 12; oct += 12) {
          const f = hz(note + oct); if (f < 150 || f > 1200) continue;
          band.set(ringing); new Biquad('band', f, 60, Out).process(band);
          for (let i = 0; i < band.length; i++) tuned[i] += band[i];
        }
      new Biquad('low', 2200, 0.707, Out).process(tuned);
      normalize(tuned);
      for (let i = 0; i < tuned.length && at + i < melt.length; i++) melt[at + i] += tuned[i];
    }
  }
}

// A told story always becomes music: if the full render fails, the plain pad drawn from its loudness takes its place.
function render(voice, melt) {
  const fitted = fit(voice);
  try { return compute(fitted, melt); }
  catch (error) { return { samples: plain(fitted), summary: '[StoryMusic] plain pad: ' + error.message, fallback: true }; }
}

self.onmessage = event => {
  const { voice, melt = true } = event.data;
  try {
    if (!voice || !voice.length) throw new Error('No captured audio.');
    const result = render(voice, melt);
    self.postMessage({ samples: result.samples, rate: Out, summary: result.summary, fallback: !!result.fallback }, [result.samples.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
