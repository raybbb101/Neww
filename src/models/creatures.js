import * as THREE from 'three';
import { canvasTex, blobShadow, optimizeRig } from '../gfx/gfx.js';
import { clamp, damp, lerp, RNG, TAU } from '../core/utils.js';

const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.78, metalness: 0, map: opts.map || null, emissive: opts.emissive ?? 0, emissiveIntensity: opts.ei ?? 1, side: opts.side ?? THREE.FrontSide, transparent: !!opts.transparent, alphaTest: opts.alphaTest || 0 }));
  return mats.get(key);
}
const hex = (c) => '#' + new THREE.Color(c).getHexString();

/** Fur texture: base, lighter belly, stripes/patches. u = around body (0.75 = back), v = along length. */
function coatTexture(coat, kind, seed = 1) {
  const key = 'coat' + kind + JSON.stringify(coat);
  if (mats.has(key)) return mats.get(key);
  const r = new RNG(seed);
  const t = canvasTex(256, 128, (g, W, H) => {
    g.fillStyle = hex(coat.base); g.fillRect(0, 0, W, H);
    // belly (u≈0.25)
    const gr = g.createLinearGradient(0, 0, W, 0);
    const b = hex(coat.belly);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.12, b); gr.addColorStop(0.38, b); gr.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.95; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    if (kind === 'tabby') {
      g.fillStyle = hex(coat.stripe);
      for (let y = 6; y < H; y += r.range(9, 13)) {
        const th = r.range(2.5, 4.5);
        g.beginPath();
        for (let x = 128 - 70; x <= 128 + 70 + 64; x += 4) {
          const yy = y + Math.sin(x * 0.08 + y) * 2;
          const fade = 1 - Math.abs(x - 192) / 120; if (fade <= 0) continue;
          g.rect(x % W, yy, 4, th * fade);
        }
        g.fill();
      }
    }
    if (coat.patches) {
      g.fillStyle = hex(coat.patches);
      const n = kind === 'spots' ? 70 : 9;
      for (let i = 0; i < n; i++) {
        g.beginPath();
        const rr = kind === 'spots' ? r.range(2, 5) : r.range(10, 26);
        g.ellipse(r.range(110, 256), r.range(0, H), rr * 1.3, rr, r.range(0, 3), 0, TAU); g.fill();
      }
    }
    if (kind === 'scales') {
      g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
      for (let y = 0; y < H; y += 6) for (let x = (y / 6) % 2 * 4; x < W; x += 8) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI); g.stroke(); }
      g.fillStyle = hex(coat.stripe);
      for (let y = 4; y < H; y += 14) {
        const isPy = coat.name === 'Ball Python', isCorn = coat.name === 'Corn Snake';
        for (let x = 150; x < 240; x += 1) {
          const w = isPy ? Math.abs(Math.sin(y * 0.3 + x * 0.06)) * 6 + 2 : isCorn ? 6 : 2;
          if ((isCorn && (x % 36 < 22)) || (!isCorn && x % 30 < (isPy ? 18 : 6))) g.fillRect(x, y, 1, w);
        }
      }
    }
    // soft fur noise
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r.chance(0.5) ? '0,0,0' : '255,255,255'},0.05)`; g.fillRect(r.range(0, W), r.range(0, H), 1, r.range(2, 5)); }
  });
  mats.set(key, t);
  return t;
}
function coatMat(coat, kind) {
  return mat(0xffffff, { map: coatTexture(coat, kind) });
}
function ellipsoid(rx, ry, rz, material, seg = 16) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, seg * 0.75));
  g.rotateX(Math.PI / 2); // poles along Z → u wraps around body
  const m = new THREE.Mesh(g, material); m.scale.set(rx, ry, rz); m.castShadow = true; return m;
}
function sphere(r, material, seg = 12) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.7)), material); m.castShadow = true; return m; }
function capsule(r, len, material) { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), material); m.castShadow = true; return m; }
function cone(r, h, material, seg = 8) { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), material); m.castShadow = true; return m; }

/** Shared state object passed every frame to rig.update */
export function defaultAnimState() {
  return { speed: 0, maxSpeed: 5, air: false, vy: 0, crouch: 0, sit: 0, lie: 0, swim: 0, charge: 0, action: null, actionT: 0, turn: 0, flying: false, glide: false, mood: 0.6, sleep: false, lookYaw: 0, scale: 1, hidden: 0, dash: 0 };
}

// ════════════════════════════ QUADRUPED ════════════════════════════
export function buildQuad(sp, coat, opts = {}) {
  const B = sp.body; const kind = opts.kind || sp.key;
  const root = new THREE.Group(); root.name = 'creature';
  const pivot = new THREE.Group(); root.add(pivot);
  const isCat = kind === 'cat', isDog = kind === 'dog', isRab = kind === 'rabbit', isSq = kind === 'squirrel', isMouse = kind === 'mouse';
  const furKind = isCat && coat.name.includes('Tabby') ? 'tabby' : coat.name === 'Dalmatian' ? 'spots' : 'plain';
  const fur = opts.plain ? mat(coat.base) : coatMat(coat, furKind);
  const belly = mat(coat.belly);
  const dark = mat(0x2a1a1a, { rough: 0.4 });
  const pink = mat(0xe89aa0);
  const rx = B.w / 2, ry = Math.max(0.05, (B.h - B.leg) * (isRab ? 1.0 : 0.85)), rz = B.len / 2;
  const torsoY = B.leg + ry * 0.75;
  const body = new THREE.Group(); body.position.y = torsoY; pivot.add(body);
  const torso = ellipsoid(rx, ry, rz, fur); torso.userData.keep = true; body.add(torso);
  const chest = ellipsoid(rx * 0.95, ry * 1.02, rz * 0.5, fur); chest.position.set(0, ry * 0.08, rz * 0.45); body.add(chest);
  const haunch = ellipsoid(rx * (isRab ? 1.15 : 1.0), ry * (isRab ? 1.1 : 0.98), rz * (isRab ? 0.6 : 0.5), fur); haunch.position.set(0, isRab ? ry * 0.1 : 0, -rz * 0.45); body.add(haunch);

  // Head
  const neck = new THREE.Group(); neck.position.set(0, ry * (isRab ? 0.55 : 0.45), rz * 0.88); body.add(neck);
  const head = new THREE.Group(); head.position.set(0, B.head * (isDog ? 0.75 : 0.6), B.head * 0.35); neck.add(head);
  const skull = ellipsoid(B.head * (isCat ? 1.08 : 0.95), B.head * 0.92, B.head * (isRab ? 1.15 : 1.0), fur); head.add(skull);
  const snLen = B.head * (B.snout || 0.4) * (isDog ? 1.7 : 1.1);
  const snout = ellipsoid(B.head * (isDog ? 0.5 : 0.48), B.head * (isDog ? 0.45 : 0.38), snLen, isDog ? fur : belly);
  snout.position.set(0, -B.head * (isDog ? 0.18 : 0.25), B.head * (isDog ? 0.75 : 0.72)); head.add(snout);
  const muzzle = ellipsoid(B.head * 0.36, B.head * 0.3, snLen * 0.6, belly); muzzle.position.set(0, -B.head * 0.32, B.head * (isDog ? 1.05 : 0.85)); head.add(muzzle);
  const nose = sphere(B.head * (isDog ? 0.17 : 0.11), isCat || isRab ? pink : dark, 8); nose.scale.set(1.2, 0.8, 0.8);
  nose.position.set(0, -B.head * (isDog ? 0.1 : 0.12), B.head * (isDog ? 0.75 + snLen / B.head * 0.95 : 1.02)); head.add(nose);
  // eyes
  const eyes = new THREE.Group(); head.add(eyes);
  const eyeMat = mat(coat.eye, { rough: 0.15 }), pupilMat = mat(0x050505, { rough: 0.1 }), shine = mat(0xffffff, { emissive: 0xffffff, ei: 0.6 });
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(s * B.head * 0.48, B.head * 0.12, B.head * 0.72); e.rotation.y = s * 0.35;
    const ball = sphere(B.head * 0.22, eyeMat, 10); ball.scale.z = 0.6; e.add(ball);
    const pup = sphere(B.head * 0.16, pupilMat, 8); pup.scale.set(isCat ? 0.35 : 0.8, isCat ? 1.1 : 0.8, 0.5); pup.position.z = B.head * 0.1; e.add(pup);
    const sh = sphere(B.head * 0.05, shine, 6); sh.position.set(B.head * 0.06, B.head * 0.08, B.head * 0.15); e.add(sh);
    eyes.add(e);
  }
  // ears
  const ears = [];
  for (const s of [-1, 1]) {
    const ep = new THREE.Group(); head.add(ep);
    if (isCat || (isDog && (coat.name === 'Shiba Red' || coat.name === 'Husky')) || isSq) {
      ep.position.set(s * B.head * 0.55, B.head * 0.72, -B.head * 0.05); ep.rotation.z = -s * 0.28;
      const e = cone(B.head * 0.42, B.head * 0.85, fur, 4); e.rotation.y = Math.PI / 4; e.scale.z = 0.45; e.position.y = B.head * 0.35; ep.add(e);
      const inner = cone(B.head * 0.26, B.head * 0.6, pink, 4); inner.rotation.y = Math.PI / 4; inner.scale.z = 0.3; inner.position.set(0, B.head * 0.3, B.head * 0.07); ep.add(inner);
    } else if (isRab || isMouse) {
      if (isMouse) { ep.position.set(s * B.head * 0.6, B.head * 0.6, -B.head * 0.1); const e = sphere(B.head * 0.45, pink, 10); e.scale.z = 0.3; ep.add(e); }
      else {
        ep.position.set(s * B.head * 0.32, B.head * 0.7, -B.head * 0.3); ep.rotation.z = -s * 0.12; ep.rotation.x = -0.25;
        const e = ellipsoid(B.head * 0.3, B.head * 1.25, B.head * 0.14, fur, 10); e.rotation.x = Math.PI / 2; e.position.y = B.head * 1.1; ep.add(e);
        const inner = ellipsoid(B.head * 0.18, B.head * 1.0, B.head * 0.05, pink, 8); inner.rotation.x = Math.PI / 2; inner.position.set(0, B.head * 1.1, B.head * 0.1); ep.add(inner);
      }
    } else { // floppy
      ep.position.set(s * B.head * 0.75, B.head * 0.45, -B.head * 0.1); ep.rotation.z = s * 0.3;
      const e = ellipsoid(B.head * 0.18, B.head * 0.6, B.head * 0.42, mat(coat.stripe), 10); e.position.y = -B.head * 0.45; ep.add(e);
    }
    ears.push(ep);
  }
  if (isCat || isMouse || isSq) { // whiskers
    const pts = [];
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const y = -B.head * 0.3 + i * B.head * 0.06, z = B.head * 0.95;
      pts.push(new THREE.Vector3(s * B.head * 0.2, y, z), new THREE.Vector3(s * B.head * 1.3, y + (i - 1) * B.head * 0.18, z - B.head * 0.25));
    }
    const wg = new THREE.BufferGeometry().setFromPoints(pts);
    head.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
  }
  let tongue = null;
  if (isDog) { tongue = ellipsoid(B.head * 0.2, B.head * 0.05, B.head * 0.32, pink, 8); tongue.position.set(0, -B.head * 0.5, B.head * 1.15); tongue.rotation.x = 0.6; tongue.userData.keep = true; head.add(tongue); }

  // Legs
  const legs = [];
  const legFur = furKind === 'tabby' ? mat(coat.base) : furKind === 'spots' ? mat(coat.base) : fur;
  const legR = Math.max(0.012, rx * (isDog ? 0.3 : 0.28));
  const mk = (front, side) => {
    const hip = new THREE.Group();
    const hindBig = isRab || isSq;
    hip.position.set(side * rx * 0.62, -ry * 0.25, (front ? 1 : -1) * rz * 0.62);
    body.add(hip);
    const L = B.leg + ry * 0.5; const up = L * 0.52, lo = L * 0.48;
    if (!front && hindBig) { const th = ellipsoid(rx * 0.45, ry * 0.75, rz * 0.4, fur); th.position.set(side * rx * 0.1, ry * 0.15, 0); hip.add(th); }
    const upper = capsule(legR * (front ? 1 : 1.25), up, legFur); upper.position.y = -up / 2; hip.add(upper);
    const knee = new THREE.Group(); knee.position.y = -up; hip.add(knee);
    const lower = capsule(legR * 0.9, lo, legFur); lower.position.y = -lo / 2; knee.add(lower);
    const paw = ellipsoid(legR * 1.3, legR * 0.8, legR * (hindBig && !front ? 3.2 : 1.6), coat.name === 'Dutch' || coat.name === 'Calico' ? belly : legFur, 8);
    paw.position.set(0, -lo, legR * (hindBig && !front ? 1.6 : 0.5)); knee.add(paw);
    legs.push({ hip, knee, front, side, up, lo });
  };
  mk(true, -1); mk(true, 1); mk(false, -1); mk(false, 1);

  // Tail
  const tail = [];
  const tailRoot = new THREE.Group(); tailRoot.position.set(0, ry * 0.35, -rz * 0.95); body.add(tailRoot);
  if (isRab) {
    const puff = sphere(B.tail * 0.9, belly, 10); puff.position.z = -B.tail * 0.3; tailRoot.add(puff); tail.push(tailRoot);
  } else {
    const n = isSq ? 7 : 6; let parent = tailRoot;
    const segL = B.tail / n;
    for (let i = 0; i < n; i++) {
      const seg = new THREE.Group(); seg.position.z = i === 0 ? 0 : -segL; parent.add(seg);
      const rad = isSq ? B.head * (0.5 + Math.sin(i / n * Math.PI) * 0.6) : Math.max(0.01, legR * (isDog ? 1.1 : 0.85) * (1 - i / n * 0.45));
      const m = isSq ? sphere(rad, fur, 8) : capsule(rad, segL, fur);
      m.rotation.x = Math.PI / 2; m.position.z = -segL / 2; seg.add(m);
      tail.push(seg); parent = seg;
    }
  }
  const shadow = blobShadow(Math.max(B.len, B.w * 2) * 1.6); root.add(shadow);
  optimizeRig(root);

  const st = { phase: 0, gaitW: 0, blink: 0, blinkT: 2, earT: 1, earTw: 0, look: 0, lookT: 0, lookTimer: 0, sitW: 0, lieW: 0, crouchW: 0, swimW: 0, airW: 0, pitch: 0, roll: 0, hopY: 0, wagP: 0, chargeW: 0, actionW: 0 };
  const baseTorsoY = torsoY;
  const tailBaseRot = isCat ? -0.55 : isDog ? (coat.name === 'Shiba Red' || coat.name === 'Husky' ? -1.0 : -0.5) : isSq ? -1.3 : isMouse ? 0.1 : 0;

  function update(dt, s) {
    const spd = s.speed, mx = Math.max(1, s.maxSpeed);
    const moving = clamp(spd / 0.4, 0, 1);
    const gait = sp.move?.gait || 'trot';
    const stride = (sp.move?.stride || 0.5) * (opts.scale || 1);
    st.phase = (st.phase + dt * (gait === 'hop' ? Math.max(spd, 0.3 * moving) / stride : spd / stride + (s.swim > 0.5 ? 2.2 : 0))) % 1;
    st.sitW = damp(st.sitW, s.sit, 6, dt); st.lieW = damp(st.lieW, s.lie, 4, dt); st.crouchW = damp(st.crouchW, Math.max(s.crouch, s.charge), 10, dt);
    st.swimW = damp(st.swimW, s.swim, 6, dt); st.airW = damp(st.airW, s.air ? 1 : 0, 12, dt); st.chargeW = damp(st.chargeW, s.charge, 12, dt);
    const ph = st.phase * TAU;
    const runW = clamp((spd - 1.8) / 3, 0, 1);
    const gallopW = (isCat || isDog) ? clamp((spd - mx * 0.72) / (mx * 0.2), 0, 1) : 0;
    // gait offsets per leg [FL, FR, BL, BR]
    const off = (gait === 'hop' || isSq) ? [0.1, 0.15, 0.55, 0.55] : [[0, 0.5, 0.75, 0.25], [0, 0.5, 0.5, 0]][runW > 0.5 ? 1 : 0];
    const gal = [0, 0.12, 0.55, 0.65];
    const amp = lerp(0.35, 0.75, runW) * moving;
    let bob = 0;
    for (let i = 0; i < 4; i++) {
      const L = legs[i];
      const o = lerp(off[i], gal[i], gallopW);
      const a = (ph + o * TAU);
      let swing = Math.sin(a) * amp * (gait === 'hop' && !L.front ? 1.3 : 1);
      let bend = Math.max(0, Math.cos(a)) * amp * 1.4 * (L.front ? 1 : -1);
      if (gait === 'hop' && moving > 0.1 && !s.air) {
        // rabbit hop: hind legs push back, fronts reach
        const hp = st.phase; swing = L.front ? Math.sin(hp * TAU) * 0.8 * moving : -Math.sin(hp * TAU) * 1.0 * moving; bend = L.front ? 0.2 : -0.6 * Math.max(0, Math.sin(hp * TAU));
      }
      // air pose
      const airSwing = L.front ? -0.7 + clamp(s.vy * 0.1, -0.4, 0.4) : 0.8;
      swing = lerp(swing, airSwing, st.airW); bend = lerp(bend, L.front ? 0.3 : -0.5, st.airW);
      // swim paddle
      swing = lerp(swing, Math.sin(ph * 1.5 + i * 1.6) * 0.8, st.swimW); bend = lerp(bend, 0.6 * (L.front ? 1 : -1), st.swimW);
      // crouch
      const cr = st.crouchW; bend = lerp(bend, L.front ? 1.2 : -1.4, cr * 0.7); swing = lerp(swing, L.front ? -0.4 : 0.8, cr * 0.6);
      // sit: hind legs fold forward, front straight
      if (L.front) { swing = lerp(swing, 0.25, st.sitW); bend = lerp(bend, 0, st.sitW); }
      else { swing = lerp(swing, -1.3, st.sitW); bend = lerp(bend, -2.2, st.sitW); }
      // lie: everything tucked
      swing = lerp(swing, L.front ? -1.35 : 1.35, st.lieW); bend = lerp(bend, L.front ? 1.6 : -1.6, st.lieW);
      L.hip.rotation.x = swing; L.knee.rotation.x = bend;
      if (i === 0) bob = Math.abs(Math.sin(a)) ;
    }
    // Action overlay (attacks)
    let headLunge = 0, swipe = 0, kick = 0;
    if (s.action) {
      const t = clamp(s.actionT, 0, 1); const e = Math.sin(t * Math.PI);
      if (s.action === 'swipe') { swipe = e; legs[(Math.floor(s.actionT * 0) + (s.actionSide > 0 ? 1 : 0))].hip.rotation.x -= e * 1.6; }
      else if (s.action === 'bite') headLunge = e;
      else if (s.action === 'kick') { kick = e; legs[2].hip.rotation.x += e * 1.8; legs[3].hip.rotation.x += e * 1.8; }
      else if (s.action === 'roar') headLunge = e * 0.6;
    }
    // Body motion
    const runBob = gait === 'hop' ? 0 : bob * lerp(0.008, 0.03, runW) * moving * (B.len * 2);
    let hop = 0;
    if (gait === 'hop' && !s.air && moving > 0.05) hop = Math.max(0, Math.sin(st.phase * TAU)) * 0.12 * moving * (opts.scale || 1);
    st.hopY = damp(st.hopY, hop, 30, dt);
    const lowered = st.crouchW * ry * 0.9 + st.sitW * ry * 0.4 + st.lieW * (B.leg * 0.92) + st.swimW * (B.leg + ry * 0.4);
    body.position.y = baseTorsoY + runBob + st.hopY - lowered;
    const breathe = 1 + Math.sin(performance.now() * 0.004) * 0.015 * (1 + st.lieW);
    torso.scale.set(rx * breathe, ry * breathe, rz);
    const targetPitch = (st.airW * clamp(-s.vy * 0.06, -0.5, 0.5)) - st.sitW * 0.65 + (gait === 'hop' ? -Math.sin(st.phase * TAU) * 0.25 * moving * (1 - st.airW) : 0) + gallopW * Math.sin(ph) * 0.12 - st.chargeW * 0.12 + kick * 0.4;
    st.pitch = damp(st.pitch, targetPitch, 10, dt);
    st.roll = damp(st.roll, clamp(-s.turn * spd * 0.03, -0.3, 0.3), 6, dt);
    body.rotation.x = st.pitch; pivot.rotation.z = st.roll;
    // charge wiggle (cats wiggle their rear before a jump!)
    body.rotation.y = st.chargeW * Math.sin(performance.now() * 0.03) * 0.12;
    // head
    st.lookTimer -= dt;
    if (st.lookTimer <= 0) { st.lookT = (spd < 0.3 && !st.lieW) ? (Math.random() - 0.5) * 1.4 : 0; st.lookTimer = 1.5 + Math.random() * 3; }
    st.look = damp(st.look, s.lookYaw ? clamp(s.lookYaw, -1, 1) : st.lookT, 4, dt);
    neck.rotation.y = st.look;
    neck.rotation.x = -st.pitch * 0.6 + st.lieW * 0.55 - st.swimW * 0.5 + (gait === 'hop' ? 0 : bob * 0.04 * moving) - headLunge * 0.3 + st.sitW * 0.5 + st.crouchW * 0.25;
    head.position.z = B.head * 0.35 + headLunge * B.head * 1.2;
    // eyes blink / sleep
    st.blinkT -= dt; if (st.blinkT < 0) { st.blink = 1; st.blinkT = 2 + Math.random() * 4; }
    st.blink = Math.max(0, st.blink - dt * 7);
    const closed = s.sleep ? 0.08 : 1 - Math.sin(st.blink * Math.PI) * 0.9;
    eyes.children.forEach((e) => (e.scale.y = closed));
    // ears
    st.earT -= dt; if (st.earT < 0) { st.earTw = 1; st.earT = 1.5 + Math.random() * 5; }
    st.earTw = Math.max(0, st.earTw - dt * 5);
    ears.forEach((e, i) => { e.rotation.x = (isRab ? -0.25 - st.crouchW * 0.9 - runW * 0.6 : -st.crouchW * 0.6 - runW * 0.3) + (i === 0 ? Math.sin(st.earTw * 9) * 0.25 : 0); });
    if (tongue) tongue.visible = spd > 3.5 || s.mood > 0.85 || headLunge > 0.1;
    // tail: wag speed from mood
    const happy = s.mood ?? 0.5;
    st.wagP += dt * (isDog ? lerp(3, 16, happy) : lerp(1.2, 3, runW));
    const n = tail.length;
    for (let i = 0; i < n; i++) {
      const t = tail[i];
      if (isRab) { t.rotation.x = 0; continue; }
      const k = i / n;
      let rx2 = (i === 0 ? tailBaseRot : 0) + (isCat ? (i === 0 ? -0.25 * happy : 0.18 + (i > 3 ? -0.25 * happy : 0)) : isDog ? 0.15 : isSq ? 0.45 : 0.05);
      rx2 += runW * (i === 0 ? 0.6 : -0.05) + st.airW * 0.2 - st.crouchW * (i === 0 ? -0.5 : 0) + st.lieW * (i === 0 ? 0.9 : 0.25);
      const wag = Math.sin(st.wagP - i * 0.7) * (isDog ? lerp(0.15, 0.55, happy) : 0.18) * (1 - st.lieW * 0.7);
      t.rotation.x = rx2 + (isCat ? Math.sin(st.wagP * 0.7 - i * 0.6) * 0.04 : 0);
      t.rotation.y = wag * (isCat ? (0.5 + k) : 1) + s.turn * 0.04 * spd;
    }
    root.scale.setScalar((opts.scale || 1) * (s.scale || 1));
    shadow.visible = !s.hiddenShadow;
  }
  return { root, update, kind: 'quad', headObj: head, mouthOffset: new THREE.Vector3(0, torsoY, rz + B.head), height: B.h + B.head };
}

// ════════════════════════════ BIRD ════════════════════════════
export function buildBird(sp, coat, opts = {}) {
  const B = sp.body; const root = new THREE.Group(); const pivot = new THREE.Group(); root.add(pivot);
  const base = mat(coat.base), belly = mat(coat.belly), dark = mat(coat.stripe), accent = mat(coat.accent || coat.stripe);
  const beakMat = mat(opts.beak ?? 0x3a3020, { rough: 0.4 }), legMat = mat(opts.legs ?? 0xb08060);
  const legL = B.h * 0.45;
  const body = new THREE.Group(); body.position.y = legL + B.h * 0.38; pivot.add(body);
  const torso = ellipsoid(B.w * 0.55, B.h * 0.48, B.len * 0.55, base); body.add(torso);
  const breast = ellipsoid(B.w * 0.5, B.h * 0.42, B.len * 0.42, belly); breast.position.set(0, -B.h * 0.08, B.len * 0.12); body.add(breast);
  const headP = new THREE.Group(); headP.position.set(0, B.h * 0.35, B.len * 0.38); body.add(headP);
  const head = sphere(B.head, base, 12); headP.add(head);
  const cap = sphere(B.head * 0.9, accent, 10); cap.scale.set(1, 0.6, 1); cap.position.y = B.head * 0.35; headP.add(cap);
  const beak = cone(B.head * 0.38, B.head * 1.1, beakMat, 6); beak.rotation.x = Math.PI / 2; beak.position.set(0, -B.head * 0.1, B.head * 1.2); headP.add(beak);
  const eyeM = mat(0x0a0a0a, { rough: 0.1 }); const sh = mat(0xffffff, { emissive: 0xffffff, ei: 0.5 });
  for (const s of [-1, 1]) { const e = sphere(B.head * 0.2, eyeM, 8); e.position.set(s * B.head * 0.72, B.head * 0.15, B.head * 0.45); headP.add(e); const h = sphere(B.head * 0.06, sh, 4); h.position.set(s * B.head * 0.82, B.head * 0.22, B.head * 0.55); headP.add(h); }
  // wings
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(s * B.w * 0.42, B.h * 0.15, B.len * 0.08); body.add(w);
    const inner = ellipsoid(B.len * 0.45, B.h * 0.08, B.len * 0.36, base); inner.position.set(s * B.len * 0.4, 0, -B.len * 0.08); w.add(inner);
    const tipP = new THREE.Group(); tipP.position.set(s * B.len * 0.8, 0, -B.len * 0.05); w.add(tipP);
    const outer = ellipsoid(B.len * 0.55, B.h * 0.05, B.len * 0.28, dark); outer.position.set(s * B.len * 0.45, 0, -B.len * 0.15); outer.rotation.y = s * 0.3; tipP.add(outer);
    wings.push({ w, tipP, s });
  }
  const tailP = new THREE.Group(); tailP.position.set(0, B.h * 0.05, -B.len * 0.5); body.add(tailP);
  const tail = ellipsoid(B.w * 0.5, B.h * 0.05, B.len * 0.45, dark); tail.position.z = -B.len * 0.35; tailP.add(tail);
  const legs = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group(); l.position.set(s * B.w * 0.22, -B.h * 0.32, B.len * 0.02); body.add(l);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(B.w * 0.04, B.w * 0.04, legL, 5), legMat); c.position.y = -legL / 2; l.add(c);
    const foot = ellipsoid(B.w * 0.1, B.w * 0.03, B.w * 0.25, legMat, 6); foot.position.set(0, -legL, B.w * 0.12); l.add(foot);
    legs.push(l);
  }
  const shadow = blobShadow(B.len * 2.5); root.add(shadow);
  optimizeRig(root);
  const st = { flap: 0, flapW: 0, hop: 0, hopY: 0, pitch: 0, roll: 0, peck: 0, peckT: 2, look: 0, lookT: 0, lt: 0 };
  function update(dt, s) {
    const fly = s.flying ? 1 : 0;
    st.flapW = damp(st.flapW, fly, 8, dt);
    const flapping = s.flying && (!s.glide || s.vy > 0.5);
    st.flap += dt * (flapping ? 22 : s.flying ? 3 : 0);
    const fl = Math.sin(st.flap);
    for (const W of wings) {
      const folded = { z: W.s * -1.25, y: W.s * 1.25 };
      const flyZ = flapping ? W.s * fl * 1.0 : W.s * (0.08 + Math.sin(st.flap) * 0.05);
      W.w.rotation.z = lerp(folded.z * 0, flyZ, st.flapW);
      W.w.rotation.y = lerp(W.s * 1.35, 0, st.flapW);
      W.w.rotation.x = lerp(-0.2, 0, st.flapW);
      W.tipP.rotation.z = lerp(W.s * -0.3, flapping ? W.s * Math.sin(st.flap - 0.8) * 0.6 : 0, st.flapW);
      W.tipP.rotation.y = lerp(W.s * 2.6, 0, st.flapW);
    }
    // ground hopping
    const moving = !s.flying && s.speed > 0.2;
    if (moving) st.hop += dt * (4 + s.speed * 2.5);
    const hy = moving ? Math.abs(Math.sin(st.hop * Math.PI)) * 0.06 * (opts.scale || 1) : 0;
    st.hopY = damp(st.hopY, hy, 25, dt);
    body.position.y = legL + B.h * 0.38 + st.hopY - (s.sit ? legL * 0.7 : 0) + (flapping ? fl * 0.012 : 0);
    st.pitch = damp(st.pitch, s.flying ? clamp(-s.vy * 0.06, -0.6, 0.6) + (s.speed > 4 ? 0.25 : 0) : 0, 6, dt);
    st.roll = damp(st.roll, s.flying ? clamp(-s.turn * s.speed * 0.06, -0.8, 0.8) : 0, 5, dt);
    body.rotation.x = st.pitch; pivot.rotation.z = st.roll;
    legs.forEach((l, i) => (l.rotation.x = s.flying ? 1.1 : moving ? Math.sin(st.hop * Math.PI) * 0.4 : 0));
    // pecking / looking around (birds are twitchy)
    st.peckT -= dt;
    if (st.peckT < 0 && !s.flying && s.speed < 0.2) { st.peck = 1; st.peckT = 1 + Math.random() * 3; }
    st.peck = Math.max(0, st.peck - dt * 4);
    let act = 0; if (s.action) act = Math.sin(clamp(s.actionT, 0, 1) * Math.PI);
    st.lt -= dt; if (st.lt < 0) { st.lookT = (Math.random() - 0.5) * 1.6; st.lt = 0.4 + Math.random() * 1.2; }
    st.look = s.flying ? 0 : lerp(st.look, st.lookT, 0.35); // snappy head turns like a real bird
    headP.rotation.y = st.look; headP.rotation.x = Math.sin(st.peck * Math.PI) * 1.0 + act * 0.9 - st.pitch * 0.5;
    headP.position.z = B.len * 0.38 + act * B.head * 1.2;
    tailP.rotation.x = s.flying ? -0.1 + Math.sin(st.flap * 0.5) * 0.05 : 0.35 + (moving ? Math.sin(st.hop * Math.PI) * 0.2 : 0);
    root.scale.setScalar((opts.scale || 1) * (s.scale || 1));
    shadow.visible = !s.hiddenShadow;
  }
  return { root, update, kind: 'bird', headObj: headP, height: B.h * 1.4 };
}

// ════════════════════════════ BUTTERFLY ════════════════════════════
function wingTexture(coat) {
  const key = 'wing' + coat.name; if (mats.has(key)) return mats.get(key);
  const t = canvasTex(256, 256, (g, W, H) => {
    const r = new RNG(coat.name.length * 7);
    g.clearRect(0, 0, W, H);
    const grd = g.createRadialGradient(0, H / 2, 10, 0, H / 2, W);
    grd.addColorStop(0, hex(coat.stripe)); grd.addColorStop(0.15, hex(coat.base)); grd.addColorStop(0.75, hex(coat.base)); grd.addColorStop(1, hex(new THREE.Color(coat.base).multiplyScalar(0.7)));
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    if (coat.name === 'Blue Morpho') { const s = g.createLinearGradient(0, 0, W, H); s.addColorStop(0, 'rgba(160,240,255,0.5)'); s.addColorStop(0.5, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(120,200,255,0.4)'); g.fillStyle = s; g.fillRect(0, 0, W, H); }
    // veins
    g.strokeStyle = hex(coat.stripe); g.lineCap = 'round';
    const veins = coat.name === 'Monarch' ? 9 : coat.name === 'Swallowtail' ? 6 : 5;
    for (let i = 0; i < veins; i++) {
      const a = -1.2 + (i / (veins - 1)) * 2.4;
      g.lineWidth = coat.name === 'Swallowtail' ? 12 : 4;
      g.beginPath(); g.moveTo(0, H / 2); g.quadraticCurveTo(W * 0.4, H / 2 + Math.sin(a) * H * 0.3, W * Math.cos(a * 0.6), H / 2 + Math.sin(a) * H * 0.55); g.stroke();
    }
    // border
    g.lineWidth = 28; g.strokeStyle = hex(coat.stripe);
    g.beginPath(); g.arc(0, H / 2, W * 0.98, -1.3, 1.3); g.stroke();
    g.fillStyle = hex(coat.spots);
    for (let i = 0; i < 26; i++) { const a = -1.2 + (i / 25) * 2.4; g.beginPath(); g.arc(Math.cos(a) * W * 0.97, H / 2 + Math.sin(a) * W * 0.97, r.range(3, 6), 0, TAU); g.fill(); }
  });
  mats.set(key, t); return t;
}
export function buildButterfly(sp, coat, opts = {}) {
  const B = sp.body; const root = new THREE.Group(); const pivot = new THREE.Group(); root.add(pivot);
  const bodyM = mat(coat.belly, { rough: 0.6 });
  const wingM = new THREE.MeshStandardMaterial({ map: wingTexture(coat), side: THREE.DoubleSide, roughness: 0.55, transparent: true, alphaTest: 0.1, emissive: new THREE.Color(coat.base), emissiveIntensity: 0.12 });
  const body = new THREE.Group(); body.position.y = 0.05; pivot.add(body);
  const thorax = capsule(B.w * 0.6, B.len * 0.55, bodyM); thorax.rotation.x = Math.PI / 2; body.add(thorax);
  const abd = capsule(B.w * 0.45, B.len * 0.6, bodyM); abd.rotation.x = Math.PI / 2; abd.position.z = -B.len * 0.6; body.add(abd);
  const head = sphere(B.w * 0.75, bodyM, 8); head.position.z = B.len * 0.48; body.add(head);
  const antM = mat(0x111111);
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, B.len * 0.9, 3), antM);
    a.position.set(s * B.w * 0.5, B.len * 0.3, B.len * 0.75); a.rotation.set(0.9, 0, -s * 0.35); body.add(a);
    const tip = sphere(0.004, antM, 4); tip.position.set(s * B.w * 0.5 + s * 0.016, B.len * 0.58, B.len * 0.96); body.add(tip);
  }
  const mkWingGeo = (fore) => {
    const sh = new THREE.Shape();
    if (fore) { sh.moveTo(0, 0); sh.bezierCurveTo(0.3, 0.55, 0.9, 0.75, 1.0, 0.55); sh.bezierCurveTo(1.05, 0.25, 0.7, 0.0, 0.0, -0.05); }
    else { sh.moveTo(0, 0); sh.bezierCurveTo(0.5, -0.05, 0.85, -0.3, 0.75, -0.65); sh.bezierCurveTo(0.6, -0.95, 0.15, -0.6, 0.0, -0.1); }
    const g = new THREE.ShapeGeometry(sh, 12);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), 0.5 + p.getY(i) * 0.5);
    g.rotateX(-Math.PI / 2); g.scale(B.wing, B.wing, B.wing);
    return g;
  };
  const wings = [];
  for (const s of [-1, 1]) for (const fore of [true, false]) {
    const p = new THREE.Group(); p.position.set(s * B.w * 0.3, 0.003, fore ? B.len * 0.05 : -B.len * 0.08); body.add(p);
    const m = new THREE.Mesh(mkWingGeo(fore), wingM); m.scale.x = s; m.castShadow = true; p.add(m);
    wings.push({ p, s, fore });
  }
  const shadow = blobShadow(B.wing * 3); root.add(shadow);
  const st = { flap: 0, rest: 0, bob: 0, pitch: 0, roll: 0, glideT: 0 };
  function update(dt, s) {
    // butterflies flap in bursts, with brief glides
    const fast = s.speed > 2 || s.vy > 0.5;
    st.glideT -= dt;
    const gliding = !fast && st.glideT > 0 && st.glideT < 0.5;
    if (st.glideT < -1.5) st.glideT = 2 + Math.random() * 2;
    const landed = !s.flying;
    const rate = landed ? 2 : gliding ? 0 : fast ? 38 : 26;
    st.flap += dt * rate;
    let a = landed ? 0.75 + Math.sin(st.flap) * 0.6 : gliding ? 0.15 : Math.sin(st.flap) * 1.15 + 0.25;
    if (s.action) a += Math.sin(clamp(s.actionT, 0, 1) * Math.PI) * 0.5;
    for (const W of wings) { W.p.rotation.z = W.s * (a + (W.fore ? 0 : -0.05)); W.p.rotation.y = W.s * (W.fore ? -0.05 : 0.1); }
    st.bob = landed ? 0 : -Math.cos(st.flap) * 0.01;
    body.position.y = 0.05 + st.bob;
    st.pitch = damp(st.pitch, clamp(-s.vy * 0.15, -0.5, 0.5) + (landed ? 0 : -0.15), 5, dt);
    st.roll = damp(st.roll, clamp(-s.turn * 0.25, -0.6, 0.6), 4, dt);
    body.rotation.x = st.pitch; pivot.rotation.z = st.roll;
    root.scale.setScalar((opts.scale || 1) * (s.scale || 1));
    shadow.visible = !s.hiddenShadow;
  }
  return { root, update, kind: 'butterfly', headObj: head, height: 0.1 };
}

// ════════════════════════════ SNAKE ════════════════════════════
// Tube body that follows the head's path (true lateral undulation).
export function buildSnake(sp, coat, opts = {}) {
  const B = sp.body; const root = new THREE.Group();
  const scale = opts.scale || 1;
  const L = B.len * scale, R = B.w * 0.5 * scale;
  const RINGS = 48, RAD = 9;
  const skin = mat(0xffffff, { map: coatTexture(coat, 'scales'), rough: 0.45 });
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(RINGS * RAD * 3), uv = new Float32Array(RINGS * RAD * 2), idx = [];
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < RAD; j++) {
    uv[(i * RAD + j) * 2] = j / (RAD - 1); uv[(i * RAD + j) * 2 + 1] = i / (RINGS - 1) * 3;
    if (i < RINGS - 1 && j < RAD - 1) { const a = i * RAD + j, b = a + RAD; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const tube = new THREE.Mesh(geo, skin); tube.castShadow = true; tube.frustumCulled = false;
  // tube is in WORLD space → added to a world-level group by owner (see .worldObjects)
  const headG = new THREE.Group();
  const headM = ellipsoid(R * 1.25, R * 0.85, R * 1.9, skin); headM.position.z = R * 0.8; headG.add(headM);
  const eyeM = mat(coat.eye, { rough: 0.1 }), pup = mat(0x000000);
  for (const s of [-1, 1]) { const e = sphere(R * 0.38, eyeM, 8); e.position.set(s * R * 0.95, R * 0.35, R * 1.3); headG.add(e); const p = sphere(R * 0.2, pup, 6); p.scale.set(0.4, 1, 0.5); p.position.set(s * R * 1.25, R * 0.38, R * 1.45); headG.add(p); }
  const tongue = new THREE.Group(); tongue.position.set(0, -R * 0.2, R * 2.5); headG.add(tongue);
  const tm = mat(0xd02040);
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.06, R * 0.06, R * 1.6, 3), tm); f.rotation.set(Math.PI / 2, s * 0.25, 0); f.position.set(s * R * 0.15, 0, R * 0.8); tongue.add(f); }
  const shadow = blobShadow(R * 6); root.add(shadow);
  const trail = []; // world points, newest first
  const st = { phase: 0, tongueT: 1, tongue: 0, init: false, coil: 0 };
  const v = new THREE.Vector3(), tan = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const pts = [];
  function sampleAt(d) {
    // distance d along trail from head
    let acc = 0;
    for (let i = 0; i < trail.length - 1; i++) {
      const a = trail[i], b = trail[i + 1]; const l = a.distanceTo(b);
      if (acc + l >= d) { const t = (d - acc) / (l || 1); return v.copy(a).lerp(b, t); }
      acc += l;
    }
    return v.copy(trail[trail.length - 1]);
  }
  function update(dt, s, worldPos, yaw) {
    if (!worldPos) return;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    if (!st.init) { trail.length = 0; for (let i = 0; i <= 40; i++) trail.push(worldPos.clone().addScaledVector(fwd, -i * L / 40).setY(worldPos.y + R)); st.init = true; }
    // head lateral undulation while moving
    const spd = s.speed;
    st.phase += dt * spd * (5.5 / Math.max(0.6, L));
    const lat = Math.sin(st.phase) * R * 2.6 * clamp(spd / 1.5, 0, 1) * (s.swim ? 1.3 : 1);
    const headPos = worldPos.clone().addScaledVector(side, lat); headPos.y = worldPos.y + R * (s.swim ? 0.2 : 1);
    if (s.action === 'strike') headPos.y += Math.sin(clamp(s.actionT, 0, 1) * Math.PI) * R * 3;
    const segLen = L / 60;
    if (trail[0].distanceTo(headPos) > segLen) trail.unshift(headPos.clone());
    else trail[0].copy(headPos);
    // trim
    let total = 0; for (let i = 0; i < trail.length - 1; i++) { total += trail[i].distanceTo(trail[i + 1]); if (total > L + 0.5 * scale) { trail.length = i + 2; break; } }
    // ensure trail long enough (extend straight)
    while (total < L) { const a = trail[trail.length - 1], b = trail[trail.length - 2] || headPos; const d = a.clone().sub(b).normalize(); if (!isFinite(d.x) || d.lengthSq() < 0.5) d.copy(fwd).negate(); trail.push(a.clone().addScaledVector(d, segLen)); total += segLen; }
    // build rings
    pts.length = 0;
    for (let i = 0; i < RINGS; i++) pts.push(sampleAt((i / (RINGS - 1)) * L).clone());
    const P = geo.attributes.position.array;
    for (let i = 0; i < RINGS; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(RINGS - 1, i + 1)];
      tan.subVectors(a, b).normalize(); if (!isFinite(tan.x) || tan.lengthSq() < 0.5) tan.copy(fwd);
      bin.crossVectors(up, tan).normalize(); nrm.crossVectors(tan, bin).normalize();
      const k = i / (RINGS - 1);
      const r = R * (k < 0.08 ? 0.75 + k * 3 : k > 0.7 ? Math.max(0.05, 1 - (k - 0.7) / 0.3) : 1) * (1 + Math.sin(k * Math.PI) * 0.25);
      for (let j = 0; j < RAD; j++) {
        const ang = (j / (RAD - 1)) * TAU;
        const cx = Math.cos(ang) * r, cy = Math.sin(ang) * r * 0.82;
        const o = (i * RAD + j) * 3;
        P[o] = pts[i].x + bin.x * cx + nrm.x * cy; P[o + 1] = pts[i].y + bin.y * cx + nrm.y * cy - r * 0.15; P[o + 2] = pts[i].z + bin.z * cx + nrm.z * cy;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
    // head
    const h0 = pts[0], h1 = pts[2];
    headG.position.copy(h0);
    const lookY = Math.atan2(h0.x - h1.x, h0.z - h1.z);
    headG.rotation.set(-Math.atan2(h0.y - h1.y, Math.hypot(h0.x - h1.x, h0.z - h1.z)) + (s.action === 'strike' ? -0.2 : 0) - (s.swim ? 0.2 : 0), lookY, 0);
    // tongue flick
    st.tongueT -= dt; if (st.tongueT < 0) { st.tongue = 1; st.tongueT = 1.2 + Math.random() * 2.5; }
    st.tongue = Math.max(0, st.tongue - dt * 3);
    tongue.scale.setScalar(Math.max(0.001, Math.sin(st.tongue * Math.PI)));
    tongue.rotation.x = Math.sin(st.tongue * 40) * 0.15;
    const sc = s.scale || 1; headG.scale.setScalar(sc);
    shadow.visible = false;
  }
  function reset() { st.init = false; }
  return { root, update, kind: 'snake', headObj: headG, worldObjects: [tube, headG], reset, height: R * 2 };
}

export function buildCreature(key, sp, coat, opts = {}) {
  sp = { ...sp, key };
  if (sp.rig === 'quad') return buildQuad(sp, coat, { kind: key, ...opts });
  if (sp.rig === 'bird') return buildBird(sp, coat, opts);
  if (sp.rig === 'butterfly') return buildButterfly(sp, coat, opts);
  if (sp.rig === 'snake') return buildSnake(sp, coat, opts);
}

// NPC species (not playable)
export const NPC_SPECIES = {
  pigeon: { rig: 'bird', body: { len: 0.3, h: 0.22, w: 0.17, head: 0.07 }, coats: [{ name: 'Pigeon', base: 0x8a8e9a, belly: 0x9aa0b0, stripe: 0x5a5e6a, accent: 0x4a6a6a, eye: 0xd07020 }], beak: 0x404040, legs: 0xd06060, move: { gait: 'hop' } },
  duck: { rig: 'bird', body: { len: 0.45, h: 0.3, w: 0.26, head: 0.1 }, coats: [{ name: 'Mallard', base: 0x8a7050, belly: 0xa08a70, stripe: 0x4a4a5a, accent: 0x207040, eye: 0x101010 }], beak: 0xe0b020, legs: 0xe08020, move: { gait: 'hop' } },
  squirrel: { rig: 'quad', body: { len: 0.24, h: 0.17, w: 0.13, head: 0.075, leg: 0.07, tail: 0.32, ear: 'cat', snout: 0.3 }, coats: [{ name: 'Squirrel', base: 0xa0582a, belly: 0xf0e0c8, stripe: 0x7a4020, eye: 0x101010 }], move: { gait: 'hop', stride: 0.5 } },
  mouse: { rig: 'quad', body: { len: 0.1, h: 0.06, w: 0.06, head: 0.035, leg: 0.025, tail: 0.12, snout: 0.5 }, coats: [{ name: 'Mouse', base: 0x8a8078, belly: 0xc8c0b8, stripe: 0x6a6058, eye: 0x101010 }], move: { gait: 'trot', stride: 0.12 } },
};
