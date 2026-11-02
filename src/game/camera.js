import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/utils.js';

// Third-person follow camera with collision, smooth lag, and an optional 2.5D (isometric-style) mode.
export class CameraRig {
  constructor(camera) {
    this.cam = camera; this.yaw = Math.PI; this.pitch = 0.32; this.dist = 3; this.zoom = 1;
    this.target = new THREE.Vector3(); this.smoothTarget = new THREE.Vector3(); this.curDist = 3;
    this.mode = 'free'; // 'free' | 'iso'
    this.shake = 0; this.autoTimer = 0; this.fovBase = 62; this.fovKick = 0;
    this.lookAhead = new THREE.Vector3();
  }
  setMode(m) { this.mode = m; if (m === 'iso') { this.pitch = 0.44; } else this.pitch = 0.32; }
  snapBehind(p) { this.yaw = p.yaw + Math.PI; this.smoothTarget.copy(p.pos); }
  update(dt, input, player, physics, opts = {}) {
    const look = input.consumeLook();
    const z = input.consumeZoom();
    if (z) this.zoom = clamp(this.zoom * (z > 0 ? 1.12 : 0.89), 0.45, 3.2);
    const sens = 0.0042;
    if (this.mode === 'free') {
      this.yaw -= look.x * sens; this.pitch = clamp(this.pitch + look.y * sens, -0.35, 1.25);
      if (Math.abs(look.x) + Math.abs(look.y) > 0.5) this.autoTimer = 2.2;
      this.autoTimer -= dt;
      // gentle auto-follow behind the creature when moving and the player isn't steering the camera
      if (this.autoTimer < 0 && player.speed > 1.5 && !opts.combat) {
        const behind = player.yaw + Math.PI;
        const f = Math.abs(input.move.x) > 0.6 && Math.abs(input.move.y) < 0.3 ? 0 : 0.9;
        this.yaw = dampAngle(this.yaw, behind, f * clamp(player.speed / 8, 0.15, 0.6), dt);
      }
    } else {
      this.yaw -= look.x * sens; // iso: rotate only
      this.pitch = clamp(this.pitch + look.y * sens * 0.5, 0.3, 0.9);
      if (Math.abs(look.x) > 0.5) this.autoTimer = 3;
      this.autoTimer -= dt;
      if (this.autoTimer < 0 && player.speed > 1.5 && !opts.combat) this.yaw = dampAngle(this.yaw, player.yaw + Math.PI, 0.25, dt);
    }
    const sp = player.sp.cam;
    const scale = player.anim.scale || 1;
    const baseDist = (this.mode === 'iso' ? sp.dist * 2.4 + 1.2 : sp.dist) * this.zoom * (opts.combat ? (this.mode === 'iso' ? 1.3 : 1.9) : 1) * Math.max(1, scale * 0.8);
    const flyBonus = player.flyingNow() && this.mode !== 'iso' ? 1.35 : 1;
    this.dist = damp(this.dist, baseDist * flyBonus + Math.min(player.speed, 12) * 0.06, 3, dt);
    // target: creature head-ish, slight look-ahead in movement direction
    const h = sp.height * scale;
    this.target.set(player.rig.root.position.x, player.rig.root.position.y + h, player.rig.root.position.z);
    this.lookAhead.set(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(Math.min(player.speed, 10) * 0.05);
    this.target.add(this.lookAhead);
    if (this.smoothTarget.distanceToSquared(this.target) > 400) this.smoothTarget.copy(this.target);
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x, 14, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z, 14, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y, player.onGround ? 10 : 6, dt);
    const T = this.smoothTarget;
    const cp = Math.cos(this.pitch), spch = Math.sin(this.pitch);
    let dx = Math.sin(this.yaw) * cp, dy = spch, dz = Math.cos(this.yaw) * cp;
    // collision with buildings
    const want = this.dist;
    let d = want;
    if (physics) {
      const t = physics.raycast(T.x, T.y, T.z, T.x + dx * want, T.y + dy * want, T.z + dz * want, 0.6);
      d = Math.max(0.35, want * t - 0.25);
    }
    this.curDist = d < this.curDist ? d : damp(this.curDist, d, 4, dt);
    let cx = T.x + dx * this.curDist, cy = T.y + dy * this.curDist, cz = T.z + dz * this.curDist;
    // keep above ground/water
    if (physics) { const g = Math.max(physics.terrain(cx, cz), physics.waterAt(cx, cz) ?? -99); if (cy < g + 0.15) cy = g + 0.15; }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * this.shake * 0.25;
    this.cam.position.set(cx + (Math.random() - 0.5) * s, cy + (Math.random() - 0.5) * s, cz + (Math.random() - 0.5) * s);
    this.cam.lookAt(T.x, T.y + (this.mode === 'iso' ? 0 : 0.05), T.z);
    // FOV kick at high speed
    const fovT = (this.mode === 'iso' ? 36 : (opts.fov || sp.fov || 62)) + clamp((player.speed - 6) * 1.2, 0, 10) + this.fovKick;
    this.fovKick = damp(this.fovKick, 0, 5, dt);
    if (Math.abs(this.cam.fov - fovT) > 0.05) { this.cam.fov = damp(this.cam.fov, fovT, 4, dt); this.cam.updateProjectionMatrix(); }
  }
  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }
}
