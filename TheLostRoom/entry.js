import { initializeExhibition, exhibitionOpen } from './exhibition.js?v=20261028-exhibition-1';

function loadScript(src) {
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=src;
    script.onload=resolve;script.onerror=()=>reject(new Error('A required file could not be loaded'));
    document.head.append(script);
  });
}
try {
  if(await initializeExhibition()) {
    await loadScript('https://cdn.jsdelivr.net/npm/babylonjs@9.31.0/babylon.js');
    if(exhibitionOpen())await loadScript('https://cdn.jsdelivr.net/npm/babylonjs-loaders@9.31.0/babylonjs.loaders.min.js');
    if(exhibitionOpen())await loadScript('assets/vendor/jsQR.js');
    if(exhibitionOpen())await import('./app.js?v=20261028-exhibition-1');
  }
} catch(error) {
  const button=document.getElementById('start');
  button.disabled=false;button.textContent='다시 열기 / Retry';button.onclick=()=>location.reload();
  document.getElementById('load-status').textContent='연결을 확인하고 다시 열어 주세요. / Check your connection and retry.';
  console.warn('WebAR could not start',error);
}
