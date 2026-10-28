import { createFogView, Vec3 } from './unity-view.js?v=20261029-ar-alpha-8';
import { createQRMarkerTracker, markerPose } from './qr-marker.js?v=20261029-ar-alpha-8';
import { messages, chooseLanguage } from './strings.js?v=20261029-ar-alpha-8';
import { createGuidance } from './guidance.js?v=20261029-ar-alpha-8';
import { exhibitionOpen } from './exhibition.js?v=20261029-ar-alpha-8';

// The Lost Room 2: QR → Fog Child → hold the child while speaking → release for music.
// Camera and voice processing stay in this browser; nothing is uploaded.
// ?mode=3d is a camera-free development preview, not the default experience.

const params = new URLSearchParams(location.search);
let language=chooseLanguage({requested:params.get('lang'),languages:navigator.languages?.length?navigator.languages:[navigator.language]});
const t=key=>messages[language][key]||messages.en[key]||key;
// Screen and narration follow the phone's primary language; other languages use English.
function applyLanguage(value) {
  if(!messages[value])return;
  language=value;document.documentElement.lang=value;document.title=t('pageTitle');
  for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=t(node.dataset.i18n);
  $('touch').setAttribute('aria-label',t('holdLabel'));
  $('music-progress').setAttribute('aria-label',t('musicProgress'));
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
  radio, radioState, iceCore, loadModels, buildIce } = createFogView(canvas, { updaters, time, lerp, clamp });
