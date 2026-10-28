import { initializeExhibition, exhibitionOpen } from './exhibition.js?v=20261029-typecast-7';
import { messages, chooseLanguage } from './strings.js?v=20261029-typecast-7';

const language=chooseLanguage({requested:new URLSearchParams(location.search).get('lang'),languages:navigator.languages?.length?navigator.languages:[navigator.language]});
const copy=messages[language];
document.documentElement.lang=language;document.title=copy.pageTitle;
for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=copy[node.dataset.i18n]||messages.en[node.dataset.i18n];
document.getElementById('touch').setAttribute('aria-label',copy.holdLabel);
document.getElementById('music-progress').setAttribute('aria-label',copy.musicProgress);

function loadScript(src) {
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=src;
    script.onload=resolve;script.onerror=()=>reject(new Error('A required file could not be loaded'));
    document.head.append(script);
  });
}
try {
  if(await initializeExhibition()) {
    await Promise.all([loadScript('https://cdn.jsdelivr.net/npm/babylonjs@9.31.0/babylon.js'),loadScript('assets/vendor/jsQR.js')]);
    if(exhibitionOpen())await import('./app.js?v=20261029-typecast-7');
  }
} catch(error) {
  const button=document.getElementById('start');
  button.hidden=false;button.disabled=false;button.textContent='Retry';button.onclick=()=>location.reload();
  document.getElementById('load-status').textContent='Check your connection and retry.';
  console.warn('WebAR could not start',error);
}
