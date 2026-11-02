import * as THREE from 'three';
import { buildMonster, MONSTERS } from '../models/monsters.js';
import { CollisionWorld } from '../world/physics.js';
import { Combat } from '../game/combat.js';
import { makeSky, dotTexture, globalUniforms } from '../gfx/gfx.js';
import { audio } from '../core/audio.js';
import { clamp, angleDiff, rand, TAU, damp, RNG } from '../core/utils.js';

const ARENA_R = 24;
export const TIER_WAVES = {
  1: [['wisp', 'wisp', 'smear'], ['tumbler', 'wisp', 'wisp']],
  2: [['wisp', 'wisp', 'smear', 'smear'], ['tumbler', 'tumbler', 'wisp'], ['totem', 'smear', 'wisp']],
  3: [['tumbler', 'smear', 'smear', 'wisp'], ['totem', 'wisp', 'wisp', 'tumbler'], ['totem', 'totem', 'smear', 'tumbler']],
  4: [['totem', 'tumbler', 'tumbler', 'wisp', 'wisp'], ['smear', 'smear', 'smear', 'totem'], ['totem', 'totem', 'tumbler', 'tumbler', 'wisp']],
  5: [['tumbler', 'wisp', 'wisp', 'smear'], ['totem', 'tumbler', 'wisp', 'smear'], ['boss']],
};
export const TIER_LEVEL = { 1: 1, 2: 3, 3: 5, 4: 7, 5: 9 };

