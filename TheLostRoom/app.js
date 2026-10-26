import { createFogView, Vec3 } from './fog-view.js?v=20261026-hold-voice-spatial-1';
import { createQRMarkerTracker, markerPose } from './qr-marker.js';
import { messages, chooseLanguage } from './strings.js';

// The Lost Room 2: QR → Fog Child → hold the child while speaking → release for music.
// Camera and voice processing stay in this browser; nothing is uploaded.
// ?mode=3d is a camera-free development preview, not the default experience.

const params = new URLSearchParams(location.search);
let savedLanguage;try{savedLanguage=localStorage.getItem('lostroom-language');}catch{}
let language=chooseLanguage({saved:savedLanguage,requested:params.get('lang'),languages:navigator.languages||[navigator.language]});
const t=key=>messages[language][key]||messages.en[key]||key;
function applyLanguage(value,save=false) {
  if(!messages[value])return;
  language=value;document.documentElement.lang=value;document.title=t('pageTitle');
  if(save)try{localStorage.setItem('lostroom-language',value);}catch{}
  for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=t(node.dataset.i18n);
  for(const select of document.querySelectorAll('.language-picker')){select.value=value;select.setAttribute('aria-label',t('language'));}
  $('touch').setAttribute('aria-label',t('holdLabel'));
  $('btn-exit').setAttribute('aria-label',t('exit'));
  $('btn-sound').setAttribute('aria-label',t(audio.muted?'unmute':'mute'));
  if(captionKey)captionEl.querySelector('.ko').textContent=t(captionKey);
}
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
const { B, engine, scene, camera, anchor, fog, fogState, fogUniforms, inflowUniforms,
  iceCore, loadModels, buildIce } = createFogView(canvas, { updaters, time, lerp, clamp });

// =====================================================================
// Audio
// =====================================================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audio = { ctx: new AudioCtx(), buffers: {}, muted: params.has('muted') };
audio.master = audio.ctx.createGain();
audio.master.gain.value = audio.muted ? 0 : 1;
// Web Audio and the Babylon scene both use metres and right-handed coordinates.
// The emitter follows the actual child, while the listener follows the camera.
const spatial={panner:audio.ctx.createPanner(),presence:audio.ctx.createGain(),meter:audio.ctx.createAnalyser(),distance:0,visible:false};
spatial.panner.panningModel='HRTF';spatial.panner.distanceModel='inverse';
spatial.panner.refDistance=.18;spatial.panner.maxDistance=3;spatial.panner.rolloffFactor=1.25;
spatial.presence.gain.value=0;spatial.meter.fftSize=1024;
audio.master.connect(spatial.panner).connect(spatial.presence).connect(spatial.meter).connect(audio.ctx.destination);
const soundPosition=new B.Vector3(),soundForward=new B.Vector3(),soundUp=new B.Vector3(),soundForwardAxis=new B.Vector3(0,0,-1);
function setAudioVector(node,prefix,v) {
  const now=audio.ctx.currentTime;
  if(node[prefix+'X'])for(const [axis,value] of [['X',v.x],['Y',v.y],['Z',v.z]])node[prefix+axis].setTargetAtTime(value,now,.08);
  else if(prefix==='position')node.setPosition(v.x,v.y,v.z);
}
updaters.add(()=>{
  if(!started)return;
  fog.computeWorldMatrix(true);soundPosition.copyFrom(fog.getAbsolutePosition());
  const listener=audio.ctx.listener,position=camera.globalPosition;
  soundForward.copyFrom(camera.getDirection(soundForwardAxis));soundUp.copyFrom(camera.getDirection(B.Axis.Y));
  setAudioVector(spatial.panner,'position',soundPosition);setAudioVector(listener,'position',position);
  if(listener.forwardX){setAudioVector(listener,'forward',soundForward);setAudioVector(listener,'up',soundUp);}
  else listener.setOrientation(soundForward.x,soundForward.y,soundForward.z,soundUp.x,soundUp.y,soundUp.z);
  spatial.distance=B.Vector3.Distance(position,soundPosition);
  const visible=!session.ended&&anchor.isEnabled();
  if(visible!==spatial.visible){spatial.visible=visible;spatial.presence.gain.setTargetAtTime(visible?1:0,audio.ctx.currentTime,.15);}
});
const ambient={element:new Audio('assets/audio/Ambient.mp3'),gain:null,target:0};
ambient.element.loop=true;ambient.element.preload='none';
function startAmbient() {
  if(!ambient.gain){ambient.gain=audio.ctx.createGain();ambient.gain.gain.value=0;audio.ctx.createMediaElementSource(ambient.element).connect(ambient.gain).connect(audio.master);}
  ambient.element.play().catch(()=>{});
}
updaters.add(()=>{
  if(!ambient.gain)return;
  const speaking=['arming','recording'].includes(whisper.phase);
  const target=session.ended?0:speaking ? .004 : music.on ? .045 : .14;
  if(target!==ambient.target){ambient.target=target;ambient.gain.gain.setTargetAtTime(target,audio.ctx.currentTime,speaking ? .08 : .9);}
});
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
  n.out.gain.setTargetAtTime(1, now, 0.6);
  music.nodes = n;
  music.on = true;
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
  n.out.gain.setTargetAtTime(['arming','recording'].includes(whisper.phase) ? 0 : 1, t, .12);
});

