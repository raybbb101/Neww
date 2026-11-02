import * as THREE from 'three';
import { blobShadow, optimizeRig } from '../gfx/gfx.js';
import { clamp, damp, lerp, pick, RNG } from '../core/utils.js';

const SKIN = [0xf2d0b0, 0xe0b090, 0xc89070, 0xa06a48, 0x7a4a30, 0xf8dcc8];
const HAIR = [0x2a1a10, 0x4a3020, 0x101010, 0x8a6030, 0xd0b070, 0x909090, 0xa04020];
const TOPS = [0x3a6ea8, 0xc84848, 0x48a070, 0xe8c050, 0x8a5ab0, 0xf0f0f0, 0x303848, 0xe07a40, 0x50b0c0, 0xd06090];
const BOTTOMS = [0x2a3448, 0x3a3a3a, 0x5a4a3a, 0x40507a, 0x6a6a70, 0x1a1a20];
const matCache = new Map();
const m = (c, r = 0.85) => { const k = c + '_' + r; if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: r })); return matCache.get(k); };
const G = {
  cap: new THREE.CapsuleGeometry(1, 1, 3, 8), sph: new THREE.SphereGeometry(1, 12, 9), box: new THREE.BoxGeometry(1, 1, 1),
};
function part(geo, mat, sx, sy, sz) { const o = new THREE.Mesh(geo, mat); o.scale.set(sx, sy, sz); o.castShadow = true; return o; }