class Enemy {
  constructor(rift, type, pos, tier) {
    this.rift = rift; this.type = type; this.def = MONSTERS[type];
    const hm = 1 + 0.5 * (tier - 1), dm = (1 + 0.32 * (tier - 1)) * 1.15;
    this.maxHp = this.def.hp * hm; this.hp = this.maxHp; this.dmg = this.def.dmg * dm; this.radius = this.def.radius;
    this.rig = buildMonster(type, Math.floor(Math.random() * 1e6));
    this.pos = pos.clone(); this.yaw = 0; this.alive = true; this.state = 'spawn'; this.stateT = 0.9; this.cd = rand(0.8, 2);
    this.kb = new THREE.Vector3(); this.stun = 0; this.poison = 0; this.poisonT = 0; this.slowT = 0; this.fear = 0; this.flyH = this.def.fly || 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.phase = 0; this.spawnScale = 0;
    this.rig.root.position.copy(this.pos); this.rig.root.scale.setScalar(0.01); this.scale = type === 'boss' ? 1 : 1.25; this.radius *= this.scale;
    rift.scene.add(this.rig.root);
  }
  center() { return new THREE.Vector3(this.pos.x, this.pos.y + (this.flyH + (this.type === 'tumbler' ? 0.55 : this.type === 'totem' ? 1.2 : this.type.startsWith('smear') || this.type === 'mote' ? 0.5 : 0)) * (this.scale || 1), this.pos.z); }
  takeDamage(dmg, info = {}) {
    if (!this.alive || this.state === 'spawn') return;
    if (this.broken > 0) { dmg *= 1.5; info.crit = true; }
    this.hp -= dmg; this.rig.flash();
    const boss = this.def.boss;
    if (info.kb && info.dir && !boss) this.kb.addScaledVector(info.dir, info.kb * (this.type === 'totem' ? 0.3 : 1));
    if (info.stun && !boss) this.stun = Math.max(this.stun, info.stun);
    if (info.stun && boss) this.stun = Math.max(this.stun, info.stun * 0.25);
    if (info.poison) { this.poison = Math.max(this.poison, info.poison); this.poisonT = 4; }
    if (info.slow) this.slowT = 0.6;
    this.rift.number(this.center().add(new THREE.Vector3(rand(-0.3, 0.3), 0.6, 0)), Math.round(dmg), info.crit ? '#ffd040' : '#ffffff', info.crit);
    if (this.state === 'windup' && info.stun) { this.state = 'recover'; this.stateT = 0.6; this.tele && this.rift.vfx.kill(this.tele); }
    if (this.hp <= 0) this.die();
  }
  die() {
    this.alive = false; this.state = 'dead';
    const c = this.center();
    this.rift.vfx.burst(c, this.def.color, 50, 7, 0.9, 0.35, 2, { vary: true });
    this.rift.vfx.burst(c, 0x100018, 30, 4, 1.2, 0.6, -1, { grow: 2 });
    this.rift.vfx.ring(this.pos, this.def.color, 3, 0.5);
    audio.sfx('monsterDie');
    if (this.tele) this.rift.vfx.kill(this.tele);
    this.rift.onEnemyDie(this);
    const root = this.rig.root; let t = 0;
    this.rift.vfx.custom(new THREE.Group(), 0.4, (f, k) => { root.scale.setScalar(Math.max(0.01, 1 - k)); root.rotation.y += 0.3; if (k >= 1) this.rift.scene.remove(root); });
    setTimeout(() => this.rift.scene.remove(root), 450);
  }
  target() {
    const r = this.rift; const p = r.player;
    if (r.combat.decoys.length && !this.def.boss) { let best = null, bd = 1e9; for (const d of r.combat.decoys) { const dd = d.pos.distanceTo(this.pos); if (dd < bd) { bd = dd; best = d; } } if (best && bd < 14) return { pos: best.pos, decoy: true }; }
    if (p.stealthT > 0) return null;
    return { pos: p.pos };
  }
  update(dt) {
    const r = this.rift, p = r.player, def = this.def;
    if (!this.alive) return;
    this.stateT -= dt; this.cd -= dt; this.stun -= dt; this.broken = (this.broken || 0) - dt; this.fear -= dt; this.slowT -= dt;
    if (this.poisonT > 0) { this.poisonT -= dt; this.poisonTick = (this.poisonTick || 0) - dt; if (this.poisonTick <= 0) { this.poisonTick = 0.5; this.hp -= this.poison * 0.5; r.number(this.center().add(new THREE.Vector3(0, 0.9, 0)), Math.round(this.poison * 0.5), '#9dff60'); r.vfx.burst(this.center(), 0x90ff40, 3, 1, 0.5, 0.15, -1); if (this.hp <= 0) return this.die(); } }
    // knockback
    if (this.kb.lengthSq() > 0.001) { this.pos.addScaledVector(this.kb, dt * 6); this.kb.multiplyScalar(Math.exp(-dt * 6)); }
    const T = this.target();
    const tp = T ? T.pos : null;
    const dx = tp ? tp.x - this.pos.x : 0, dz = tp ? tp.z - this.pos.z : 0, dist = tp ? Math.hypot(dx, dz) : 99;
    const toYaw = Math.atan2(dx, dz);
    const slow = this.slowT > 0 ? 0.5 : 1;
    let spd = 0;
    if (this.state === 'spawn') {
      this.spawnScale = Math.min(1, this.spawnScale + dt * 1.4);
      this.rig.root.scale.setScalar(Math.max(0.01, this.spawnScale * this.scale));
      if (this.stateT <= 0) { this.state = 'chase'; if (def.boss) audio.sfx('monsterCry'); }
    } else if (this.stun > 0) {
      if (Math.random() < 0.3) r.vfx.trail(this.center().add(new THREE.Vector3(rand(-0.4, 0.4), 0.6, rand(-0.4, 0.4))), 0xfff0a0, 0.15, 0.4);
    } else if (this.fear > 0) {
      this.yaw += angleDiff(this.yaw, toYaw + Math.PI) * Math.min(1, dt * 6); spd = def.speed * 0.8;
    } else if (this.state === 'chase') {
      if (!tp) { this.phase += dt; this.yaw += dt * 0.5; spd = def.speed * 0.3; }
      else if (def.boss) this.bossAI(dt, dist, toYaw);
      else {
        this.yaw += angleDiff(this.yaw, toYaw) * Math.min(1, dt * 5);
        if (def.ranged) { // keep distance & strafe
          if (dist > def.range * 0.8) spd = def.speed; else if (dist < def.range * 0.45) { spd = -def.speed * 0.8; }
          else { const s = this.strafe * def.speed * 0.7; this.pos.x += Math.cos(toYaw) * s * dt; this.pos.z -= Math.sin(toYaw) * s * dt; if (Math.random() < dt * 0.3) this.strafe *= -1; }
          if (this.cd <= 0 && dist < def.range) this.windup(0.65);
        } else if (def.charge) {
          if (dist > def.range) spd = def.speed; else if (this.cd <= 0) this.windup(0.75); else spd = def.speed * 0.3;
        } else if (def.pulse) {
          spd = dist > 3 ? def.speed : 0;
          if (this.cd <= 0 && dist < def.range + 1) this.windup(1.1, 'pulse');
          else if (this.cd <= 0 && dist < 16 && Math.random() < 0.5) this.windup(0.9, 'spike');
        } else if (def.melee) {
          if (dist > def.range + this.radius) spd = def.speed; else if (this.cd <= 0) this.windup(0.5);
        }
      }
    } else if (this.state === 'windup') {
      if (!this.glinted && this.stateT < 0.32) { this.glinted = true; const unblock = this.kind === 'pulse' || this.kind === 'spike' || this.kind === 'beamPrep'; r.glint(this.center().add(new THREE.Vector3(0, this.radius + 0.5, 0)), !unblock); }
      if (def.charge) this.yaw += angleDiff(this.yaw, toYaw) * Math.min(1, dt * 2);
      if (this.stateT <= 0) this.attack(tp, dist, toYaw);
    } else if (this.state === 'charging') {
      spd = 15; this.chargeHit ||= false;
      if (!this.chargeHit && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < this.radius + p.radius + 0.4 && Math.abs(p.pos.y - this.pos.y) < 1.5) { this.chargeHit = true; const res = r.hurtPlayer(this.dmg * 1.3, this.pos, { type: 'charge', enemy: this }); if (res === 'parry' || res === 'perfect') { this.state = 'recover'; this.stateT = Math.max(this.stateT, 0.6); } }
      r.vfx.trail(this.center(), def.color, 0.4, 0.3);
      if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 1.1; this.cd = def.cd; }
    } else if (this.state === 'recover') {
      if (this.stateT <= 0) this.state = 'chase';
    } else if (this.state === 'beam') {
      this.beamYaw += this.beamDir * dt * 0.9;
      this.beamTick -= dt;
      if (this.beamTick <= 0) { this.beamTick = 0.12; const o = this.pos; const ddx = p.pos.x - o.x, ddz = p.pos.z - o.z; const along = ddx * Math.sin(this.beamYaw) + ddz * Math.cos(this.beamYaw), perp = Math.abs(ddx * Math.cos(this.beamYaw) - ddz * Math.sin(this.beamYaw)); if (along > 0 && along < 30 && perp < 1.1 && p.pos.y < 3) r.hurtPlayer(this.dmg * 0.35, o, { type: 'aoe' }); }
      if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 1.0; this.cd = def.cd; }
    }
    if (spd) { spd *= slow; const ny = this.state === 'charging' ? this.yaw : this.yaw; this.pos.x += Math.sin(ny) * spd * dt; this.pos.z += Math.cos(ny) * spd * dt; }
    // separation
    for (const o of r.enemies) if (o !== this && o.alive) { const ex = this.pos.x - o.pos.x, ez = this.pos.z - o.pos.z, d = Math.hypot(ex, ez), m = this.radius + o.radius; if (d < m && d > 0.001) { this.pos.x += (ex / d) * (m - d) * 0.5; this.pos.z += (ez / d) * (m - d) * 0.5; } }
    // arena bounds
    const rr = Math.hypot(this.pos.x, this.pos.z); if (rr > ARENA_R - 1) { this.pos.x *= (ARENA_R - 1) / rr; this.pos.z *= (ARENA_R - 1) / rr; }
    this.rig.root.position.copy(this.pos); this.rig.root.rotation.y = this.yaw;
    this.rig.update(dt, { target: p.centerPos(), speed: Math.abs(spd), agitated: this.state === 'windup' || this.state === 'charging', telegraph: this.state === 'windup' ? 1 : 0 });
  }
  windup(t, kind) {
    const r = this.rift, p = r.player; this.state = 'windup'; this.stateT = t; this.kind = kind; this.glinted = false;
    audio.sfx('telegraph');
    if (this.def.charge) this.tele = r.vfx.telegraphLine(this.pos, this.yaw, 11, this.radius * 2, t);
    else if (kind === 'pulse') this.tele = r.vfx.telegraph(this.pos, this.def.range, t, 0xa060ff);
    else if (kind === 'spike') { this.spikeAt = p.pos.clone(); this.spikeAt.y = 0; this.tele = r.vfx.telegraph(this.spikeAt, 1.9, t); }
    else if (this.def.melee) { const f = this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(this.radius + 0.6)); this.meleeAt = f; this.tele = r.vfx.telegraph(f, this.def.range * 0.9, t); }
  }
  attack(tp, dist, toYaw) {
    const r = this.rift, def = this.def, p = r.player; this.tele = null;
    this.cd = def.cd * rand(0.85, 1.2);
    if (def.ranged) {
      for (let i = -1; i <= 1; i++) r.enemyShot(this.center(), toYaw + i * 0.22, 9, this.dmg, def.color);
      this.state = 'recover'; this.stateT = 0.4;
    } else if (def.charge) { this.state = 'charging'; this.stateT = 0.75; this.chargeHit = false; audio.sfx('dodge'); }
    else if (this.kind === 'pulse') {
      r.vfx.ring(this.pos, def.color, def.range * 1.1, 0.5, 0.1, 0.3); r.vfx.burst(this.center(), def.color, 30, 6, 0.6, 0.3, 0, { flat: true });
      if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < def.range + p.radius && p.pos.y < 2.5) r.hurtPlayer(this.dmg, this.pos, { type: 'aoe' });
      audio.sfx('boom', { vol: 0.5 }); r.cam.addShake(0.2); this.state = 'recover'; this.stateT = 0.8;
    } else if (this.kind === 'spike') {
      const s = this.spikeAt; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.4, 5), new THREE.MeshStandardMaterial({ color: 0x0a0812, emissive: def.color, emissiveIntensity: 1.2 }));
      sp.position.copy(s); r.vfx.custom(sp, 0.7, (f, k) => { sp.position.y = s.y + Math.min(1, k * 6) * 1.2 - (k > 0.7 ? (k - 0.7) * 6 : 0); });
      if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 1.9 + p.radius && p.pos.y < 2.5) r.hurtPlayer(this.dmg * 0.8, s, { type: 'aoe' });
      this.state = 'recover'; this.stateT = 0.6;
    } else if (def.melee) {
      const f = this.meleeAt; r.vfx.slash(this.center(), this.yaw, def.color, def.range + 0.4, 100, 0.25);
      if (Math.hypot(p.pos.x - f.x, p.pos.z - f.z) < def.range * 0.9 + p.radius && p.pos.y < 2.5) r.hurtPlayer(this.dmg, this.pos, { type: 'melee', enemy: this });
      this.pos.addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.5);
      this.state = 'recover'; this.stateT = 0.5;
    }
  }
  bossAI(dt, dist, toYaw) {
    const r = this.rift, p = r.player, def = this.def;
    this.yaw += angleDiff(this.yaw, toYaw) * Math.min(1, dt * 1.5);
    if (dist > 8) { this.pos.x += Math.sin(this.yaw) * def.speed * dt; this.pos.z += Math.cos(this.yaw) * def.speed * dt; }
    const hpK = this.hp / this.maxHp;
    if (!this.summon1 && hpK < 0.66) { this.summon1 = true; r.spawnWave(['wisp', 'smear', 'tumbler'], true); r.banner('The Unwoven calls its spawn!'); }
    if (!this.summon2 && hpK < 0.33) { this.summon2 = true; r.spawnWave(['totem', 'wisp', 'wisp', 'smear'], true); r.banner('It is unravelling — finish it!'); }
    if (this.cd > 0) return;
    const pick = Math.floor(Math.random() * 3);
    const fast = hpK < 0.33 ? 0.7 : 1;
    if (pick === 0) { // rotating beam
      this.state = 'windup'; this.stateT = 1.0 * fast; this.kind = 'beamPrep'; this.glinted = false;
      this.beamYaw = toYaw - 0.8; this.beamDir = 1;
      this.tele = r.vfx.telegraphLine(this.pos, this.beamYaw, 28, 2.2, 1.0 * fast);
      this.attack = () => { this.state = 'beam'; this.stateT = 2.2; this.beamTick = 0; const from = () => this.center().setY(1); r.vfx.beam(from(), this.beamYaw, 30, 2.2, def.color, 2.2, { follow: from, followYaw: () => this.beamYaw }); audio.sfx('shoot', { vol: 2 }); this.attack = Enemy.prototype.attack; };
    } else if (pick === 1) { // orb rings
      this.state = 'recover'; this.stateT = 1.6; this.cd = def.cd * fast;
      for (let w = 0; w < 3; w++) setTimeout(() => { if (!this.alive) return; for (let i = 0; i < 14; i++) r.enemyShot(this.center().setY(1.0), (i / 14) * TAU + w * 0.22, 7, this.dmg * 0.6, def.color); audio.sfx('shoot'); }, w * 450);
    } else { // slams at player position
      this.state = 'recover'; this.stateT = 2.2; this.cd = def.cd * fast;
      for (let i = 0; i < 4; i++) setTimeout(() => {
        if (!this.alive) return; const s = p.pos.clone(); s.y = 0; r.vfx.telegraph(s, 3, 0.85); setTimeout(() => r.glint(s.clone().setY(1.2), false), 600);
        setTimeout(() => { if (!this.alive) return; r.vfx.ring(s, def.color, 4, 0.4); r.vfx.burst(s.clone().setY(0.3), def.color, 25, 6, 0.5, 0.3, 6); r.cam.addShake(0.35); audio.sfx('boom', { vol: 0.6 }); if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 3 + p.radius && p.pos.y < 3) r.hurtPlayer(this.dmg, s, { type: 'aoe' }); }, 850);
      }, i * 500);
    }
  }
}

