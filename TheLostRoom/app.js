import { createFogView, Vec3 } from './fog-view.js';

// The Lost Room 2 · Tea Time, a phone web AR reached from the QR on a tea bag.
//   tell a story → the voice gathers as particles and the Fog Child is born
//   → its music is made from that recording → play with it by touch → stay with the tea.
// Modes: 'xr'     (WebXR immersive-ar, Android Chrome: the Fog Child is placed on a real surface and stays there)
//        'camera' (no WebXR, e.g. iPhone: camera feed + device orientation, the visitor taps a place)
//        '3d'     (no camera: the Fog Child alone on a dark background).
// In every mode only the Fog Child is drawn over the real view.
// The recording and the music made from it stay in this page's memory; nothing is uploaded or saved.
// Structure: WebAR/티타임_시스템구조.txt

const params = new URLSearchParams(location.search);
const FAST = params.has('fast');
const DEMO = params.has('demo'); // a synthetic voice instead of the microphone, for testing
const T = (ms) => (FAST ? ms * 0.25 : ms);

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const video = $('camera-feed');

// ---------- Helpers ----------
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tweens = new Set();
const ease = {
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  lin: (t) => t,
};
function tween(ms, fn, e = ease.inOut) {
  return new Promise((resolve) => tweens.add({ start: performance.now(), ms: T(ms), fn, e, resolve }));
}
const updaters = new Set();

const time = { value: 0 };
const tmpV = new Vec3();
const { B, engine, scene, camera, anchor, fog, fogState, fogUniforms, inflowUniforms,
  iceCore, loadModels, buildIce } = createFogView(canvas, { updaters, time, lerp, clamp });

// =====================================================================
// Audio
// =====================================================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audio = { ctx: new AudioCtx(), buffers: {}, muted: params.has('muted') };
audio.master = audio.ctx.createGain();
audio.master.gain.value = audio.muted ? 0 : 1;
audio.master.connect(audio.ctx.destination);
const SFX = ['Appear', 'FogChild', 'TextAppear', 'WaterDrop'];

async function loadAudio(onProgress) {
  let done = 0;
  await Promise.all(SFX.map(async (name) => {
    try {
      const data = await (await fetch(`assets/audio/${name}.wav`)).arrayBuffer();
      audio.buffers[name] = await new Promise((ok, fail) => audio.ctx.decodeAudioData(data, ok, fail));
    } catch (err) {
      console.warn('sound not loaded', name, err);
    }
    onProgress(++done / SFX.length);
  }));
}

function play(name, { vol = 1, loop = false, rate = 1 } = {}) {
  const buf = audio.buffers[name];
  if (!buf) return { gain: null, stop() {} };
  const src = audio.ctx.createBufferSource();
  src.buffer = buf; src.loop = loop; src.playbackRate.value = rate;
  const g = audio.ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(audio.master);
  src.start();
  return {
    gain: g,
    stop(fadeMs = 400) {
      const t = audio.ctx.currentTime;
      g.gain.setTargetAtTime(0, t, fadeMs / 3000);
      try { src.stop(t + fadeMs / 1000 + 0.1); } catch {}
    },
  };
}

const ambientEl = new Audio('assets/audio/Ambient.mp3');
ambientEl.loop = true;
ambientEl.preload = 'auto';
let ambientGain = null;
function startAmbient() {
  if (!ambientGain) {
    ambientGain = audio.ctx.createGain();
    ambientGain.gain.value = 0;
    audio.ctx.createMediaElementSource(ambientEl).connect(ambientGain).connect(audio.master);
  }
  ambientEl.play().catch(() => {});
  setAmbient(0.3, 4);
}
function setAmbient(v, seconds = 2) { ambientGain?.gain.setTargetAtTime(v, audio.ctx.currentTime, seconds / 3); }

function makeImpulse(seconds = 3.2) {
  const c = audio.ctx;
  const len = Math.floor(c.sampleRate * seconds);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return ir;
}

// =====================================================================
// StoryMusic: the Fog Child's music, made from the recording
// =====================================================================
// Starts from singBack in the earlier Tears Tea: the voice slowed and lowered, a reversed copy
// even slower, both low-passed into a long reverb over a quiet drone. The two voice layers are
// rendered offline once, then looped live so touch can move them apart and back together.
const NOTES = [220, 277.18, 329.63, 415.3, 493.88];
const VOICED_MIN = 0.6; // seconds of voice needed to call the result "music from your voice"