// The Fog Child moves with its music.
const anaBuf = new Float32Array(1024);
updaters.add(() => {
  if (!music.analyser || whisper.phase === 'recording') return;
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
async function openMic(isCurrent) {
  if (DEMO) { mic.paused=false; return 'opened'; }
  let stream;
  try {
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    // A permission dialog may outlast the touch. Never begin recording after release.
    if (!isCurrent()) { stream.getTracks().forEach(t=>t.stop());return 'released'; }
    mic.stream=stream;
    const c=audio.ctx;
    mic.src=c.createMediaStreamSource(stream);mic.analyser=c.createAnalyser();mic.analyser.fftSize=2048;
    mic.td=new Float32Array(mic.analyser.fftSize);mic.proc=c.createScriptProcessor(4096,1,1);
    mic.sink=c.createGain();mic.sink.gain.value=0;
    mic.src.connect(mic.analyser);mic.src.connect(mic.proc);mic.proc.connect(mic.sink).connect(c.destination);
    mic.chunks=[];mic.samples=0;mic.paused=false;mic.full=false;
    mic.proc.onaudioprocess=e=>{
      if (mic.paused || !isCurrent()) return;
      const remaining=Math.floor(c.sampleRate*MAX_TALK)-mic.samples;
      if (remaining<=0) { mic.full=true;return; }
      const d=new Float32Array(e.inputBuffer.getChannelData(0).subarray(0,remaining));
      mic.chunks.push(d);mic.samples+=d.length;
      if (mic.samples>=c.sampleRate*MAX_TALK) mic.full=true;
    };
    return 'opened';
  } catch (error) {
    stream?.getTracks().forEach(t=>t.stop());
    if(isCurrent())closeMic(true);
    console.warn('microphone unavailable',error);return 'denied';
  }
}
function closeMic(discard = false) {
  mic.stream?.getTracks().forEach((t) => t.stop());
  try { mic.src?.disconnect(); mic.proc?.disconnect(); mic.sink?.disconnect(); } catch {}
  if (mic.proc) mic.proc.onaudioprocess = null;
  mic.analyser = null; mic.src = null; mic.proc = null; mic.stream = null; mic.sink = null;
  const c = audio.ctx;
  let buffer = null;
  if (DEMO && !discard) buffer = demoVoice();
  else if (mic.samples && !discard) {
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
// CameraView: camera feed, screen/world conversion
// =====================================================================
// In WebXR the XR camera is active; everywhere else the page's own camera.
const viewCam = () => scene.activeCamera || camera;
function worldToScreen(v, out = { x: 0, y: 0 }) {
  const c = viewCam();
  const p = B.Vector3.Project(v, B.Matrix.IdentityReadOnly,
    c.getViewMatrix().multiply(c.getProjectionMatrix()), new B.Viewport(0, 0, innerWidth, innerHeight));
  out.x = p.x; out.y = p.y;
  return out;
}
let markerStatusTimer = 0;
const markerTracker = createQRMarkerTracker({ video,
  onPose(corners,modules,snap) {
    const projection=camera.getProjectionMatrix(true).m;
    const pose=markerPose(corners,{width:innerWidth,height:innerHeight,
      fx:innerWidth*projection[0]/2,fy:innerHeight*projection[5]/2,modules});
    if (!pose) return false;
    const p=new B.Vector3(...pose.position);
    const matrix=B.Matrix.FromValues(...pose.x,0,...pose.y,0,...pose.z,0,0,0,0,1);
    const q=B.Quaternion.FromRotationMatrix(matrix);
    if (!anchor.rotationQuaternion) anchor.rotationQuaternion=B.Quaternion.Identity();
    if (snap) { anchor.position.copyFrom(p);anchor.rotationQuaternion.copyFrom(q); }
    else { B.Vector3.LerpToRef(anchor.position,p,.6,anchor.position);B.Quaternion.SlerpToRef(anchor.rotationQuaternion,q,.5,anchor.rotationQuaternion); }
    return true;
  },
  onVisibility(visible,locked) {
    clearTimeout(markerStatusTimer);
    const status=$('marker-status');
    anchor.setEnabled(visible && !session.ended);
    if (!visible) finishHold(true);
    if (session.ended) { status.classList.remove('on');return; }
    status.dataset.i18n=visible?'qrFound':locked?'qrAgain':'qrFull';status.textContent=t(status.dataset.i18n);
    status.classList.add('on');
    if (visible) markerStatusTimer=setTimeout(()=>status.classList.remove('on'),1800);
  }
});
// Hold the Fog Child to speak. Releasing the same pointer makes its music.
// =====================================================================
const touchLayer=$('touch');
const session={ended:false,recording:false};
const whisper={phase:'idle',pointerId:null,token:0,voiced:0,elapsed:0,generation:0};
const captionEl=$('caption');
let captionTimer=0;
let captionKey=null;
function say(key,fade=false) {
  clearTimeout(captionTimer);
  captionKey=key;captionEl.querySelector('.ko').textContent=key?t(key):'';
  captionEl.querySelector('.hint').textContent='';
  captionEl.classList.toggle('on',!!key);
  if(fade)captionTimer=setTimeout(()=>{if(whisper.phase==='idle')captionEl.classList.remove('on');},6000);
}
const recEl=$('rec');
function showRec(on) {
  recEl.classList.toggle('on',on);
  const seconds=Math.min(MAX_TALK,Math.floor(whisper.elapsed));
  recEl.querySelector('.time').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
const fogWorld=new Vec3(),edgeWorld=new Vec3();
function fogScreen() {
  fog.computeWorldMatrix(true);fogWorld.copy(fog.getAbsolutePosition());
  const c=worldToScreen(fogWorld,{});
  edgeWorld.copy(fogWorld).addScaledVector(camera.getDirection(B.Axis.Y),fogUniforms.uScale.value*1.1);
  const e=worldToScreen(edgeWorld,{});
  return {x:c.x,y:c.y,r:Math.max(48,Math.min(150,Math.hypot(e.x-c.x,e.y-c.y)*1.2))};
}
function canHold() { return started&&!session.ended&&anchor.isEnabled()&&(!markerTracker.state.active||markerTracker.state.visible); }
async function beginHold(pointerId) {
  if(!canHold()||whisper.phase!=='idle')return;
  whisper.pointerId=pointerId;whisper.phase='arming';whisper.voiced=0;whisper.elapsed=0;
  const token=++whisper.token;
  audio.ctx.resume().catch(()=>{});
  say('hold');
  const current=()=>token===whisper.token&&whisper.pointerId===pointerId&&!session.ended&&!document.hidden;
  const result=await openMic(current);
  if(!current()) {
    if(result==='released'&&!session.ended&&whisper.phase==='idle')say('micReady');
    return;
  }
  if(result!=='opened') {
    whisper.pointerId=null;whisper.phase='idle';
    say('micPermission');return;
  }
  whisper.phase='recording';session.recording=true;demoClock=0;
  say('recording');showRec(true);
}
async function finishHold(discard=false) {
  if(!['arming','recording'].includes(whisper.phase))return;
  const wasRecording=whisper.phase==='recording',pointerId=whisper.pointerId;
  whisper.pointerId=null;const token=++whisper.token;mic.paused=true;
  session.recording=false;showRec(false);inflowUniforms.uAlpha.value=0;fogState.target=0;
  whisper.phase=wasRecording&&!discard?'rendering':'idle';
  if(typeof pointerId==='number')try{touchLayer.releasePointerCapture(pointerId);}catch{}
  const buffer=wasRecording?closeMic(discard):null;
  if(!wasRecording||discard||session.ended) {
    whisper.phase='idle';
    if(!session.ended)say('hold');return;
  }
  if(!buffer||whisper.voiced<VOICED_MIN) {
    whisper.phase='idle';say('moreVoice');return;
  }
  say('creating');
  try {
    const layers=await Promise.all([
      renderLayer(buffer,{rate:.62,reverse:false,gain:1.6,delay:.4}),
      renderLayer(buffer,{rate:.5,reverse:true,gain:.9,delay:1.2})
    ]);
    if(session.ended||token!==whisper.token)return;
    if(!layers.every(b=>b&&b.length))throw new Error('Voice music was empty');
    stopMusic();music.voiced=true;music.layers=layers;startMusic();whisper.generation++;
    whisper.phase='idle';
    say('repeat',true);
  }catch(error) {
    if(session.ended||token!==whisper.token)return;
    console.warn('voice music unavailable',error);whisper.phase='idle';
    say('musicError');
  }
}
touchLayer.addEventListener('contextmenu',e=>e.preventDefault());
touchLayer.addEventListener('pointerdown',e=>{
  if(e.button!==0||!canHold())return;
  const f=fogScreen();if(Math.hypot(e.clientX-f.x,e.clientY-f.y)>f.r)return;
  if(whisper.phase!=='idle')return;
  e.preventDefault();try{touchLayer.setPointerCapture(e.pointerId);}catch{}
  beginHold(e.pointerId);
});
touchLayer.addEventListener('pointerup',e=>{if(e.pointerId===whisper.pointerId)finishHold();});
for(const type of ['pointercancel','lostpointercapture'])touchLayer.addEventListener(type,e=>{if(e.pointerId===whisper.pointerId)finishHold(true);});
touchLayer.addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)&&!e.repeat){e.preventDefault();beginHold('keyboard');}});
touchLayer.addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)&&whisper.pointerId==='keyboard'){e.preventDefault();finishHold();}});
addEventListener('blur',()=>finishHold(true));
updaters.add(dt=>{
  if(whisper.phase!=='recording')return;
  demoClock+=dt;whisper.elapsed+=dt;
  const rms=micRms(),level=clamp((rms-.006)*9,0,1);
  if(rms>.02)whisper.voiced+=dt;
  fogState.target=level;fogState.touch=level;
  inflowUniforms.uAlpha.value=.06+level*.3;inflowUniforms.uSpeed.value=.22+level*.35;
  fogUniforms.uScale.value=lerp(fogUniforms.uScale.value,.026+level*.012,Math.min(1,dt*5));
  showRec(true);
  if(whisper.elapsed>=MAX_TALK||mic.full)finishHold();
});

