import * as THREE from 'three';
import { buildHuman } from '../models/humans.js';
import { optimizeRig, bakeStatic } from '../gfx/gfx.js';
import { toSprite } from '../gfx/post.js';
import { buildCreature, NPC_SPECIES, defaultAnimState } from '../models/creatures.js';
import { SPECIES } from '../data/species.js';
import { ROADS, isRoad, POND, PARK, SEA_X } from './city.js';
import { audio } from '../core/audio.js';
import { RNG, angleDiff, clamp, damp, rand, pick, TAU, dist2 } from '../core/utils.js';

const ACTIVE_R = 85;
// ═════════════════════════ Humans ═════════════════════════
export class Human {
  constructor(npcs, seed, opts) {
    this.npcs = npcs; this.rig = buildHuman(seed, opts); this.root = this.rig.root;
    this.pos = opts.pos.clone(); this.yaw = opts.yaw ?? 0; this.role = opts.role || 'walker';
    this.speed = 0; this.pose = opts.pose || 'idle'; this.anim = { speed: 0, pose: this.pose, lookYaw: 0 };
    this.node = opts.node; this.prev = null; this.goal = null; this.wait = 0; this.react = null; this.reactT = 0; this.home = this.pos.clone(); this.homeYaw = this.yaw;
    this.walkSpeed = rand(1.1, 1.5) * (this.rig.child ? 1.2 : 1); this.say = null;
    if (opts.held) this.rig.held.add(opts.held);
    toSprite(this.root); this.root.position.copy(this.pos); npcs.scene.add(this.root);
  }
  setReact(kind, t, data) { this.react = kind; this.reactT = t; this.reactData = data; }
  update(dt, player) {
    const w = this.npcs;
    this.reactT -= dt;
    if (this.reactT <= 0 && this.react) { this.react = null; if (this.role !== 'walker') this.goal = this.home.clone(); }
    let target = 0;
    const pd = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    // notice the player
    const noticed = pd < 5 && !player.stealth;
    this.anim.lookYaw = noticed ? clamp(angleDiff(this.yaw, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z)), -1.1, 1.1) : 0;
    this.pose = this.basePose();
    if (this.react === 'flee') { // run away from snake etc.
      const a = Math.atan2(this.pos.x - player.pos.x, this.pos.z - player.pos.z);
      this.yaw += angleDiff(this.yaw, a) * Math.min(1, dt * 6); target = 4.2; this.pose = 'scared';
    } else if (this.react === 'pet' || this.react === 'crouch') {
      this.yaw += angleDiff(this.yaw, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z)) * Math.min(1, dt * 5);
      this.pose = this.react;
    } else if (this.react === 'chase') {
      const a = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      this.yaw += angleDiff(this.yaw, a) * Math.min(1, dt * 6); target = pd > 1.2 ? 3.6 : 0; this.pose = 'shoo';
      if (pd < 1.4 && !this.reactData?.done) { this.reactData = { done: true }; w.onShooed?.(this); }
    } else if (this.react === 'throw') { this.pose = 'throw'; }
    else if (this.react === 'shoo') { this.pose = 'shoo'; this.yaw += angleDiff(this.yaw, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z)) * Math.min(1, dt * 5); }
    else if (this.role === 'walker') {
      if (!this.goal) this.pickGoal();
      if (this.wait > 0) { this.wait -= dt; }
      else {
        const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.6) { this.pickGoal(); if (Math.random() < 0.08) this.wait = rand(2, 6); }
        else { this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 4); target = this.walkSpeed; }
        // don't walk into the player
        if (pd < 1.0) target *= 0.3;
      }
    } else if (this.goal) {
      const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.4) { this.goal = null; this.yaw = this.homeYaw; } else { this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 4); target = 1.6; }
    }
    this.speed = damp(this.speed, target, 6, dt);
    if (this.speed > 0.01) {
      const nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt, nz = this.pos.z + Math.cos(this.yaw) * this.speed * dt;
      this.pos.x = nx; this.pos.z = nz;
      if (this.react === 'flee' || this.react === 'chase' || this.goal) w.physics.resolve(this.pos, 0.3, this.pos.y, 1.7, 0.3);
      this.pos.y = w.physics.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.2, 0.3);
    }
    this.anim.speed = this.speed; this.anim.pose = this.speed > 0.2 && this.pose !== 'scared' && this.pose !== 'shoo' ? 'idle' : this.pose;
    if (this.pose === 'scared') this.anim.pose = 'scared';
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    this.rig.update(dt, this.anim);
  }
  basePose() { return this.role === 'sitter' || this.role === 'feeder' ? 'sit' : this.role === 'fisher' ? 'fish' : this.role === 'vendor' ? (this.busy > 0 ? 'crouch' : 'vendor') : this.role === 'phone' ? 'phone' : 'idle'; }
  pickGoal() {
    const g = this.npcs.walk;
    if (this.path === 'park') {
      const a = (this.parkA = (this.parkA ?? rand(0, TAU)) + 0.35 * this.parkDir);
      const rr = POND.r + 6; this.goal = new THREE.Vector3(POND.x + Math.cos(a) * rr, 0.15, POND.z + Math.sin(a) * rr); return;
    }
    const nb = g.adj.get(this.node) || [];
    let opts = nb.filter((n) => n !== this.prev); if (!opts.length) opts = nb;
    const nxt = pick(opts); this.prev = this.node; this.node = nxt;
    const p = g.nodes[nxt]; this.goal = new THREE.Vector3(p.x + rand(-0.6, 0.6), 0.15, p.z + rand(-0.6, 0.6));
  }
}