async function renderLayer(voice, { rate, reverse, gain, delay }) {
  const sr = audio.ctx.sampleRate;
  const dur = Math.min(48, voice.duration / rate + delay + 4.5);
  const off = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  let buf = voice;
  if (reverse) {
    buf = off.createBuffer(1, voice.length, voice.sampleRate);
    buf.getChannelData(0).set(Float32Array.from(voice.getChannelData(0)).reverse());
  }
  const src = off.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = off.createGain(); g.gain.value = gain;
  const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  const conv = off.createConvolver(); conv.buffer = makeImpulse(3.4);
  const wet = off.createGain(); wet.gain.value = 0.9;
  const dry = off.createGain(); dry.gain.value = 0.22;
  // Fades so the loop can overlap itself without clicks.
  const env = off.createGain();
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(1, 1.2);
  env.gain.setValueAtTime(1, Math.max(1.3, dur - 3));
  env.gain.linearRampToValueAtTime(0, dur);
  src.connect(g).connect(lp);
  lp.connect(dry).connect(env);
  lp.connect(conv).connect(wet).connect(env);
  env.connect(off.destination);
  src.start(delay);
  const out = await off.startRendering();
  // Normalise: phone recordings vary a lot in level.
  let peak = 0;
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const d = out.getChannelData(ch);
    for (let i = 0; i < d.length; i += 4) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0.0001) {
    const k = Math.min(8, 0.7 / peak);
    for (let ch = 0; ch < out.numberOfChannels; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= k; }
  }
  return out;
}

// Plays a buffer over and over, each pass overlapping the end of the last one.
function loopLayer(buffer, dest, overlap = 3) {
  const c = audio.ctx;
  const live = new Set();
  let timer = 0, stopped = false;
  const step = Math.max(2, buffer.duration - overlap);
  const schedule = (at) => {
    if (stopped) return;
    const s = c.createBufferSource();
    s.buffer = buffer;
    s.connect(dest);
    s.start(at);
    live.add(s);
    s.onended = () => live.delete(s);
    const next = at + step;
    timer = setTimeout(() => schedule(next), Math.max(0, (next - c.currentTime - 1) * 1000));
  };
  schedule(c.currentTime + 0.05);
  return { stop() { stopped = true; clearTimeout(timer); live.forEach((s) => { try { s.stop(); } catch {} }); live.clear(); } };
}

const music = { on: false, voiced: false, layers: [], loops: [], oscs: [], nodes: null, analyser: null };

async function prepareMusic(story) {
  music.voiced = !!story.buffer && story.voiced >= VOICED_MIN;
  music.layers = [];
  if (!music.voiced) return true;
  music.layers = await Promise.all([
    renderLayer(story.buffer, { rate: 0.62, reverse: false, gain: 1.6, delay: 0.4 }),
    renderLayer(story.buffer, { rate: 0.5, reverse: true, gain: 0.9, delay: 1.2 }),
  ]);
  return music.layers.every((b) => b && b.length > 0);
}

function startMusic() {
  const c = audio.ctx;
  const now = c.currentTime;
  const n = {};
  n.out = c.createGain(); n.out.gain.value = 0;
  n.tone = c.createBiquadFilter(); n.tone.type = 'lowpass'; n.tone.frequency.value = 3200; n.tone.Q.value = 0.7;
  n.dry = c.createGain(); n.dry.gain.value = 0.8;
  n.space = c.createConvolver(); n.space.buffer = makeImpulse(4.2);
  n.wet = c.createGain(); n.wet.gain.value = 0.25;
  n.tone.connect(n.dry).connect(n.out);
  n.tone.connect(n.space).connect(n.wet).connect(n.out);
  music.analyser = c.createAnalyser(); music.analyser.fftSize = 1024;
  n.out.connect(music.analyser);
  n.out.connect(audio.master);
  // Layer A: the slowed voice. Layer B: the reversed voice. Each has its own place left–right.
  const mk = (pan) => { const g = c.createGain(); const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(n.tone); return { g, p }; };
  n.a = mk(0); n.a.g.gain.value = 1;
  n.b = mk(0); n.b.g.gain.value = 0.55;
  n.pad = mk(0); n.pad.g.gain.value = music.voiced ? 0.05 : 0.08;
  music.loops = music.layers.map((buf, i) => loopLayer(buf, i === 0 ? n.a.g : n.b.g));
  music.oscs = [];
  for (const f of [NOTES[0] / 2, NOTES[2] / 2, NOTES[1]]) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    o.connect(n.pad.g); o.start(now); music.oscs.push(o);
  }
  // Without a voice the Fog Child keeps its own hum; this is not called music from the visitor's voice.
  if (!music.voiced && audio.buffers.FogChild) {
    const s = c.createBufferSource(); s.buffer = audio.buffers.FogChild; s.loop = true;
    const g = c.createGain(); g.gain.value = 0.5; s.connect(g).connect(n.tone); s.start(now);
    music.oscs.push(s);
  }
  n.out.gain.setTargetAtTime(1, now, 0.6);
  music.nodes = n;
  music.on = true;
  setAmbient(0.12, 3);
}

function stopMusic() {
  music.loops.forEach((l) => l.stop());
  music.oscs.forEach((o) => { try { o.stop(); } catch {} });
  try { music.nodes?.out.disconnect(); } catch {}
  music.loops = []; music.oscs = []; music.layers = []; music.nodes = null; music.analyser = null; music.on = false;
}