function endSession() {
  if(session.ended)return;
  session.ended=true;whisper.token++;whisper.phase='idle';whisper.pointerId=null;
  session.recording=false;mic.paused=true;closeMic(true);stopMusic();markerTracker.stop();
  ambient.element.pause();ambient.element.currentTime=0;
  tweens.clear();clearTimeout(captionTimer);clearTimeout(markerStatusTimer);
  video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;
  inflowUniforms.uAlpha.value=0;anchor.setEnabled(false);showRec(false);
  $('marker-status').classList.remove('on');$('hud').classList.remove('on');$('end').classList.add('on');
}
let started=false;
async function spawnFogChild() {
  if(mode==='camera') {
    say('qrAim');markerTracker.start();
    if(!await markerTracker.waitForFirst()||session.ended)return;
  }else{anchor.position.set(0,0,0);anchor.setEnabled(true);}
  const token=whisper.token;
  await tween(1200,k=>{if(!session.ended){fogUniforms.uAlpha.value=k;fogUniforms.uScale.value=lerp(.004,.028,k);iceCore.userData.show=k;}});
  if(!session.ended&&token===whisper.token)say('hold');
}
document.addEventListener('visibilitychange',()=>{
  if(!started||session.ended)return;
  if(document.hidden){finishHold(true);audio.ctx.suspend().catch(()=>{});ambient.element.pause();}
  else {audio.ctx.resume().catch(()=>{});ambient.element.play().catch(()=>{});}
});

