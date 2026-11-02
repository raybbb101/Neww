import * as THREE from 'three';
import { ABILITIES } from '../data/abilities.js';
import { buildCreature, defaultAnimState } from '../models/creatures.js';
import { SPECIES } from '../data/species.js';
import { audio } from '../core/audio.js';
import { clamp, angleDiff, rand, TAU, damp } from '../core/utils.js';
import { toSprite } from '../gfx/post.js';

const ACTION_BY_SPECIES = { cat: 'swipe', dog: 'bite', rabbit: 'kick', bird: 'bite', snake: 'strike', butterfly: 'flap' };
const _v = new THREE.Vector3();

export class Combat {
  constructor(ctx) { this.ctx = ctx; this.projectiles = []; this.allies = []; this.fields = []; this.timers = []; this.channels = []; this.decoys = []; }
  get player() { return this.ctx.player; }
  get vfx() { return this.ctx.vfx; }
  schedule(t, fn) { this.timers.push({ t, fn }); }
  clear() {
    for (const p of this.projectiles) this.ctx.scene.remove(p.mesh);
    for (const a of this.allies) this.ctx.scene.remove(a.rig.root);
    for (const d of this.decoys) this.ctx.scene.remove(d.rig.root);
    this.projectiles = []; this.allies = []; this.fields = []; this.timers = []; this.channels = []; this.decoys = [];
  }
  enemies() { return this.ctx.enemies.filter((e) => e.alive); }
  nearest(from, maxD = 16, preferYaw = null) {
    let best = null, bs = Infinity;
    for (const e of this.enemies()) {
      const d = Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
      if (d > maxD) continue;
      let s = d;
      if (preferYaw != null) { const a = Math.abs(angleDiff(preferYaw, Math.atan2(e.pos.x - from.x, e.pos.z - from.z))); s += a * 3; }
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  faceTarget(t) { const p = this.player; if (t) p.yaw = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z); }
  /** Compute damage for an ability hit */
  calc(def, mul = 1) {
    const p = this.player;
    let dmg = def.dmg * mul * p.atk * p.buff('dmg') * p.moodMul;
    const critC = p.critBase + p.buff('crit');
    const crit = Math.random() < critC;
    if (crit) dmg *= 1.6 + p.buff('critDmg');
    dmg *= rand(0.92, 1.08);
    return { dmg, crit };
  }
  hit(e, def, mul = 1, extra = {}) {
    if (!e.alive) return;
    const { dmg, crit } = this.calc(def, mul);
    const p = this.player;
    const dir = _v.set(e.pos.x - (extra.from?.x ?? p.pos.x), 0, e.pos.z - (extra.from?.z ?? p.pos.z)).normalize();
    e.takeDamage(dmg, { crit, kb: (def.kb ?? 1) * (extra.kbMul ?? 1), dir: dir.clone(), stun: extra.stun ?? def.stun, poison: (def.poison ? def.poison * p.atk : 0), slow: def.slow });
    p.spirit = Math.min(100, p.spirit + (def.slot === 'ult' ? 0.4 : 2.2));
    if (p.buff('lifesteal')) p.hp = Math.min(p.maxHp, p.hp + dmg * p.buff('lifesteal'));
    audio.sfx(crit ? 'crit' : 'hit', { vol: 0.8 });
    if (crit) this.ctx.hitstop?.(0.05);
  }
  inArc(e, origin, yaw, range, arcDeg, vTol = 3.5) {
    const dx = e.pos.x - origin.x, dz = e.pos.z - origin.z, d = Math.hypot(dx, dz);
    if (d > range + e.radius) return false;
    if (Math.abs((e.pos.y + (e.flyH || 0)) - origin.y) > vTol + (e.radius || 0)) return false;
    if (arcDeg >= 360) return true;
    return Math.abs(angleDiff(yaw, Math.atan2(dx, dz))) <= (arcDeg * Math.PI) / 360 + Math.atan2(e.radius, Math.max(d, 0.1));
  }
  /** Try to cast an ability. Returns true if cast. */
  cast(id) {
    const def = ABILITIES[id]; const p = this.player; if (!def) return false;
    if ((p.cds[id] || 0) > 0 || p.burrowed > 0) return false;
    if (this.channels.some((c) => c.lock)) return false;
    if (def.slot === 'ult') { if (p.spirit < 100) { this.ctx.toast?.('Spirit not full yet', 'warn'); return false; } p.spirit = 0; }
    const isCombo = def.kind === 'melee' && def.combo > 1;
    if (isCombo) { if (p.comboT > 0) p.comboIdx = (p.comboIdx + 1) % def.combo; else p.comboIdx = 0; p.comboT = def.cd + 0.45; }
    p.cds[id] = isCombo && p.comboIdx < def.combo - 1 ? def.cd : def.cd * (isCombo ? 1.6 : 1);
    if (def.slot === 'ult') { p.cds[id] = 1.5; this.ctx.ultFlash?.(def); audio.sfx('ult'); }
    else if (def.slot === 'skill') audio.sfx('skill');
    const fn = this['k_' + def.kind]; if (!fn) return false;
    fn.call(this, def, id);
    return true;
  }
  // ───────────── Executors ─────────────
  k_melee(def) {
    const p = this.player;
    const t = this.nearest(p.pos, def.range + 3, p.yaw); this.faceTarget(t);
    const last = def.combo > 1 && p.comboIdx === def.combo - 1;
    p.playAction(ACTION_BY_SPECIES[p.key], 0.25);
    const lunge = (def.lunge || 0.6) * (last ? 1.6 : 1);
    if (t) { const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) - t.radius - 0.3; if (d > 0.2) p.dashVel = { x: Math.sin(p.yaw) * Math.min(d, lunge + 2) / 0.12, z: Math.cos(p.yaw) * Math.min(d, lunge + 2) / 0.12, t: 0.12 }; }
    else p.dashVel = { x: Math.sin(p.yaw) * lunge / 0.1, z: Math.cos(p.yaw) * lunge / 0.1, t: 0.1 };
    audio.sfx('swipe', { vol: 0.6 });
    this.schedule(0.1, () => {
      const o = p.centerPos();
      this.vfx.slash(o, p.yaw + (p.comboIdx % 2 ? 0.3 : -0.3), def.color, def.range * (def.arc >= 360 ? 1 : 1.1), def.arc, 0.2, p.comboIdx % 2 ? 0.4 : -0.4);
      let any = false;
      for (const e of this.enemies()) if (this.inArc(e, o, p.yaw, def.range, def.arc)) { this.hit(e, def, last ? 1.6 : 1, { kbMul: last ? 2 : 1 }); any = true; this.vfx.burst(e.center(), def.color, 8, 4, 0.35, 0.18, 3); }
      if (any) this.ctx.cam?.addShake(last ? 0.35 : 0.15);
    });
  }
  k_cone(def) {
    const p = this.player; const t = this.nearest(p.pos, def.range + 3, p.yaw); this.faceTarget(t);
    p.playAction(p.key === 'cat' ? 'roar' : ACTION_BY_SPECIES[p.key], 0.4);
    if (p.key === 'cat') audio.voice('hiss'); else if (p.key === 'bird') audio.sfx('flap', { vol: 1.5 });
    this.schedule(0.1, () => {
      const o = p.centerPos();
      for (let i = 0; i < 4; i++) this.schedule(i * 0.06, () => this.vfx.slash(o, p.yaw, def.color, def.range * (0.35 + i * 0.22), def.arc, 0.32, 0, 0.12));
      for (let i = 0; i < 30; i++) { const a = p.yaw + rand(-1, 1) * (def.arc * Math.PI / 360); this.vfx.emit({ x: o.x, y: o.y, z: o.z, vx: Math.sin(a) * rand(6, 12), vy: rand(-0.5, 1), vz: Math.cos(a) * rand(6, 12), life: 0.4, max: 0.4, size: 0.3, ...rgb(def.color), grav: 0, drag: 4, grow: 1.5 }); }
      for (const e of this.enemies()) if (this.inArc(e, o, p.yaw, def.range, def.arc)) this.hit(e, def);
      this.ctx.cam?.addShake(0.3);
    });
  }
  k_leap(def) {
    const p = this.player; const t = this.nearest(p.pos, def.range + 2, p.yaw); this.faceTarget(t);
    const dest = t ? t.pos.clone() : p.pos.clone().addScaledVector(p.forward, def.range * 0.6);
    const d = Math.hypot(dest.x - p.pos.x, dest.z - p.pos.z);
    const dur = def.big ? 0.75 : 0.45;
    const ux = (dest.x - p.pos.x) / Math.max(d, 0.01), uz = (dest.z - p.pos.z) / Math.max(d, 0.01);
    const travel = Math.max(0, d - (t ? t.radius * 0.6 : 0));
    p.dashVel = { x: ux * travel / dur, z: uz * travel / dur, t: dur };
    p.vel.y = def.big ? 14 : 7.5; p.onGround = false; p.invuln = Math.max(p.invuln, dur);
    if (p.flying && p.sp.rig === 'bird') p.vel.y = def.big ? 10 : 3;
    p.playAction(ACTION_BY_SPECIES[p.key], dur);
    audio.sfx('jump');
    const tel = this.vfx.telegraph(dest, def.radius, dur, def.color);
    this.schedule(dur, () => {
      if (p.flying && p.sp.rig === 'bird') { p.vel.y = -12; }
      const c = p.pos.clone(); c.y = this.ctx.groundY ?? 0;
      this.vfx.ring(c, def.color, def.radius * 1.3, 0.45); this.vfx.ring(c, 0xffffff, def.radius, 0.3);
      this.vfx.burst(c.clone().setY(c.y + 0.3), def.color, def.big ? 60 : 30, def.big ? 9 : 6, 0.6, 0.3, 8, { up: 2 });
      this.vfx.dust(c, 14);
      for (const e of this.enemies()) if (Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < def.radius + e.radius) this.hit(e, def, 1, { from: c, stun: def.stun });
      this.ctx.cam?.addShake(def.big ? 0.9 : 0.45); audio.sfx('boom', { vol: def.big ? 1 : 0.5 });
    });
  }
  k_dash(def) {
    const p = this.player; const t = this.nearest(p.pos, def.dist + 2, p.yaw); this.faceTarget(t);
    const dur = 0.25; const hit = new Set();
    const segs = def.zigzag ? 3 : 1;
    p.invuln = Math.max(p.invuln, dur * segs + 0.1);
    audio.sfx('dodge');
    for (let s = 0; s < segs; s++) this.schedule(s * dur, () => {
      const yaw = p.yaw + (def.zigzag ? (s === 1 ? 0.5 : s === 2 ? -0.5 : 0) : 0);
      const v = def.dist / segs / dur;
      p.dashVel = { x: Math.sin(yaw) * v, z: Math.cos(yaw) * v, t: dur };
      if (def.zigzag) { p.vel.y = 4; p.onGround = false; }
    });
    p.playAction(ACTION_BY_SPECIES[p.key], dur * segs);
    this.channels.push({ t: dur * segs, upd: () => {
      const c = p.centerPos();
      this.vfx.trail(c, def.color, 0.35, 0.35);
      for (const e of this.enemies()) if (!hit.has(e) && Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < 1.3 + e.radius) { hit.add(e); this.hit(e, def); this.vfx.burst(e.center(), def.color, 12, 5, 0.4, 0.2); this.ctx.cam?.addShake(0.2); }
    } });
    if (def.buff) this.addBuff({ ...def.buff, color: def.color, name: def.name });
    if (def.id === 'cat_stalk' || def.name === 'Shadow Stalk') p.stealthT = 1.5;
  }
  k_nova(def) {
    const p = this.player;
    p.playAction(p.key === 'dog' ? 'roar' : ACTION_BY_SPECIES[p.key], 0.4);
    if (p.key === 'dog') audio.voice('dog');
    if (def.delay > 0.2) this.vfx.telegraph(p.pos, def.radius, def.delay, def.color);
    const rings = def.rings || 1;
    for (let r = 0; r < rings; r++) this.schedule(def.delay + r * 0.18, () => {
      const c = p.pos.clone(); c.y = this.ctx.groundY ?? p.pos.y;
      this.vfx.ring(c, def.color, def.radius * (0.7 + r * 0.2), 0.5, 0.1, 0.25);
      this.vfx.burst(c.clone().setY(c.y + 0.4), def.color, 30, def.radius * 1.4, 0.5, 0.3, 1, { flat: true });
      if (r === 0) for (const e of this.enemies()) if (Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < def.radius + e.radius) this.hit(e, def, 1, { from: c });
      else for (const e of this.enemies()) if (Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < def.radius + e.radius) this.hit(e, def, 0.35, { from: c, kbMul: 0.3 });
      this.ctx.cam?.addShake(rings > 1 ? 0.5 : 0.25);
    });
    if (rings > 1) audio.sfx('boom');
  }
  k_proj(def) {
    const p = this.player; const t = this.nearest(p.pos, 22, p.yaw); this.faceTarget(t);
    p.playAction(ACTION_BY_SPECIES[p.key], 0.2);
    audio.sfx('shoot', { vol: def.count > 4 ? 1 : 0.5 });
    const n = def.count || 1;
    for (let i = 0; i < n; i++) {
      const spread = def.spread ? ((n === 1 ? 0 : i / (n - 1)) - 0.5) * (def.spread * Math.PI / 180) : 0;
      const yaw = p.yaw + (def.spread >= 360 ? (i / n) * TAU : spread);
      const delay = def.spread >= 360 ? i * 0.03 : n > 3 ? i * 0.03 : 0;
      this.schedule(delay, () => this.spawnProj(def, yaw));
    }
  }
  spawnProj(def, yaw, opts = {}) {
    const p = this.player;
    const pos = opts.pos || p.centerPos().addScaledVector(p.forward, 0.3);
    const mesh = projMesh(def);
    mesh.position.copy(pos); this.ctx.scene.add(mesh);
    const sp = def.speed || 18;
    const pr = { def, mesh, pos: mesh.position, vel: new THREE.Vector3(Math.sin(yaw) * sp, opts.vy || 0, Math.cos(yaw) * sp), life: opts.life || 1.6, hit: new Set(), homing: def.homing || 0, boomer: opts.boomer, out: 0, rain: opts.rain, target: opts.target };
    this.projectiles.push(pr);
    return pr;
  }
  k_boomerang(def) {
    const p = this.player; const t = this.nearest(p.pos, 16, p.yaw); this.faceTarget(t);
    p.playAction('bite', 0.25); audio.sfx('swipe');
    this.spawnProj({ ...def, model: 'stick' }, p.yaw, { boomer: true, life: 3 });
  }
  k_rain(def) {
    const p = this.player; const t = this.nearest(p.pos, 20, p.yaw);
    const center = t ? t.pos.clone() : p.pos.clone().addScaledVector(p.forward, 5);
    this.vfx.telegraph(center, def.radius, def.dur, def.color);
    for (let i = 0; i < def.count; i++) this.schedule((i / def.count) * def.dur, () => {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * def.radius;
      const tgt = new THREE.Vector3(center.x + Math.cos(a) * r, this.ctx.groundY ?? 0, center.z + Math.sin(a) * r);
      const pr = this.spawnProj(def, 0, { pos: tgt.clone().add(new THREE.Vector3(rand(-2, 2), 14, rand(-2, 2))), rain: true, life: 2 });
      pr.vel.copy(tgt).sub(pr.pos).normalize().multiplyScalar(30); pr.target = tgt;
    });
  }
  k_heal(def) {
    const p = this.player;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * (def.amount || 0));
    if (def.regen) this.addBuff({ dur: def.dur, regen: def.regen, color: def.color, name: def.name });
    if (def.shield) p.shield = p.maxHp * def.shield;
    if (def.invuln) p.invuln = Math.max(p.invuln, def.invuln);
    if (def.cleanse) p.poison = 0;
    audio.sfx('heal'); if (p.key === 'cat') audio.voice('purr');
    this.vfx.burst(p.centerPos(), def.color, 30, 2.5, 1.0, 0.25, -2, { vary: true });
    this.vfx.ring(p.pos, def.color, 2.2, 0.6);
    this.ctx.number?.(p.centerPos(), '+' + Math.round(p.maxHp * (def.amount || 0)), '#7dffa0');
  }
  k_buff(def) {
    const p = this.player;
    this.addBuff({ ...def.buff, dur: def.buff.dur, color: def.color, name: def.name });
    if (def.heal) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * def.heal);
    if (def.fear) for (const e of this.enemies()) if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < def.fear * 2) e.fear = 2;
    p.playAction(p.key === 'dog' ? 'roar' : ACTION_BY_SPECIES[p.key], 0.5);
    if (p.key === 'dog') audio.voice('dog'); if (p.key === 'bird') audio.voice('bird');
    this.vfx.ring(p.pos, def.color, 3.5, 0.6); this.vfx.burst(p.centerPos(), def.color, 40, 3, 0.9, 0.25, -3, { vary: true });
  }
  addBuff(b) { const p = this.player; p.buffs = p.buffs.filter((x) => x.name !== b.name); p.buffs.push({ ...b, t: b.dur, max: b.dur }); }
  k_burrow(def) {
    const p = this.player;
    p.burrowed = def.dur; p.invuln = Math.max(p.invuln, def.dur + 0.2);
    this.vfx.dust(p.pos, 20); audio.sfx('dig');
    if (def.heal) this.addBuff({ dur: def.dur, regen: def.heal / def.dur, name: 'Burrow' });
    this.schedule(def.dur * 0.6, () => { const t = this.nearest(p.pos, 14); if (t) { const a = rand(0, TAU); p.pos.x = t.pos.x + Math.cos(a) * 0.6; p.pos.z = t.pos.z + Math.sin(a) * 0.6; } });
    this.schedule(def.dur, () => {
      p.burrowed = 0; p.vel.y = 7; p.onGround = false;
      const c = p.pos.clone(); c.y = this.ctx.groundY ?? p.pos.y;
      this.vfx.ring(c, def.color, def.radius * 1.3, 0.5); this.vfx.burst(c, 0x9a7a50, 40, 7, 0.8, 0.35, 10, { up: 3 });
      for (const e of this.enemies()) if (Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < def.radius + e.radius) this.hit(e, def, 1, { from: c });
      this.ctx.cam?.addShake(0.5); audio.sfx('boom', { vol: 0.6 });
    });
  }
  k_summon(def) {
    const p = this.player;
    for (let i = 0; i < def.count; i++) {
      const sp = SPECIES.dog;
      const rig = buildCreature('dog', sp, { name: 'Spirit', base: 0x9ad8ff, belly: 0xe0f8ff, stripe: 0x6ab0e0, eye: 0xffffff });
      rig.root.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.65; o.material.emissive = new THREE.Color(def.color); o.material.emissiveIntensity = 0.8; } });
      const a = (i / def.count) * TAU;
      const pos = p.pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5));
      rig.root.position.copy(pos); toSprite(rig.root); this.ctx.scene.add(rig.root);
      this.vfx.burst(pos.clone().setY(pos.y + 0.4), def.color, 20, 3, 0.6, 0.25, -1);
      this.allies.push({ rig, pos, yaw: p.yaw, t: def.dur, def, atkT: rand(0, 0.5), anim: defaultAnimState(), speed: 0 });
    }
    audio.voice('dog');
  }
  k_decoy(def) {
    const p = this.player;
    for (let i = 0; i < def.count; i++) {
      const rig = buildCreature(p.key, p.sp, p.coat);
      rig.root.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.material.emissive = new THREE.Color(def.color); o.material.emissiveIntensity = 0.6; } });
      const a = p.yaw + (i ? 1.6 : -1.6);
      const pos = p.pos.clone().add(new THREE.Vector3(Math.sin(a) * 2.5, 0, Math.cos(a) * 2.5));
      rig.root.position.copy(pos); toSprite(rig.root); this.ctx.scene.add(rig.root);
      this.decoys.push({ rig, pos, t: def.dur, anim: { ...defaultAnimState(), flying: true }, phase: rand(0, 6) });
    }
    this.vfx.burst(p.centerPos(), def.color, 30, 3, 0.7, 0.2, 0, { vary: true });
  }
  k_field(def) {
    const p = this.player;
    const t = def.at === 'target' ? this.nearest(p.pos, 16, p.yaw) : null;
    const c = (t ? t.pos.clone() : p.pos.clone()); c.y = this.ctx.groundY ?? p.pos.y;
    const grp = new THREE.Group(); grp.position.copy(c);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(def.radius, 40), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.07; grp.add(disc);
    const edge = new THREE.Mesh(new THREE.RingGeometry(def.radius * 0.95, def.radius, 40), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    edge.rotation.x = -Math.PI / 2; edge.position.y = 0.08; grp.add(edge);
    if (def.heal) { // a magic flower / music notes
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 1 })); f.position.y = 0.4; grp.add(f);
    }
    this.vfx.custom(grp, def.dur, (f, k) => { disc.material.opacity = 0.22 * (1 - k * 0.5) + Math.sin(k * 40) * 0.03; grp.rotation.y += 0.01; });
    this.fields.push({ def, c, t: def.dur, tick: 0 });
  }
  k_beam(def) {
    const p = this.player; const t = this.nearest(p.pos, def.length, p.yaw); this.faceTarget(t);
    p.lockMove = def.dur;
    const from = () => p.centerPos().addScaledVector(p.forward, 0.3);
    this.vfx.beam(from(), p.yaw, def.length, def.width, def.color, def.dur, { rainbow: def.rainbow, follow: from, followYaw: () => p.yaw });
    audio.sfx('shoot', { vol: 1.5 });
    let tick = 0;
    this.channels.push({ t: def.dur, upd: (dt) => {
      const tt = this.nearest(p.pos, def.length, p.yaw); if (tt) { const want = Math.atan2(tt.pos.x - p.pos.x, tt.pos.z - p.pos.z); p.yaw += clamp(angleDiff(p.yaw, want), -dt * 1.5, dt * 1.5); }
      tick -= dt; if (tick > 0) return; tick = def.tick;
      const o = from();
      for (const e of this.enemies()) {
        const dx = e.pos.x - o.x, dz = e.pos.z - o.z; const along = dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw); const perp = Math.abs(dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw));
        if (along > 0 && along < def.length && perp < def.width / 2 + e.radius) { this.hit(e, def, 1, { kbMul: 0.2 }); this.vfx.burst(e.center(), def.color, 4, 3, 0.3, 0.2); }
      }
      this.ctx.cam?.addShake(0.06);
    } });
  }
  k_flurry(def) {
    const p = this.player; p.invuln = Math.max(p.invuln, def.hits * def.interval);
    for (let i = 0; i < def.hits; i++) this.schedule(i * def.interval, () => {
      const t = this.nearest(p.pos, def.radius + 2); if (t) this.faceTarget(t);
      p.yaw += 0.9; p.playAction(ACTION_BY_SPECIES[p.key], def.interval * 1.5);
      const c = p.centerPos();
      this.vfx.slash(c, rand(0, TAU), def.color, def.radius * rand(0.5, 1), 140, 0.18, rand(-0.6, 0.6));
      audio.sfx('swipe', { vol: 0.4 });
      for (const e of this.enemies()) if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < def.radius + e.radius) this.hit(e, def, 1, { kbMul: 0.15 });
      this.ctx.cam?.addShake(0.12);
    });
  }
  k_multileap(def) {
    for (let i = 0; i < def.leaps; i++) this.schedule(i * 0.6, () => this.k_leap({ ...def, cd: 0, big: i === def.leaps - 1 }));
  }
  k_vortex(def) {
    const p = this.player; p.invuln = Math.max(p.invuln, def.dur * 0.5);
    let tick = 0;
    const grp = new THREE.Group();
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(def.radius * (0.4 + i * 0.25), 0.08, 6, 40), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); t.rotation.x = Math.PI / 2; t.position.y = 0.3 + i * 0.4; grp.add(t); }
    this.vfx.custom(grp, def.dur, (f, k) => { grp.position.copy(p.pos); grp.rotation.y += 0.25; grp.children.forEach((c, i) => (c.material.opacity = 0.6 * (1 - k))); });
    this.channels.push({ t: def.dur, upd: (dt) => {
      p.yaw += dt * 12; p.anim.turn = 8;
      for (const e of this.enemies()) { const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, d = Math.hypot(dx, dz); if (d < def.radius * 1.6 && d > 0.8 && !e.def.boss) { e.pos.x += (dx / d) * def.pull * dt; e.pos.z += (dz / d) * def.pull * dt; } }
      tick -= dt; if (tick > 0) return; tick = def.tick;
      for (const e of this.enemies()) if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < def.radius + e.radius) this.hit(e, def, 1, { kbMul: 0 });
      this.vfx.burst(p.centerPos(), def.color, 6, 6, 0.4, 0.25, 0, { flat: true });
    } });
  }
  k_grab(def) {
    const p = this.player; const t = this.nearest(p.pos, def.range + 1, p.yaw);
    if (!t) { this.ctx.toast?.('No target in range'); p.cds[Object.keys(p.cds).find((k) => ABILITIES[k] === def)] = 0.5; return; }
    this.faceTarget(t); p.lockMove = def.hits * def.interval;
    t.stun = Math.max(t.stun || 0, def.stun + def.hits * def.interval);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(t.radius + 0.2, 0.12, 8, 24), new THREE.MeshStandardMaterial({ color: p.coat.base, emissive: def.color, emissiveIntensity: 0.4 }));
    this.vfx.custom(coil, def.hits * def.interval, (f, k) => { coil.position.copy(t.center()); coil.rotation.x = Math.PI / 2; coil.position.y += Math.sin(k * 20) * 0.2; coil.scale.setScalar(1 - k * 0.2); });
    for (let i = 0; i < def.hits; i++) this.schedule(i * def.interval, () => { if (t.alive) { this.hit(t, def, 1, { kbMul: 0 }); this.vfx.burst(t.center(), def.color, 5, 2, 0.3, 0.15); } });
  }
  // ───────────── Update ─────────────
  update(dt) {
    const p = this.player;
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); } }
    for (let i = this.channels.length - 1; i >= 0; i--) { const c = this.channels[i]; c.t -= dt; c.upd(dt); if (c.t <= 0) this.channels.splice(i, 1); }
    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]; pr.life -= dt;
      if (pr.homing && !pr.rain) {
        const t = this.nearest(pr.pos, 14, Math.atan2(pr.vel.x, pr.vel.z));
        if (t) { const want = t.center().sub(pr.pos).normalize().multiplyScalar(pr.vel.length()); pr.vel.lerp(want, clamp(pr.homing * dt, 0, 1)); }
      }
      if (pr.boomer) { pr.out += dt; if (pr.out > (pr.def.dist / pr.def.speed)) { const back = p.centerPos().sub(pr.pos); if (back.length() < 0.8) pr.life = 0; pr.vel.lerp(back.normalize().multiplyScalar(pr.def.speed * 1.2), 0.2); if (!pr.returned) { pr.returned = true; pr.hit.clear(); } } pr.mesh.rotation.y += dt * 25; }
      pr.pos.addScaledVector(pr.vel, dt);
      if (!pr.boomer) pr.mesh.lookAt(pr.pos.clone().add(pr.vel));
      if (Math.random() < 0.7) this.vfx.trail(pr.pos, pr.def.color, 0.18, 0.25);
      if (pr.rain) {
        if (pr.pos.y <= (this.ctx.groundY ?? 0) + 0.1) {
          pr.life = 0; this.vfx.burst(pr.pos, pr.def.color, 8, 3, 0.3, 0.2, 4, { flat: true });
          for (const e of this.enemies()) if (Math.hypot(e.pos.x - pr.pos.x, e.pos.z - pr.pos.z) < pr.def.area + e.radius) this.hit(e, pr.def, 1, { from: pr.pos, kbMul: 0.2 });
        }
      } else {
        for (const e of this.enemies()) {
          if (pr.hit.has(e)) continue;
          const c = e.center(); if (c.distanceTo(pr.pos) < e.radius + 0.4) {
            pr.hit.add(e); this.hit(e, pr.def, 1, { from: pr.pos.clone().sub(pr.vel), kbMul: 0.5 }); this.vfx.burst(pr.pos, pr.def.color, 10, 3, 0.35, 0.2);
            if (!pr.boomer && !pr.def.pierce) { pr.life = 0; break; }
          }
        }
        if (pr.pos.y < (this.ctx.groundY ?? -99) - 0.2) pr.life = 0;
      }
      if (pr.life <= 0) { this.ctx.scene.remove(pr.mesh); this.projectiles.splice(i, 1); }
    }
    // fields
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i]; f.t -= dt; f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = f.def.tick;
        if (f.def.heal && Math.hypot(p.pos.x - f.c.x, p.pos.z - f.c.z) < f.def.radius) { const h = p.maxHp * f.def.heal; p.hp = Math.min(p.maxHp, p.hp + h); this.vfx.burst(p.centerPos(), f.def.color, 5, 1.5, 0.6, 0.2, -2); }
        if (f.def.dmg) for (const e of this.enemies()) if (Math.hypot(e.pos.x - f.c.x, e.pos.z - f.c.z) < f.def.radius + e.radius) { this.hit(e, f.def, 1, { from: f.c, kbMul: 0 }); if (f.def.slow) e.slowT = 0.6; }
        this.vfx.burst(f.c.clone().setY(f.c.y + 0.3), f.def.color, 6, 1.5, 0.8, 0.25, -1.5, { flat: true, spread: f.def.radius * 4 });
      }
      if (f.t <= 0) this.fields.splice(i, 1);
    }
    // allies (spirit dogs)
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i]; a.t -= dt; a.atkT -= dt;
      const t = this.nearest(a.pos, 30);
      let speed = 0;
      if (t) {
        const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        a.yaw += angleDiff(a.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
        if (d > t.radius + 0.9) { speed = 8; a.pos.x += Math.sin(a.yaw) * speed * dt; a.pos.z += Math.cos(a.yaw) * speed * dt; }
        else if (a.atkT <= 0) { a.atkT = 0.7; a.anim.action = 'bite'; a.anim.actionT = 0; this.hit(t, a.def, 1, { from: a.pos, kbMul: 0.3 }); this.vfx.burst(t.center(), a.def.color, 6, 3, 0.3, 0.2); }
      }
      a.speed = damp(a.speed, speed, 8, dt);
      if (a.anim.action) { a.anim.actionT += dt / 0.3; if (a.anim.actionT > 1) a.anim.action = null; }
      a.anim.speed = a.speed; a.anim.maxSpeed = 10; a.anim.mood = 1;
      a.rig.root.position.set(a.pos.x, this.ctx.groundY ?? a.pos.y, a.pos.z); a.rig.root.rotation.y = a.yaw; a.rig.update(dt, a.anim);
      if (a.t <= 0) { this.vfx.burst(a.rig.root.position.clone().setY(0.5), a.def.color, 20, 2, 0.6, 0.25, -2); this.ctx.scene.remove(a.rig.root); this.allies.splice(i, 1); }
    }
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i]; d.t -= dt; d.phase += dt;
      d.rig.root.position.set(d.pos.x + Math.sin(d.phase * 1.3) * 0.8, (this.ctx.groundY ?? 0) + 1 + Math.sin(d.phase * 2) * 0.3, d.pos.z + Math.cos(d.phase) * 0.8);
      d.anim.speed = 2; d.rig.update(dt, d.anim);
      if (d.t <= 0) { this.vfx.sparkle(d.rig.root.position, 0xa0e0ff, 15); this.ctx.scene.remove(d.rig.root); this.decoys.splice(i, 1); }
    }
  }
}
function rgb(c) { const k = new THREE.Color(c); return { r: k.r, g: k.g, b: k.b }; }
const projCache = {};
function projMesh(def) {
  const model = def.model || 'orb';
  if (model === 'carrot') { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.45, 8), new THREE.MeshStandardMaterial({ color: 0xff8a20, emissive: 0xff6010, emissiveIntensity: 0.4 })); c.rotation.x = -Math.PI / 2; g.add(c); const l = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 5), new THREE.MeshStandardMaterial({ color: 0x40a030 })); l.rotation.x = Math.PI / 2; l.position.z = -0.27; g.add(l); return g; }
  if (model === 'feather') { const g = new THREE.Group(); const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe8f4ff, emissive: def.color, emissiveIntensity: 0.8 })); f.scale.set(0.25, 0.05, 1); g.add(f); return g; }
  if (model === 'stick') { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x8a5a30 })); s.rotation.z = Math.PI / 2; g.add(s); return g; }
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(model === 'butterfly' ? 0.12 : 0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(model === 'butterfly' ? 0.25 : 0.3, 10, 8), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(core, glow); return g;
}