// Touch → music. Shape and sound move together; the music never just gets louder or quieter.
const play$ = { pan: 0, spread: 1, stay: false };
updaters.add((dt) => {
  const n = music.nodes;
  if (!n) return;
  const c = audio.ctx, t = c.currentTime;
  const s = fogState.spread; // 0.45 gathered … 1 resting … 2.8 spread wide
  const wide = clamp((s - 1) / 1.8, 0, 1);
  const close = clamp((1 - s) / 0.55, 0, 1);
  const touch = fogState.touch;
  const stay = play$.stay ? 1 : 0;
  // Spreading pulls the layers apart left and right and opens the room; gathering brings them into one place.
  n.a.p.pan.setTargetAtTime(clamp(play$.pan - wide * 0.7, -1, 1), t, 0.08);
  n.b.p.pan.setTargetAtTime(clamp(play$.pan + wide * 0.7, -1, 1), t, 0.08);
  n.pad.p.pan.setTargetAtTime(clamp(play$.pan * 0.5, -1, 1), t, 0.08);
  n.b.g.gain.setTargetAtTime(0.55 + wide * 0.35 - close * 0.3 + touch * 0.3, t, 0.1);
  n.pad.g.gain.setTargetAtTime((music.voiced ? 0.05 : 0.08) * (1 + wide * 1.2), t, 0.2);
  n.wet.gain.setTargetAtTime(0.25 + wide * 0.55 - close * 0.12 + stay * 0.1, t, 0.15);
  n.dry.gain.setTargetAtTime(0.8 - wide * 0.3 + close * 0.15, t, 0.15);
  // A touch opens the tone for a moment; gathering and staying darken it.
  n.tone.frequency.setTargetAtTime(clamp(3200 + touch * 3800 - close * 1600 - stay * 1200 + wide * 600, 500, 9000), t, 0.06);
  n.out.gain.setTargetAtTime(stay ? 0.75 : 1, t, 1);
});

// The Fog Child moves with its music.
const anaBuf = new Float32Array(1024);
updaters.add(() => {
  if (!music.analyser) return;
  music.analyser.getFloatTimeDomainData(anaBuf);
  let rms = 0;
  for (let i = 0; i < anaBuf.length; i++) rms += anaBuf[i] * anaBuf[i];
  fogState.target = clamp(Math.sqrt(rms / anaBuf.length) * 5, 0, 1);
});

// =====================================================================
// StoryCapture: microphone, recording started and finished by the visitor
// =====================================================================
const MAX_TALK = 60;
const mic = { stream: null, src: null, analyser: null, proc: null, td: null, chunks: [], samples: 0, paused: false, full: false };
async function openMic() {
  if (DEMO) return true;
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    console.warn('microphone unavailable', err);
    return false;
  }
  const c = audio.ctx;
  mic.src = c.createMediaStreamSource(mic.stream);
  mic.analyser = c.createAnalyser();
  mic.analyser.fftSize = 2048;
  mic.td = new Float32Array(mic.analyser.fftSize);
  mic.proc = c.createScriptProcessor(4096, 1, 1);
  const sink = c.createGain();
  sink.gain.value = 0;
  mic.src.connect(mic.analyser);
  mic.src.connect(mic.proc);
  mic.proc.connect(sink).connect(c.destination);
  mic.chunks = []; mic.samples = 0; mic.paused = false; mic.full = false;
  mic.proc.onaudioprocess = (e) => {
    if (mic.paused) return;
    if (mic.samples > c.sampleRate * MAX_TALK) { mic.full = true; return; }
    const d = new Float32Array(e.inputBuffer.getChannelData(0));
    mic.chunks.push(d);
    mic.samples += d.length;
  };
  return true;
}
function closeMic() {
  mic.stream?.getTracks().forEach((t) => t.stop());
  try { mic.src?.disconnect(); mic.proc?.disconnect(); } catch {}
  if (mic.proc) mic.proc.onaudioprocess = null;
  mic.analyser = null; mic.src = null; mic.proc = null; mic.stream = null;
  const c = audio.ctx;
  let buffer = null;
  if (DEMO) buffer = demoVoice();
  else if (mic.samples) {
    buffer = c.createBuffer(1, mic.samples, c.sampleRate);
    const data = buffer.getChannelData(0);
    let o = 0;
    for (const ch of mic.chunks) { const n = Math.min(ch.length, data.length - o); data.set(ch.subarray(0, n), o); o += n; if (o >= data.length) break; }
  }
  mic.chunks = []; mic.samples = 0;
  return buffer;
}
let demoClock = 0;
function micRms() {
  if (DEMO) return 0.04 + 0.03 * Math.sin(demoClock * 7) * Math.sin(demoClock * 1.3);
  if (!mic.analyser) return 0;
  mic.analyser.getFloatTimeDomainData(mic.td);
  let s = 0;
  for (let i = 0; i < mic.td.length; i++) s += mic.td[i] * mic.td[i];
  return Math.sqrt(s / mic.td.length);
}
// A few seconds of voice-like sound for ?demo.
function demoVoice() {
  const c = audio.ctx, sr = c.sampleRate, len = sr * 6;
  const b = c.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f0 = 150 + 30 * Math.sin(t * 2.1) + 20 * Math.sin(t * 5.3);
    ph += f0 / sr;
    const syll = Math.max(0, Math.sin(t * Math.PI * 3.1)) ** 2;
    const saw = (ph % 1) * 2 - 1;
    d[i] = syll * (0.25 * saw * (0.6 + 0.4 * Math.sin(TAU * 700 * t)) + 0.03 * (Math.random() * 2 - 1));
  }
  return b;
}