const interactionNode=()=>fogState.form==='radio'?radio:fog;

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
spatial.panner.refDistance=.35;spatial.panner.maxDistance=3;spatial.panner.rolloffFactor=.7;
spatial.presence.gain.value=0;spatial.meter.fftSize=1024;
// Only the child's sounds need a QR position. The room bed and instructions
// must already be audible while the visitor is looking for the QR.
audio.child = audio.ctx.createGain();
spatial.childMeter=audio.ctx.createAnalyser();spatial.childMeter.fftSize=1024;
audio.child.connect(spatial.panner).connect(spatial.presence).connect(spatial.childMeter).connect(audio.master);
audio.master.connect(spatial.meter).connect(audio.ctx.destination);
const soundPosition=new B.Vector3(),soundForward=new B.Vector3(),soundUp=new B.Vector3(),soundForwardAxis=new B.Vector3(0,0,-1);
function setAudioVector(node,prefix,v) {
  const now=audio.ctx.currentTime;
  if(node[prefix+'X'])for(const [axis,value] of [['X',v.x],['Y',v.y],['Z',v.z]])node[prefix+axis].setTargetAtTime(value,now,.08);
  else if(prefix==='position')node.setPosition(v.x,v.y,v.z);
}
updaters.add(()=>{
  if(!started)return;
  const emitter=interactionNode();emitter.computeWorldMatrix(true);soundPosition.copyFrom(emitter.getAbsolutePosition());
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
ambient.element.loop=true;ambient.element.preload='auto';
const guidance=createGuidance({context:audio.ctx,output:audio.master,language,muted:audio.muted,
  canPlay:()=>!session.ended&&!session.interrupted&&!document.hidden&&!['arming','recording'].includes(whisper.phase)});
function updateSoundPrompt() {
  $('sound-start').hidden=audio.muted||session.ended||session.interrupted||document.hidden||
    (audio.ctx.state==='running'&&!ambient.element.paused);
}
function startAmbient() {
  if(!ambient.gain){ambient.gain=audio.ctx.createGain();ambient.gain.gain.value=.32;audio.ctx.createMediaElementSource(ambient.element).connect(ambient.gain).connect(audio.master);}
  if(!ambient.element.paused)return;
  ambient.element.play().then(updateSoundPrompt).catch(error=>{
    updateSoundPrompt();
    if(error.name!=='NotAllowedError'&&error.name!=='AbortError')console.warn('Background audio unavailable',error);
  });
}
function activateAudio() {
  if(!exhibitionOpen()||audio.muted||session.ended||session.interrupted||document.hidden)return;
  // Call both APIs inside the original gesture, before any permission awaits.
  audio.ctx.resume().then(()=>{guidance.resume();updateSoundPrompt();}).catch(updateSoundPrompt);
  startAmbient();updateSoundPrompt();
}
audio.ctx.addEventListener('statechange',updateSoundPrompt);
updaters.add(()=>{
  if(!ambient.gain)return;
  const speaking=['arming','recording'].includes(whisper.phase);
  const target=session.ended?0:speaking ? .004 : guidance.state.playing ? .025 : music.on ? .06 : .32;
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
// The same voice-derived composition as the headset, rendered off the UI thread.
const NOTES = [220, 277.18, 329.63, 415.3, 493.88];
const VOICED_MIN = 0.6; // seconds of voice needed to call the result "music from your voice"

// A soft, falling water note uses the same pitch palette as the voice music.
// It shares the child's spatial/mute path and never repeats while a finger is held.
const touchSound={active:new Set(),count:0,lastAt:-Infinity};
function stopTouchSounds(fade=.012) {
  const now=audio.ctx.currentTime;
  for(const voice of touchSound.active){
    voice.envelope.gain.cancelScheduledValues(now);
    voice.envelope.gain.setValueAtTime(Math.max(.0001,voice.envelope.gain.value),now);
    if(fade)voice.envelope.gain.exponentialRampToValueAtTime(.0001,now+fade);
    else voice.envelope.gain.setValueAtTime(0,now);
    for(const oscillator of voice.oscillators)try{oscillator.stop(now+fade+.002);}catch{}
  }
}
function playTouchSound() {
  const c=audio.ctx,now=c.currentTime;
  if(audio.muted||document.hidden||session.ended||now-touchSound.lastAt<.12)return;
  c.resume().catch(()=>{});
  if(touchSound.active.size>=2)stopTouchSounds(.01);
  const base=NOTES[[0,2,1,4][touchSound.count%4]]*2;
  const envelope=c.createGain(),filter=c.createBiquadFilter();
  filter.type='lowpass';filter.frequency.value=2200;filter.Q.value=.3;
  envelope.gain.setValueAtTime(.0001,now);
  envelope.gain.linearRampToValueAtTime(.09,now+.014);
  envelope.gain.exponentialRampToValueAtTime(.0001,now+.34);
  envelope.connect(filter).connect(audio.child);
  const fundamental=c.createOscillator(),overtone=c.createOscillator(),overtoneGain=c.createGain();
  fundamental.type=overtone.type='sine';overtoneGain.gain.value=.16;
  fundamental.frequency.setValueAtTime(base*1.035,now);
  fundamental.frequency.exponentialRampToValueAtTime(base,now+.10);
  overtone.frequency.setValueAtTime(base*2,now);
  fundamental.connect(envelope);overtone.connect(overtoneGain).connect(envelope);
  const voice={envelope,oscillators:[fundamental,overtone]};touchSound.active.add(voice);
  fundamental.onended=()=>{
    fundamental.disconnect();overtone.disconnect();overtoneGain.disconnect();envelope.disconnect();filter.disconnect();
    touchSound.active.delete(voice);
  };
  fundamental.start(now);overtone.start(now);fundamental.stop(now+.36);overtone.stop(now+.36);
  touchSound.lastAt=now;touchSound.count++;fogState.touch=.65;
}

// The story's piece: the same StoryMusic as the headset, rendered in a worker from the 16 kHz voice.
// Its loop is seamless (the tail is folded onto the start), so one looping source is enough.
const STORY_WORKER='story-music.js?v=20261029-ar-alpha-8';
const story={worker:null,cancel:null,version:0};
async function voiceAt16k(buffer) {
  const rate=16000,length=Math.max(1,Math.ceil(buffer.duration*rate));
  const off=new OfflineAudioContext(1,length,rate);
  const source=off.createBufferSource();source.buffer=buffer;source.connect(off.destination);source.start(0);
  const out=await off.startRendering();
  return Float32Array.from(out.getChannelData(0));
}
function cancelStory() {
  story.version++;
  story.cancel?.();story.cancel=null;
  story.worker?.terminate();story.worker=null;
}
async function composeStory(buffer,onProgress=()=>{}) {
  cancelStory();
  const version=story.version;
  const voice=await voiceAt16k(buffer);
  if(version!==story.version)throw new DOMException('Music cancelled','AbortError');
  const worker=new Worker(STORY_WORKER);story.worker=worker;
  const result=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Music took too long')),45000);
    const settle=fn=>value=>{clearTimeout(timeout);fn(value);};
    story.cancel=()=>settle(reject)(new DOMException('Music cancelled','AbortError'));
    worker.onmessage=e=>{
      if(typeof e.data.progress==='number'){onProgress(e.data.progress);return;}
      e.data.error?settle(reject)(new Error(e.data.error)):settle(resolve)(e.data);
    };
    worker.onerror=e=>settle(reject)(new Error(e.message||'Story music worker failed'));
    worker.onmessageerror=()=>settle(reject)(new Error('Music could not be read'));
    worker.postMessage({voice,melt:true},[voice.buffer]);
  }).finally(()=>{if(story.worker===worker){story.worker=null;story.cancel=null;}worker.terminate();});
  if(!(result.samples instanceof Float32Array)||!result.samples.length||!Number.isFinite(result.rate))throw new Error('Music was empty');
  let peak=0;
  for(const sample of result.samples){if(!Number.isFinite(sample))throw new Error('Music was invalid');peak=Math.max(peak,Math.abs(sample));}
  if(peak<.0001)throw new Error('Music was silent');
  if(result.summary)console.info(result.summary);
  const music=audio.ctx.createBuffer(1,result.samples.length,result.rate);
  music.getChannelData(0).set(result.samples);
  return music;
}

const music = { on: false, voiced: false, source: null, nodes: null, analyser: null };

// Play the rendered piece as one seamless loop.
function startMusic(buffer) {
  stopMusic();
  const c = audio.ctx;
  const now = c.currentTime;
  const n = {};
  n.out = c.createGain(); n.out.gain.value = 0;
  n.tone = c.createBiquadFilter(); n.tone.type = 'lowpass'; n.tone.frequency.value = 4200; n.tone.Q.value = 0.7;
  n.dry = c.createGain(); n.dry.gain.value = 0.85;
  n.space = c.createConvolver(); n.space.buffer = makeImpulse(3.2);
  n.wet = c.createGain(); n.wet.gain.value = 0.18;
  n.tone.connect(n.dry).connect(n.out);
  n.tone.connect(n.space).connect(n.wet).connect(n.out);
  music.analyser = c.createAnalyser(); music.analyser.fftSize = 1024;
  n.out.connect(music.analyser);
  n.out.connect(audio.child);
  const source = c.createBufferSource();
  source.buffer = buffer;source.loop = true;source.connect(n.tone);source.start(now + 0.05);
  music.source = source;
  n.out.gain.setTargetAtTime(1, now, 0.8);
  music.nodes = n;
  music.on = true;
  c.resume().then(updateSoundPrompt).catch(updateSoundPrompt);
}

function stopMusic() {
  try { music.source?.stop(); } catch {}
  try { music.source?.disconnect(); } catch {}
  for(const node of Object.values(music.nodes||{}))try{node.disconnect();}catch{}
  music.analyser?.disconnect();
  music.source = null; music.nodes = null; music.analyser = null; music.on = false;
}

// A touch opens the tone for a moment; the piece falls silent while a new story is told.
updaters.add(() => {
  const n = music.nodes;
  if (!n) return;
  const t = audio.ctx.currentTime;
  n.tone.frequency.setTargetAtTime(clamp(4200 + fogState.touch * 3000, 500, 9000), t, 0.06);
  n.out.gain.setTargetAtTime(['arming','recording'].includes(whisper.phase) ? 0 : 1, t, .12);
});

// The Fog Child moves with its music.
const anaBuf = new Float32Array(1024);
const spectrumBuf = new Float32Array(512);
let nextSpectrumAt=0;
updaters.add(() => {
  if (!music.analyser || whisper.phase === 'recording') return;
  music.analyser.getFloatTimeDomainData(anaBuf);
  let rms = 0;
  for (let i = 0; i < anaBuf.length; i++) rms += anaBuf[i] * anaBuf[i];
  fogState.target = clamp(Math.sqrt(rms / anaBuf.length) * 5, 0, 1);
  const now=audio.ctx.currentTime;
  if(now>=nextSpectrumAt){
    nextSpectrumAt=now+1/30;music.analyser.getFloatFrequencyData(spectrumBuf);
    const binHz=audio.ctx.sampleRate/music.analyser.fftSize;
    const band=(low,high,gain)=>{
      const from=Math.max(1,Math.ceil(low/binHz)),to=Math.min(spectrumBuf.length,Math.ceil(high/binHz));
      let power=0;for(let i=from;i<to;i++)if(Number.isFinite(spectrumBuf[i]))power+=Math.pow(10,spectrumBuf[i]/10);
      return clamp(Math.sqrt(power/Math.max(1,to-from))*gain,0,1);
    };
    fogState.bass=band(60,280,10);fogState.mid=band(280,1600,18);
  }
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
    // The second scan creates the child. Losing sight of the QR afterward does
    // not undo that creation or interrupt a story; retain the last camera pose.
    anchor.setEnabled((visible||locked) && !session.ended && !session.interrupted);
    $('scan-guide').hidden=locked;
    if (session.ended) { status.classList.remove('on');return; }
    if(!locked){status.classList.remove('on');return;}
    if(locked&&!visible){status.classList.remove('on');return;}
    status.dataset.i18n=visible?'qrFound':locked?'qrAgain':'qrFull';status.textContent=t(status.dataset.i18n);
    status.classList.add('on');
    if (visible) markerStatusTimer=setTimeout(()=>status.classList.remove('on'),1800);
  }
});
// Hold the Fog Child to speak. Releasing the same pointer makes its music.
// =====================================================================
const touchLayer=$('touch');
const session={ended:false,recording:false,interrupted:false};
const whisper={phase:'idle',pointerId:null,token:0,voiced:0,elapsed:0,generation:0};
const captionEl=$('caption');
let captionTimer=0;
let captionKey=null;
let musicActionsTimer=0;
function hideMusicActions(){clearTimeout(musicActionsTimer);$('music-actions').hidden=true;}
function say(key,fade=false) {
  clearTimeout(captionTimer);
  captionKey=key;captionEl.querySelector('.ko').textContent=key?t(key):'';
  captionEl.querySelector('.hint').textContent=key==='hold'&&fogState.form==='radio'?t('radioHint'):'';
  captionEl.classList.toggle('on',!!key);
  captionEl.classList.toggle('creating',key==='creating');
  captionEl.classList.toggle('music-note',key==='repeat');
  $('music-progress').hidden=key!=='creating';
  hideMusicActions();
  if(key&&music.on&&fogState.form==='child'&&whisper.phase==='idle')musicActionsTimer=setTimeout(()=>{
    if(!session.ended&&!session.interrupted&&whisper.phase==='idle')$('music-actions').hidden=false;
  },key==='repeat'?6000:1000);
  guidance.say(key);
  if(fade&&key!=='repeat')captionTimer=setTimeout(()=>{if(whisper.phase==='idle')captionEl.classList.remove('on');},6000);
}
function setPhase(phase) {
  whisper.phase=phase;document.body.dataset.phase=phase;
  radioState.recording=phase==='recording';radioState.preparing=phase==='rendering';
  if(phase==='arming'||phase==='recording')guidance.stop();
  touchLayer.setAttribute('aria-busy',String(phase==='rendering'));
  if(phase!=='idle')hideMusicActions();
}
const recEl=$('rec');
function showRec(on) {
  recEl.classList.toggle('on',on);
  const seconds=Math.min(MAX_TALK,Math.floor(whisper.elapsed));
  recEl.querySelector('.time').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
const fogWorld=new Vec3(),edgeWorld=new Vec3();
function fogScreen() {
  const target=interactionNode();target.computeWorldMatrix(true);fogWorld.copy(target.getAbsolutePosition());
  const c=worldToScreen(fogWorld,{});
  edgeWorld.copy(fogWorld).addScaledVector(camera.getDirection(B.Axis.Y),fogState.form==='radio'?.04:fogUniforms.uScale.value*1.1);
  const e=worldToScreen(edgeWorld,{});
  return {x:c.x,y:c.y,r:Math.max(48,Math.min(150,Math.hypot(e.x-c.x,e.y-c.y)*1.2))};
}
function canHold() { return exhibitionOpen()&&started&&!session.ended&&!session.interrupted&&(fogState.form==='radio'?radioState.ready&&radioState.alpha>.85:fogUniforms.uAlpha.value>.85)&&anchor.isEnabled()&&(!markerTracker.state.active||markerTracker.state.locked); }
async function beginHold(pointerId) {
  if(!canHold()||['arming','recording'].includes(whisper.phase))return;
  playTouchSound();
  if(fogState.form==='child'){fogState.touch=1;return;}
  if(whisper.phase!=='idle')return;
  whisper.pointerId=pointerId;setPhase('arming');whisper.voiced=0;whisper.elapsed=0;
  const token=++whisper.token;
  audio.ctx.resume().catch(()=>{});
  say('micOpening');
  const current=()=>token===whisper.token&&whisper.pointerId===pointerId&&!session.ended&&!document.hidden;
  const result=await openMic(current);
  if(!current()) {
    if(result==='released'&&!session.ended&&whisper.phase==='idle')say('micReady');
    return;
  }
  if(result!=='opened') {
    whisper.pointerId=null;setPhase('idle');
    say('micPermission');return;
  }
  // Fade the touch response as the microphone opens; echo cancellation is also enabled.
  stopTouchSounds();
  setPhase('recording');session.recording=true;demoClock=0;
  say(null);showRec(true);
}
async function finishHold(discard=false) {
  if(!['arming','recording'].includes(whisper.phase))return;
  const wasRecording=whisper.phase==='recording',pointerId=whisper.pointerId;
  whisper.pointerId=null;const token=++whisper.token;mic.paused=true;
  session.recording=false;showRec(false);fogState.target=0;
  const gatheringAlpha=inflowUniforms.uAlpha.value;
  if(discard)inflowUniforms.uAlpha.value=0;
  else tween(500,k=>{if(token===whisper.token)inflowUniforms.uAlpha.value=gatheringAlpha*(1-k);});
  setPhase(wasRecording&&!discard?'rendering':'idle');
  if(typeof pointerId==='number')try{touchLayer.releasePointerCapture(pointerId);}catch{}
  const buffer=wasRecording?closeMic(discard):null;
  if(!wasRecording||discard||session.ended) {
    setPhase('idle');
    if(!session.ended)say('hold');return;
  }
  if(!buffer||whisper.voiced<VOICED_MIN) {
    setPhase('idle');say('moreVoice');return;
  }
  say('creating');
  $('music-progress').value=0;
  try {
    const piece=await composeStory(buffer,progress=>{
      if(token===whisper.token)$('music-progress').value=progress;
    });
    if(session.ended||token!==whisper.token)return;
    if(!piece||!piece.length)throw new Error('Voice music was empty');
    // Unity's BirthFromRadio: swallow the last particles, pause for a breath,
    // then start the music as the child comes out through the speaker grille.
    await tween(700,()=>{});
    await tween(150,()=>{});
    if(session.ended||token!==whisper.token)return;
    music.voiced=true;startMusic(piece);whisper.generation++;
    fogState.form='child';
    touchLayer.setAttribute('aria-label',t('childLabel'));
    radioState.grille.computeWorldMatrix(true);
    const birthWorld=radioState.grille.getAbsolutePosition().clone();
    const outward=radioState.grille.getDirection(new B.Vector3(0,0,-1)).normalize();
    birthWorld.addInPlace(outward.scale(.06*radioState.scale));
    const birthLocal=B.Vector3.TransformCoordinates(birthWorld,anchor.getWorldMatrix().clone().invert());
    const resting=new Vec3(0,.14,0);fogState.home.copyFrom(birthLocal);
    tween(3400,k=>{
      if(session.ended||token!==whisper.token)return;
      const seconds=k*3.4,grow=clamp((seconds-.3)/1.6,0,1),travel=clamp((seconds-1.3)/2,0,1);
      const smooth=v=>v*v*(3-2*v);
      fogUniforms.uAlpha.value=smooth(grow);fogUniforms.uScale.value=.028*smooth(grow);
      B.Vector3.LerpToRef(birthLocal,resting,smooth(travel),fogState.home);
    });
    setPhase('idle');fogState.touch=1;
    say('repeat',true);
  }catch(error) {
    if(session.ended||token!==whisper.token)return;
    console.warn('voice music unavailable',error);setPhase('idle');
    say('musicError');
  }
}
touchLayer.addEventListener('contextmenu',e=>e.preventDefault());
touchLayer.addEventListener('pointerdown',e=>{
  if(e.button!==0||!canHold())return;
  const f=fogScreen();if(Math.hypot(e.clientX-f.x,e.clientY-f.y)>f.r)return;
  e.preventDefault();if(whisper.phase==='idle')try{touchLayer.setPointerCapture(e.pointerId);}catch{}
  beginHold(e.pointerId);
});
touchLayer.addEventListener('pointerup',e=>{if(e.pointerId===whisper.pointerId)finishHold();});
for(const type of ['pointercancel','lostpointercapture'])touchLayer.addEventListener(type,e=>{if(e.pointerId===whisper.pointerId)finishHold(true);});
touchLayer.addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)&&!e.repeat){e.preventDefault();beginHold('keyboard');}});
touchLayer.addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)&&whisper.pointerId==='keyboard'){e.preventDefault();finishHold();}});
addEventListener('blur',()=>finishHold(true));
updaters.add(()=>{
  const enabled=canHold();
  touchLayer.tabIndex=enabled?0:-1;
  touchLayer.setAttribute('aria-disabled',String(!enabled||whisper.phase==='rendering'));
});
updaters.add(dt=>{
  if(whisper.phase!=='recording')return;
  demoClock+=dt;whisper.elapsed+=dt;
  const rms=micRms(),level=clamp((rms-.006)*9,0,1);
  if(rms>.02)whisper.voiced+=dt;
  fogState.target=level;fogState.touch=level;
  inflowUniforms.uAlpha.value=.22+level*.65;inflowUniforms.uSpeed.value=.30+level*.65;
  fogUniforms.uScale.value=lerp(fogUniforms.uScale.value,.026+level*.012,Math.min(1,dt*5));
  showRec(true);
  if(whisper.elapsed>=MAX_TALK||mic.full)finishHold();
});

