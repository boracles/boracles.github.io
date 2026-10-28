import {loadUnityCompanion} from './unity-companion.js?v=20261029-languages-6';
import {loadUnityRadio} from './unity-radio.js?v=20261029-languages-6';
import {createUnityVoiceMist} from './unity-voice-mist.js?v=20261029-languages-6';
const B=globalThis.BABYLON;
if(!B)throw new Error('Babylon.js did not load.');
export class Vec3 extends B.Vector3 {
  copy(v){this.copyFrom(v);return this;}
  lerp(v,k){B.Vector3.LerpToRef(this,v,k,this);return this;}
  lerpVectors(a,b,k){B.Vector3.LerpToRef(a,b,k,this);return this;}
  distanceTo(v){return B.Vector3.Distance(this,v);}
  addScaledVector(v,k){this.x+=v.x*k;this.y+=v.y*k;this.z+=v.z*k;return this;}
}

export function createFogView(canvas,{updaters,time}) {
  const engine=new B.Engine(canvas,true,{alpha:true,premultipliedAlpha:true,stencil:true},false);
  engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio||1,1.5));
  const scene=new B.Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new B.Color4(0,0,0,0);
  const camera=new B.FreeCamera('tea-camera',B.Vector3.Zero(),scene);
  camera.fov=64*Math.PI/180;camera.minZ=.01;camera.maxZ=20;camera.inputs.clear();
  camera.rotationQuaternion=B.Quaternion.Identity();camera.position=new Vec3();
  const ambient=new B.HemisphericLight('room-light',new B.Vector3(0,1,0),scene);
  ambient.diffuse=new B.Color3(.8,.88,1);ambient.groundColor=new B.Color3(.04,.06,.12);ambient.intensity=.65;
  const key=new B.DirectionalLight('soft-light',new B.Vector3(-.3,-1,-.5),scene);key.intensity=.55;
  const anchor=new B.TransformNode('qr-anchor',scene);anchor.setEnabled(false);
  const fog=new B.TransformNode('fog-child',scene);fog.parent=anchor;fog.position=new Vec3();
  const radio=new B.TransformNode('story-radio',scene);radio.parent=anchor;radio.setEnabled(false);
  const radioState={alpha:0,ready:false,recording:false,preparing:false,grille:null,mist:null};
  // Compatibility with the reveal timeline. No faceted stand-in is rendered.
  const iceCore={userData:{show:0}};
  const fogUniforms={uLevel:{value:0},uScale:{value:.0001},uAlpha:{value:0},uSize:{value:.0026},uSpread:{value:1},uTouch:{value:0},uTouchDir:{value:new Vec3(0,1,0)}};
  const inflowUniforms={uAlpha:{value:0},uSpeed:{value:.3},uSize:{value:.0018}};
  const fogState={level:0,target:0,bass:0,mid:0,home:new Vec3(0,.08,0),spread:1,spreadTarget:1,touch:0,form:'radio'};
  const glow=new B.GlowLayer('companion-bloom',scene,{mainTextureFixedSize:256,blurKernelSize:16});glow.intensity=.32;
  let companion=null,receiver=null;
  async function loadModels(onProgress){
    [companion,receiver]=await Promise.all([loadUnityCompanion(B,scene,fog),loadUnityRadio(B,scene,radio)]);
    glow.addIncludedOnlyMesh(companion.mesh);radioState.grille=receiver.grille;radioState.scale=receiver.scale;radioState.ready=true;onProgress(1);
  }
  function buildIce(){} // Native body replaces the old ice-core geometry.

  const mist=createUnityVoiceMist(B,scene,camera);
  radioState.mist=mist.stats;
  const tmp=new Vec3();
  updaters.add((dt,t)=>{
    fogState.level+=(fogState.target-fogState.level)*Math.min(1,dt*10);
    fogState.spread+=(fogState.spreadTarget-fogState.spread)*Math.min(1,dt*8);
    fogState.touch=Math.max(0,fogState.touch-dt*1.6);
    fogUniforms.uLevel.value=fogState.level;fogUniforms.uSpread.value=fogState.spread;fogUniforms.uTouch.value=fogState.touch;
    fog.position.lerp(tmp.set(fogState.home.x+.010*Math.sin(t*.55),fogState.home.y+.008*Math.sin(t*.8),fogState.home.z+.006*Math.cos(t*.45)),Math.min(1,dt*6));
    const visible=anchor.isEnabled()&&fogUniforms.uAlpha.value>0;
    // Alpha reaching zero must hide the whole child, including native inner
    // particles. Skipping its update alone leaves the previous material visible.
    fog.setEnabled(visible);
    glow.isEnabled=visible;
    if(visible)companion?.update(dt,t,{scale:fogUniforms.uScale.value,alpha:fogUniforms.uAlpha.value,level:fogState.level,bass:fogState.bass,mid:fogState.mid,touch:fogState.touch,direction:fogUniforms.uTouchDir.value});
    receiver?.update(radioState.alpha,fogState.level);
    mist.update(dt,t,{receiver,state:radioState,level:fogState.level,visible:anchor.isEnabled()});
  });
  return{B,engine,scene,camera,anchor,fog,radio,radioState,fogUniforms,inflowUniforms,fogState,iceCore,loadModels,buildIce};
}