export function buildHuman(seed, opts = {}) {
  const r = new RNG(seed);
  const child = opts.child ?? r.chance(0.12);
  const S = child ? 0.62 : r.range(0.94, 1.06);
  const skin = m(SKIN[r.int(0, SKIN.length - 1)]);
  const hairC = m(HAIR[r.int(0, HAIR.length - 1)], 0.9);
  const top = m(opts.top ?? TOPS[r.int(0, TOPS.length - 1)]);
  const bottom = m(opts.bottom ?? BOTTOMS[r.int(0, BOTTOMS.length - 1)]);
  const shoe = m(r.chance(0.5) ? 0x222222 : 0xf0f0f0, 0.6);
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const hipY = 0.9;
  const pelvis = new THREE.Group(); pelvis.position.y = hipY; body.add(pelvis);
  const hips = part(G.sph, bottom, 0.17, 0.12, 0.11); pelvis.add(hips);
  const spine = new THREE.Group(); spine.position.y = 0.05; pelvis.add(spine);
  const dress = !child && r.chance(0.2);
  const torso = part(G.cap, top, 0.17, 0.17, 0.11); torso.position.y = 0.28; spine.add(torso);
  if (dress) { const sk = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.55, 12, 1, true), top); sk.position.y = -0.18; sk.castShadow = true; spine.add(sk); }
  const neck = new THREE.Group(); neck.position.y = 0.5; neck.scale.setScalar(1.55); spine.add(neck); // chibi-style big heads
  const head = part(G.sph, skin, 0.115, 0.13, 0.12); head.position.y = 0.12; neck.add(head);
  const nose = part(G.sph, skin, 0.025, 0.03, 0.03); nose.position.set(0, 0.11, 0.12); neck.add(nose);
  const eyeM = m(0x1a1a1a, 0.3);
  for (const s of [-1, 1]) { const e = part(G.sph, eyeM, 0.016, 0.02, 0.01); e.position.set(s * 0.045, 0.14, 0.11); neck.add(e); }
  const hairStyle = r.int(0, 4);
  if (hairStyle === 0) { const h = part(G.sph, hairC, 0.125, 0.09, 0.13); h.position.set(0, 0.19, -0.01); neck.add(h); }
  else if (hairStyle === 1) { const h = part(G.sph, hairC, 0.13, 0.14, 0.135); h.position.set(0, 0.14, -0.02); neck.add(h); const b = part(G.sph, hairC, 0.06, 0.06, 0.06); b.position.set(0, 0.22, -0.12); neck.add(b); }
  else if (hairStyle === 2) { const h = part(G.sph, hairC, 0.13, 0.15, 0.13); h.position.set(0, 0.12, -0.03); neck.add(h); const l = part(G.cap, hairC, 0.1, 0.12, 0.06); l.position.set(0, 0.02, -0.08); neck.add(l); }
  else if (hairStyle === 3) { const c = part(G.sph, m(TOPS[r.int(0, TOPS.length - 1)]), 0.13, 0.07, 0.13); c.position.set(0, 0.21, 0); neck.add(c); const br = part(G.box, c.material, 0.18, 0.015, 0.12); br.position.set(0, 0.2, 0.12); neck.add(br); }
  else { const h = part(G.sph, hairC, 0.12, 0.06, 0.125); h.position.set(0, 0.2, -0.01); neck.add(h); }
  const mkLimb = (parent, x, y, len, rad, mat, lowerMat, isLeg) => {
    const p = new THREE.Group(); p.position.set(x, y, 0); parent.add(p);
    const u = part(G.cap, mat, rad, len * 0.25, rad); u.position.y = -len * 0.25; p.add(u);
    const j = new THREE.Group(); j.position.y = -len * 0.5; p.add(j);
    const l = part(G.cap, lowerMat, rad * 0.88, len * 0.23, rad * 0.88); l.position.y = -len * 0.25; j.add(l);
    if (isLeg) { const f = part(G.box, shoe, rad * 2, rad * 1.1, rad * 3.4); f.position.set(0, -len * 0.5 + rad * 0.2, rad * 0.9); j.add(f); }
    else { const h = part(G.sph, skin, rad * 1.05, rad * 1.2, rad * 0.8); h.position.y = -len * 0.5; j.add(h); }
    return { p, j };
  };
  const shorts = r.chance(0.25);
  const legs = [mkLimb(pelvis, -0.09, -0.02, 0.86, 0.06, bottom, shorts ? skin : bottom, true), mkLimb(pelvis, 0.09, -0.02, 0.86, 0.06, bottom, shorts ? skin : bottom, true)];
  const sleeve = r.chance(0.5);
  const arms = [mkLimb(spine, -0.22, 0.5, 0.6, 0.045, top, sleeve ? top : skin, false), mkLimb(spine, 0.22, 0.5, 0.6, 0.045, top, sleeve ? top : skin, false)];
  arms[0].p.rotation.z = -0.08; arms[1].p.rotation.z = 0.08;
  const held = new THREE.Group(); arms[1].j.add(held); held.position.y = -0.3;
  root.add(blobShadow(0.8));
  optimizeRig(root);
  // distant LOD: one merged static mesh
  const lod = new THREE.Group();
  const lb = part(G.box, bottom, 0.3, 0.9, 0.2); lb.position.y = 0.45; lod.add(lb);
  const lt = part(G.cap, top, 0.18, 0.18, 0.12); lt.position.y = 1.22; lod.add(lt);
  const lh = part(G.sph, skin, 0.18, 0.2, 0.18); lh.position.y = 1.7; lod.add(lh);
  const lhair = part(G.sph, hairC, 0.19, 0.12, 0.2); lhair.position.y = 1.83; lod.add(lhair);
  optimizeRig(lod); lod.visible = false; root.add(lod);
  let far = false;
  const setFar = (f) => { if (f === far) return; far = f; body.visible = !f; lod.visible = f; };
  root.scale.setScalar(S);
  const st = { ph: r.range(0, 6), idle: r.range(0, 6), pose: 'idle', w: 0 };
  function update(dt, s) {
    const spd = s.speed || 0, run = clamp((spd - 2) / 2, 0, 1);
    st.ph += dt * spd * (2.6 / S) * (1 - run * 0.25);
    st.idle += dt;
    const a = Math.sin(st.ph), amp = clamp(spd / 1.4, 0, 1) * lerp(0.55, 0.9, run);
    let lh0 = a * amp, lh1 = -a * amp, lk0 = Math.max(0, -Math.cos(st.ph)) * amp * 1.4, lk1 = Math.max(0, Math.cos(st.ph)) * amp * 1.4;
    let ah0 = -a * amp * 0.8, ah1 = a * amp * 0.8, ae0 = -0.2 - run * 1.2, ae1 = -0.2 - run * 1.2;
    let bodyY = Math.abs(Math.cos(st.ph)) * 0.03 * amp, lean = run * 0.25, headX = 0, crouch = 0;
    const pose = s.pose || 'idle';
    if (pose === 'sit') { lh0 = lh1 = -1.5; lk0 = lk1 = 1.5; bodyY = -0.42; ah0 = ah1 = -0.3; ae0 = ae1 = -0.6; }
    else if (pose === 'crouch' || pose === 'pet') { lh0 = lh1 = -1.3; lk0 = lk1 = 2.2; bodyY = -0.48; lean = 0.6; ah0 = -0.6; ah1 = pose === 'pet' ? -1.4 + Math.sin(st.idle * 6) * 0.15 : -0.6; ae1 = -0.3; headX = 0.4; }
    else if (pose === 'throw') { ah1 = -1.2 + Math.sin(st.idle * 4) * 0.6; ae1 = -0.5; }
    else if (pose === 'fish') { ah0 = ah1 = -0.9; ae0 = ae1 = -0.4; lh0 = lh1 = -1.5; lk0 = lk1 = 1.5; bodyY = -0.42; }
    else if (pose === 'shoo') { ah1 = -2.6 + Math.sin(st.idle * 10) * 0.3; ae1 = -0.3; ah0 = -0.5; }
    else if (pose === 'scared') { ah0 = ah1 = -2.8; ae0 = ae1 = -0.6; headX = -0.2; }
    else if (pose === 'vendor') { ah0 = ah1 = -0.5; ae0 = ae1 = -1.2; }
    else if (pose === 'phone') { ah1 = -0.4; ae1 = -2.2; headX = 0.35; }
    if (spd < 0.1 && pose === 'idle') { ah0 = ah1 = Math.sin(st.idle * 1.3) * 0.03; ae0 = ae1 = -0.1; bodyY = Math.sin(st.idle * 2) * 0.004; }
    const k = 1 - Math.exp(-14 * dt);
    const L = (o, key, v) => (o.rotation[key] += (v - o.rotation[key]) * k);
    L(legs[0].p, 'x', lh0); L(legs[1].p, 'x', lh1); L(legs[0].j, 'x', lk0); L(legs[1].j, 'x', lk1);
    L(arms[0].p, 'x', ah0); L(arms[1].p, 'x', ah1); L(arms[0].j, 'x', ae0); L(arms[1].j, 'x', ae1);
    pelvis.position.y += (hipY + bodyY - pelvis.position.y) * k;
    L(spine, 'x', lean); L(neck, 'x', headX);
    neck.rotation.y = damp(neck.rotation.y, s.lookYaw || 0, 5, dt);
    spine.rotation.y = Math.sin(st.ph) * 0.08 * amp;
  }
  return { root, update, held, height: 1.7 * S, child, setFar };
}
