// FogChild.prefab: FogIce (61 mesh particles) and FogParticle (43 fog patches).
// Keep the native meshes/counts while giving each inner particle a visible,
// music-driven path instead of overlapping all crystals at the centre.
export async function loadUnityInnerParticles(B,scene,parent,bodyGeometry,texture) {
  const nativeFogTexture=new B.Texture('assets/models/companion/inner-fog.png?v=20261029-restart-audio-10',scene,false,true);
  const response=await fetch('assets/models/companion/ice-mesh.json?v=20261029-restart-audio-10');
  if(!response.ok)throw new Error('The native inner particles could not be loaded');
  const geometry=await response.json(),root=new B.TransformNode('unity-inner-particles',scene);root.parent=parent;
  const crystal=new B.Mesh('unity-fog-ice-particles',scene);crystal.parent=root;crystal.isPickable=false;crystal.alwaysSelectAsActiveMesh=true;
  crystal.overrideMaterialSideOrientation=B.Material.CounterClockWiseSideOrientation;
  let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<geometry.positions.length;i++){
    const axis=i%3;min[axis]=Math.min(min[axis],geometry.positions[i]);max[axis]=Math.max(max[axis],geometry.positions[i]);
  }
  const height=Math.max(...max.map((v,i)=>v-min[i]));
  const mesh=new B.VertexData();mesh.positions=geometry.positions.map((v,i)=>(v-(min[i%3]+max[i%3])*.5)/height*(i%3===2?-1:1));
  mesh.normals=geometry.normals.map((v,i)=>i%3===2?-v:v);mesh.indices=geometry.indices.slice();
  for(let i=0;i<mesh.indices.length;i+=3)[mesh.indices[i+1],mesh.indices[i+2]]=[mesh.indices[i+2],mesh.indices[i+1]];
  mesh.applyToMesh(crystal);
  const material=new B.StandardMaterial('unity-ice-particle-material',scene);
  material.diffuseColor=new B.Color3(.955,.976,1);material.emissiveColor=new B.Color3(.189,.428,.679);material.specularColor=new B.Color3(.9,.96,.98);
  material.alpha=0;material.disableDepthWrite=true;material.backFaceCulling=false;crystal.material=material;crystal.renderingGroupId=2;
  const matrices=new Float32Array(61*16),instanceScale=new B.Vector3(),position=new B.Vector3(),rotation=new B.Quaternion();
  const particleMatrices=Array.from({length:61},()=>new B.Matrix());
  const directions=new Float32Array(61*3),radii=new Float32Array(61),particleSizes=new Float32Array(61),seedsIce=new Float32Array(61);
  for(let i=0;i<61;i++){
    const index=Math.floor(i*3.41)%(bodyGeometry.positions.length/3),j=index*3;
    position.set(bodyGeometry.positions[j],bodyGeometry.positions[j+1],-bodyGeometry.positions[j+2]).normalize();
    directions.set([position.x,position.y,position.z],i*3);
    seedsIce[i]=(i*.61803398875)%1;radii[i]=.09+.17*seedsIce[i];particleSizes[i]=.014+.022*((i*.754877666)%1);
    instanceScale.setAll(particleSizes[i]);position.scaleInPlace(radii[i]);
    B.Quaternion.FromEulerAnglesToRef(i*.7,i*1.1,i*.4,rotation);
    B.Matrix.ComposeToRef(instanceScale,rotation,position,particleMatrices[i]);particleMatrices[i].copyToArray(matrices,i*16);
  }
  crystal.thinInstanceSetBuffer('matrix',matrices,16,false);
  const cloud=new B.Mesh('unity-inner-fog-particles',scene);cloud.parent=root;cloud.isPickable=false;cloud.isUnIndexed=true;cloud.alwaysSelectAsActiveMesh=true;
  const positions=new Float32Array(43*3),seeds=new Float32Array(43);
  for(let i=0;i<43;i++){
    const index=(i*9)%(bodyGeometry.positions.length/3),j=index*3;
    positions.set([bodyGeometry.positions[j]*.32,bodyGeometry.positions[j+1]*.32,-bodyGeometry.positions[j+2]*.32],i*3);seeds[i]=i*.317;
  }
  cloud.setVerticesData('position',positions);cloud.setVerticesData('aSeed',seeds,false,1);
  const fogMaterial=new B.ShaderMaterial('unity-inner-fog-material',scene,{
    vertexSource:`precision highp float;attribute vec3 position;attribute float aSeed;uniform mat4 worldView,projection;
      uniform float uTime,uViewH,uAlpha,uLevel;varying float vAlpha;
      void main(){vec3 p=position*(1.+uLevel*.12)+vec3(sin(uTime*.8+aSeed),cos(uTime*.7+aSeed),sin(uTime*.6-aSeed))*.035;
      vec4 mv=worldView*vec4(p,1.);gl_Position=projection*mv;
      gl_PointSize=clamp((.10+.025*sin(aSeed))*projection[1][1]*uViewH*.5*.056/max(.01,-mv.z),2.,26.);
      vAlpha=uAlpha*(.08+.05*uLevel)*(.7+.3*sin(uTime+aSeed));}`,
    fragmentSource:`precision highp float;uniform sampler2D fogTexture;varying float vAlpha;
      void main(){vec4 tex=texture2D(fogTexture,gl_PointCoord);vec2 p=gl_PointCoord*2.-1.;float edge=max(0.,1.-dot(p,p));
      gl_FragColor=vec4(tex.rgb*vec3(.45,.72,1.),tex.a*vAlpha*edge*edge);}`
  },{attributes:['position','aSeed'],uniforms:['worldView','projection','uTime','uViewH','uAlpha','uLevel'],samplers:['fogTexture'],needAlphaBlending:true});
  fogMaterial.setTexture('fogTexture',nativeFogTexture);fogMaterial.pointsCloud=true;fogMaterial.alphaMode=B.Engine.ALPHA_LAYER_ACCUMULATE;fogMaterial.disableDepthWrite=true;cloud.material=fogMaterial;cloud.renderingGroupId=2;
  let previousTime=null,motion=0,energy=0;
  function update(time,scale,alpha,level){
    const dt=previousTime===null?0:Math.min(.05,Math.max(0,time-previousTime));previousTime=time;
    energy+=(level-energy)*(1-Math.exp(-dt*7));motion+=dt*(.35+energy*1.15);
    root.scaling.setAll(scale*2);root.rotation.y=motion*.2;root.rotation.z=Math.sin(motion*.45)*.08;
    for(let i=0;i<61;i++){
      const j=i*3,seed=seedsIce[i],angle=motion*(.65+seed*.65),c=Math.cos(angle),s=Math.sin(angle);
      const radius=radii[i]*(1+energy*.14),x=directions[j],y=directions[j+1],z=directions[j+2];
      position.set((x*c-z*s)*radius,y*radius+Math.sin(motion*(.7+seed)+i)*.025,(x*s+z*c)*radius);
      instanceScale.setAll(particleSizes[i]*(1+energy*.18));
      B.Quaternion.FromEulerAnglesToRef(i*.7+motion*(.5+seed),i*1.1+motion*(.8+seed),i*.4+motion*.3,rotation);
      B.Matrix.ComposeToRef(instanceScale,rotation,position,particleMatrices[i]);
      crystal.thinInstanceSetMatrixAt(i,particleMatrices[i],false);
    }
    crystal.thinInstanceBufferUpdated('matrix');
    root.setEnabled(alpha>.001);material.alpha=.4*alpha;material.emissiveColor.set(.189*(1+level),.428*(1+level),.679*(1+level));
    fogMaterial.setFloat('uTime',motion).setFloat('uViewH',scene.getEngine().getRenderHeight()).setFloat('uAlpha',alpha).setFloat('uLevel',energy);
  }
  return{root,crystal,cloud,update};
}