// Closing or navigating away releases every media resource, including on bfcache entry.
function endSession() {
  session.ended=true;session.recording=false;whisper.pointerId=null;whisper.token++;
  hideMusicActions();
  engine.stopRenderLoop();
  cancelStory();closeMic(true);stopMusic();stopTouchSounds(0);markerTracker.stop();guidance.dispose();
  ambient.element.pause();ambient.element.removeAttribute('src');ambient.element.load();
  video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;
  anchor.setEnabled(false);clearTimeout(captionTimer);clearTimeout(markerStatusTimer);
  setPhase('idle');showRec(false);
  audio.ctx.suspend().catch(()=>{});
  updateSoundPrompt();
}
addEventListener('pagehide',endSession);
function finishExperience(){
  if(session.ended)return;
  endSession();$('hud').classList.remove('on');$('resume').hidden=true;
  captionEl.classList.remove('on');$('scan-guide').hidden=true;$('end').hidden=false;
  audio.ctx.close().catch(()=>{});$('end').focus();window.close();
}
$('finish').addEventListener('click',finishExperience);
$('tell-again').addEventListener('click',()=>{
  if(session.ended||whisper.phase!=='idle')return;
  whisper.token++; // Invalidate a still-finishing birth before returning to the radio.
  fog.setEnabled(false);
  fogState.form='radio';fogUniforms.uAlpha.value=0;radioState.alpha=1;
  touchLayer.setAttribute('aria-label',t('holdLabel'));
  say('hold');touchLayer.focus();fogState.touch=.45;
});
// A restored browser history page must open a fresh session and request a new camera.
addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
let started=false;
async function spawnFogChild() {
  if(mode==='camera') {
    say('qrAim');$('scan-guide').hidden=false;markerTracker.start();
    if(!await markerTracker.waitForFirst()||session.ended)return;
  }else{anchor.position.set(0,0,0);anchor.setEnabled(true);}
  await visualAssetsReady;
  if(!radioState.ready||session.ended)return;
  const token=whisper.token;fogState.form='radio';fogUniforms.uAlpha.value=0;
  await tween(900,k=>{if(!session.ended)radioState.alpha=k;});
  if(!session.ended&&token===whisper.token)say('hold');
}
document.addEventListener('visibilitychange',()=>{
  if(!started||session.ended)return;
  if(document.hidden){
    finishHold(true);stopTouchSounds(0);guidance.stop();audio.ctx.suspend().catch(()=>{});ambient.element.pause();
    markerTracker.pause();anchor.setEnabled(false);session.interrupted=true;hideMusicActions();updateSoundPrompt();engine.stopRenderLoop();
  } else showResume();
});

