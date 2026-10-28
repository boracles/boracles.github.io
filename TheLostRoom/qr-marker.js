// A normal, printable QR is both the entry URL and the physical placement target.
// Camera frames stay on the device. jsQR supplies the four code corners, without
// the quiet zone; a planar pose is recovered using the camera projection.
export const MARKER_URL = 'https://boracles.art/TheLostRoom/';
export const PRINTED_QR_METRES = 0.034; // 34 mm including the four-module quiet zone

export function isOurMarker(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['boracles.art', 'boracles.github.io'].includes(url.hostname) &&
      url.pathname.replace(/\/$/, '') === '/TheLostRoom';
  } catch { return false; }
}

// Map the uncropped camera pixels to the displayed object-fit:cover video.
export function videoPointToScreen(point, frameWidth, frameHeight, width, height) {
  const scale = Math.max(width / frameWidth, height / frameHeight);
  return { x: point.x * scale + (width - frameWidth * scale) / 2,
    y: point.y * scale + (height - frameHeight * scale) / 2 };
}

function solve(matrix, values) {
  const a = matrix.map((row, i) => [...row, values[i]]), n = values.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-10) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const divisor = a[c][c];
    for (let k = c; k <= n; k++) a[c][k] /= divisor;
    for (let r = 0; r < n; r++) if (r !== c) {
      const factor = a[r][c];
      for (let k = c; k <= n; k++) a[r][k] -= factor * a[c][k];
    }
  }
  return a.map(row => row[n]);
}
const norm = a => Math.hypot(...a);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const unit = a => { const n = norm(a); return a.map(v => v / n); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

// Right-handed camera coordinates: +x right, +y up, visible objects at -z.
// Axis y points out of the paper, so the Fog Child floats above the QR.
export function markerPose(corners, { width, height, fx, fy, modules = 29, size = PRINTED_QR_METRES }) {
  if (corners.length !== 4 || !corners.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const half = size * modules / (modules + 8) / 2;
  const square = [[-half, half], [half, half], [half, -half], [-half, -half]];
  const rows = [], values = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = square[i], u = (corners[i].x - width/2)/fx, v = (height/2 - corners[i].y)/fy;
    rows.push([x,y,1,0,0,0,-u*x,-u*y], [0,0,0,x,y,1,-v*x,-v*y]);
    values.push(u,v);
  }
  const h = solve(rows, values);
  if (!h) return null;
  const a = [h[0],h[3],-h[6]], b = [h[1],h[4],-h[7]];
  const na = norm(a), nb = norm(b);
  if (!na || !nb || Math.max(na/nb,nb/na) > 1.7 || Math.abs(dot(a,b)/(na*nb)) > .45) return null;
  const scale = 2 / (na+nb), x = unit(a), up = unit(b.map((v,i)=>v-x[i]*dot(b,x)));
  const normal = unit(cross(x,up));
  const position = [h[2]*scale,h[5]*scale,-scale];
  if (!position.every(Number.isFinite) || scale < .025 || scale > 3) return null;
  return { position, x, y: normal, z: up.map(v=>-v), depth: scale };
}

export function createQRMarkerTracker({ video, onPose, onVisibility }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let timer = 0, running = false, resolveFirst = null, lastSeen = 0, consecutive = 0;
  let announced = false, first = true;
  let decoder=null,workerFailed=false,pending=null,decodeTimer=0,runVersion=0;
  const state = { active: false, visible: false, locked: false, detections: 0, url: null, worker:false,scanMs:0 };
  function releaseDecoder(){
    clearTimeout(decodeTimer);decoder?.terminate();decoder=null;state.worker=false;
    pending?.(null);pending=null;
  }
  function decode(pixels,width,height){
    if(!workerFailed&&typeof Worker==='function'){
      if(!decoder){
        try{
          decoder=new Worker('qr-scan-worker.js?v=20261029-ar-alpha-8');state.worker=true;
          decoder.onmessage=({data})=>{
            clearTimeout(decodeTimer);const resolve=pending;pending=null;
            if(data.error){workerFailed=true;releaseDecoder();}
            resolve?.(data.code||null);
          };
          decoder.onerror=()=>{workerFailed=true;releaseDecoder();};
        }catch{workerFailed=true;releaseDecoder();}
      }
      if(decoder)return new Promise(resolve=>{
        pending=resolve;
        decodeTimer=setTimeout(()=>{workerFailed=true;releaseDecoder();},2000);
        decoder.postMessage({pixels:pixels.data.buffer,width,height},[pixels.data.buffer]);
      });
    }
    return Promise.resolve(globalThis.jsQR?.(pixels.data,width,height,{inversionAttempts:'dontInvert'})||null);
  }
  function visibility(visible) {
    state.visible = visible;
    if (announced !== visible) { announced = visible; onVisibility(visible, state.locked); }
  }
  async function scan() {
    if (!running) return;
    const version=runVersion;
    try {
      if (!document.hidden && video.readyState >= 2 && video.videoWidth && typeof globalThis.jsQR === 'function') {
        const s = Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
        const w = Math.round(video.videoWidth*s), h = Math.round(video.videoHeight*s);
        if (canvas.width !== w || canvas.height !== h) { canvas.width=w; canvas.height=h; }
        ctx.drawImage(video,0,0,w,h);
        const pixels = ctx.getImageData(0,0,w,h);
        const began=performance.now();
        const code = await decode(pixels,w,h);
        if(!running||version!==runVersion)return;
        state.scanMs=performance.now()-began;
        let accepted = false;
        if (code && isOurMarker(code.data)) {
          const corners = ['topLeftCorner','topRightCorner','bottomRightCorner','bottomLeftCorner']
            .map(key=>videoPointToScreen(code.location[key],w,h,innerWidth,innerHeight));
          if (corners.every(p=>p.x>=0 && p.y>=0 && p.x<=innerWidth && p.y<=innerHeight)) {
            const modules = 17 + code.version*4;
            accepted = onPose(corners,modules,first || performance.now()-lastSeen>650) !== false;
            if (accepted) {
              lastSeen=performance.now();consecutive++;state.detections++;state.url=code.data;
              if (consecutive>=3) {
                state.locked=true;first=false;visibility(true);
                resolveFirst?.(true);resolveFirst=null;
              }
            }
          }
        }
        if (!accepted) consecutive=0;
      }
      if (performance.now()-lastSeen>650) visibility(false);
    } catch (error) {
      console.warn('QR frame could not be read',error);
      visibility(false);
    }
    if (running&&version===runVersion) timer=setTimeout(scan,state.locked?160:110);
  }
  return {
    state,
    start() {
      if (running) return;
      running=true;runVersion++;state.active=true;lastSeen=0;consecutive=0;onVisibility(false,state.locked);scan();
    },
    pause() { running=false;runVersion++;clearTimeout(timer);releaseDecoder();state.active=false;visibility(false); },
    waitForFirst() { return state.locked ? Promise.resolve(true) : new Promise(resolve=>{resolveFirst=resolve;}); },
    stop() { running=false;runVersion++;clearTimeout(timer);releaseDecoder();state.active=false;visibility(false);resolveFirst?.(false);resolveFirst=null; }
  };
}
