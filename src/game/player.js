import * as THREE from 'three';
import { SPECIES } from '../data/species.js';
import { buildCreature, defaultAnimState } from '../models/creatures.js';
import { clamp, damp, angleDiff, wrapAngle, lerp } from '../core/utils.js';
import { audio } from '../core/audio.js';

const RADIUS = { cat: 0.2, dog: 0.3, rabbit: 0.17, bird: 0.12, snake: 0.14, butterfly: 0.08 };
const HEIGHT = { cat: 0.35, dog: 0.62, rabbit: 0.35, bird: 0.22, snake: 0.12, butterfly: 0.1 };
const GRAV = 22;

export class Player {
  constructor(game, key, coatIdx, prog) {
    this.game = game; this.key = key; this.sp = SPECIES[key]; this.coatIdx = coatIdx; this.prog = prog;
    this.coat = this.sp.coats[coatIdx] || this.sp.coats[0];
    this.rig = buildCreature(key, this.sp, this.coat);
    this.anim = defaultAnimState();
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.visualY = 0;
    this.yaw = 0; this.speed = 0; this.turnRate = 0; this.onGround = true; this.flying = this.sp.rig === 'butterfly';
    this.radius = RADIUS[key]; this.height = HEIGHT[key];
    this.charge = 0; this.charging = false; this.swimming = false; this.wet = 0;
    this.sit = 0; this.sitTime = 0; this.crouch = false; this.hidden = false; this.stealth = false;
    this.flapCd = 0; this.lungeCd = 0; this.instinctCd = 0; this.stepT = 0; this.airTime = 0; this.coyote = 0; this.jumpBuffer = 0;
    // needs
    this.hunger = 80; this.energy = 100; this.mood = 65;
    // combat
    this.recalcStats();
    this.hp = this.maxHp; this.spirit = 0; this.invuln = 0; this.buffs = []; this.cds = {}; this.shield = 0;
    this.action = null; this.actionT = 0; this.actionDur = 0.3; this.comboIdx = 0; this.comboT = 0; this.lockMove = 0; this.dashVel = null;
    this.burrowed = 0; this.poisonImmune = 0; this.mode = 'city';
    this.lastGroundTag = null; this.groundBox = null;
  }
  recalcStats() {
    const lv = this.prog.level, s = this.sp.stats;
    this.maxHp = Math.round(s.hp * (1 + 0.12 * (lv - 1)));
    this.atk = s.atk * (1 + 0.1 * (lv - 1));
    this.def = s.def; this.critBase = s.crit;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
  }
  addTo(scene) {
    scene.add(this.rig.root);
    if (this.rig.worldObjects) this.rig.worldObjects.forEach((o) => scene.add(o));
  }
  removeFrom(scene) {
    scene.remove(this.rig.root);
    if (this.rig.worldObjects) this.rig.worldObjects.forEach((o) => scene.remove(o));
  }
  teleport(p, yaw = this.yaw) {
    this.pos.copy(p); this.visualY = p.y; this.vel.set(0, 0, 0); this.yaw = yaw; this.speed = 0;
    this.rig.reset?.(); this.sit = 0; this.charge = 0;
    this.rig.root.position.copy(this.pos); this.rig.root.rotation.y = this.yaw;
  }
  buff(k) { let v = k === 'dmg' || k === 'speed' ? 1 : 0; for (const b of this.buffs) if (b[k] != null) v = (k === 'dmg' || k === 'speed') ? v * b[k] : v + b[k]; return v; }
  get moodMul() { return this.mood > 70 ? 1.1 : this.mood < 30 ? 0.9 : 1; }