function showResume(cameraLost=false) {
  session.interrupted=true;
  guidance.stop();ambient.element.pause();updateSoundPrompt();
  $('resume').hidden=false;$('resume-text').textContent=t(cameraLost?'cameraInterrupted':'resumeNote');
  $('resume-button').textContent=t('resume');
}
$('resume-button').addEventListener('click',async()=>{
  if(!exhibitionOpen())return;
  const button=$('resume-button');button.disabled=true;
  try {
    // Start media in the click, before camera permissions can consume activation.
    session.interrupted=false;activateAudio();
    if(mode==='camera'){
      if(!video.srcObject?.getVideoTracks().some(track=>track.readyState==='live'))await startCamera();
      else await video.play();
      markerTracker.start();
    }else anchor.setEnabled(true);
    if(session.ended)return;
    session.interrupted=false;$('resume').hidden=true;startAmbient();last=performance.now();engine.runRenderLoop(renderFrame);
    if(mode==='3d'||markerTracker.state.locked)anchor.setEnabled(true);
    if(whisper.phase!=='rendering')say(mode==='camera'&&!markerTracker.state.locked?'qrAim':music.on?'repeat':'hold',music.on);
  }catch(error){showResume(true);$('resume-text').textContent=t('cameraError');}
  finally{button.disabled=false;}
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
  if(!exhibitionOpen())throw new Error('Exhibition ended');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  if(!exhibitionOpen()||session.ended){stream.getTracks().forEach(t=>t.stop());throw new Error('Session ended');}
  video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject = stream;
  try{await video.play();}catch(error){stream.getTracks().forEach(t=>t.stop());video.srcObject=null;throw error;}
  for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{
    if(session.ended||video.srcObject!==stream)return;
    finishHold(true);markerTracker.pause();anchor.setEnabled(false);showResume(true);
  });
  mode = 'camera';
  document.body.className = 'mode-camera';
}