// =====================================================================
// CameraView: camera feed, device orientation, tapping a place
// =====================================================================
const orient = { q: B.Quaternion.Identity(), has: false };
const qBackCam = new B.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const rad = (degrees) => degrees * Math.PI / 180;
function onOrientation(e) {
  if (e.alpha == null) return;
  orient.q.copyFrom(B.Quaternion.RotationYawPitchRoll(rad(e.alpha), rad(e.beta), -rad(e.gamma))
    .multiply(qBackCam).multiply(B.Quaternion.RotationAxis(B.Axis.Z, -rad(screen.orientation?.angle ?? window.orientation ?? 0))));
  orient.has = true;
}
const fallbackQ = B.Quaternion.RotationYawPitchRoll(0, -0.65, 0);

// In WebXR the XR camera is active; everywhere else the page's own camera.
const viewCam = () => scene.activeCamera || camera;
function screenToWorld(px, py, dist, out) {
  const c = viewCam();
  const near = B.Vector3.Unproject(new B.Vector3(px, py, 0), innerWidth, innerHeight,
    B.Matrix.IdentityReadOnly, c.getViewMatrix(), c.getProjectionMatrix());
  const far = B.Vector3.Unproject(new B.Vector3(px, py, 1), innerWidth, innerHeight,
    B.Matrix.IdentityReadOnly, c.getViewMatrix(), c.getProjectionMatrix());
  return out.copy(c.globalPosition).addScaledVector(far.subtract(near).normalize(), dist);
}
function worldToScreen(v, out = { x: 0, y: 0 }) {
  const c = viewCam();
  const p = B.Vector3.Project(v, B.Matrix.IdentityReadOnly,
    c.getViewMatrix().multiply(c.getProjectionMatrix()), new B.Viewport(0, 0, innerWidth, innerHeight));
  out.x = p.x; out.y = p.y;
  return out;
}
function faceCamera() {
  const c = viewCam().globalPosition;
  anchor.rotation.set(0, Math.atan2(c.x - anchor.position.x, c.z - anchor.position.z), 0);
}