  update(dt, input, camYaw, physics) {
    const sp = this.sp, M = sp.move, inRift = this.mode === 'rift';
    const isBird = sp.rig === 'bird', isFly = sp.rig === 'butterfly', isSnake = sp.rig === 'snake';
    // timers
    this.flapCd -= dt; this.lungeCd -= dt; this.instinctCd -= dt; this.invuln -= dt; this.lockMove -= dt; this.comboT -= dt; this.coyote -= dt; this.jumpBuffer -= dt;
    for (const k in this.cds) this.cds[k] -= dt * (1 + this.buff('cdr'));
    this.buffs = this.buffs.filter((b) => (b.t -= dt) > 0);
    if (this.action) { this.actionT += dt / this.actionDur; if (this.actionT >= 1) this.action = null; }

    // ── Desired direction from input relative to camera
    const mx = input.move.x, my = input.move.y;
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * my + rx * mx, dz = fz * my + rz * mx;
    let mag = Math.min(1, Math.hypot(dx, dz));
    if (this.burrowed > 0) { this.burrowed -= dt; }
    if (this.lockMove > 0 || this.game.ui?.modalOpen) mag = 0;

    // ── Sitting / napping
    if (input.hit('sit') && this.onGround && !this.flyingNow()) { this.sit = this.sit ? 0 : 1; this.sitTime = 0; }
    if (mag > 0.1 || input.hit('jump')) { if (this.sit) { this.sit = 0; } }
    if (this.sit) this.sitTime += dt;
    const lying = this.sit && this.sitTime > 2.2;

    // ── Instinct
    if (input.hit('instinct') && !inRift) this.game.world?.useInstinct(this);
    if (this.crouch && (this.speed > M.run * 0.9 || !this.onGround)) { /* keep */ }

    // ── Speed target
    const sprintHeld = input.down('sprint') || input.analogSprint;
    const canSprint = this.energy > 1 && !this.crouch && !this.swimming;
    let target = mag < 0.55 && input.touchMove?.active ? M.walk + (M.run - M.walk) * clamp((mag - 0.2) / 0.35, 0, 1) : M.run;
    if (mag > 0.1 && sprintHeld && canSprint) target = (this.flyingNow() && M.flySprint) ? M.flySprint : M.sprint;
    else if (this.flyingNow() && M.fly) target = M.fly;
    if (inRift) target = Math.max(target, (this.flyingNow() && M.fly ? M.fly : M.run) * 1.1);
    if (this.crouch) target *= 0.45;
    if (this.swimming) target = Math.max(0.6, M.run * (M.swim || 0.3));
    target *= this.buff('speed') * (this.mood < 25 ? 0.9 : 1) * (this.hunger <= 0 ? 0.8 : 1);
    if (mag < 0.08) target = 0;
    else target *= Math.max(0.35, mag);

    // ── Turning: animals turn along arcs, never strafe
    const strafe = this.guarding && inRift;
    if (strafe) target = Math.min(target, M.walk * 1.4) * Math.max(0.35, mag);
    if (mag > 0.08 && !strafe) {
      const diff = angleDiff(this.yaw, want);
      const turnSpd = (M.turn || 9) * (inRift ? 1.6 : 1) * (this.onGround || this.flyingNow() ? 1 : 0.4) * (this.speed > M.run * 1.2 ? 0.75 : 1);
      // sharp reversals: pivot quickly when slow
      const step = turnSpd * dt * (Math.abs(diff) > 2.2 && this.speed < 2 ? 1.8 : 1);
      const ny = Math.abs(diff) <= step ? want : this.yaw + Math.sign(diff) * step;
      this.turnRate = damp(this.turnRate, wrapAngle(ny - this.yaw) / Math.max(dt, 1e-4), 10, dt);
      this.yaw = wrapAngle(ny);
      target *= clamp(Math.cos(diff) * 0.8 + 0.4, 0.15, 1);
    } else this.turnRate = damp(this.turnRate, 0, 8, dt);

    // ── Accelerate along facing
    const accel = (M.accel || 10) * (this.onGround || this.flyingNow() || this.swimming ? 1 : 0.25) * (inRift ? 1.4 : 1);
    this.speed = damp(this.speed, target, target < this.speed ? accel * 1.2 : accel * 0.6, dt);
    if (this.speed < 0.01) this.speed = 0;
    const sl = Math.hypot(dx, dz) || 1;
    const hx = strafe ? (dx / sl) * this.speed : Math.sin(this.yaw) * this.speed, hz = strafe ? (dz / sl) * this.speed : Math.cos(this.yaw) * this.speed;
    if (this.onGround || this.flyingNow() || this.swimming) { this.vel.x = hx; this.vel.z = hz; }
    else { this.vel.x = damp(this.vel.x, hx, 2.5, dt); this.vel.z = damp(this.vel.z, hz, 2.5, dt); }
    if (this.dashVel) { this.vel.x = this.dashVel.x; this.vel.z = this.dashVel.z; this.dashVel.t -= dt; if (this.dashVel.t <= 0) this.dashVel = null; }
    if (this.knock) { this.vel.x += this.knock.x; this.vel.z += this.knock.z; this.knock.x = damp(this.knock.x, 0, 6, dt); this.knock.z = damp(this.knock.z, 0, 6, dt); if (Math.abs(this.knock.x) + Math.abs(this.knock.z) < 0.05) this.knock = null; }

    // ── Jumping / flying
    const ground = physics.groundAt(this.pos.x, this.pos.z, this.pos.y, this.radius, M.step + (this.onGround ? 0.05 : 0));
    const water = physics.waterAt(this.pos.x, this.pos.z);
    if (input.hit('jump')) this.jumpBuffer = 0.15;
    const canJump = (this.onGround || this.coyote > 0) && !this.swimming;
    if (isFly) {
      // Butterfly: always airborne. Jump = rise, release = gently sink.
      const up = input.down('jump'), down = input.down('sit') || input.down('dodge') && false;
      const maxAlt = inRift ? 2.2 : 80;
      const vyT = up ? 2.6 : down ? -2.2 : -0.45;
      this.vel.y = damp(this.vel.y, vyT, 3, dt);
      if (this.updraft > 0) { this.updraft -= dt; this.vel.y = Math.max(this.vel.y, 7); }
      const minY = Math.max(ground, water ?? -99) + 0.22;
      if (this.pos.y > maxAlt + ground && this.vel.y > 0) this.vel.y = 0;
      this.flying = true;
      if (this.pos.y < minY) { this.pos.y = damp(this.pos.y, minY, 10, dt); if (this.vel.y < 0) this.vel.y = 0; }
      this.landed = this.pos.y < minY + 0.05 && down;
    } else if (isBird) {
      if (this.jumpBuffer > 0 && canJump && !this.flying) { this.vel.y = M.jump; this.onGround = false; this.coyote = 0; this.jumpBuffer = 0; audio.sfx('jump', { vol: 0.5 }); }
      else if (!this.onGround && !this.flying && (input.hit('jump') || (input.down('jump') && this.airTime > 0.15))) { this.flying = true; }
      if (this.flying) {
        const climb = input.down('jump');
        const cost = sprintHeld ? 6 : 2.5;
        if (climb && this.flapCd <= 0 && this.energy > 0) { this.vel.y = Math.min(this.vel.y + 4.2, 5.5); this.flapCd = 0.22; audio.sfx('flap', { vol: 0.6 }); this.energy -= cost * 0.22 * (inRift ? 0 : 1); }
        const dive = input.down('sit');
        const glideVy = dive ? -9 : this.speed > 2 ? -1.2 : -2.4;
        this.vel.y = damp(this.vel.y, climb ? this.vel.y : glideVy, climb ? 0 : 1.8, dt);
        this.vel.y -= (climb ? GRAV * 0.55 : 0) * dt;
        if (inRift && this.pos.y > 2.2 && this.vel.y > 0) this.vel.y = 0;
        if (this.pos.y > 120) this.vel.y = Math.min(this.vel.y, 0);
      } else this.vel.y -= GRAV * dt;
    } else if (isSnake) {
      if (this.jumpBuffer > 0 && canJump && this.lungeCd <= 0) { // strike lunge
        this.vel.y = 3.2; this.dashVel = { x: Math.sin(this.yaw) * 7, z: Math.cos(this.yaw) * 7, t: 0.22 }; this.lungeCd = 0.7; this.onGround = false; this.jumpBuffer = 0;
        this.playAction('strike', 0.35); audio.voice('snake');
      }
      this.vel.y -= GRAV * dt;
    } else {
      if (sp.key === 'cat' || M.chargeJump) {
        if (input.hit('jump') && canJump) { this.charging = true; this.charge = 0; }
        if (this.charging) {
          this.charge = Math.min(1, this.charge + dt / 0.7);
          if (!this.onGround && this.coyote <= 0) { this.charging = false; this.charge = 0; }
          if (!input.down('jump')) {
            const c = this.charge < 0.12 ? 0 : this.charge;
            this.vel.y = lerp(M.jump, M.chargeJump, c); this.onGround = false; this.coyote = 0; this.charging = false; this.charge = 0; this.jumpBuffer = 0;
            if (c > 0.5) { this.vel.x += Math.sin(this.yaw) * 1.5; this.vel.z += Math.cos(this.yaw) * 1.5; }
            audio.sfx('jump', { vol: 0.6 + c * 0.4 });
          }
        }
      } else if (this.jumpBuffer > 0 && canJump) {
        this.vel.y = M.jump; this.onGround = false; this.coyote = 0; this.jumpBuffer = 0; audio.sfx('jump', { vol: 0.7 });
        if (sp.key === 'rabbit') { this.speed += 1.5; if (this.mood > 80 && !inRift) this.game.world?.event('binky'); }
      }
      this.vel.y -= GRAV * dt;
    }
    if (this.swimming && input.hit('jump') && !isFly) { this.vel.y = isBird ? 5 : 4.5; this.swimming = false; this.onGround = false; if (isBird) this.flying = true; }
    this.vel.y = Math.max(this.vel.y, -30);

    // ── Integrate horizontal + collide
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const blocked = physics.resolve(this.pos, this.radius, this.pos.y, this.height, M.step);
    if (blocked && this.onGround) { // lose speed into the wall
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-4);
      this.speed = Math.min(this.speed, moved + 0.5);
    }
    // ── Vertical
    const g2 = physics.groundAt(this.pos.x, this.pos.z, this.pos.y, this.radius, M.step);
    this.groundBox = physics.lastGroundBox;
    const ceil = physics.ceilingAt(this.pos.x, this.pos.z, this.pos.y, this.radius);
    let ny = this.pos.y + this.vel.y * dt;
    if (ny + this.height > ceil && this.vel.y > 0) { ny = ceil - this.height; this.vel.y = 0; }
    const wasGround = this.onGround;
    // swimming
    const w2 = physics.waterAt(this.pos.x, this.pos.z);
    const sub = this.height * 0.55;
    if (!isFly && w2 != null && ny < w2 - sub + 0.02 && g2 < w2 - sub) {
      if (!this.swimming) { audio.sfx('splash'); this.game.vfx?.splash(this.pos.clone().setY(w2)); this.game.world?.onSwim(this); }
      this.swimming = true; this.flying = false; ny = damp(ny, w2 - sub, 8, dt); this.vel.y = 0; this.onGround = false;
      this.wet = 1;
    } else this.swimming = false;
    if (!this.swimming && !isFly) {
      if (ny <= g2 + 0.001) {
        if (!wasGround && this.vel.y < -6) { audio.sfx('land', { vol: clamp(-this.vel.y / 15, 0.2, 1) }); this.landShake = clamp(-this.vel.y / 20, 0, 1); }
        if (!wasGround) this.onLand?.(this.groundBox);
        ny = g2; this.vel.y = 0; this.onGround = true; this.coyote = 0.1;
        if (isBird && this.flying) { this.flying = false; this.onLand?.(this.groundBox); }
      } else {
        if (wasGround && ny > g2 - 0.5 && ny - g2 < M.step + 0.05 && this.vel.y <= 0) { ny = g2; this.onGround = true; } // walking down steps
        else this.onGround = false;
      }
    } else if (isFly) { this.onGround = ny <= g2 + 0.25; }
    this.pos.y = ny;
    if (this.onGround) this.airTime = 0; else this.airTime += dt;

