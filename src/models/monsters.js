import * as THREE from 'three';
import { blobShadow, dotTexture } from '../gfx/gfx.js';
import { RNG, TAU } from '../core/utils.js';

// Rift creatures: not animal, not human. Matte void-black bodies, glowing iris and seams.
const voidMat = () => new THREE.MeshStandardMaterial({ color: 0x1a1426, roughness: 0.3, metalness: 0.5, emissive: 0x2a0c48, emissiveIntensity: 0.7 });
const glowMat = (c, i = 2.2) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: i, roughness: 0.3 });
function eye(r, irisColor) {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe8e0f0, roughness: 0.2, emissive: 0x302040, emissiveIntensity: 0.4 }));
  const iris = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 14, 10), glowMat(irisColor, 2.5)); iris.scale.z = 0.4; iris.position.z = r * 0.72;
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.25, 10, 8), new THREE.MeshBasicMaterial({ color: 0x000000 })); pupil.scale.set(0.5, 1.2, 0.3); pupil.position.z = r * 0.9;
  g.add(ball, iris, pupil); g.userData.pupil = pupil;
  return g;
}
function halo(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
  s.scale.setScalar(size); return s;
}

export const MONSTERS = {
  wisp: { name: 'Gazer Wisp', hp: 60, dmg: 8, speed: 2.4, radius: 0.7, fly: 1.6, ranged: true, range: 11, cd: 2.4, xp: 10, color: 0x40e0ff },
  tumbler: { name: 'Shard Tumbler', hp: 85, dmg: 12, speed: 3.6, radius: 0.8, charge: true, range: 7, cd: 3.2, xp: 12, color: 0xff40a0 },
  totem: { name: 'Hollow Totem', hp: 160, dmg: 14, speed: 1.2, radius: 0.9, pulse: true, range: 5, cd: 4, xp: 20, color: 0xa060ff },
  smear: { name: 'Smear', hp: 110, dmg: 10, speed: 2.2, radius: 0.9, melee: true, range: 1.6, cd: 1.6, xp: 15, splits: true, color: 0x80ff60 },
  mote: { name: 'Smear Mote', hp: 30, dmg: 6, speed: 3.2, radius: 0.45, melee: true, range: 1.1, cd: 1.3, xp: 4, color: 0x80ff60 },
  boss: { name: 'The Unwoven', hp: 1400, dmg: 20, speed: 1.5, radius: 2.2, boss: true, fly: 2.8, range: 30, cd: 2.6, xp: 220, color: 0xff3a6a },
};

