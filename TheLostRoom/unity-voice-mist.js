// Port of LostStoryRecorder.DrawIntoHole and TheLostRoom/Story Voice Mist.
export function createUnityVoiceMist(B,scene,camera) {
  const count=256,positions=new Float32Array(count*3),sizes=new Float32Array(count),alpha=new Float32Array(count),life=new Float32Array(count);
  const mesh=new B.Mesh('gathering-voice',scene);mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
  mesh.setVerticesData('position',positions,true);mesh.setVerticesData('aSize',sizes,true,1);mesh.setVerticesData('aAlpha',alpha,true,1);mesh.isUnIndexed=true;
  const stats={emitted:0,absorbed:0};
  const material=new B.ShaderMaterial('unity-story-voice-mist',scene,{
    vertexSource:`precision highp float;attribute vec3 position;attribute float aSize,aAlpha;
      uniform mat4 view,projection;uniform float uViewH;varying float vAlpha;
      void main(){vec4 p=view*vec4(position,1.);gl_Position=projection*p;
      gl_PointSize=clamp(aSize*projection[1][1]*uViewH*.5/max(.01,-p.z),2.,22.);vAlpha=aAlpha;}`,
    fragmentSource:`precision highp float;varying float vAlpha;
      void main(){vec2 p=gl_PointCoord*2.-1.;float mist=clamp(1.-dot(p,p),0.,1.);mist*=mist;
      gl_FragColor=vec4(vec3(0.,.255,1.)*1.6,vAlpha*mist);}`
  },{attributes:['position','aSize','aAlpha'],uniforms:['view','projection','uViewH'],needAlphaBlending:true});
  material.pointsCloud=true;material.alphaMode=B.Engine.ALPHA_ADD;material.disableDepthWrite=true;material.backFaceCulling=false;mesh.material=material;
  const forward=new B.Vector3(),mouth=new B.Vector3(),inside=new B.Vector3(),origin=new B.Vector3();
  const up=new B.Vector3(),outward=new B.Vector3(),tmp=new B.Vector3();let cursor=0,emission=0;
  function update(dt,time,{receiver,state,level,visible}){
    if(!visible||!receiver){mesh.setEnabled(false);return;}
    receiver.hole.computeWorldMatrix(true);mouth.copyFrom(receiver.hole.getAbsolutePosition());
    forward.copyFrom(receiver.hole.getDirection(new B.Vector3(0,0,-1))).normalize();
    if(B.Vector3.Dot(camera.globalPosition.subtract(mouth),forward)<0)forward.scaleInPlace(-1);
    inside.copyFrom(mouth).subtractInPlace(forward.scale(.05*receiver.scale));
    const emitting=state.recording&&level>.01;
    if(emitting){
      outward.copyFrom(camera.getDirection(new B.Vector3(0,0,-1))).normalize();up.copyFrom(camera.getDirection(B.Axis.Y));
      origin.copyFrom(camera.globalPosition).addInPlace(outward.scale(.17)).subtractInPlace(up.scale(.065));
      emission+=dt*(35+level*100);
      while(emission>=1){
        const i=cursor++%count,j=i*3;positions[j]=origin.x+(Math.random()-.5)*.016;positions[j+1]=origin.y+(Math.random()-.5)*.016;positions[j+2]=origin.z+(Math.random()-.5)*.016;
        life[i]=4;sizes[i]=.002+Math.random()*.002;alpha[i]=.8;emission--;stats.emitted++;
      }
    }
    let live=0;const rate=state.preparing?3:1.2;
    for(let i=0;i<count;i++){
      if(life[i]<=0){alpha[i]=0;continue;}
      life[i]-=dt;const j=i*3;tmp.set(positions[j],positions[j+1],positions[j+2]);
      const distance=B.Vector3.Distance(tmp,mouth);
      if(B.Vector3.Distance(tmp,inside)<.025*receiver.scale||(distance<.08*receiver.scale&&B.Vector3.Dot(tmp.subtract(mouth),forward)<-.03*receiver.scale)){life[i]=0;alpha[i]=0;stats.absorbed++;continue;}
      const far=Math.min(1,distance/(.25*receiver.scale)),angle=time*.35+i*2.4;
      const mix=far*far,swirl=.025*receiver.scale*far,step=1-Math.exp(-dt*rate*(2-far));
      const tx=inside.x*(1-mix)+(mouth.x+forward.x*.06*receiver.scale)*mix+Math.sin(angle)*swirl;
      const ty=inside.y*(1-mix)+(mouth.y+forward.y*.06*receiver.scale)*mix+Math.cos(angle*1.3)*swirl;
      const tz=inside.z*(1-mix)+(mouth.z+forward.z*.06*receiver.scale)*mix+Math.cos(angle)*swirl;
      positions[j]+=(tx-positions[j])*step;positions[j+1]+=(ty-positions[j+1])*step;positions[j+2]+=(tz-positions[j+2])*step;
      alpha[i]=Math.min(.8,life[i]*2);live++;
    }
    mesh.setEnabled(live>0);
    if(live){mesh.updateVerticesData('position',positions);mesh.updateVerticesData('aSize',sizes);mesh.updateVerticesData('aAlpha',alpha);material.setFloat('uViewH',scene.getEngine().getRenderHeight());}
  }
  function clear(){life.fill(0);alpha.fill(0);mesh.setEnabled(false);}
  return{mesh,update,clear,stats};
}