export class Rift {
  constructor(game) {
    this.game = game; this.scene = new THREE.Scene(); this.built = false;
    this.physics = new CollisionWorld(); this.enemies = []; this.eShots = [];
  }
  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x120820);
    s.fog = new THREE.FogExp2(0x1a0a2a, 0.018);
    const sky = makeSky(); sky.material.uniforms.riftTint.value = 1; s.add(sky); this.sky = sky;
    s.add(new THREE.HemisphereLight(0xa080e0, 0x302050, 1.5));
    const key = new THREE.DirectionalLight(0xc0b0ff, 1.6); key.position.set(10, 25, 8); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); const c = key.shadow.camera; c.left = c.bottom = -28; c.right = c.top = 28; c.near = 1; c.far = 80; key.shadow.bias = -0.0005;
    s.add(key); s.add(key.target);
    const rim = new THREE.DirectionalLight(0x40e0ff, 0.8); rim.position.set(-15, 6, -20); s.add(rim);
    // Hex-tile platform
    const hex = new THREE.CylinderGeometry(1, 1, 1, 6);
    const tileMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.15, flatShading: true });
    const tiles = []; const R = new RNG(7);
    const sz = 1.6;
    for (let q = -18; q <= 18; q++) for (let r = -18; r <= 18; r++) {
      const x = sz * 1.5 * q, z = sz * Math.sqrt(3) * (r + q / 2);
      const d = Math.hypot(x, z); if (d > ARENA_R + 1) continue;
      tiles.push({ x, z, h: d > ARENA_R - 1.5 ? R.range(0.5, 1.6) : R.range(0, 0.06), d });
    }
    const inst = new THREE.InstancedMesh(hex, tileMat, tiles.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    tiles.forEach((t, i) => {
      const h = 3 + t.h;
      m.compose(new THREE.Vector3(t.x, -h / 2 + t.h, t.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6), new THREE.Vector3(sz * 0.97, h, sz * 0.97));
      inst.setMatrixAt(i, m);
      col.setHSL(0.72 + R.range(-0.04, 0.04), 0.2, 0.2 + R.range(0, 0.07)); inst.setColorAt(i, col);
    });
    inst.receiveShadow = true; inst.castShadow = true; s.add(inst);
    // glowing seams (rings)
    for (const rr of [6, 12, 18]) { const ring = new THREE.Mesh(new THREE.RingGeometry(rr - 0.08, rr, 64), new THREE.MeshBasicMaterial({ color: 0x8a40ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07; s.add(ring); }
    const runes = new THREE.Mesh(new THREE.RingGeometry(ARENA_R - 1.6, ARENA_R - 1.3, 6), new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); runes.rotation.x = -Math.PI / 2; runes.position.y = 0.08; s.add(runes); this.runes = runes;
    // crystal pillars (obstacles)
    const crys = new THREE.MeshStandardMaterial({ color: 0x2a1840, emissive: 0x4a18a0, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.6, flatShading: true });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3, x = Math.cos(a) * 19.5, z = Math.sin(a) * 19.5;
      const p = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), crys); p.scale.set(0.7, 2.6, 0.7); p.position.set(x, 2.2, z); p.rotation.y = a; p.castShadow = true; s.add(p);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: 0xa060ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(4); glow.position.set(x, 2.2, z); s.add(glow);
      this.physics.addBox(x, z, 1.2, 1.2, 4.6, 'pillar').noCam = true;
    }
    // floating debris in the void
    this.debris = [];
    for (let i = 0; i < 40; i++) {
      const g = new THREE.Mesh(new THREE.IcosahedronGeometry(R.range(0.8, 4), 0), new THREE.MeshStandardMaterial({ color: 0x1a1428, flatShading: true, roughness: 0.7, emissive: 0x200840, emissiveIntensity: 0.5 }));
      const a = R.range(0, TAU), d = R.range(36, 120); g.position.set(Math.cos(a) * d, R.range(-20, 30), Math.sin(a) * d); g.rotation.set(R.range(0, 3), R.range(0, 3), 0);
      s.add(g); this.debris.push({ g, s: R.range(-0.2, 0.2), b: g.position.y, p: R.range(0, 6) });
    }
    // the great eye-portal in the sky
    const portal = new THREE.Mesh(new THREE.TorusGeometry(26, 1.2, 8, 64), new THREE.MeshBasicMaterial({ color: 0xff3a8a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }));
    portal.position.set(0, 60, -120); s.add(portal); this.portal = portal;
    const core = new THREE.Mesh(new THREE.CircleGeometry(24, 48), new THREE.MeshBasicMaterial({ color: 0x08020e })); core.position.copy(portal.position); s.add(core);
    // floating motes
    const mg = new THREE.BufferGeometry(); const mp = new Float32Array(600 * 3); for (let i = 0; i < 600; i++) { mp[i * 3] = R.range(-60, 60); mp[i * 3 + 1] = R.range(-5, 30); mp[i * 3 + 2] = R.range(-60, 60); }
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({ size: 0.25, map: dotTexture(), color: 0xb080ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.add(this.motes);
    this.physics.terrain = (x, z) => (Math.hypot(x, z) < ARENA_R + 0.5 ? 0 : -60);
    this.physics.waterAt = () => null; this.physics.bounds = 200;
    this.built = true;
  }
  get player() { return this.game.player; }
  get vfx() { return this.game.vfx; }
  get cam() { return this.game.camRig; }
  number(pos, t, c, big) { this.vfx.number(pos, t, c, big); }
  enter(mist) {
    if (!this.built) this.build();
    this.mist = mist; this.tier = mist.tier; this.wave = 0; this.waves = TIER_WAVES[this.tier]; this.done = false; this.result = null; this.xpGained = 0; this.timer = 0;
    this.enemies = []; this.eShots.forEach((s) => this.scene.remove(s.mesh)); this.eShots = []; this.stats = { parry: 0, pguard: 0, pdodge: 0, hits: 0 };
    this.combat = new Combat({ player: this.player, vfx: this.vfx, scene: this.scene, enemies: this.enemies, cam: this.cam, groundY: 0, toast: (t, k) => this.game.ui.toast(t, k), number: (p, t, c) => this.number(p, t, c), hitstop: (t) => this.game.hitstop(t), ultFlash: (d) => this.game.ui.ultFlash(d) });
    const p = this.player; p.mode = 'rift'; p.spirit = 30; p.buffs = []; p.cds = {}; p.shield = 0; p.invuln = 1.5; p.flying = p.sp.rig === 'butterfly'; p.crouch = false; p.sit = 0;
    p.parryT = 0; p.parryCd = 0; p.parryRec = 0; p.guarding = false; p.guardT = 0; p.guardBroken = 0; p.dodgeWin = 0;
    p.addTo(this.scene); p.teleport(new THREE.Vector3(0, 0, 14), Math.PI);
    this.vfx.attach(this.scene); this.vfx.clear();
    this.cam.snapBehind(p);
    this.nextWaveT = 2.2; this.banner(`${mist.name} — Tier ${this.tier}`);
    audio.setMusic('rift');
  }
  banner(t) { this.game.ui.banner(t); }
  spawnWave(list, extra = false) {
    list.forEach((type, i) => {
      const a = (i / list.length) * TAU + rand(-0.3, 0.3) + (extra ? 1 : 0);
      const d = type === 'boss' ? 0 : rand(8, 16);
      const pos = type === 'boss' ? new THREE.Vector3(0, 0, -6) : new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d - 3);
      setTimeout(() => {
        if (this.done) return;
        // spawn rift crack
        this.vfx.ring(pos, 0xa040ff, type === 'boss' ? 7 : 2.5, 0.8); this.vfx.burst(pos.clone().setY(0.5), 0x2a0a40, 40, 3, 1, 0.5, -2, { grow: 2 }); this.vfx.burst(pos.clone().setY(0.5), 0xd080ff, 20, 4, 0.8, 0.2, 0);
        audio.sfx('portal');
        const e = new Enemy(this, type, pos, this.tier);
        this.enemies.push(e);
        if (type === 'boss') { this.boss = e; this.game.ui.bossBar(e); audio.setMusic('boss'); this.cam.addShake(0.8); }
      }, i * 260);
    });
  }
  enemyShot(from, yaw, speed, dmg, color) {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5) })));
    mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })));
    mesh.position.copy(from); this.scene.add(mesh);
    const tp = this.player.centerPos(); const vy = clamp((tp.y - from.y) / 2, -2, 2);
    this.eShots.push({ mesh, pos: mesh.position, vel: new THREE.Vector3(Math.sin(yaw) * speed, vy, Math.cos(yaw) * speed), dmg, life: 4, color });
  }
  glint(pos, parryable) {
    // warning flash just before an enemy attack lands: gold = can parry/guard, red = unblockable (dodge!)
    const c = parryable ? 0xffd040 : 0xff3040;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.copy(pos); this.vfx.custom(sp, 0.35, (f, k) => { const s = Math.sin(k * Math.PI) * (parryable ? 1.6 : 2.2); sp.scale.set(s * 1.6, s * 0.35, 1); sp.material.opacity = 1 - k * 0.5; });
    const sp2 = sp.clone(); sp2.material = sp.material.clone(); this.vfx.custom(sp2, 0.35, (f, k) => { const s = Math.sin(k * Math.PI) * (parryable ? 1.6 : 2.2); sp2.scale.set(s * 0.35, s * 1.6, 1); sp2.material.opacity = 1 - k * 0.5; sp2.position.copy(pos); });
    audio.tone({ f: parryable ? 1800 : 500, f2: parryable ? 2600 : 300, type: parryable ? 'sine' : 'sawtooth', dur: 0.15, vol: 0.07, filter: parryable ? undefined : 900 });
  }
  /** Returns 'hit' | 'blocked' | 'guardbreak' | 'perfect' | 'parry' | 'dodged' | 'immune' */
  hurtPlayer(dmg, from, info = {}) {
    const p = this.player, g = this.game;
    if (this.done) return 'immune';
    const type = info.type || 'melee';
    const blockable = type !== 'aoe';
    // PARRY — tight window, melee/charge/projectiles; staggers the attacker or reflects the shot
    if (p.parryT > 0 && blockable) { this.onParry(info); return 'parry'; }
    if (p.burrowed > 0) return 'immune';
    if (p.invuln > 0) {
      if (p.dodgeWin > 0 && !p.perfectDodgeUsed) { // PERFECT DODGE
        p.perfectDodgeUsed = true; this.stats.pdodge++;
        g.slowmo(0.9, 0.3); g.ui.perfectFlash('#80d8ff');
        this.number(p.centerPos().add(new THREE.Vector3(0, 0.6, 0)), 'Perfect Dodge!', '#9ae8ff', true);
        p.spirit = Math.min(100, p.spirit + 12); this.combat.addBuff({ name: 'Focus', dur: 3, dmg: 1.3, color: 0x80d8ff });
        audio.tone({ f: 900, f2: 1800, type: 'sine', dur: 0.4, vol: 0.12, rev: 0.8 });
        this.vfx.burst(p.centerPos(), 0x9ae8ff, 24, 3, 0.6, 0.2, 0);
      }
      return 'dodged';
    }
    if (Math.random() < p.buff('dodge')) { this.number(p.centerPos(), 'Dodge', '#9ad8ff'); p.invuln = 0.3; return 'dodged'; }
    let d = dmg * (1 - p.def) * (1 - Math.min(0.7, p.buff('dr')));
    // GUARD — must face the attack; unblockable (red) attacks go straight through
    if (p.guarding && blockable && from) {
      const ang = Math.abs(angleDiff(p.yaw, Math.atan2(from.x - p.pos.x, from.z - p.pos.z)));
      if (ang < 1.9) {
        if (p.guardT < 0.22) { // PERFECT GUARD
          this.stats.pguard++;
          p.energy = Math.min(100, p.energy + 12); p.spirit = Math.min(100, p.spirit + 10); p.invuln = 0.25;
          this.number(p.centerPos().add(new THREE.Vector3(0, 0.6, 0)), 'Perfect Guard!', '#ffe680', true);
          this.vfx.burst(p.centerPos().addScaledVector(p.forward, 0.4), 0xffffff, 26, 5, 0.35, 0.18, 0); this.vfx.ring(p.pos, 0xffe680, 2, 0.3);
          audio.tone({ f: 2200, type: 'triangle', dur: 0.5, vol: 0.12, rev: 0.7 }); audio.tone({ f: 3300, type: 'sine', dur: 0.4, vol: 0.06, rev: 0.7 });
          g.hitstop(0.09); this.cam.addShake(0.2); g.ui.perfectFlash('#ffe680');
          if (info.enemy && !info.enemy.def.boss) { info.enemy.stun = Math.max(info.enemy.stun || 0, 0.7); info.enemy.kb.add(new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(3)); }
          return 'perfect';
        }
        const cost = d * 1.1;
        if (p.energy >= cost) { // normal block: chip damage, costs energy
          p.energy -= cost; d *= 0.2; p.invuln = 0.3;
          this.number(p.centerPos(), 'Blocked ' + Math.round(d), '#c8d8ff');
          this.vfx.burst(p.centerPos().addScaledVector(p.forward, 0.4), 0xc8d8ff, 10, 3, 0.25, 0.15, 0);
          audio.sfx('hit', { vol: 0.5 }); audio.tone({ f: 600, type: 'square', dur: 0.08, vol: 0.05, filter: 1200 });
          p.knock = new THREE.Vector3(p.pos.x - from.x, 0, p.pos.z - from.z).normalize().multiplyScalar(2.5);
          p.hp -= d; if (p.hp <= 0) { p.hp = 0; this.finish(false); }
          return 'blocked';
        }
        // GUARD BREAK — out of energy
        p.energy = 0; p.guarding = false; p.guardBroken = 1.2; p.lockMove = 0.9; d *= 0.7;
        this.banner('Guard Break!'); audio.sfx('boom', { vol: 0.4 });
      }
    }
    if (p.shield > 0) { const a = Math.min(p.shield, d); p.shield -= a; d -= a; }
    p.hp -= d; p.invuln = 0.45; p.spirit = Math.min(100, p.spirit + 4); this.stats.hits++;
    if (from) { const k = new THREE.Vector3(p.pos.x - from.x, 0, p.pos.z - from.z).normalize().multiplyScalar(5); p.knock = k; }
    this.number(p.centerPos(), Math.round(d), '#ff5a6a');
    this.vfx.burst(p.centerPos(), 0xff4060, 12, 3, 0.4, 0.2);
    this.cam.addShake(0.4); audio.sfx('hurt'); g.ui.hurtFlash();
    if (p.hp <= 0) { p.hp = 0; this.finish(false); }
    return 'hit';
  }
  onParry(info) {
    const p = this.player, g = this.game;
    p.parryT = 0; p.parryOk = true; p.invuln = Math.max(p.invuln, 0.45); this.stats.parry++;
    p.spirit = Math.min(100, p.spirit + 20); p.energy = Math.min(100, p.energy + 15);
    this.combat.addBuff({ name: 'Counter', dur: 2.2, dmg: 1.8, crit: 0.4, color: 0xffd040 });
    g.slowmo(0.55, 0.22); g.ui.perfectFlash('#ffd040'); this.cam.addShake(0.5);
    this.number(p.centerPos().add(new THREE.Vector3(0, 0.7, 0)), 'PARRY!', '#ffd040', true);
    audio.tone({ f: 1500, type: 'square', dur: 0.08, vol: 0.08, filter: 3000 }); audio.tone({ f: 2600, type: 'triangle', dur: 0.7, vol: 0.12, rev: 0.9 }); audio.sfx('crit');
    const at = info.shot ? info.shot.pos : info.enemy ? info.enemy.center() : p.centerPos();
    this.vfx.burst(at, 0xffe060, 40, 7, 0.5, 0.22, 2, { vary: true }); this.vfx.ring(p.pos, 0xffd040, 3, 0.35);
    p.playAction('swipe', 0.25);
    if (info.enemy) {
      const e = info.enemy; const st = e.def.boss ? 1.0 : 2.6;
      e.stun = Math.max(e.stun || 0, st); e.broken = st; if (e.tele) this.vfx.kill(e.tele);
      if (e.state === 'charging' || e.state === 'windup') { e.state = 'recover'; e.stateT = st; }
      if (!e.def.boss) e.kb.add(new THREE.Vector3(e.pos.x - p.pos.x, 0, e.pos.z - p.pos.z).normalize().multiplyScalar(5));
      this.number(e.center().add(new THREE.Vector3(0, 1, 0)), 'Staggered', '#ffd040');
    }
    if (info.shot) { // reflect back, stronger
      const s = info.shot; s.reflected = true; s.dmg *= 3; s.life = 3;
      const t = this.combat.nearest(s.pos, 30); const dir = t ? t.center().sub(s.pos).normalize() : s.vel.clone().negate().normalize();
      s.vel.copy(dir).multiplyScalar(22); s.color = 0xffd040; s.mesh.children[1].material.color.set(0xffd040);
    }
  }
  onEnemyDie(e) {
    this.xpGained += e.def.xp * (1 + (this.tier - 1) * 0.6);
    this.player.spirit = Math.min(100, this.player.spirit + 8);
    if (e.def.splits) for (let i = 0; i < 2; i++) { const pos = e.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1))); const m = new Enemy(this, 'mote', pos, this.tier); m.state = 'chase'; m.spawnScale = 1; m.rig.root.scale.setScalar(m.scale); this.enemies.push(m); }
    if (e === this.boss) { this.game.ui.bossBar(null); }
  }
  finish(win) {
    if (this.done) return;
    this.done = true; this.result = win;
    this.combat.clear();
    for (const e of this.enemies) if (e.alive && win) e.die();
    if (win) { audio.sfx('victory'); this.banner('Rift Cleansed!'); this.vfx.burst(this.player.centerPos(), 0xffffff, 80, 8, 1.4, 0.3, -1, { vary: true }); }
    else { audio.sfx('sad'); this.banner('The mist pushes you out…'); }
    const st = this.stats; const bonus = win ? st.parry * 6 + st.pguard * 4 + st.pdodge * 3 + (st.hits === 0 ? 40 : 0) : 0;
    setTimeout(() => this.game.exitRift(win, Math.round(this.xpGained * (win ? 1 : 0.4)) + bonus, st), 2600);
  }
  exit() {
    this.player.removeFrom(this.scene);
    for (const e of this.enemies) this.scene.remove(e.rig.root);
    this.enemies.length = 0; this.eShots.forEach((s) => this.scene.remove(s.mesh)); this.eShots = [];
    this.combat?.clear(); this.boss = null; this.game.ui.bossBar(null);
  }
  update(dt, input) {
    const p = this.player;
    this.timer += dt;
    // input → abilities
    if (!this.done && !this.game.ui.modalOpen) {
      const slots = this.game.loadout();
      const tryCast = (id) => id && this.combat.cast(id);
      // ── Defence: guard (hold), parry (tap, tight window), dodge (perfect dodge if just in time)
      const wantGuard = (input.down('guard') || input.down('instinct')) && !(p.guardBroken > 0) && !p.dashVel && p.parryT <= 0 && (p.parryRec || 0) <= 0;
      if (wantGuard && !p.guarding) { p.guarding = true; p.guardT = 0; audio.tone({ f: 300, type: 'triangle', dur: 0.06, vol: 0.05 }); }
      else if (!wantGuard) p.guarding = false;
      if ((input.hit('parry') || input.hit('interact')) && (p.parryCd || 0) <= 0 && !p.dashVel) {
        p.parryT = 0.2; p.parryCd = 0.8; p.parryOk = false; p.guarding = false;
        const t = this.combat.nearest(p.pos, 6); if (t) p.yaw = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        p.playAction('swipe', 0.2); audio.sfx('swipe', { vol: 0.5 });
        this.vfx.slash(p.centerPos(), p.yaw, 0xffe080, 1.4, 140, 0.18, 0, 0.25);
      }
      if (!p.guarding && p.parryT <= 0 && (p.parryRec || 0) <= 0) {
      if (input.down('atk1')) tryCast(slots.normal[0]);
      if (input.down('atk2')) tryCast(slots.normal[1]);
      if (input.hit('skill1')) tryCast(slots.skill[0]);
      if (input.hit('skill2')) tryCast(slots.skill[1]);
      if (input.hit('skill3')) tryCast(slots.skill[2]);
      if (input.hit('ult1')) tryCast(slots.ult[0]);
      if (input.hit('ult2')) tryCast(slots.ult[1]);
      }
      if ((input.hit('dodge') || input.hit('sprint')) && (p.dodgeCd || 0) <= 0 && p.energy >= 15 && !p.dashVel) {
        p.dodgeCd = 0.55; p.energy -= 15; p.invuln = Math.max(p.invuln, 0.35); p.dodgeWin = 0.2; p.perfectDodgeUsed = false; p.guarding = false;
        const mv = input.move; let yaw = p.yaw;
        if (Math.hypot(mv.x, mv.y) > 0.2) { const cy = this.cam.yaw; yaw = Math.atan2(-Math.sin(cy) * mv.y + Math.cos(cy) * mv.x, -Math.cos(cy) * mv.y - Math.sin(cy) * mv.x); p.yaw = yaw; }
        p.dashVel = { x: Math.sin(yaw) * 16, z: Math.cos(yaw) * 16, t: 0.2 }; audio.sfx('dodge'); this.vfx.dust(p.pos, 6);
      }
    }
    p.dodgeCd = (p.dodgeCd || 0) - dt; p.stealthT = (p.stealthT || 0) - dt; p.dodgeWin = (p.dodgeWin || 0) - dt;
    p.parryCd = (p.parryCd || 0) - dt; p.guardBroken = (p.guardBroken || 0) - dt; p.parryRec = (p.parryRec || 0) - dt;
    if (p.parryT > 0) { p.parryT -= dt; if (p.parryT <= 0 && !p.parryOk) { p.parryRec = 0.35; p.lockMove = 0.35; } } // whiffed parry leaves you open
    if (p.guarding) { p.guardT += dt; const t = this.combat.nearest(p.pos, 14); if (t) { const want = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z); p.yaw += angleDiff(p.yaw, want) * Math.min(1, dt * 12); } p.energy = Math.max(0, p.energy - dt * 3); }
    p.update(dt, input, this.cam.yaw, this.physics);
    // arena edge
    const rr = Math.hypot(p.pos.x, p.pos.z); if (rr > ARENA_R - 0.6) { p.pos.x *= (ARENA_R - 0.6) / rr; p.pos.z *= (ARENA_R - 0.6) / rr; }
    if (p.pos.y < -5) { p.teleport(new THREE.Vector3(0, 0, 10)); }
    this.combat.update(dt);
    for (const e of this.enemies) e.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) if (!this.enemies[i].alive) this.enemies.splice(i, 1);
    // enemy shots
    for (let i = this.eShots.length - 1; i >= 0; i--) {
      const s = this.eShots[i]; s.life -= dt; s.pos.addScaledVector(s.vel, dt);
      if (Math.random() < 0.5) this.vfx.trail(s.pos, s.color, 0.25, 0.3);
      if (s.reflected) {
        for (const e of this.enemies) if (e.alive && e.center().distanceTo(s.pos) < e.radius + 0.4) { e.takeDamage(s.dmg, { crit: true, kb: 2, dir: s.vel.clone().normalize() }); s.life = 0; this.vfx.burst(s.pos, 0xffd040, 16, 4, 0.4, 0.2); break; }
      } else if (s.pos.distanceTo(p.centerPos()) < 0.45 + p.radius + 0.1) {
        const res = this.hurtPlayer(s.dmg, s.pos.clone().sub(s.vel), { type: 'proj', shot: s });
        if (res !== 'parry' && res !== 'dodged') { s.life = 0; this.vfx.burst(s.pos, s.color, 10, 3, 0.3, 0.2); }
      }
      if (s.pos.y < 0) s.life = 0;
      if (s.life <= 0) { this.scene.remove(s.mesh); this.eShots.splice(i, 1); }
    }
    // waves
    if (!this.done && this.enemies.length === 0 && this.eShots.length >= 0) {
      this.nextWaveT -= dt;
      if (this.nextWaveT <= 0) {
        if (this.wave >= this.waves.length) this.finish(true);
        else { const w = this.waves[this.wave++]; this.banner(w[0] === 'boss' ? '⚠ The Unwoven awakens ⚠' : `Wave ${this.wave} / ${this.waves.length}`); this.spawnWave(w); this.nextWaveT = 1.8; }
      }
    }
    // ambience
    const t = performance.now() * 0.001;
    for (const d of this.debris) { d.g.rotation.y += d.s * dt; d.g.position.y = d.b + Math.sin(t * 0.4 + d.p) * 1.5; }
    this.portal.rotation.z += dt * 0.05; this.runes.rotation.z -= dt * 0.1;
    this.motes.rotation.y += dt * 0.02;
    this.sky.material.uniforms.sunDir.value.set(0, 0.3, -1);
    this.cam.update(dt, input, p, this.physics, { combat: true });
  }
}
