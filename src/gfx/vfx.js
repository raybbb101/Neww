import * as THREE from 'three';
import { dotTexture } from './gfx.js';
import { rand, TAU, clamp } from '../core/utils.js';

const MAXP = 1600;
export class VFX {
  constructor() {
    this.root = new THREE.Group();
    const g = new THREE.BufferGeometry();
    this.P = new Float32Array(MAXP * 3); this.C = new Float32Array(MAXP * 3); this.S = new Float32Array(MAXP); this.A = new Float32Array(MAXP);
    g.setAttribute('position', new THREE.BufferAttribute(this.P, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.C, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.S, 1)); g.setAttribute('alpha', new THREE.BufferAttribute(this.A, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dotTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;
        uniform float scale; void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * 1.6, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.root.add(this.points);
    this.parts = []; // {x,y,z,vx,vy,vz,life,max,size,r,g,b,grav,drag,grow}
    this.fx = []; // mesh effects
    this.numbers = []; // damage numbers queued for HUD
  }
  attach(scene) { scene.add(this.root); }
  setViewport(h) { this.mat.uniforms.scale.value = h * 0.9; }
  emit(o) { if (this.parts.length >= MAXP) this.parts.shift(); this.parts.push(o); }
  burst(pos, color, n = 20, speed = 4, life = 0.7, size = 0.25, grav = 4, opt = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const th = rand(0, TAU), ph = opt.flat ? rand(-0.15, 0.4) : Math.acos(rand(-1, 1));
      const s = speed * rand(0.4, 1);
      const vx = Math.cos(th) * Math.sin(ph) * s, vz = Math.sin(th) * Math.sin(ph) * s, vy = (opt.flat ? Math.abs(Math.cos(ph)) * s * 0.4 : Math.cos(ph) * s) + (opt.up || 0);
      const cc = opt.vary ? c.clone().offsetHSL(rand(-0.08, 0.08), 0, rand(-0.1, 0.1)) : c;
      this.emit({ x: pos.x + rand(-0.1, 0.1) * (opt.spread || 1), y: pos.y + rand(-0.1, 0.1), z: pos.z + rand(-0.1, 0.1) * (opt.spread || 1), vx, vy, vz, life: life * rand(0.6, 1), max: life, size: size * rand(0.6, 1.3), r: cc.r, g: cc.g, b: cc.b, grav, drag: opt.drag ?? 2, grow: opt.grow ?? -0.5 });
    }
  }
  trail(pos, color, size = 0.2, life = 0.4) { const c = new THREE.Color(color); this.emit({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-0.3, 0.3), vy: rand(0, 0.5), vz: rand(-0.3, 0.3), life, max: life, size, r: c.r, g: c.g, b: c.b, grav: 0, drag: 1, grow: -0.8 }); }
  sparkle(pos, color, n = 12) { this.burst(pos, color, n, 1.5, 1.0, 0.15, -0.5, { vary: true }); }
  splash(pos) { this.burst(pos, 0xbfe6ff, 26, 3.2, 0.7, 0.14, 9, { up: 2.5, flat: true }); }
  dust(pos, n = 8) { this.burst(pos, 0xb8a888, n, 1.2, 0.6, 0.3, -0.3, { flat: true, drag: 3, grow: 1.2 }); }
  /** Expanding ground ring (shockwave) */
  ring(pos, color, radius, dur = 0.5, y = 0.08, thick = 0.18) {
    const m = new THREE.Mesh(new THREE.RingGeometry(1 - thick, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, pos.y + y, pos.z); this.root.add(m);
    this.fx.push({ m, t: 0, dur, upd: (f, k) => { const s = 0.2 + k * radius; f.m.scale.set(s, s, s); f.m.material.opacity = (1 - k) * 0.9; } });
  }
  /** Arc slash in front of a creature */
  slash(pos, yaw, color, radius = 1.5, arcDeg = 120, dur = 0.22, tilt = 0, thick = 0.45) {
    const arc = (arcDeg * Math.PI) / 180;
    const g = new THREE.RingGeometry(radius * (1 - thick), radius, 24, 1, -arc / 2, arc);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const grp = new THREE.Group(); grp.position.copy(pos); grp.rotation.y = yaw; m.rotation.x = -Math.PI / 2 + tilt; m.rotation.z = Math.PI / 2; grp.add(m); this.root.add(grp);
    this.fx.push({ m: grp, mat: m.material, t: 0, dur, upd: (f, k) => { f.mat.opacity = (1 - k) * (radius > 3 ? 0.4 : 0.8); f.m.scale.setScalar(0.8 + k * 0.4); f.m.rotation.y = yaw + (k - 0.5) * 0.6; } });
  }
  /** Ground telegraph circle that fills up — returns handle */
  telegraph(pos, radius, dur, color = 0xff3050) {
    const grp = new THREE.Group(); grp.position.set(pos.x, pos.y + 0.06, pos.z);
    const edge = new THREE.Mesh(new THREE.RingGeometry(radius * 0.94, radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    edge.rotation.x = fill.rotation.x = -Math.PI / 2; grp.add(edge, fill); this.root.add(grp);
    const f = { m: grp, t: 0, dur, upd: (f, k) => { fill.scale.setScalar(Math.max(0.01, k)); fill.material.opacity = 0.18 + k * 0.25; edge.material.opacity = 0.5 + Math.sin(k * 30) * 0.3; } };
    this.fx.push(f); return f;
  }
  telegraphLine(from, yaw, length, width, dur, color = 0xff3050) {
    const grp = new THREE.Group(); grp.position.set(from.x, from.y + 0.06, from.z); grp.rotation.y = yaw;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, length), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    fill.rotation.x = -Math.PI / 2; fill.position.z = length / 2; grp.add(fill); this.root.add(grp);
    const f = { m: grp, t: 0, dur, upd: (f, k) => { fill.material.opacity = 0.15 + k * 0.35; fill.scale.x = 0.3 + k * 0.7; } };
    this.fx.push(f); return f;
  }
  beam(from, yaw, length, width, color, dur, opts = {}) {
    const grp = new THREE.Group(); grp.position.copy(from); grp.rotation.y = yaw;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.25, width * 0.25, length, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.5, width * 0.5, length, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (const c of [core, glow]) { c.rotation.x = Math.PI / 2; c.position.z = length / 2; grp.add(c); }
    this.root.add(grp);
    const f = { m: grp, t: 0, dur, upd: (f, k) => { const p = 1 + Math.sin(k * 80) * 0.12; core.scale.set(p, 1, p); glow.scale.set(p * (1 - k * 0.3), 1, p); glow.material.opacity = 0.5 * (1 - k * k); core.material.opacity = 1 - k * k; if (opts.rainbow) glow.material.color.setHSL((k * 3) % 1, 1, 0.6); if (opts.follow) { grp.position.copy(opts.follow()); grp.rotation.y = opts.followYaw(); } } };
    this.fx.push(f); return f;
  }
  /** A temporary 3D mesh with custom update */
  custom(mesh, dur, upd) { this.root.add(mesh); const f = { m: mesh, t: 0, dur, upd }; this.fx.push(f); return f; }
  kill(f) { f.t = f.dur; }
  number(pos, text, color = '#fff', big = false) { this.numbers.push({ pos: pos.clone(), text, color, big, t: 0 }); }
  clear() { this.parts.length = 0; for (const f of this.fx) this.root.remove(f.m); this.fx.length = 0; }
  update(dt) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy -= p.grav * dt; const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (const p of this.parts) {
      if (n >= MAXP) break;
      const k = p.life / p.max;
      this.P[n * 3] = p.x; this.P[n * 3 + 1] = p.y; this.P[n * 3 + 2] = p.z;
      this.C[n * 3] = p.r; this.C[n * 3 + 1] = p.g; this.C[n * 3 + 2] = p.b;
      this.S[n] = Math.max(0.001, p.size * (1 + p.grow * (1 - k))); this.A[n] = clamp(k * 1.5, 0, 1);
      n++;
    }
    const g = this.points.geometry; g.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size', 'alpha']) g.attributes[k].needsUpdate = true;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.t += dt; const k = Math.min(1, f.t / f.dur);
      f.upd?.(f, k, dt);
      if (f.t >= f.dur) { this.root.remove(f.m); f.m.traverse?.((o) => { if (o.geometry && !o.geometry._shared) o.geometry.dispose(); }); this.fx.splice(i, 1); f.done = true; }
    }
  }
}