    // ── Needs (city only)
    if (!inRift) {
      this.hunger = Math.max(0, this.hunger - dt * 0.12);
      const sprinting = target >= M.sprint * 0.9 && this.speed > M.run;
      if (sprinting) this.energy = Math.max(0, this.energy - dt * 5);
      else this.energy = Math.min(100, this.energy + dt * (lying ? 9 : this.sit ? 5 : 2.2));
      this.mood = clamp(this.mood + dt * ((50 - this.mood) * 0.004 - (this.hunger < 20 ? 0.15 : 0) - (this.swimming && sp.key === 'cat' ? 1.5 : 0) + (this.swimming && sp.key === 'dog' ? 0.6 : 0)), 0, 100);
      if (this.hunger > 15 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * (lying ? 4 : 1));
      if (this.hunger <= 0) this.hp = Math.max(1, this.hp - dt * 0.6);
    } else {
      this.energy = Math.min(100, this.energy + dt * 12);
      const regen = this.buff('regen'); if (regen) this.hp = Math.min(this.maxHp, this.hp + regen * this.maxHp * dt);
    }
    this.wet = Math.max(0, this.wet - dt * 0.08);

    // ── Footsteps
    if (this.onGround && this.speed > 0.5 && !isSnake) { this.stepT -= dt * this.speed / (M.stride || 0.5); if (this.stepT <= 0) { this.stepT = 0.5; audio.sfx('step', { vol: this.sp.key === 'dog' ? 1.3 : 0.7 }); } }