// =====================================================================
// WebXR AR: real surfaces through hit-test, the page UI as a DOM overlay
// =====================================================================
const xr = { supported: false, helper: null, hitTest: null, hit: null, reticle: null, placing: false };
async function checkXR() {
  try { xr.supported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch { xr.supported = false; }
  return xr.supported;
}
function buildReticle() {
  const ring = B.MeshBuilder.CreateTorus('place-ring', { diameter: 0.07, thickness: 0.003, tessellation: 48 }, scene);
  const mat = new B.StandardMaterial('place-ring-material', scene);
  mat.disableLighting = true; mat.emissiveColor = B.Color3.FromHexString('#dfe6ff'); mat.alpha = 0.85;
  ring.material = mat; ring.isPickable = false; ring.renderingGroupId = 1;
  ring.rotationQuaternion = B.Quaternion.Identity();
  ring.setEnabled(false);
  return ring;
}
async function startXR() {
  const helper = await B.WebXRExperienceHelper.CreateAsync(scene);
  const fm = helper.featuresManager;
  xr.hitTest = fm.enableFeature(B.WebXRFeatureName.HIT_TEST, 'latest', {}, true, true);
  try { fm.enableFeature(B.WebXRFeatureName.DOM_OVERLAY, 'latest', { element: '#ui' }, true, false); } catch (err) { console.warn('dom overlay unavailable', err); }
  xr.hitTest.onHitTestResultObservable.add((results) => {
    xr.hit = results.length ? results[0] : null;
    if (!xr.reticle) return;
    xr.reticle.setEnabled(xr.placing && !!xr.hit);
    if (xr.placing && xr.hit) xr.hit.transformationMatrix.decompose(undefined, xr.reticle.rotationQuaternion, xr.reticle.position);
  });
  helper.sessionManager.onXRSessionEnded.add(() => { if (!session.ended) endSession(); });
  xr.reticle = buildReticle();
  try { await helper.enterXRAsync('immersive-ar', 'local-floor'); }
  catch { await helper.enterXRAsync('immersive-ar', 'local'); }
  xr.helper = helper;
  mode = 'xr';
  document.body.className = 'mode-xr';
}

// =====================================================================
// TouchPlay: touch, drag, two-finger spread and gather → shape and music
// =====================================================================
const pointers = new Map();
// A full-screen layer under the buttons takes the touches. In WebXR it sits in the DOM overlay,
// where the canvas no longer receives pointer events.
const touchLayer = $('touch');
const touchPlay = { enabled: false, dragging: false, pinch0: 0, spread0: 1, counts: { touch: 0, drag: 0, spread: 0, gather: 0 }, onChange: null };
const fogWorld = new Vec3();
const edgeWorld = new Vec3();
function fogScreen() {
  fog.computeWorldMatrix(true); fogWorld.copy(fog.getAbsolutePosition());
  const c = worldToScreen(fogWorld, {});
  edgeWorld.copy(fogWorld).addScaledVector(viewCam().getDirection(B.Axis.Y), fogUniforms.uScale.value * fogState.spread * 1.1);
  const e = worldToScreen(edgeWorld, {});
  return { x: c.x, y: c.y, r: Math.max(56, Math.hypot(e.x - c.x, e.y - c.y) * 1.3) };
}
function bump(kind) {
  touchPlay.counts[kind]++;
  touchPlay.onChange?.(kind);
}
touchLayer.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { touchLayer.setPointerCapture(e.pointerId); } catch {}
  if (!touchPlay.enabled) return;
  if (pointers.size === 1) {
    const f = fogScreen();
    if (Math.hypot(e.clientX - f.x, e.clientY - f.y) < f.r) {
      // Shake the side that was touched.
      const dx = e.clientX - f.x, dy = e.clientY - f.y;
      fogUniforms.uTouchDir.value.set(dx, -dy, 0.4).normalize();
      fogState.touch = 1;
      touchPlay.dragging = true;
      touchPlay.moved = 0;
      bump('touch');
    }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    touchPlay.dragging = false;
    touchPlay.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
    touchPlay.spread0 = fogState.spreadTarget;
    touchPlay.pinchFrom = fogState.spreadTarget;
  }
});
touchLayer.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (!touchPlay.enabled) return;
  if (pointers.size === 1 && touchPlay.dragging) {
    // Carry the Fog Child across the screen at its current depth, within reach of the cup.
    fog.computeWorldMatrix(true); fogWorld.copy(fog.getAbsolutePosition());
    const dist = viewCam().globalPosition.subtract(fogWorld).length();
    screenToWorld(e.clientX, e.clientY, dist, tmpV);
    const local = B.Vector3.TransformCoordinates(tmpV, anchor.computeWorldMatrix(true).clone().invert());
    const xz = Math.hypot(local.x, local.z);
    if (xz > 0.22) { local.x *= 0.22 / xz; local.z *= 0.22 / xz; }
    local.y = clamp(local.y, 0.03, 0.22);
    fogState.home.copy(local);
    touchPlay.moved += Math.hypot(dx, dy);
    play$.pan = clamp(((e.clientX / innerWidth) * 2 - 1) * 1.1, -1, 1);
  } else if (pointers.size === 2 && touchPlay.pinch0 > 0) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    fogState.spreadTarget = clamp(touchPlay.spread0 * (d / touchPlay.pinch0), 0.45, 2.8);
  }
});
const endPointer = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (!touchPlay.enabled) return;
  if (touchPlay.dragging && pointers.size === 0) {
    touchPlay.dragging = false;
    if (touchPlay.moved > 40) bump('drag');
  }
  if (pointers.size < 2 && touchPlay.pinch0 > 0) {
    const from = touchPlay.pinchFrom, to = fogState.spreadTarget;
    if (to > from * 1.25) bump('spread');
    else if (to < from * 0.8) bump('gather');
    touchPlay.pinch0 = 0;
  }
};
touchLayer.addEventListener('pointerup', endPointer);
touchLayer.addEventListener('pointercancel', endPointer);
// Left alone, the Fog Child slowly returns to its resting size. Gathering is never read as an ending.
updaters.add((dt) => {
  if (pointers.size < 2) fogState.spreadTarget += (1 - fogState.spreadTarget) * Math.min(1, dt * 0.12);
});