// ═════════════════════════ Cars ═════════════════════════
const CAR_COLORS = [0xc83a3a, 0x3a6ac8, 0xe8e8e8, 0x2a2a2a, 0xe8c040, 0x5a9a6a, 0x8a8a90, 0xe87a30];
const carGeo = { body: new THREE.BoxGeometry(1.8, 0.75, 4.2), cabin: new THREE.BoxGeometry(1.6, 0.55, 2.2), win: new THREE.BoxGeometry(1.62, 0.42, 2.0), wheel: new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12), light: new THREE.BoxGeometry(0.4, 0.15, 0.05) };
const carMats = {}; const cm = (c, o = {}) => (carMats[c + JSON.stringify(o)] ||= new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.4, metalness: o.m ?? 0.3, emissive: o.e ?? 0, emissiveIntensity: o.ei ?? 0 }));
export class Car {
  constructor(npcs, a, b, seed) {
    this.npcs = npcs; const r = new RNG(seed);
    const g = new THREE.Group(); const color = CAR_COLORS[r.int(0, CAR_COLORS.length - 1)];
    const body = new THREE.Mesh(carGeo.body, cm(color)); body.position.y = 0.6; body.castShadow = true; g.add(body);
    const cab = new THREE.Mesh(carGeo.cabin, cm(color)); cab.position.set(0, 1.2, -0.2); cab.castShadow = true; g.add(cab);
    const win = new THREE.Mesh(carGeo.win, cm(0x1a2a3a, { r: 0.1, m: 0.6 })); win.position.copy(cab.position); g.add(win);
    this.wheels = [];
    for (const [x, z] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) { const w = new THREE.Mesh(carGeo.wheel, cm(0x151515, { r: 0.8, m: 0 })); w.rotation.z = Math.PI / 2; w.position.set(x, 0.35, z); g.add(w); this.wheels.push(w); }
    this.head = cm(0xfff8e0, { e: 0xfff0c0, ei: 0 }); this.tail = cm(0x801010, { e: 0xff2020, ei: 0.3 });
    for (const s of [-0.6, 0.6]) { const h = new THREE.Mesh(carGeo.light, this.head); h.position.set(s, 0.7, 2.11); g.add(h); const t = new THREE.Mesh(carGeo.light, this.tail); t.position.set(s, 0.75, -2.11); g.add(t); }
    optimizeRig(g); toSprite(g); this.root = g; npcs.scene.add(g);
    this.from = a; this.to = b; this.path = null; this.s = 0; this.speed = 0; this.maxSpeed = r.range(8, 11); this.honkT = 0;
    this.col = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, top: 1.45, bottom: 0, tag: 'movingcar' };
    npcs.physics.dynamic.push(this.col);
    this.buildPath(null);
    this.pos = this.path.p0.clone(); this.yaw = 0;
  }
  lanePt(node, tx, tz, along) { const N = this.npcs.roads.nodes[node]; return new THREE.Vector3(N.x + tx * along - tz * 3, 0, N.z + tz * along + tx * 3); }
  buildPath(prevDir) {
    const R = this.npcs.roads; const A = R.nodes[this.from], B = R.nodes[this.to];
    const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
    // choose next
    const nb = (R.adj.get(this.to) || []).filter((n) => n !== this.from);
    const next = nb.length ? pick(nb) : this.from;
    const C = R.nodes[next];
    const ex = Math.sign(C.x - B.x), ez = Math.sign(C.z - B.z);
    const p0 = this.lanePt(this.from, dx, dz, 9), p1 = this.lanePt(this.to, dx, dz, -9);
    // right-hand lane offset: (-dz, dx) * 3 relative to travel → lanePt uses (-dirz*3, dirx*3)
    const q0 = p1.clone(), q2 = this.lanePt(this.to, ex, ez, 9);
    const ctrl = new THREE.Vector3((q0.x + q2.x) / 2, 0, (q0.z + q2.z) / 2);
    if (ex !== dx || ez !== dz) { // turning: control point at lane intersection
      if (dx !== 0) ctrl.set(q2.x, 0, q0.z); else ctrl.set(q0.x, 0, q2.z);
    }
    this.path = { p0, p1, q0, ctrl, q2, len1: p0.distanceTo(p1), next };
    this.s = 0;
  }
  sample(s, out) {
    const P = this.path;
    if (s <= P.len1) return out.lerpVectors(P.p0, P.p1, s / P.len1);
    const t = Math.min(1, (s - P.len1) / Math.max(1, P.q0.distanceTo(P.q2) * 1.1));
    const a = 1 - t; return out.set(a * a * P.q0.x + 2 * a * t * P.ctrl.x + t * t * P.q2.x, 0, a * a * P.q0.z + 2 * a * t * P.ctrl.z + t * t * P.q2.z);
  }
  update(dt, player, others) {
    const P = this.path; const total = P.len1 + P.q0.distanceTo(P.q2) * 1.1;
    // brake for obstacles ahead
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let block = false;
    const check = (x, z, r = 1.2) => { const dx = x - this.pos.x, dz = z - this.pos.z; const along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx); return along > 0 && along < 9 && side < r; };
    if (check(player.pos.x, player.pos.z) && player.pos.y < 2) { block = true; if (this.honkT <= 0 && this.speed > 2) { audio.sfx('car'); this.honkT = 3; } }
    for (const o of others) if (o !== this && check(o.pos.x, o.pos.z, 1.6)) block = true;
    for (const h of this.npcs.humans) if (check(h.pos.x, h.pos.z, 1.4)) block = true;
    this.honkT -= dt;
    this.speed = damp(this.speed, block ? 0 : (this.s > P.len1 ? this.maxSpeed * 0.55 : this.maxSpeed), block ? 5 : 1.2, dt);
    this.s += this.speed * dt;
    if (this.s >= total) { this.from = this.to; this.to = P.next; this.buildPath(); this.s = 0; }
    const np = this.sample(this.s, new THREE.Vector3());
    const ahead = this.sample(this.s + 1.5, new THREE.Vector3());
    if (ahead.distanceToSquared(np) > 0.01) this.yaw = Math.atan2(ahead.x - np.x, ahead.z - np.z);
    this.pos.copy(np);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    for (const w of this.wheels) w.rotation.x += this.speed * dt / 0.35;
    const along = Math.abs(Math.sin(this.yaw)) > 0.7;
    this.col.minX = this.pos.x - (along ? 2.1 : 0.9); this.col.maxX = this.pos.x + (along ? 2.1 : 0.9); this.col.minZ = this.pos.z - (along ? 0.9 : 2.1); this.col.maxZ = this.pos.z + (along ? 0.9 : 2.1);
    // hit player
    if (this.speed > 3 && player.pos.y < 1.4) {
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z; const al = dx * fx + dz * fz, sd = dx * fz - dz * fx;
      if (Math.abs(al) < 2.3 && Math.abs(sd) < 1.1) this.npcs.onCarHit?.(this, new THREE.Vector3(Math.sign(sd || 1) * fz, 0, -Math.sign(sd || 1) * fx));
    }
  }
}