    // ── Visual
    this.visualY = this.onGround && Math.abs(this.visualY - this.pos.y) < 0.6 ? damp(this.visualY, this.pos.y, 18, dt) : this.pos.y;
    const R = this.rig.root;
    R.position.set(this.pos.x, this.visualY, this.pos.z);
    R.rotation.y = this.yaw;
    const a = this.anim;
    a.speed = this.burrowed > 0 ? 0 : (this.dashVel ? Math.hypot(this.dashVel.x, this.dashVel.z) : this.speed);
    a.maxSpeed = M.sprint; a.air = !this.onGround && !this.swimming && !this.flyingNow(); a.vy = this.vel.y;
    a.crouch = this.crouch || (this.guarding && this.mode === 'rift') ? 1 : 0; a.charge = this.charge; a.sit = this.sit && !lying ? 1 : 0; a.lie = lying ? 1 : 0; a.sleep = lying && this.sitTime > 4;
    a.swim = this.swimming ? 1 : 0; a.turn = this.turnRate; a.flying = this.flyingNow() && !this.landed; a.glide = !input.down('jump');
    a.mood = this.mood / 100; a.action = this.action; a.actionT = this.actionT; a.actionSide = this.comboIdx % 2 ? 1 : -1;
    a.scale = this.buff('scale') ? 1 + this.buff('scale') - (this.buffs.filter((b) => b.scale).length) : 1;
    a.hiddenShadow = this.burrowed > 0;
    this.rig.update(dt, a, this.pos, this.yaw);
    R.visible = this.burrowed <= 0;
    if (this.rig.worldObjects) this.rig.worldObjects.forEach((o) => (o.visible = this.burrowed <= 0));
    // shadow sits on ground under flying creatures
    const sh = R.children.find((c) => c.geometry?.type === 'PlaneGeometry');
    if (sh) { sh.position.y = (g2 - this.visualY) / R.scale.y + 0.02; const h = clamp(1 - (this.visualY - g2) / 8, 0.15, 1); sh.material.opacity = h; }
    // cat night vision handled in world
  }
  flyingNow() { return this.flying && (this.sp.rig === 'bird' || this.sp.rig === 'butterfly'); }
  playAction(name, dur = 0.3) { this.action = name; this.actionT = 0; this.actionDur = dur; }
  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  centerPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z); }
}
