import * as THREE from 'three';
import { RNG } from '../core/utils.js';

// ───────────────────────── Shared uniforms ─────────────────────────
export const globalUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

// ───────────────────────── Batcher ─────────────────────────
// Merges many static geometries (with per-piece vertex colour) into one mesh → very few draw calls.
export class Batcher {
  constructor(withUV = false) { this.parts = []; this.withUV = withUV; }
  add(geo, matrix, color, uvScale) {
    this.parts.push({ geo, matrix: matrix.clone(), color: new THREE.Color(color), uvScale });
    return this;
  }
  /** convenience: box at position with size */
  box(x, y, z, w, h, d, color, rotY = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, rotY), new THREE.Vector3(w, h, d));
    return this.add(BOX, m, color);
  }
  geo(geo, x, y, z, color, rotY = 0, sx = 1, sy = 1, sz = 1, rotX = 0, rotZ = 0) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    return this.add(geo, m, color);
  }
  build(material, opts = {}) {
    let total = 0;
    const prepared = this.parts.map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      total += g.attributes.position.count;
      return { ...p, g };
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const uv = this.withUV ? new Float32Array(total * 2) : null;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let o = 0;
    for (const p of prepared) {
      const P = p.g.attributes.position, N = p.g.attributes.normal, U = p.g.attributes.uv;
      nm.getNormalMatrix(p.matrix);
      const vc = p.g.attributes.color;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(p.matrix); pos.set([v.x, v.y, v.z], (o + i) * 3);
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (o + i) * 3);
        if (vc) col.set([vc.getX(i) * p.color.r, vc.getY(i) * p.color.g, vc.getZ(i) * p.color.b], (o + i) * 3);
        else col.set([p.color.r, p.color.g, p.color.b], (o + i) * 3);
        if (uv) { if (U) uv.set([U.getX(i), U.getY(i)], (o + i) * 2); }
      }
      o += P.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = opts.cast ?? true; mesh.receiveShadow = opts.receive ?? true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    return mesh;
  }
}
export const UP = new THREE.Vector3(0, 1, 0);
export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
export const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
export const CONE = new THREE.ConeGeometry(0.5, 1, 8);
export const SPHERE = new THREE.SphereGeometry(0.5, 12, 8);
export const ICO = new THREE.IcosahedronGeometry(0.5, 1);
export function jitteredIco(seed, amount = 0.08, detail = 1) {
  const g = new THREE.IcosahedronGeometry(0.5, detail); const r = new RNG(seed);
  const p = g.attributes.position; const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(k)) map.set(k, 1 + r.range(-amount, amount) * 2);
    const s = map.get(k); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  g.computeVertexNormals(); return g;
}