// ═════════════════════════ Animals ═════════════════════════
export class Critter {
  constructor(npcs, kind, pos, opts = {}) {
    this.npcs = npcs; this.kind = kind;
    const sp = NPC_SPECIES[kind] || SPECIES[kind];
    const coat = opts.coat || sp.coats[Math.floor(Math.random() * sp.coats.length)];
    this.rig = buildCreature(kind, { ...sp, key: kind }, coat, { scale: opts.scale || 1, beak: sp.beak, legs: sp.legs, plain: true });
    this.root = this.rig.root; npcs.scene.add(this.root);
    if (this.rig.worldObjects) this.rig.worldObjects.forEach((o) => npcs.scene.add(o));
    this.pos = pos.clone(); this.home = pos.clone(); this.yaw = rand(0, TAU); this.speed = 0; this.anim = defaultAnimState(); this.state = 'idle'; this.t = rand(0, 3);
    this.flying = false; this.vy = 0; this.alt = 0; this.range = opts.range ?? 4; this.flee = 0; this.goal = null; this.hidden = false; this.water = opts.water;
    this.rig.update(0.016, this.anim, this.pos, this.yaw);
    if (kind !== 'butterfly') {
      const savedPos = this.root.position.clone(), savedRot = this.root.rotation.y; this.root.position.set(0, 0, 0); this.root.rotation.y = 0;
      this.lod = bakeStatic(this.root); this.root.position.copy(savedPos); this.root.rotation.y = savedRot;
      if (this.lod) { this.lod.visible = false; this.lod.scale.setScalar(1 / this.root.scale.x); this.root.add(this.lod); this.parts = this.root.children.filter((c) => c !== this.lod && c.geometry?.type !== 'PlaneGeometry'); }
    }
    this.far = false; toSprite(this.root); this.rig.worldObjects?.forEach(toSprite);
    this.maxSpeed = { pigeon: 2.5, duck: 1, squirrel: 6, mouse: 4, cat: 4, dog: 5, butterfly: 2 }[kind] || 2;
  }
  setFar(f) { if (!this.lod || f === this.far) return; this.far = f; this.lod.visible = f; for (const c of this.parts) c.visible = !f; }
  scare(from, force = 1) { if (this.flee > 0 || this.hidden) return false; this.flee = 2.5 + force; this.fleeFrom = from.clone(); return true; }
  update(dt, player) {
    this.t -= dt; this.flee -= dt;
    const k = this.kind;
    const pd = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    // react to fast approach (not when sneaking)
    const threat = !player.stealth && ((pd < 3 && player.speed > 3) || (pd < 1.6 && player.speed > 0.8));
    if (threat && (k === 'pigeon' || k === 'squirrel' || k === 'mouse' || k === 'duck')) { if (this.scare(player.pos)) { if (k === 'pigeon') { audio.sfx('flap'); this.npcs.onScatter?.(this); } } }
    let target = 0;
    if (k === 'pigeon' || k === 'duck') {
      if (this.flee > 0 && k === 'pigeon') {
        if (!this.flying) { this.flying = true; this.vy = 4; this.yaw = Math.atan2(this.pos.x - this.fleeFrom.x, this.pos.z - this.fleeFrom.z) + rand(-0.6, 0.6); }
      }
      if (this.flying) {
        target = 7; this.vy = this.flee > 0 ? damp(this.vy, 2.5, 2, dt) : damp(this.vy, -1.5, 1, dt);
        this.alt += this.vy * dt;
        if (this.flee <= 0) { const dx = this.home.x - this.pos.x, dz = this.home.z - this.pos.z; this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 2); if (Math.hypot(dx, dz) < 3 && this.alt < 0.3) { this.flying = false; this.alt = 0; } }
        if (this.alt < 0) this.alt = 0; if (this.alt > 14) this.vy = Math.min(this.vy, 0);
      } else if (this.flee > 0 && k === 'duck') { target = 1.8; this.yaw += angleDiff(this.yaw, Math.atan2(this.pos.x - this.fleeFrom.x, this.pos.z - this.fleeFrom.z)) * Math.min(1, dt * 3); }
      else {
        if (this.t <= 0) { this.t = rand(0.5, 3); this.goal = Math.random() < 0.6 ? null : this.home.clone().add(new THREE.Vector3(rand(-this.range, this.range), 0, rand(-this.range, this.range))); if (this.lure) this.goal = this.lure.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5))); }
        if (this.goal) { const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z; if (Math.hypot(dx, dz) < 0.3) this.goal = null; else { this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 6); target = k === 'duck' ? 0.8 : 1.0; } }
      }
    } else if (k === 'squirrel' || k === 'mouse') {
      if (this.flee > 0) { this.yaw += angleDiff(this.yaw, Math.atan2(this.pos.x - this.fleeFrom.x, this.pos.z - this.fleeFrom.z)) * Math.min(1, dt * 8); target = this.maxSpeed; if (k === 'squirrel' && this.flee < 1.5) { this.hidden = true; this.hideT = 6; } }
      else if (this.hidden) { this.hideT -= dt; if (this.hideT <= 0) { this.hidden = false; this.pos.copy(this.home); } }
      else {
        if (this.t <= 0) { this.t = rand(0.6, 2.5); this.goal = Math.random() < 0.5 ? null : this.home.clone().add(new THREE.Vector3(rand(-this.range, this.range), 0, rand(-this.range, this.range))); }
        if (this.goal) { const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z; if (Math.hypot(dx, dz) < 0.3) this.goal = null; else { this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8); target = this.maxSpeed * 0.6; } }
      }
    } else if (k === 'cat' || k === 'dog') {
      // stray: wander, sit, react to species
      if (this.flee > 0) { this.yaw += angleDiff(this.yaw, Math.atan2(this.pos.x - this.fleeFrom.x, this.pos.z - this.fleeFrom.z)) * Math.min(1, dt * 6); target = 5; this.anim.sit = 0; }
      else {
        if (this.t <= 0) { this.t = rand(2, 7); this.sitting = Math.random() < 0.5; this.goal = this.sitting ? null : this.home.clone().add(new THREE.Vector3(rand(-this.range, this.range), 0, rand(-this.range, this.range))); }
        if (this.goal) { const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z; if (Math.hypot(dx, dz) < 0.4) this.goal = null; else { this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 4); target = 1.3; } }
        this.anim.sit = this.sitting && !this.goal ? 1 : 0;
        if (pd < 4) this.anim.lookYaw = clamp(angleDiff(this.yaw, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z)), -1, 1); else this.anim.lookYaw = 0;
      }
    } else if (k === 'butterfly') {
      this.flying = true;
      if (this.t <= 0) { this.t = rand(1, 3); this.goal = this.home.clone().add(new THREE.Vector3(rand(-this.range, this.range), 0, rand(-this.range, this.range))); this.goalAlt = rand(0.4, 2); }
      if (this.dance > 0) { this.dance -= dt; this.goal = player.pos.clone().add(new THREE.Vector3(Math.cos(this.dance * 3) * 0.6, 0, Math.sin(this.dance * 3) * 0.6)); this.goalAlt = player.pos.y - 0.15 + 0.3 + Math.sin(this.dance * 5) * 0.2; }
      if (this.goal) { const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z; this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 3); target = Math.min(2, Math.hypot(dx, dz) * 2); }
      this.alt = damp(this.alt, (this.goalAlt ?? 1) + Math.sin(performance.now() * 0.004 + this.home.x) * 0.15, 2, dt);
    }
    if (this.water) { // ducks stay in pond
      const dx = this.pos.x - POND.x, dz = this.pos.z - POND.z, d = Math.hypot(dx, dz);
      if (d > POND.r - 1.5) { this.pos.x = POND.x + dx / d * (POND.r - 1.5); this.pos.z = POND.z + dz / d * (POND.r - 1.5); this.yaw += angleDiff(this.yaw, Math.atan2(-dx, -dz)) * 0.1; }
    }
    this.speed = damp(this.speed, target, 6, dt);
    this.pos.x += Math.sin(this.yaw) * this.speed * dt; this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    if (!this.flying && !this.water) { this.npcs.physics.resolve(this.pos, 0.15, this.pos.y, 0.3, 0.3); this.pos.y = this.npcs.physics.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.1, 0.4); }
    if (this.water) this.pos.y = 0.0;
    this.root.position.set(this.pos.x, this.pos.y + this.alt, this.pos.z); this.root.rotation.y = this.yaw;
    this.root.visible = !this.hidden;
    this.anim.speed = this.speed; this.anim.maxSpeed = this.maxSpeed; this.anim.flying = this.flying; this.anim.vy = this.vy; this.anim.mood = 0.5; this.anim.swim = this.water ? 1 : 0;
    if (!this.far) this.rig.update(dt, this.anim, this.root.position, this.yaw);
  }
}

