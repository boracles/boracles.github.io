// Babylon.js visual layer. Audio and the Tea Time flow remain in app.js.
const B = globalThis.BABYLON;
if (!B) throw new Error('Babylon.js did not load.');

export class Vec3 extends B.Vector3 {
  copy(v) { this.copyFrom(v); return this; }
  lerp(v, k) { B.Vector3.LerpToRef(this, v, k, this); return this; }
  lerpVectors(a, b, k) { B.Vector3.LerpToRef(a, b, k, this); return this; }
  distanceTo(v) { return B.Vector3.Distance(this, v); }
  addScaledVector(v, k) { this.x += v.x * k; this.y += v.y * k; this.z += v.z * k; return this; }
}

export function createFogView(canvas, { updaters, time, lerp, clamp }) {
  // Premultiplied: additive particles write colour but not alpha, so a non-premultiplied
  // transparent canvas would composite them away. This matches how the camera feed shows through.
  const engine = new B.Engine(canvas, true, { alpha: true, premultipliedAlpha: true, stencil: true }, false);
  engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio || 1, 2));
  const scene = new B.Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new B.Color4(0, 0, 0, 0);
  scene.autoClear = true;
  const camera = new B.FreeCamera('tea-camera', B.Vector3.Zero(), scene);
  camera.fov = 64 * Math.PI / 180;
  camera.minZ = 0.01; camera.maxZ = 20;
  camera.inputs.clear();
  camera.rotationQuaternion = B.Quaternion.Identity();
  camera.position = new Vec3();
  const hemi = new B.HemisphericLight('soft-room-light', new B.Vector3(0, 1, 0), scene);
  hemi.diffuse = B.Color3.FromHexString('#dfe6ff');
  hemi.groundColor = B.Color3.FromHexString('#3a2a1a'); hemi.intensity = 0.9;
  const key = new B.DirectionalLight('warm-light', new B.Vector3(-0.3, -1, -0.5), scene);
  key.diffuse = B.Color3.FromHexString('#ffe7c8'); key.intensity = 1.4;
  const anchor = new B.TransformNode('cup-anchor', scene);
  anchor.position = new Vec3(); anchor.setEnabled(false);
  const fog = new B.TransformNode('fog-child', scene);
  fog.parent = anchor; fog.position = new Vec3();
  const iceCore = new B.TransformNode('ice-core', scene);
  iceCore.parent = fog; iceCore.userData = { show: 0 };
  const fogUniforms = {
    uLevel: { value: 0 }, uScale: { value: 0.0001 }, uAlpha: { value: 0 }, uSize: { value: 0.0042 },
    uSpread: { value: 1 }, uTouch: { value: 0 }, uTouchDir: { value: new Vec3(0, 1, 0) },
  };
  const inflowUniforms = { uAlpha: { value: 0 }, uSpeed: { value: 0.3 }, uSize: { value: 0.0034 } };
  const fogState = { level: 0, target: 0, home: new Vec3(0, 0.08, 0), spread: 1, spreadTarget: 1, touch: 0 };
  const pointSize = `
    vec4 mv = worldView * vec4(p, 1.0);
    gl_Position = projection * mv;
    gl_PointSize = clamp(sz * projection[1][1] * uViewH * 0.5 / max(0.01, -mv.z), 1.0, 64.0);
  `;
  const softPoint = `
    vec2 c = gl_PointCoord - 0.5;
    float a = exp(-dot(c,c) * 16.0);
    if (a < 0.02) discard;
  `;
  function points(name, count, attributes, uniforms, vertexSource, fragmentSource) {
    const mesh = new B.Mesh(name, scene);
    mesh.parent = fog; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
    mesh.setVerticesData('position', new Float32Array(count * 3));
    for (const [key, { data, stride }] of Object.entries(attributes)) mesh.setVerticesData(key, data, false, stride);
    const material = new B.ShaderMaterial(name + '-material', scene,
      { vertexSource, fragmentSource }, {
        attributes: ['position', ...Object.keys(attributes)],
        uniforms: ['worldView', 'projection', 'uTime', 'uViewH', ...uniforms], needAlphaBlending: true,
      });
    material.pointsCloud = true;
    material.alphaMode = B.Engine.ALPHA_ADD;
    material.disableDepthWrite = true;
    material.backFaceCulling = false;
    mesh.material = material; mesh.isUnIndexed = true; mesh.renderingGroupId = 1;
    return { mesh, material };
  }
  const dirs = new Float32Array(2400 * 3), seeds = new Float32Array(2400);
  for (let i = 0; i < seeds.length; i++) {
    const y = Math.random() * 2 - 1, angle = Math.random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    dirs.set([r * Math.cos(angle), y, r * Math.sin(angle)], i * 3); seeds[i] = Math.random();
  }
  const fogPoints = points('story-fog', seeds.length,
    { aDir: { data: dirs, stride: 3 }, aSeed: { data: seeds, stride: 1 } },
    ['uLevel', 'uScale', 'uAlpha', 'uSize', 'uSpread', 'uTouch', 'uTouchDir'], `
      precision highp float;
      attribute vec3 position, aDir; attribute float aSeed;
      uniform mat4 worldView, projection;
      uniform float uTime, uViewH, uLevel, uScale, uAlpha, uSize, uSpread, uTouch;
      uniform vec3 uTouchDir;
      varying float vAlpha, vCore;
      void main() {
        float r = pow(fract(aSeed * 7.13 + 0.17), 0.6), s = aSeed * 6.2831;
        float breath = 1.0 + 0.10 * sin(uTime * 1.5 + s) + uLevel * 0.7 * fract(aSeed * 3.7);
        vec3 swirl = vec3(sin(uTime*.63+s*3.0+aDir.y*4.0), sin(uTime*.71+s*5.0+aDir.z*4.0)*1.3, sin(uTime*.57+s*7.0+aDir.x*4.0));
        float spread = mix(1.0, uSpread, .35+.65*r);
        vec3 p = (aDir*r*breath*spread+swirl*.16*(.4+r)*spread)*uScale;
        p += aDir*uScale*uTouch*max(0.0,dot(aDir,uTouchDir))*.5*sin(uTime*22.0+s*9.0);
        p.y *= 1.12;
        float sz = uSize*(.55+.9*fract(aSeed*5.31))*(1.0+uLevel*.5);
        ${pointSize}
        vCore = 1.0-r; vAlpha = uAlpha*(.14+.4*vCore)/mix(1.0,uSpread,.4);
      }`, `
      precision highp float;
      uniform float uLevel, uTouch;
      varying float vAlpha, vCore;
      void main() {
        ${softPoint}
        vec3 col = mix(vec3(.435,.553,1.0),vec3(.949,.965,1.0),smoothstep(.35,1.0,vCore))*(.85+uLevel*.8+uTouch*.5);
        gl_FragColor = vec4(col,a*vAlpha);
      }`);
  const starts = new Float32Array(800 * 3), inflowSeeds = new Float32Array(800);
  for (let i = 0; i < inflowSeeds.length; i++) {
    const y = Math.random() * 2 - 1, angle = Math.random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    const v = new B.Vector3(r * Math.cos(angle), y * 0.6 + 0.1, r * Math.sin(angle)).normalize().scale(0.1 + Math.random() * 0.16);
    starts.set([v.x, v.y, v.z], i * 3); inflowSeeds[i] = Math.random();
  }
  const inflow = points('gathering-voice', inflowSeeds.length,
    { aStart: { data: starts, stride: 3 }, aSeed: { data: inflowSeeds, stride: 1 } }, ['uAlpha', 'uSpeed', 'uSize'], `
      precision highp float;
      attribute vec3 position, aStart; attribute float aSeed;
      uniform mat4 worldView, projection;
      uniform float uTime, uViewH, uAlpha, uSpeed, uSize;
      varying float vA;
      void main() {
        float u=fract(uTime*uSpeed*(.5+aSeed)+aSeed*13.0), k=u*u*(3.0-2.0*u);
        float ang=k*2.2*(aSeed>.5?1.0:-1.0);
        vec3 s=aStart, rot=vec3(s.x*cos(ang)-s.z*sin(ang),s.y,s.x*sin(ang)+s.z*cos(ang));
        vec3 p=rot*(1.0-k)*(1.0-k); float sz=uSize*(.6+aSeed);
        ${pointSize}
        vA=uAlpha*sin(u*3.1416)*(.4+.6*k);
      }`, `precision highp float; varying float vA; void main(){ ${softPoint} gl_FragColor=vec4(.86,.9,1.0,a*vA); }`);

  const glow = new B.DynamicTexture('fog-glow', { width: 128, height: 128 }, scene, false);
  const ctx = glow.getContext();
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.25, 'rgba(255,255,255,.45)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128); glow.hasAlpha = true; glow.update();
  function glowPlane(name, color, additive) {
    const mesh = B.MeshBuilder.CreatePlane(name, { size: 1, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
    mesh.parent = fog; mesh.billboardMode = B.Mesh.BILLBOARDMODE_ALL; mesh.isPickable = false;
    const mat = new B.StandardMaterial(name + '-material', scene);
    mat.disableLighting = true; mat.emissiveColor = B.Color3.FromHexString(color);
    mat.opacityTexture = glow; mat.alpha = 0; mat.disableDepthWrite = true;
    if (additive) mat.alphaMode = B.Engine.ALPHA_ADD;
    mesh.material = mat; mesh.renderingGroupId = 1;
    return mesh;
  }
  const halo = glowPlane('fog-shadow', '#050a24', false), heart = glowPlane('fog-heart', '#9fb4ff', true);
  let modelContainer = null, iceBuilt = false;
  async function loadModels(onProgress) {
    try { modelContainer = await B.SceneLoader.LoadAssetContainerAsync('assets/models/', 'ice.glb', scene); }
    catch (err) { console.warn('ice model unavailable; using a faceted core', err); }
    onProgress(1);
  }
  function buildIce() {
    if (iceBuilt) return;
    iceBuilt = true;
    const mat = new B.PBRMaterial('ice-material', scene);
    mat.albedoColor = B.Color3.FromHexString('#f3f8ff'); mat.metallic = .1; mat.roughness = .08;
    mat.emissiveColor = B.Color3.FromHexString('#6f8dff').scale(.35); mat.alpha = 0;
    mat.transparencyMode = B.PBRMaterial.PBRMATERIAL_ALPHABLEND; mat.disableDepthWrite = true;
    const wrap = new B.TransformNode('fitted-ice', scene); wrap.parent = iceCore;
    if (modelContainer) {
      modelContainer.addAllToScene();
      const root = modelContainer.meshes[0]; root.parent = wrap;
      root.computeWorldMatrix(true);
      let bounds = root.getHierarchyBoundingVectors(true);
      const size = bounds.max.subtract(bounds.min);
      if (size.z > size.y && size.z > size.x) { wrap.rotation.x = -Math.PI / 2; wrap.computeWorldMatrix(true); }
      bounds = wrap.getHierarchyBoundingVectors(true);
      const height = Math.max(.001, bounds.max.y - bounds.min.y), scale = .55 / height;
      const center = bounds.min.add(bounds.max).scale(.5);
      wrap.scaling.setAll(scale);
      wrap.position.set(-center.x * scale, -bounds.min.y * scale - .27, -center.z * scale);
      for (const mesh of modelContainer.meshes) if (mesh.getTotalVertices()) { mesh.material = mat; mesh.isPickable = false; }
    } else {
      const core = B.MeshBuilder.CreateIcoSphere('fallback-core', { radius: .23, subdivisions: 1, flat: true }, scene);
      core.parent = wrap; core.material = mat;
    }
    iceCore.userData.mat = mat;
  }
  const tmp = new Vec3();
  updaters.add((dt, t) => {
    fogState.level += (fogState.target-fogState.level)*Math.min(1,dt*10);
    fogState.spread += (fogState.spreadTarget-fogState.spread)*Math.min(1,dt*8);
    fogState.touch = Math.max(0,fogState.touch-dt*1.6);
    fogUniforms.uLevel.value=fogState.level; fogUniforms.uSpread.value=fogState.spread; fogUniforms.uTouch.value=fogState.touch;
    const scale=fogUniforms.uScale.value, alpha=fogUniforms.uAlpha.value;
    fog.position.lerp(tmp.set(fogState.home.x+.006*Math.sin(t*.7),fogState.home.y+.008*Math.sin(t*1.1),fogState.home.z+.004*Math.cos(t*.6)),Math.min(1,dt*6));
    halo.scaling.setAll(scale*5.2*Math.sqrt(fogState.spread)); halo.material.alpha=.34*alpha;
    heart.scaling.setAll(scale*(1.7+fogState.level*1.6+fogState.touch+.12*Math.sin(t*1.5)));
    heart.material.alpha=.28*alpha*(.7+fogState.level)/Math.sqrt(fogState.spread);
    iceCore.scaling.setAll(scale/Math.sqrt(fogState.spread)); iceCore.rotation.y=t*.35;
    if (iceCore.userData.mat) iceCore.userData.mat.alpha=.42*alpha*iceCore.userData.show;
    for (const [system, uniforms] of [[fogPoints,fogUniforms],[inflow,inflowUniforms]]) {
      system.material.setFloat('uTime',time.value).setFloat('uViewH',engine.getRenderHeight());
      for (const [name,uniform] of Object.entries(uniforms)) {
        if (uniform.value instanceof B.Vector3) system.material.setVector3(name,uniform.value);
        else system.material.setFloat(name,uniform.value);
      }
    }
  });
  return { B, engine, scene, camera, anchor, fog, fogUniforms, inflowUniforms, fogState, iceCore, loadModels, buildIce };
}
