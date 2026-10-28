// Fixed, pre-recorded instructions in the exhibition's voices. Visitor audio
// never leaves the device, and no speech service is called during a visit.
export const guidanceKeys=['qrAim','hold','micReady','micPermission','moreVoice','creating','repeat','musicError'];

export function createGuidance({context,output,language,muted,canPlay}) {
  const buffers=new Map(),requests=new Map(),controller=new AbortController();
  const gain=context.createGain();gain.gain.value=1;gain.connect(output);
  const state={key:null,pending:null,playing:false,source:null,count:0,error:null};
  let version=0,disposed=false;
  async function load(key) {
    if(buffers.has(key))return buffers.get(key);
    if(!requests.has(key))requests.set(key,(async()=>{
      const response=await fetch(`assets/audio/guidance/${language}/${key}.wav?v=20261029-restart-audio-10`,{signal:controller.signal});
      if(!response.ok)throw new Error(`Guidance ${language}/${key}: ${response.status}`);
      const buffer=await context.decodeAudioData(await response.arrayBuffer());
      buffers.set(key,buffer);return buffer;
    })().finally(()=>requests.delete(key)));
    return requests.get(key);
  }
  function stop() {
    version++;state.pending=null;state.key=null;state.playing=false;
    if(state.source){state.source.onended=null;try{state.source.stop();}catch{}state.source.disconnect();state.source=null;}
  }
  async function resume() {
    const key=state.pending,token=version;
    if(!key||disposed||muted||context.state!=='running'||!canPlay())return;
    try {
      const buffer=await load(key);
      if(token!==version||disposed||context.state!=='running'||!canPlay())return;
      // A repeated unlock event must not start a second copy of this line.
      if(state.pending!==key)return;
      const source=context.createBufferSource();source.buffer=buffer;source.connect(gain);
      state.pending=null;state.source=source;state.key=key;state.playing=true;state.error=null;
      source.onended=()=>{source.disconnect();if(state.source===source){state.source=null;state.playing=false;}};
      source.start();state.count++;
    }catch(error){
      if(token!==version||disposed)return;
      state.error=error.message;state.pending=null;
      console.warn('Guidance audio unavailable',error);
    }
  }
  function say(key) {
    stop();
    if(disposed||muted||!guidanceKeys.includes(key))return;
    state.pending=key;resume();
  }
  function preload() {
    if(muted||disposed)return;
    for(const key of ['qrAim','hold'])load(key).catch(()=>{});
  }
  function dispose(){if(disposed)return;stop();disposed=true;controller.abort();buffers.clear();gain.disconnect();}
  return {state,say,stop,resume,preload,dispose};
}