// ═════════════════════════ Manager ═════════════════════════
export class NPCs {
  constructor(world, city) {
    this.world = world; this.scene = world.scene; this.physics = world.physics; this.city = city;
    this.humans = []; this.cars = []; this.critters = [];
    this.buildGraphs(); this.spawn();
  }
  buildGraphs() {
    // Sidewalk graph: corners around every intersection
    const nodes = [], idx = new Map(), adj = new Map();
    const key = (x, z) => `${x},${z}`;
    const add = (x, z) => { const k = key(x, z); if (!idx.has(k)) { idx.set(k, nodes.length); nodes.push({ x, z }); } return idx.get(k); };
    const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push(b); adj.get(b).push(a); };
    const O = 8.5;
    for (let i = 0; i < ROADS.length; i++) for (let j = 0; j < ROADS.length; j++) {
      const X = ROADS[i], Z = ROADS[j];
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = X + sx * O, z = Z + sz * O; if (Math.abs(x) > 186 || Math.abs(z) > 186) continue;
        const a = add(x, z);
        // along block edges
        if (sx > 0 && i < ROADS.length - 1) { const b = add(ROADS[i + 1] - O, z); link(a, b); }
        if (sz > 0 && j < ROADS.length - 1) { const b = add(x, ROADS[j + 1] - O); link(a, b); }
        // crosswalks
        if (sx > 0 && isRoad(X, z) && Math.abs(X - O) <= 186) link(a, add(X - O, z));
        if (sz > 0 && isRoad(x, Z) && Math.abs(Z - O) <= 186) link(a, add(x, Z - O));
      }
    }
    this.walk = { nodes, adj };
    // Road graph for cars
    const rn = [], ridx = new Map(), radj = new Map();
    for (const X of ROADS) for (const Z of ROADS) { if (!isRoad(X, Z)) continue; ridx.set(key(X, Z), rn.length); rn.push({ x: X, z: Z }); }
    const rl = (a, b) => { if (!radj.has(a)) radj.set(a, []); radj.get(a).push(b); };
    for (let i = 0; i < ROADS.length; i++) for (let j = 0; j < ROADS.length; j++) {
      const a = ridx.get(key(ROADS[i], ROADS[j])); if (a == null) continue;
      if (i < ROADS.length - 1) { const b = ridx.get(key(ROADS[i + 1], ROADS[j])); if (b != null && isRoad((ROADS[i] + ROADS[i + 1]) / 2, ROADS[j])) { rl(a, b); rl(b, a); } }
      if (j < ROADS.length - 1) { const b = ridx.get(key(ROADS[i], ROADS[j + 1])); if (b != null && isRoad(ROADS[i], (ROADS[j] + ROADS[j + 1]) / 2)) { rl(a, b); rl(b, a); } }
    }
    this.roads = { nodes: rn, adj: radj };
  }
  spawn() {
    const R = new RNG(99); const c = this.city;
    // pedestrians
    const n = this.walk.nodes.length;
    for (let i = 0; i < 42; i++) {
      const node = R.int(0, n - 1), p = this.walk.nodes[node];
      const h = new Human(this, 1000 + i, { pos: new THREE.Vector3(p.x, 0.15, p.z), node, role: R.chance(0.08) ? 'phone' : 'walker' });
      if (h.role === 'phone') h.role = 'walker';
      this.humans.push(h);
    }
    for (let i = 0; i < 8; i++) { const h = new Human(this, 2000 + i, { pos: new THREE.Vector3(POND.x + POND.r + 6, 0.15, POND.z), role: 'walker' }); h.path = 'park'; h.parkA = R.range(0, TAU); h.parkDir = R.chance(0.5) ? 1 : -1; this.humans.push(h); }
    // vendors
    for (const v of c.vendors) { const h = new Human(this, 3000 + this.humans.length, { pos: v.pos, yaw: v.face > 0 ? Math.PI / 2 : -Math.PI / 2, role: 'vendor' }); h.stall = v.stall; v.stall.vendor = h; h.busy = 0; this.humans.push(h); }
    // fishermen
    for (const f of c.fishermen) { const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 2.6, 4), new THREE.MeshStandardMaterial({ color: 0x3a2a1a })); rod.rotation.x = 1.1; rod.position.set(0, -0.05, 1.1); const h = new Human(this, 4000 + this.humans.length, { pos: f.pos, yaw: f.face, role: 'fisher', held: rod }); this.humans.push(h); }
    // bench sitters & the pigeon feeder at the plaza
    const benches = c.benches.filter((_, i) => i % 3 === 0).slice(0, 10);
    benches.forEach((b, i) => {
      const off = new THREE.Vector3(Math.sin(b.rot) * -0.05, 0.05, Math.cos(b.rot) * -0.05);
      const h = new Human(this, 5000 + i, { pos: b.pos.clone().add(off), yaw: b.rot, role: i === 0 ? 'feeder' : 'sitter' });
      this.humans.push(h);
    });
    // a plaza feeder specifically
    if (c.plaza) { const b = c.benches.find((b) => b.pos.distanceTo(c.plaza) < 14); if (b) { const h = new Human(this, 6000, { pos: b.pos.clone(), yaw: b.rot, role: 'feeder', child: false }); this.feeder = h; this.humans.push(h); } }
    // kids in the school field (play fetch with dogs!)
    if (c.schoolField) for (let i = 0; i < 3; i++) { const h = new Human(this, 7000 + i, { pos: c.schoolField.clone().add(new THREE.Vector3(R.range(-8, 8), 0, R.range(-4, 4))), role: 'kid', child: true }); h.yaw = R.range(0, TAU); h.fetcher = true; this.humans.push(h); }
    // dog walker in the park
    const dw = new Human(this, 7100, { pos: new THREE.Vector3(-30, 0.15, -40), role: 'kid', child: false }); dw.fetcher = true; this.humans.push(dw);
    // cars
    const rn = this.roads.nodes.length;
    for (let i = 0; i < 16; i++) {
      let a = R.int(0, rn - 1); const nb = this.roads.adj.get(a); if (!nb) continue;
      const car = new Car(this, a, R.pick(nb), 8000 + i); this.cars.push(car);
    }
    // critters
    const flock = (center, count, range) => { for (let i = 0; i < count; i++) this.critters.push(new Critter(this, 'pigeon', center.clone().add(new THREE.Vector3(R.range(-range, range), 0, R.range(-range, range))), { range })); };
    if (c.plaza) flock(c.plaza.clone().add(new THREE.Vector3(6, 0, 6)), 10, 5);
    flock(c.market.clone().add(new THREE.Vector3(0, 0, -16)), 6, 3);
    flock(new THREE.Vector3(-40, 0.15, -40), 6, 4);
    flock(new THREE.Vector3(SEA_X - 6, 0.15, 0), 6, 5);
    for (let i = 0; i < 5; i++) this.critters.push(new Critter(this, 'duck', new THREE.Vector3(POND.x + R.range(-8, 8), 0, POND.z + R.range(-8, 8)), { water: true, range: 8 }));
    for (let i = 0; i < 6; i++) this.critters.push(new Critter(this, 'squirrel', new THREE.Vector3(R.range(PARK.minX + 10, PARK.maxX - 10), 0.15, R.range(PARK.minZ + 10, PARK.maxZ - 10)), { range: 6 }));
    const alleys = this.city.interact.filter((it) => it.label === 'Search the dumpster');
    alleys.slice(0, 8).forEach((a) => this.critters.push(new Critter(this, 'mouse', a.pos.clone().add(new THREE.Vector3(1, 0, 1)), { range: 2.5 })));
    for (let i = 0; i < 4; i++) this.critters.push(new Critter(this, 'cat', new THREE.Vector3(-150 + R.range(-15, 15), 0.15, -150 + i * 30), { range: 5, scale: 1 }));
    for (const f of this.city.flowers.filter((_, i) => i % 2 === 0).slice(0, 10)) this.critters.push(new Critter(this, 'butterfly', f.pos.clone(), { range: 3 }));
  }
  update(dt, player) {
    const px = player.pos.x, pz = player.pos.z, R2 = ACTIVE_R * ACTIVE_R;
    for (const h of this.humans) {
      const d2 = dist2(h.pos.x, h.pos.z, px, pz); const near = d2 < (h.role === 'walker' ? 75 * 75 : R2);
      h.root.visible = near; h.rig.setFar(d2 > 28 * 28);
      if (near) { if (d2 < 28 * 28) h.update(dt, player); else { h.lodT = (h.lodT || 0) + dt; if (h.lodT > 0.1) { h.update(h.lodT, player); h.lodT = 0; } } }
    }
    for (const c of this.cars) { c.update(dt, player, this.cars); c.root.visible = dist2(c.pos.x, c.pos.z, px, pz) < 140 * 140; }
    for (const c of this.critters) { const near = dist2(c.pos.x, c.pos.z, px, pz) < (c.kind === 'pigeon' || c.kind === 'mouse' || c.kind === 'butterfly' ? 32 * 32 : 40 * 40); c.root.visible = near && !c.hidden; if (near) { c.setFar(dist2(c.pos.x, c.pos.z, px, pz) > 14 * 14 && !c.flying); c.update(dt, player); } }
    // vendor "busy" cycles (turns away to arrange goods → chance for a sneaky steal)
    for (const h of this.humans) if (h.role === 'vendor') { h.busyT = (h.busyT ?? rand(4, 10)) - dt; if (h.busyT <= 0) { h.busy = h.busy > 0 ? 0 : rand(2.5, 4); h.busyT = h.busy > 0 ? h.busy : rand(5, 10); } if (h.busy > 0) h.busy -= dt; }
  }
  nearestHuman(p, r = 2.2, filter) { let best = null, bd = r; for (const h of this.humans) { if (!h.root.visible || (filter && !filter(h))) continue; const d = Math.hypot(h.pos.x - p.x, h.pos.z - p.z); if (d < bd && Math.abs(h.pos.y - p.y) < 2) { bd = d; best = h; } } return best; }
  nearestCritter(p, r = 2, kind) { let best = null, bd = r; for (const c of this.critters) { if (c.hidden || (kind && c.kind !== kind)) continue; const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z); if (d < bd) { bd = d; best = c; } } return best; }
}