// ───────────────────────── Materials ─────────────────────────
export const MAT = {};
export function initMaterials() {
  MAT.batch = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  MAT.batchFlat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  MAT.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 });
  MAT.foliage = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), 0.06);
  MAT.grass = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), 0.12, true);
  MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  MAT.lamp = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd480, emissiveIntensity: 0, roughness: 0.4 });
}
export function windMaterial(mat, amp, byHeight = false) {
  mat.customProgramCacheKey = () => 'wind' + amp + byHeight;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = globalUniforms.uTime; sh.uniforms.uWind = globalUniforms.uWind;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 wp = (instanceMatrix * vec4(transformed,1.0)).xyz;
      #else
        vec3 wp = transformed;
      #endif
      float h = ${byHeight ? 'max(position.y,0.0)' : '1.0'};
      float s = sin(uTime*1.7 + wp.x*0.35 + wp.z*0.27) + 0.5*sin(uTime*3.1 + wp.x*1.3 + wp.y*1.7);
      transformed.x += s * ${amp.toFixed(3)} * h * uWind;
      transformed.z += cos(uTime*1.3 + wp.z*0.4 + wp.y) * ${(amp * 0.6).toFixed(3)} * h * uWind;`);
  };
  return mat;
}

// ───────────────────────── Canvas textures ─────────────────────────
export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
/** Window atlas: 8x8 cells. albedo + emissive (lit windows). */
export function makeWindowTextures(style = 0) {
  const r = new RNG(77 + style);
  const cells = 8, S = 64;
  const lit = []; for (let i = 0; i < cells * cells; i++) lit.push(r.chance(0.42) ? r.range(0.5, 1) : 0);
  const albedo = canvasTex(cells * S, cells * S, (g) => {
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
      const ox = x * S, oy = y * S;
      g.fillStyle = '#ffffff'; g.fillRect(ox, oy, S, S);
      g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(ox, oy + S - 6, S, 6); // floor line
      const ww = style === 1 ? 44 : 30, wh = style === 1 ? 34 : 38;
      const wx = ox + (S - ww) / 2, wy = oy + 12;
      g.fillStyle = '#d8d8d8'; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 8);
      const blind = r.chance(0.3);
      const grd = g.createLinearGradient(wx, wy, wx + ww, wy + wh); grd.addColorStop(0, '#3a5068'); grd.addColorStop(0.5, '#6f8fae'); grd.addColorStop(1, '#2c3e52');
      g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
      if (blind) { g.fillStyle = 'rgba(230,220,200,0.85)'; g.fillRect(wx, wy, ww, wh * r.range(0.3, 0.8)); }
      g.fillStyle = '#e8e8e8'; g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(wx + 2, wy + wh - 2); g.lineTo(wx + ww * 0.4, wy + 2); g.lineTo(wx + ww * 0.55, wy + 2); g.lineTo(wx + 8, wy + wh - 2); g.fill();
    }
  }, { repeat: true });
  const emissive = canvasTex(cells * S, cells * S, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, cells * S, cells * S);
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
      const l = lit[y * cells + x]; if (!l) continue;
      const ww = style === 1 ? 44 : 30, wh = style === 1 ? 34 : 38;
      const wx = x * S + (S - ww) / 2, wy = y * S + 12;
      const warm = r.chance(0.8);
      g.fillStyle = warm ? `rgba(255,${190 + r.int(0, 40)},${110 + r.int(0, 50)},${l})` : `rgba(170,210,255,${l})`;
      g.fillRect(wx, wy, ww, wh);
    }
  }, { repeat: true });
  return { albedo, emissive };
}
export function noiseTexture(size = 256, seed = 3, scale = 1) {
  const r = new RNG(seed);
  return canvasTex(size, size, (g) => {
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) { const v = 200 + r.range(-1, 1) * 55 * scale; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    // blotches
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${r.chance(0.5) ? '0,0,0' : '255,255,255'},${r.range(0.02, 0.06)})`; g.beginPath(); g.arc(r.range(0, size), r.range(0, size), r.range(6, 40), 0, 6.3); g.fill(); }
  }, { repeat: true, linear: true });
}
export function waterNormalTexture(size = 256) {
  const r = new RNG(9);
  const waves = []; for (let i = 0; i < 14; i++) waves.push({ kx: r.int(-6, 6), ky: r.int(-6, 6), a: r.range(0.2, 1), p: r.range(0, 6.28) });
  return canvasTex(size, size, (g) => {
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) { const ph = (w.kx * x + w.ky * y) / size * 6.283 + w.p; const c = Math.cos(ph) * w.a; dx += c * w.kx; dy += c * w.ky; }
      const i = (y * size + x) * 4;
      img.data[i] = 128 + dx * 2.2; img.data[i + 1] = 128 + dy * 2.2; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true, linear: true });
}