function start3D() {
  mode = '3d';
  document.body.className = 'mode-3d';
}

const camSupported = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
// Opening the QR URL requests the camera; only denied permission needs a retry button.
const intro = $('intro'), startLine = $('start'), loadStatus = $('load-status');
const ready = { models: false, failed: false };
let resolveVisualAssets;
const visualAssetsReady=new Promise(resolve=>{resolveVisualAssets=resolve;});

async function boot() {
  // Camera permission must not wait for models, textures or their download.
  ready.models=true;begin();
  const done=()=>{buildIce();ready.models=true;if(!ready.failed){startLine.dataset.i18n='cameraOpening';startLine.textContent=t('cameraOpening');loadStatus.textContent='';}if(!started&&!beginning&&!ready.failed)begin();};
  const timeout=setTimeout(done,4000);
  try{await loadModels(p=>{if(!ready.models)loadStatus.textContent=`${Math.round(p*100)}%`;});}
  catch(error){console.warn('model unavailable',error);buildIce();}
  clearTimeout(timeout);resolveVisualAssets();done();
}
let beginning=false;
async function begin() {
  if(!exhibitionOpen()||started||beginning||!ready.models)return;
  beginning=true;ready.failed=false;startLine.disabled=true;
  activateAudio();
  try {
    if(params.get('mode')==='3d')start3D();
    else {
      if(!camSupported)throw new Error('Camera needs a supported HTTPS browser');
      await startCamera();
    }
    if(session.ended)return;
    started=true;intro.classList.add('hidden');intro.inert=true;$('hud').classList.add('on');spawnFogChild();
  }catch(error) {
    video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;
    ambient.element.pause();console.warn('camera unavailable',error);ready.failed=true;
    startLine.hidden=false;startLine.disabled=false;startLine.dataset.i18n='cameraRetry';startLine.textContent=t('cameraRetry');
    loadStatus.dataset.i18n='cameraError';loadStatus.textContent=t('cameraError');
  }
  beginning=false;
}
startLine.addEventListener('click',()=>begin());
// Try on entry; when autoplay is blocked, any genuine touch/key unlocks it.
// Touch-end covers mobile browsers that do not accept touch pointer-down.
for(const type of ['pointerdown','pointerup','touchend','keydown'])
  addEventListener(type,activateAudio,{passive:true,capture:true});
$('sound-start').addEventListener('click',activateAudio);

addEventListener('resize', () => {
  engine.resize();
});

const T0 = performance.now();
let last = T0;
function renderFrame() {
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
}
engine.runRenderLoop(renderFrame);

window.addEventListener('exhibition-ended',()=>{
  endSession();engine.stopRenderLoop();audio.ctx.close().catch(()=>{});
});
applyLanguage(language);setPhase('idle');if(exhibitionOpen()){activateAudio();guidance.preload();boot();}

if (params.has('debug')) window.__tt = { markerTracker, BABYLON:B, engine, scene, camera, anchor, fog, radio, radioState, fogState, fogUniforms, music, mic, whisper, fogScreen, session, ambient, spatial, audio, touchSound, story, guidance, composeStory, cancelStory, endSession, begin };