export function buildMonster(type, seed = 1) {
  const r = new RNG(seed);
  const def = MONSTERS[type];
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const parts = { spin: [], bob: [], eyes: [], tendrils: [], glow: [] };
  const vm = voidMat(), gm = glowMat(def.color);
  if (type === 'wisp') {
    // a floating eye inside counter-rotating rings, trailing ribbons
    const e = eye(0.38, def.color); body.add(e); parts.eyes.push(e);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62 + i * 0.12, 0.035, 6, 32), i === 1 ? gm : vm);
      ring.rotation.set(r.range(0, 3), r.range(0, 3), 0); body.add(ring); parts.spin.push({ o: ring, ax: new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize(), s: (i % 2 ? -1 : 1) * (1 + i * 0.5) });
    }
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.9, 5), vm); t.position.set(Math.cos(i * 1.57) * 0.2, -0.6, Math.sin(i * 1.57) * 0.2); t.rotation.x = Math.PI; body.add(t); parts.tendrils.push(t);
    }
    body.add(halo(def.color, 2.4));
  } else if (type === 'tumbler') {
    // cluster of black crystal shards that rolls and charges
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), gm); body.add(core);
    for (let i = 0; i < 14; i++) {
      const sh = new THREE.Mesh(new THREE.ConeGeometry(0.13, r.range(0.6, 1.1), 4), vm);
      const d = new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize();
      sh.position.copy(d).multiplyScalar(0.4); sh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); body.add(sh);
    }
    const e = eye(0.18, 0xffffff); e.position.set(0, 0.1, 0.42); body.add(e); parts.eyes.push(e);
    body.add(halo(def.color, 1.8));
  } else if (type === 'totem') {
    // stacked floating plates around a void core, rotating at different speeds
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), gm); core.position.y = 1.2; body.add(core); parts.glow.push(core);
    for (let i = 0; i < 5; i++) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.75 - Math.abs(i - 2) * 0.12, 0.75 - Math.abs(i - 2) * 0.12, 0.12, 6, 1, false), vm);
      plate.position.y = 0.3 + i * 0.42; body.add(plate); parts.spin.push({ o: plate, ax: new THREE.Vector3(0, 1, 0), s: (i % 2 ? 1 : -1) * (0.6 + i * 0.2) }); parts.bob.push({ o: plate, y: plate.position.y, p: i });
      const seam = new THREE.Mesh(new THREE.TorusGeometry(0.75 - Math.abs(i - 2) * 0.12, 0.02, 4, 6), gm); seam.rotation.x = Math.PI / 2; plate.add(seam);
    }
    for (let i = 0; i < 3; i++) { const e = eye(0.15, def.color); e.position.set(Math.cos(i * 2.09) * 0.55, 1.2, Math.sin(i * 2.09) * 0.55); e.lookAt(e.position.clone().multiplyScalar(3).setY(1.2)); body.add(e); parts.eyes.push(e); }
    body.add(halo(def.color, 3));
  } else if (type === 'smear' || type === 'mote') {
    // wobbling goo with drifting eyes
    const sc = type === 'mote' ? 0.5 : 1;
    const g = new THREE.IcosahedronGeometry(0.75 * sc, 3);
    const blob = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x0a120a, roughness: 0.15, metalness: 0.3, emissive: 0x103010, emissiveIntensity: 0.8 }));
    blob.position.y = 0.6 * sc; blob.castShadow = true; body.add(blob); parts.blob = blob; parts.blobBase = g.attributes.position.array.slice();
    const n = type === 'mote' ? 1 : 4;
    for (let i = 0; i < n; i++) { const e = eye(r.range(0.1, 0.17) * (type === 'mote' ? 1.3 : 1), def.color); e.userData.orbit = { a: r.range(0, 6), sp: r.range(0.3, 0.8), h: r.range(0.4, 0.9) * sc }; body.add(e); parts.eyes.push(e); }
  } else if (type === 'boss') {
    // The Unwoven: huge iris inside layered rotating ribbons and orbiting plates
    const e = eye(1.1, def.color); body.add(e); parts.eyes.push(e);
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6 + i * 0.35, i % 2 ? 0.05 : 0.12, 6, 48, i % 2 ? TAU : TAU * 0.75), i % 2 ? gm : vm);
      ring.rotation.set(r.range(0, 3), r.range(0, 3), 0); body.add(ring); parts.spin.push({ o: ring, ax: new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize(), s: (i % 2 ? -1 : 1) * (0.3 + i * 0.15) });
    }
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.08), vm); const holder = new THREE.Group(); holder.add(p); p.position.x = 3.6;
      holder.rotation.y = (i / 8) * TAU; body.add(holder); parts.spin.push({ o: holder, ax: new THREE.Vector3(0, 1, 0), s: 0.5 });
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.1), gm); edge.position.y = 0.7; p.add(edge);
    }
    for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.18, 3.2, 6), vm); t.position.set(Math.cos(i) * 0.8, -2, Math.sin(i) * 0.8); t.rotation.x = Math.PI; body.add(t); parts.tendrils.push(t); }
    body.add(halo(def.color, 9));
  }
  body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const shadow = blobShadow(def.radius * 2.4); root.add(shadow);
  const st = { t: r.range(0, 10), flash: 0 };
  const flashMats = [];
  body.traverse((o) => { if (o.isMesh && o.material.emissive) flashMats.push({ m: o.material, base: o.material.emissive.clone(), bi: o.material.emissiveIntensity }); });
  // unique materials per monster so hit-flash doesn't affect others
  for (const f of flashMats) { /* materials created per build above */ }
  function update(dt, s) {
    st.t += dt; const t = st.t;
    const hover = def.fly ? def.fly + Math.sin(t * 1.6) * 0.25 : 0;
    body.position.y = hover + (type === 'tumbler' ? 0.55 : 0);
    for (const p of parts.spin) p.o.rotateOnAxis(p.ax, dt * p.s * (s.agitated ? 2.5 : 1));
    for (const p of parts.bob) p.o.position.y = p.y + Math.sin(t * 2 + p.p) * 0.06;
    parts.tendrils.forEach((tt, i) => { tt.rotation.z = Math.sin(t * 3 + i) * 0.35; tt.rotation.x = Math.PI + Math.cos(t * 2.3 + i) * 0.3; });
    if (type === 'tumbler') body.rotation.x += dt * (s.speed || 0) * 2.2;
    if (parts.blob) {
      const P = parts.blob.geometry.attributes.position, B = parts.blobBase;
      for (let i = 0; i < P.count; i++) {
        const x = B[i * 3], y = B[i * 3 + 1], z = B[i * 3 + 2];
        const w = 1 + Math.sin(t * 3 + x * 5 + y * 3) * 0.08 + Math.sin(t * 5 + z * 6) * 0.05;
        P.setXYZ(i, x * w, y * w * (y < 0 ? 0.6 : 1), z * w);
      }
      P.needsUpdate = true; parts.blob.geometry.computeVertexNormals();
      for (const e of parts.eyes) { const o = e.userData.orbit; if (!o) continue; o.a += dt * o.sp; e.position.set(Math.cos(o.a) * 0.35 * (type === 'mote' ? 0.4 : 1), o.h + Math.sin(t * 2 + o.a) * 0.1, Math.sin(o.a) * 0.35 * (type === 'mote' ? 0.4 : 1) + 0.25); }
    }
    // eyes track the player
    if (s.target) for (const e of parts.eyes) { if (parts.blob || type === 'totem') continue; e.lookAt(s.target); }
    if (s.target && type === 'totem') for (const e of parts.eyes) { const p = e.userData.pupil; p.position.x = Math.sin(t * 3) * 0.04; }
    // hit flash
    st.flash = Math.max(0, st.flash - dt * 6);
    for (const f of flashMats) { f.m.emissive.copy(f.base).lerp(new THREE.Color(0xffffff), st.flash); f.m.emissiveIntensity = f.bi + st.flash * 2; }
    if (s.telegraph) body.scale.setScalar(1 + Math.sin(t * 30) * 0.04 * s.telegraph); else body.scale.setScalar(1);
  }
  function flash() { st.flash = 1; }
  return { root, update, flash, def, height: (def.fly || 0) + def.radius * 2 };
}