// ───────────────────────── Sky dome ─────────────────────────
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x4a8ad8) }, horizon: { value: new THREE.Color(0xcfe4f4) }, bottom: { value: new THREE.Color(0x9ab0c0) },
      sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) }, sunColor: { value: new THREE.Color(0xfff2d0) }, night: { value: 0 }, uTime: globalUniforms.uTime,
      riftTint: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 top, horizon, bottom, sunDir, sunColor; uniform float night, uTime, riftTint; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, bottom, clamp(-h*3.0,0.0,1.0));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 12.0) * 0.35 + pow(sd,3.0)*0.08);
        if (night > 0.01 && h > 0.0) {
          vec3 q = floor(d * 260.0); float s = hash(q); float tw = 0.6 + 0.4*sin(uTime*2.0 + s*50.0);
          c += vec3(step(0.9965, s) * night * tw * 1.2);
        }
        if (riftTint > 0.0) {
          float n = sin(d.x*7.0+uTime*0.3)*sin(d.z*6.0-uTime*0.2)*sin(d.y*9.0+uTime*0.1);
          c = mix(c, vec3(0.25,0.05,0.35) + vec3(0.2,0.0,0.3)*n + vec3(0.0,0.4,0.5)*pow(max(n,0.0),3.0), riftTint);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1;
  return mesh;
}

// Soft round sprite texture (for particles / glows)
let _dot;
export function dotTexture() {
  if (_dot) return _dot;
  _dot = canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  });
  return _dot;
}
let _blob;
export function blobShadowTexture() {
  if (_blob) return _blob;
  _blob = canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  });
  return _blob;
}
export function blobShadow(size) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
  return m;
}

// ───────────────────────── Rig optimiser ─────────────────────────
// Merges untextured, non-animated child meshes of each node into one vertex-coloured mesh.
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const vcMats = new Map();
function vcMat(rough, metal) { const k = rough.toFixed(2) + '_' + metal.toFixed(2); if (!vcMats.has(k)) vcMats.set(k, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal })); return vcMats.get(k); }
export function optimizeRig(root) {
  const nodes = []; root.traverse((o) => nodes.push(o));
  for (const node of nodes) {
    const groups = new Map();
    for (const c of node.children) {
      if (!c.isMesh || c.children.length || c.userData.keep || c.isInstancedMesh) continue;
      const m = c.material;
      if (!m || !m.isMeshStandardMaterial || m.map || m.transparent || m.vertexColors || (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0)) continue;
      if (!c.geometry.index || !c.geometry.attributes.uv) continue;
      const k = m.roughness.toFixed(1) + '_' + m.metalness.toFixed(1);
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c);
    }
    for (const [, list] of groups) {
      if (list.length < 2) continue;
      const geos = list.map((c) => {
        c.updateMatrix(); const g = c.geometry.clone().applyMatrix4(c.matrix);
        for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
        const n = g.attributes.position.count, col = new Float32Array(n * 3), cc = c.material.color;
        for (let i = 0; i < n; i++) { col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
      });
      const merged = mergeGeometries(geos, false); if (!merged) continue;
      const m0 = list[0].material;
      const mesh = new THREE.Mesh(merged, vcMat(m0.roughness, m0.metalness)); mesh.castShadow = list.some((c) => c.castShadow); mesh.receiveShadow = list.some((c) => c.receiveShadow);
      for (const c of list) node.remove(c);
      node.add(mesh);
    }
  }
  return root;
}
/** Bake a whole (untextured) rig in its current pose into one vertex-coloured mesh — used as a distant LOD. */
export function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(); const geos = []; const tmp = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !o.material?.isMeshStandardMaterial || o.geometry.type === 'PlaneGeometry') return;
    let p = o; while (p && p !== root) { if (!p.visible) return; p = p.parent; }
    tmp.multiplyMatrices(inv, o.matrixWorld);
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(tmp);
    const n = g.attributes.position.count; let col = g.attributes.color;
    if (!col) { const c = o.material.color; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } col = new THREE.BufferAttribute(a, 3); }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', g.attributes.position); out.setAttribute('normal', g.attributes.normal); out.setAttribute('color', col);
    geos.push(out);
  });
  if (!geos.length) return null;
  const m = new THREE.Mesh(mergeGeometries(geos, false), vcMat(0.8, 0)); m.castShadow = true;
  return m;
}
