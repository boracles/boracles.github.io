// The final exhibition day is inclusive in Korea: close at Nov 9, 00:00 KST.
export const CLOSES_AT = Date.parse('2026-11-09T00:00:00+09:00');
let serverStart=0,wallStart=0,monotonicStart=0,initialized=false,closed=false,timer=0;
const copy={
  ko:['전시가 종료되었습니다.','안개 아이 웹AR은 2026년 11월 8일까지 운영되었습니다.\n함께해 주셔서 감사합니다.'],
  en:['The exhibition has ended.','The Fog Child WebAR was available through November 8, 2026 (Korea time).\nThank you for spending time with us.'],
  ja:['展示は終了しました。','霧の子のWebARは2026年11月8日（韓国時間）まで公開されました。\nご参加いただきありがとうございました。']
};
function now() {
  // Anchor to the host's HTTP clock. Changing the phone's date backward cannot
  // extend a running session; wall-clock elapsed time also covers device sleep.
  return serverStart+Math.max(0,performance.now()-monotonicStart,Date.now()-wallStart);
}
function closeExhibition() {
  if(closed)return;
  closed=true;clearTimeout(timer);
  window.dispatchEvent(new Event('exhibition-ended'));
  for(const id of ['ui','stage','camera-feed'])document.getElementById(id).hidden=true;
  const language=new URLSearchParams(location.search).get('lang')||navigator.language.split('-')[0];
  const [title,note]=copy[language]||copy.en;
  document.getElementById('exhibition-title').textContent=title;
  document.getElementById('exhibition-note').textContent=note;
  document.getElementById('exhibition-ended').hidden=false;
  document.title=title;
}
export function exhibitionOpen() {
  if(!initialized||closed)return false;
  if(now()>=CLOSES_AT){closeExhibition();return false;}
  return true;
}
function check() {
  clearTimeout(timer);
  if(exhibitionOpen())timer=setTimeout(check,Math.min(60000,Math.max(1,CLOSES_AT-now())));
}
export async function initializeExhibition() {
  // Same-origin HEAD is free static hosting, not a paid generation API. A fresh
  // URL and HTTP Date/Age prevent a wrong phone date or cached page extending access.
  const response=await fetch('./publication.json?clock='+Date.now(),{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(10000)});
  const date=Date.parse(response.headers.get('Date'));
  const age=Number(response.headers.get('Age')||0);
  if(!response.ok||!Number.isFinite(date)||!Number.isFinite(age))throw new Error('Exhibition time could not be checked');
  serverStart=date+Math.max(0,age)*1000;wallStart=Date.now();monotonicStart=performance.now();initialized=true;
  check();
  document.addEventListener('visibilitychange',check);
  window.addEventListener('pageshow',check);
  return exhibitionOpen();
}