// =====================================================================
// Modes and loop
// =====================================================================
let mode = null;
const view = { yaw: 0.5, pitch: 0.55 };

function applyView() {
  if (mode === 'camera') {
    camera.position.set(0, 0, 0);
    // QR pose is recovered relative to the current camera frame, including its rotation.
    camera.rotationQuaternion.set(0,0,0,1);
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
}

function start3D() {
  mode = '3d';
  document.body.className = 'mode-3d';
}

const camSupported = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
const startBtn = $('start');

async function boot() {
  startBtn.dataset.mode=params.get('mode')==='3d'?'3d':'camera';
  const ready=()=>{startBtn.disabled=false;startBtn.dataset.i18n='start';startBtn.textContent=t('start');$('load-status').textContent='';};
  const timeout=setTimeout(ready,12000);
  try{await loadModels(p=>{$('load-status').textContent=`${Math.round(p*100)}%`;});buildIce();}
  catch(error){console.warn('model unavailable',error);buildIce();}
  clearTimeout(timeout);ready();
}
async function begin(kind) {
  if(started)return;
  startBtn.disabled=true;audio.ctx.resume().catch(()=>{});startAmbient();
  try {
    if(kind==='3d')start3D();
    else {
      if(!camSupported)throw new Error('Camera needs a supported HTTPS browser');
      await startCamera();
    }
    started=true;$('intro').classList.add('hidden');$('hud').classList.add('on');spawnFogChild();
  }catch(error) {
    video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;
    ambient.element.pause();console.warn('camera unavailable',error);startBtn.disabled=false;startBtn.dataset.i18n='cameraRetry';startBtn.textContent=t('cameraRetry');
    $('load-status').dataset.i18n='cameraError';$('load-status').textContent=t('cameraError');
  }
}
startBtn.addEventListener('click', () => begin(startBtn.dataset.mode));

$('btn-sound').addEventListener('click', () => {
  audio.ctx.resume().catch(()=>{});
  audio.muted = !audio.muted;
  audio.master.gain.setTargetAtTime(audio.muted ? 0 : 1, audio.ctx.currentTime, 0.05);
  $('snd-wave').style.opacity = audio.muted ? 0.15 : 1;
  $('btn-sound').setAttribute('aria-label',t(audio.muted?'unmute':'mute'));
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

for(const select of document.querySelectorAll('.language-picker'))select.addEventListener('change',()=>applyLanguage(select.value,true));
applyLanguage(language);boot();

if (params.has('debug')) window.__tt = { markerTracker, BABYLON:B, engine, scene, camera, anchor, fog, fogState, fogUniforms, music, mic, whisper, fogScreen, session, ambient, spatial, audio };