// =====================================================================
// UI
// =====================================================================
const captionEl = $('caption');
let captionTimer = 0;
function say(main, hint = '') {
  clearTimeout(captionTimer);
  captionEl.classList.remove('on');
  const swap = () => {
    captionEl.querySelector('.ko').textContent = main;
    captionEl.querySelector('.hint').textContent = hint;
    captionEl.classList.toggle('no-main', !main);
    captionEl.classList.add('on');
    requestAnimationFrame(() => document.documentElement.style.setProperty('--cap-h', `${captionEl.offsetHeight}px`));
  };
  if (captionEl.querySelector('.ko').textContent || captionEl.querySelector('.hint').textContent) captionTimer = setTimeout(swap, 420);
  else swap();
}
function offer(buttons) {
  const box = $('actions');
  box.innerHTML = '';
  document.body.classList.toggle('has-actions', buttons.length > 0);
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = `btn ${b.primary ? 'btn-primary' : 'btn-ghost'}`;
    el.textContent = b.label;
    el.onclick = b.onClick;
    box.appendChild(el);
  }
}
const clearOffer = () => offer([]);
// Resolves with the value of the button pressed.
function choose(buttons) {
  return new Promise((resolve) => offer(buttons.map((b) => ({ ...b, onClick: () => { clearOffer(); resolve(b.value); } }))));
}
function fmt(sec) { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
const recEl = $('rec');
function showRec(on, sec = 0, note = '') {
  recEl.classList.toggle('on', on);
  recEl.querySelector('.time').textContent = fmt(sec);
  recEl.querySelector('.note').textContent = note;
}

// =====================================================================
// TeaTimeFlow
// =====================================================================
const session = { story: null, ended: false, recording: false, interrupted: false };

async function placeFogChild() {
  if (mode === 'xr') {
    // A ring follows the real surface the phone points at; a tap puts the Fog Child there.
    xr.placing = true;
    say('찻잔이 놓인 탁자를 비춰 주세요.', '원이 나타나면, 찻잔 옆 원이 있는 자리를 눌러 주세요.');
    while (!session.ended) {
      await new Promise((r) => touchLayer.addEventListener('pointerdown', r, { once: true }));
      if (xr.hit) break;
      say('탁자 면을 찾는 중이에요.', '휴대폰을 천천히 움직여 탁자 면을 비춰 주세요.');
    }
    xr.placing = false;
    xr.reticle?.setEnabled(false);
    if (session.ended) return;
    xr.hit.transformationMatrix.decompose(undefined, undefined, anchor.position);
    faceCamera();
    anchor.setEnabled(true);
    play('WaterDrop', { vol: 0.6 });
    return;
  }
  if (mode !== 'camera') {
    anchor.position.set(0, 0, 0);
    anchor.setEnabled(true);
    return;
  }
  say('안개 아이가 나타날 자리를 눌러 주세요.', '화면 속 찻잔 바로 위를 누르면 됩니다.');
  const e = await new Promise((r) => touchLayer.addEventListener('pointerdown', r, { once: true }));
  screenToWorld(e.clientX, e.clientY, 0.35, anchor.position);
  anchor.position.y -= 0.06; // the tap marks the Fog Child, the tea surface sits a little below
  faceCamera();
  anchor.setEnabled(true);
  play('WaterDrop', { vol: 0.6 });
}

// Recording is started and finished by the visitor. Silence never ends it.
async function tell() {
  while (true) {
    // Draft prompt from Docs/LostRoom_UXWriting_2026-10-14.txt; the Tea Time opening line is not final.
    say('지금 떠오르는 장면 하나를 골라주세요. 그때 어디에 있었고, 어떤 마음이었나요?',
      '‘녹음 시작’을 누르고 이야기한 뒤 ‘녹음 멈춤’을 누르세요. 최대 1분 녹음합니다.');
    const go = await choose([{ label: '녹음 시작', primary: true, value: 'rec' }, { label: '말 없이 이어가기', value: 'skip' }]);
    if (go === 'skip') return { buffer: null, voiced: 0 };
    const ok = await openMic();
    if (!ok) {
      say('마이크를 쓸 수 없어요.', '브라우저 설정에서 마이크를 허용한 뒤 다시 시도하거나, 말 없이 이어갈 수 있습니다.');
      const next = await choose([{ label: '다시 시도', primary: true, value: 'retry' }, { label: '말 없이 이어가기', value: 'skip' }]);
      if (next === 'skip') return { buffer: null, voiced: 0 };
      continue;
    }
    return record();
  }
}

async function record() {
  session.recording = true;
  setAmbient(0.06, 1.5);
  say('', '말을 마치면 ‘녹음 멈춤’을 누르세요.');
  let voiced = 0, elapsed = 0, done = false;
  // The gathering particles grow with how much has been said.
  fogUniforms.uAlpha.value = 0;
  fogUniforms.uScale.value = 0.004;
  const tick = (dt) => {
    if (mic.paused) { inflowUniforms.uAlpha.value *= 0.9; return; }
    demoClock += dt;
    elapsed += dt;
    const rms = micRms();
    const level = clamp((rms - 0.006) * 9, 0, 1);
    if (rms > 0.02) voiced += dt;
    inflowUniforms.uAlpha.value = 0.12 + level * 1.2;
    inflowUniforms.uSpeed.value = 0.22 + level * 0.35;
    const g = clamp(voiced / 8, 0, 1);
    fogUniforms.uAlpha.value = lerp(fogUniforms.uAlpha.value, 0.15 + g * 0.45 + level * 0.2, Math.min(1, dt * 4));
    fogUniforms.uScale.value = lerp(fogUniforms.uScale.value, 0.006 + g * 0.012 + level * 0.004, Math.min(1, dt * 3));
    fogState.target = level;
    const full = elapsed >= MAX_TALK || mic.full;
    showRec(true, Math.min(elapsed, MAX_TALK), full ? '1분이 되어 녹음을 멈췄습니다' : '');
    if (full && !mic.paused) mic.paused = true;
  };
  updaters.add(tick);
  const stopBtn = () => offer([{ label: '녹음 멈춤', primary: true, onClick: () => { done = true; } }]);
  stopBtn();
  session.onResume = () => {
    say('녹음을 잠시 멈췄어요.', '이어서 녹음하거나, 지금까지의 녹음으로 마칠 수 있습니다.');
    offer([
      { label: '이어서 녹음', primary: true, onClick: () => { mic.paused = false; say('', '말을 마치면 ‘녹음 멈춤’을 누르세요.'); stopBtn(); } },
      { label: '녹음 멈춤', onClick: () => { done = true; } },
    ]);
  };
  while (!done && !session.ended) await sleep(100);
  session.onResume = null;
  updaters.delete(tick);
  clearOffer();
  showRec(false);
  session.recording = false;
  inflowUniforms.uAlpha.value = 0;
  fogState.target = 0;
  setAmbient(0.3, 3);
  return { buffer: closeMic(), voiced: DEMO ? 5 : voiced };
}

async function birth(story) {
  say('', story.buffer && story.voiced >= VOICED_MIN ? '목소리를 음악으로 바꾸는 중입니다.' : '');
  let ok = true;
  try { ok = await prepareMusic(story); } catch (err) { console.warn('music not made', err); ok = false; }
  story.buffer = null; // the raw recording is no longer needed once the music layers exist
  if (!ok) {
    say('음악으로 바꾸지 못했어요.', '다시 녹음하거나, 말 없이 이어갈 수 있습니다.');
    const next = await choose([{ label: '다시 녹음', primary: true, value: 'again' }, { label: '말 없이 이어가기', value: 'skip' }]);
    music.layers = []; music.voiced = false;
    if (next === 'again') return false;
  }
  say(music.voiced ? '당신의 목소리에서 안개 아이가 태어납니다.' : '안개 아이가 태어납니다.');
  play('Appear', { vol: 0.75 });
  startMusic();
  const a0 = fogUniforms.uAlpha.value, s0 = Math.max(0.004, fogUniforms.uScale.value);
  await tween(4200, (k) => {
    fogUniforms.uAlpha.value = lerp(a0, 1, k);
    fogUniforms.uScale.value = lerp(s0, 0.034, k);
    iceCore.userData.show = k;
  });
  return true;
}

async function playWithFogChild() {
  touchPlay.enabled = true;
  say('손가락으로 안개 아이를 만져보세요.', '끌어서 옮기고, 두 손가락으로 벌리거나 모아 보세요.');
  const t0 = performance.now();
  let offered = false;
  await new Promise((resolve) => {
    const maybeOffer = () => {
      const c = touchPlay.counts;
      const tried = (c.touch > 0) + (c.drag > 0) + (c.spread > 0) + (c.gather > 0);
      if (!offered && (tried >= 3 || performance.now() - t0 > T(40000))) {
        offered = true;
        offer([{ label: '차 마시기', primary: true, onClick: () => { clearOffer(); resolve(); } }]);
      }
    };
    touchPlay.onChange = maybeOffer;
    const iv = setInterval(() => { if (session.ended) { clearInterval(iv); resolve(); } else maybeOffer(); }, 1000);
  });
  touchPlay.onChange = null;
}

async function stay() {
  play$.stay = true;
  say('차를 마시는 동안 음악은 이어집니다.', '다시 만져도 되고, ‘마치기’로 끝낼 수 있습니다.');
  // The Fog Child settles low over the cup.
  const from = fogState.home.clone();
  tween(3000, (k) => { fogState.home.lerpVectors(from, new Vec3(0, 0.06, 0), k); });
  await choose([{ label: '마치기', value: 'end' }]);
}

// Stops camera, microphone and sound, and lets go of the recording and the music.
function endSession({ show = true } = {}) {
  if (session.ended) return;
  session.ended = true;
  touchPlay.enabled = false;
  if (mic.stream) closeMic();
  mic.chunks = []; mic.samples = 0;
  stopMusic();
  session.story = null;
  video.srcObject?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  if (xr.helper?.state === B.WebXRState.IN_XR) xr.helper.exitXRAsync().catch(() => {});
  ambientEl.pause();
  removeEventListener('deviceorientation', onOrientation);
  clearOffer();
  showRec(false);
  $('hud').classList.remove('on');
  if (show) $('end').classList.add('on');
}

let started = false;
async function flow() {
  if (started) return;
  started = true;
  await placeFogChild();
  while (!session.ended) {
    session.story = await tell();
    if (session.ended) return;
    if (await birth(session.story)) break;
    fogUniforms.uAlpha.value = 0;
  }
  if (session.ended) return;
  await playWithFogChild();
  if (session.ended) return;
  await stay();
  endSession();
}

// App switch or screen lock: stop recording and sound, keep the state, never record again on return.
document.addEventListener('visibilitychange', () => {
  if (!started || session.ended) return;
  if (document.hidden) {
    if (session.recording) { mic.paused = true; session.interrupted = true; }
    audio.ctx.suspend();
    ambientEl.pause();
  } else {
    audio.ctx.resume();
    ambientEl.play().catch(() => {});
    if (session.interrupted) { session.interrupted = false; session.onResume?.(); }
  }
});

// =====================================================================
// Modes and loop
// =====================================================================
let mode = null;
const view = { yaw: 0.5, pitch: 0.55 };

function applyView() {
  if (mode === 'camera') {
    camera.position.set(0, 0, 0);
    camera.rotationQuaternion.copyFrom(orient.has ? orient.q : fallbackQ);
  } else if (mode === '3d') {
    const dist = Math.max(0.36, 0.15 / (Math.tan(camera.fov / 2) * (innerWidth / innerHeight)));
    const target = new Vec3(0, 0.0, 0);
    camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch) * dist, target.y + Math.sin(view.pitch) * dist, Math.cos(view.yaw) * Math.cos(view.pitch) * dist);
    camera.setTarget(target);
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  await video.play().catch(() => {});
  mode = 'camera';
  document.body.className = 'mode-camera';
  addEventListener('deviceorientation', onOrientation);
}

