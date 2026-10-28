// The same authored vintage radio used as the Unity recorder.
export async function loadUnityRadio(B,scene,root) {
  const folder='assets/models/radio/';
  const response=await fetch(folder+'radio.json?v=20261029-languages-6');
  if(!response.ok)throw new Error('The radio model could not be loaded');
  const data=await response.json(),materials=[];
  for(const entry of data.materials){
    const material=new B.PBRMaterial('radio-'+entry.name,scene);
    material.albedoColor=new B.Color3(entry.color.r,entry.color.g,entry.color.b);
    material.metallic=entry.metallic;material.roughness=Math.max(.4,entry.roughness);
    material.alpha=0;material.forceDepthWrite=true;material.transparencyMode=B.PBRMaterial.PBRMATERIAL_ALPHABLEND;
    if(entry.texture)material.albedoTexture=new B.Texture(folder+entry.texture,scene,false,true);
    if(entry.normalTexture){material.bumpTexture=new B.Texture(folder+entry.normalTexture,scene,false,true);material.invertNormalMapX=true;}
    if(entry.aoTexture){material.ambientTexture=new B.Texture(folder+entry.aoTexture,scene,false,true);material.useAmbientInGrayScale=true;}
    if(entry.metallicTexture){material.metallicTexture=new B.Texture(folder+entry.metallicTexture,scene,false,true);material.useRoughnessFromMetallicTextureAlpha=false;material.useRoughnessFromMetallicTextureGreen=true;material.useMetallnessFromMetallicTextureBlue=true;}
    if(entry.emissionTexture)material.emissiveTexture=new B.Texture(folder+entry.emissionTexture,scene,false,true);
    materials.push(material);
  }
  const multi=new B.MultiMaterial('unity-radio-materials',scene);multi.subMaterials=materials;
  const content=new B.TransformNode('radio-model',scene);content.parent=root;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const part of data.parts){
    const mesh=new B.Mesh('radio-'+part.name,scene);mesh.parent=content;mesh.isPickable=false;
    mesh.overrideMaterialSideOrientation=B.Material.CounterClockWiseSideOrientation;
    const vertices=new B.VertexData();vertices.positions=part.positions.map((v,i)=>i%3===2?-v:v);
    vertices.normals=part.normals.map((v,i)=>i%3===2?-v:v);vertices.uvs=part.uvs;vertices.indices=part.indices.slice();
    for(let i=0;i<vertices.indices.length;i+=3)[vertices.indices[i+1],vertices.indices[i+2]]=[vertices.indices[i+2],vertices.indices[i+1]];
    vertices.applyToMesh(mesh);mesh.material=multi;mesh.subMeshes=[];
    for(const sub of part.submeshes)new B.SubMesh(sub.material,0,vertices.positions.length/3,sub.start,sub.count,mesh);
    for(let i=0;i<vertices.positions.length;i+=3){minX=Math.min(minX,vertices.positions[i]);maxX=Math.max(maxX,vertices.positions[i]);minY=Math.min(minY,vertices.positions[i+1]);maxY=Math.max(maxY,vertices.positions[i+1]);minZ=Math.min(minZ,vertices.positions[i+2]);maxZ=Math.max(maxZ,vertices.positions[i+2]);}
  }
  const scale=.085/(maxX-minX);content.scaling.setAll(scale);content.rotation.y=Math.PI;
  content.position.set((minX+maxX)*scale*.5,-(minY+maxY)*scale*.5,(minZ+maxZ)*scale*.5);
  root.position.y=(maxY-minY)*scale*.5;
  const hole=new B.TransformNode('unity-radio-story-hole',scene);hole.parent=content;hole.position.set(data.hole.x,data.hole.y,-data.hole.z);
  const grille=new B.TransformNode('unity-radio-story-grille',scene);grille.parent=content;grille.position.set(data.grille.x,data.grille.y,-data.grille.z);
  function update(alpha,level){
    root.setEnabled(alpha>.001);
    for(let i=0;i<materials.length;i++){
      materials[i].alpha=alpha*data.materials[i].alpha;
      materials[i].transparencyMode=alpha>.999?B.PBRMaterial.PBRMATERIAL_OPAQUE:B.PBRMaterial.PBRMATERIAL_ALPHABLEND;
      materials[i].emissiveColor.set(.008*level,.045*level,.12*level);
    }
  }
  return{root,hole,grille,scale,materials,source:data.source,update};
}
