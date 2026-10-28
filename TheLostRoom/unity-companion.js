import {loadUnityInnerParticles} from './unity-inner-particles.js?v=20261029-radio-cue-9';
// Native FogChild.prefab geometry, FogBase texture and PerlinPDM deformation.
// Unity's material is URP/Lit with additive transparency and blue emission.
export async function loadUnityCompanion(B,scene,parent) {
  const folder='assets/models/companion/';
  const read=async name=>{const response=await fetch(folder+name+'?v=20261029-radio-cue-9');if(!response.ok)throw new Error(`Unity companion ${name}: ${response.status}`);return response.json();};
  const [geometry,profile,noise]=await Promise.all(['mesh.json','profile.json','noise.json'].map(read));
  const mesh=new B.Mesh('unity-fog-child-body',scene);mesh.parent=parent;mesh.isPickable=false;
  const data=new B.VertexData();
  // Unity's mesh is left-handed; reflect Z and reverse triangle winding for the
  // right-handed QR/camera frame without changing the authored UVs.
  const rest=Float32Array.from(geometry.positions,(v,i)=>i%3===2?-v:v);
  data.positions=rest;data.normals=geometry.normals.map((v,i)=>i%3===2?-v:v);data.uvs=geometry.uvs;
  data.indices=geometry.indices.slice();for(let i=0;i<data.indices.length;i+=3)[data.indices[i+1],data.indices[i+2]]=[data.indices[i+2],data.indices[i+1]];
  data.applyToMesh(mesh,true);
  const texture=await new Promise((resolve,reject)=>{
    const loaded=new B.Texture(folder+'fog-base.png?v=20261029-radio-cue-9',scene,false,false,B.Texture.TRILINEAR_SAMPLINGMODE,()=>resolve(loaded),(message,error)=>reject(error||new Error(message)));
  });texture.hasAlpha=true;
  const material=new B.PBRMaterial('unity-fog-child-body-material',scene);
  material.albedoTexture=texture;material.emissiveTexture=texture;material.useAlphaFromAlbedoTexture=true;
  material.albedoColor=new B.Color3(profile.baseColor.r,profile.baseColor.g,profile.baseColor.b);
  material.emissiveColor=new B.Color3(profile.emission.r,profile.emission.g,profile.emission.b);
  material.metallic=0;material.roughness=.5;material.alpha=0;
  material.transparencyMode=B.PBRMaterial.PBRMATERIAL_ALPHABLEND;
  // Keep real coverage in the transparent canvas; additive-only alpha stays zero
  // and mobile video compositors can discard the entire glowing silhouette.
  material.alphaMode=B.Engine.ALPHA_LAYER_ACCUMULATE;material.disableDepthWrite=true;material.backFaceCulling=true;
  mesh.material=material;mesh.renderingGroupId=1;
  mesh.overrideMaterialSideOrientation=B.Material.CounterClockWiseSideOrientation;
  const inner=await loadUnityInnerParticles(B,scene,parent,geometry,texture);
  const deformed=new Float32Array(rest),normals=new Float32Array(rest.length),indices=data.indices;
  const groups=new Map(),source=new Int32Array(rest.length/3);
  for(let i=0;i<source.length;i++){
    const key=[rest[i*3],rest[i*3+1],rest[i*3+2]].map(v=>v.toFixed(5)).join(',');
    if(!groups.has(key))groups.set(key,i);source[i]=groups.get(key);
  }
  const smooth=t=>t*t*(3-2*t),mix=(t,a,b)=>a+t*(b-a),p=noise.permutation,g=noise.gradients;
  const dot=(index,rx,ry,rz,unityCorner=false)=>rx*g[index*3]+ry*g[index*3+(unityCorner?2:1)]+rz*g[index*3+2];
  function perlin(x,y,z){
    const tx=x+4096,ty=y+4096,tz=z+4096,bx=Math.trunc(tx),by=Math.trunc(ty),bz=Math.trunc(tz);
    const x0=bx&255,x1=(bx+1)&255,y0=by&255,y1=(by+1)&255,z0=bz&255,z1=(bz+1)&255;
    const rx0=tx-bx,rx1=rx0-1,ry0=ty-by,ry1=ry0-1,rz0=tz-bz,rz1=rz0-1;
    const b00=p[p[x0]+y0],b10=p[p[x1]+y0],b01=p[p[x0]+y1],b11=p[p[x1]+y1];
    const sx=smooth(rx0),sy=smooth(ry0),sz=smooth(rz0);
    const c=mix(sy,mix(sx,dot(b00+z0,rx0,ry0,rz0),dot(b10+z0,rx1,ry0,rz0)),mix(sx,dot(b01+z0,rx0,ry1,rz0),dot(b11+z0,rx1,ry1,rz0)));
    // Keep the authored PerlinPDM corner calculation, including its Y/Z index.
    const d=mix(sy,mix(sx,dot(b00+z1,rx0,ry0,rz1,true),dot(b10+z1,rx1,ry0,rz1)),mix(sx,dot(b01+z1,rx0,ry1,rz1),dot(b11+z1,rx1,ry1,rz1)));
    return mix(sz,c,d);
  }
  let phase=0,speed=.16,next=0,musicPhase=0,energy=0,lowEnergy=0,midEnergy=0;
  function update(dt,time,{scale,alpha,level,bass=0,mid=0,touch,direction}) {
    // Fast musical attacks and slower release make the skin feel soft rather
    // than jittering at each waveform sample. Integrate phase to avoid jumps.
    const follow=(value,target)=>mix(1-Math.exp(-Math.min(dt,.05)/(target>value ? .075 : .28)),value,target);
    energy=follow(energy,level);lowEnergy=follow(lowEnergy,bass);midEnergy=follow(midEnergy,mid);
    musicPhase+=Math.min(dt,.05)*(.25+energy*.8+lowEnergy*.45);
    speed=mix(1-Math.exp(-dt*2),speed,.14+.08*Math.min(1,.5+level*.5));phase+=Math.min(dt,.05)*speed;
    mesh.scaling.setAll(scale*2*(1+energy*.03));material.alpha=alpha*profile.baseColor.a;
    const light=1+level*.4+touch*.12;
    material.emissiveColor.set(profile.emission.r*light,profile.emission.g*light,profile.emission.b*light);
    inner.update(time,scale,alpha,level);
    if(time<next)return;next=time+1/(touch>.01||energy>.02?45:30);
    for(let i=0;i<source.length;i++){
      const j=i*3,k=source[i]*3;
      if(k!==j){deformed.set(deformed.subarray(k,k+3),j);continue;}
      const x=rest[j],y=rest[j+1],z=-rest[j+2],radius=Math.hypot(x,y,z);
      const displacement=perlin(phase+x,phase+y,phase+z)*Math.sqrt(.75)*.10;
      const contact=Math.max(0,Math.min(1,((x*direction.x+y*direction.y-z*direction.z)/radius-.1)/.9));
      const dent=smooth(contact)*touch*Math.sqrt(.75)*.18;
      const nx=x/radius,ny=y/radius,nz=z/radius;
      // Coherent broad bulges change the actual silhouette. Bass swells the
      // low wave; the midrange moves a second, smaller wave across the skin.
      const waveA=Math.sin(nx*2.8+ny*2.1+nz*1.7+musicPhase)*.68;
      const waveB=Math.sin(ny*3.4-nz*2.2+nx*.8-musicPhase*.83)*.32;
      const swell=(waveA+waveB)*(.11*energy+.045*lowEnergy)+Math.sin(nx*2.2-nz*2.9+musicPhase*1.1)*.025*midEnergy;
      let dx=displacement+nx*(swell-dent),dy=displacement+ny*(swell-dent),dz=displacement+nz*(swell-dent);
      const limit=Math.min(1,.16/Math.max(.00001,Math.hypot(dx,dy,dz)));dx*=limit;dy*=limit;dz*=limit;
      deformed[j]=x+dx;deformed[j+1]=y+dy;deformed[j+2]=-(z+dz);
    }
    normals.fill(0);
    for(let i=0;i<indices.length;i+=3){
      const ia=indices[i]*3,ib=indices[i+1]*3,ic=indices[i+2]*3;
      const ax=deformed[ib]-deformed[ia],ay=deformed[ib+1]-deformed[ia+1],az=deformed[ib+2]-deformed[ia+2];
      const bx=deformed[ic]-deformed[ia],by=deformed[ic+1]-deformed[ia+1],bz=deformed[ic+2]-deformed[ia+2];
      const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
      for(let corner=0;corner<3;corner++){const j=source[indices[i+corner]]*3;normals[j]+=nx;normals[j+1]+=ny;normals[j+2]+=nz;}
    }
    for(let i=0;i<source.length;i++){
      const j=i*3,k=source[i]*3,length=Math.hypot(normals[k],normals[k+1],normals[k+2])||1;
      if(k===j){normals[j]/=length;normals[j+1]/=length;normals[j+2]/=length;}
      else normals.set(normals.subarray(k,k+3),j);
    }
    mesh.updateVerticesData(B.VertexBuffer.PositionKind,deformed,true);mesh.updateVerticesData(B.VertexBuffer.NormalKind,normals);
  }
  return{mesh,material,profile,inner,update};
}