function start3D() {
  mode = '3d';
  document.body.className = 'mode-3d';
}

const camSupported = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
const startBtn = $('start');

async function boot() {
  const kind = params.get('mode') || ((await checkXR()) ? 'xr' : camSupported ? 'camera' : '3d');
  startBtn.dataset.mode = kind;
  let ready = false;
  const enable = () => {
    if (ready) return;
    ready = true;
    startBtn.disabled = false;
    startBtn.textContent = '시작하기';
    $('load-status').textContent = '';
  };
  setTimeout(enable, 12000);
  let pa = 0, pm = 0;
  const progress = () => { if (!ready) $('load-status').textContent = `${Math.round((pa + pm) * 50)}%`; };
  await Promise.all([loadAudio((p) => { pa = p; progress(); }), loadModels((p) => { pm = p; progress(); })]);
  buildIce();
  enable();
}

async function begin(kind) {
  // Inside the click: audio unlock and the iOS motion permission need the gesture.
  audio.ctx.resume();
  startAmbient();
  if (kind !== '3d' && typeof globalThis.DeviceOrientationEvent?.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  $('intro').classList.add('hidden');
  $('hud').classList.add('on');
  if (kind === 'xr') {
    try { await startXR(); } catch (err) {
      console.warn('WebXR AR unavailable, using the camera view', err);
      try { await startCamera(); } catch (e2) { console.warn('camera unavailable', e2); start3D(); }
    }
  } else if (kind === 'camera') {
    try { await startCamera(); } catch (err) { console.warn('camera unavailable', err); start3D(); }
  } else {
    start3D();
  }
  flow();
}
startBtn.addEventListener('click', () => begin(startBtn.dataset.mode));

$('btn-sound').addEventListener('click', () => {
  audio.muted = !audio.muted;
  audio.master.gain.setTargetAtTime(audio.muted ? 0 : 1, audio.ctx.currentTime, 0.05);
  $('snd-wave').style.opacity = audio.muted ? 0.15 : 1;
  $('btn-sound').setAttribute('aria-label', audio.muted ? '소리 켜기' : '소리 끄기');
});
if (audio.muted) $('snd-wave').style.opacity = 0.15;
$('btn-exit').addEventListener('click', () => endSession());
$('again').addEventListener('click', () => location.reload());

addEventListener('resize', () => {
  engine.resize();
});

const T0 = performance.now();
let last = T0;
engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time.value = (now - T0) / 1000; // small values keep shader sin() precise on phones
  for (const tw of tweens) {
    const k = Math.min(1, (now - tw.start) / tw.ms);
    tw.fn(tw.e(k));
    if (k >= 1) { tweens.delete(tw); tw.resolve(); }
  }
  if (mode) applyView();
  camera.getViewMatrix(true);
  for (const u of updaters) u(dt, time.value);
  scene.render();
});

boot();

if (params.has('debug')) window.__tt = { xr, BABYLON: B, engine, scene, camera, anchor, fog, fogState, fogUniforms, music, touchPlay, session, play$ };
