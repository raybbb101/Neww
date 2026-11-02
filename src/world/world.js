import * as THREE from 'three';
import { CollisionWorld } from './physics.js';
import { buildCity, districtAt, POND } from './city.js';
import { NPCs } from './npcs.js';
import { makeSky, globalUniforms, MAT, dotTexture } from '../gfx/gfx.js';
import { FOODS } from '../data/foods.js';
import { TIER_LEVEL } from '../rift/rift.js';
import { audio } from '../core/audio.js';
import { clamp, lerp, rand, pick, TAU, smooth } from '../core/utils.js';

const C = (h) => new THREE.Color(h);
const SKY = {
  day: { top: C(0x3a78d0), hor: C(0xc4e2f6), bot: C(0x8aa8b8) },
  dusk: { top: C(0x3a4a8a), hor: C(0xf4a066), bot: C(0x6a5a6a) },
  night: { top: C(0x040816), hor: C(0x16203a), bot: C(0x0a0e18) },
};

export class World {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.physics = new CollisionWorld();
    this.time = 0.33; // 0..1 day cycle (0.25 sunrise, 0.75 sunset)
    this.dayLength = 720; // seconds per full day
    this.buildLights();
    this.city = buildCity(this.scene, this.physics);
    this.grass = null; this.setGrass(game.settings.quality);
    this.npcs = new NPCs(this, this.city);
    this.npcs.onScatter = (c) => this.onScatter(c);
    this.npcs.onCarHit = (car, dir) => this.onCarHit(car, dir);
    this.npcs.onShooed = (h) => this.onShooed(h);
    for (const it of this.city.interact) { it.cd = 0; }
    this.buildMist(); this.buildShards(); this.buildCups(); this.buildBoats();
    this.promptT = 0; this.prompt = null; this.mistDismissed = new Set(); this.revealT = 0; this.feedT = 10; this.tempFood = [];
    this.ball = null; this.carry = null; this.district = '';
  }
  get player() { return this.game.player; }
  get prog() { return this.game.prog; }
  get vfx() { return this.game.vfx; }
  setGrass(q) {
    if (this.grass) { this.scene.remove(this.grass); this.grass.geometry.dispose(); this.grass = null; }
    const n = q === 'low' ? 0 : q === 'medium' ? 9000 : 22000;
    if (n) { this.grass = this.city.buildGrass(n); this.scene.add(this.grass); }
  }
  buildLights() {
    const s = this.scene;
    this.sky = makeSky(); s.add(this.sky);
    s.fog = new THREE.Fog(0xc4e2f6, 60, 420);
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6a48, 0.7); s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.4); this.sun.castShadow = true;
    const sh = this.sun.shadow; sh.mapSize.set(2048, 2048); sh.bias = -0.0004; sh.normalBias = 0.03;
    const c = sh.camera; c.left = c.bottom = -38; c.right = c.top = 38; c.near = 1; c.far = 260;
    s.add(this.sun); s.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0x9ab8ff, 0.25); this.fill.position.set(-40, 30, -60); s.add(this.fill);
    this.sunDir = new THREE.Vector3();
    for (const l of [this.hemi, this.sun, this.fill]) l.layers.enableAll();
    this.sun.shadow.camera.layers.enableAll();
  }
  setShadowQuality(q) { const m = q === 'high' ? 2048 : q === 'medium' ? 1024 : 512; this.sun.shadow.mapSize.set(m, m); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } this.sun.castShadow = q !== 'low'; }
  // ───────── Black mist ─────────
  buildMist() {
    const per = 420, zones = this.city.mist, N = per * zones.length;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
    zones.forEach((z, zi) => { for (let i = 0; i < per; i++) { const k = zi * per + i; pos[k * 3] = z.pos.x; pos[k * 3 + 1] = z.pos.y; pos[k * 3 + 2] = z.pos.z; seed[k * 4] = Math.random(); seed[k * 4 + 1] = Math.random(); seed[k * 4 + 2] = Math.random(); seed[k * 4 + 3] = zi; } });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.mistAlpha = new Float32Array(8).fill(1);
    this.mistMat = new THREE.ShaderMaterial({
      uniforms: { uTime: globalUniforms.uTime, map: { value: dotTexture() }, alpha: { value: this.mistAlpha }, scale: { value: 700 } },
      vertexShader: `attribute vec4 seed; uniform float uTime; uniform float alpha[8]; uniform float scale; varying float vA; varying float vGlint;
        void main(){
          float t = uTime*0.25 + seed.x*10.0; float h = fract(seed.y + uTime*0.06*(0.5+seed.z));
          float r = (0.4 + seed.z*3.2) * (1.0 - h*0.35);
          float a = seed.x*6.283 + t*(1.0+seed.z) + h*4.0;
          vec3 p = position + vec3(cos(a)*r, h*5.5, sin(a)*r);
          int zi = int(seed.w+0.5); float za = 0.0;
          for (int i=0;i<8;i++){ if(i==zi) za = alpha[i]; }
          vA = za * smoothstep(0.0,0.15,h) * (1.0-smoothstep(0.5,1.0,h)) * (0.3 + 0.25*(1.0-seed.z));
          vGlint = step(0.93, seed.z);
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_PointSize = (0.9 + seed.z*2.0) * (vGlint>0.5?0.25:1.0) * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying float vGlint;
        void main(){ float m = texture2D(map, gl_PointCoord).a; vec3 c = mix(vec3(0.05,0.0,0.09), vec3(0.8,0.4,1.0), vGlint); gl_FragColor = vec4(c, m*vA*(vGlint>0.5?3.0:1.0)); if(gl_FragColor.a<0.01) discard; }`,
      transparent: true, depthWrite: false,
    });
    this.mistPts = new THREE.Points(g, this.mistMat); this.mistPts.frustumCulled = false; this.scene.add(this.mistPts);
    // dark ground stains
    this.mistRings = zones.map((z) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(4.2, 32), new THREE.MeshBasicMaterial({ map: dotTexture(), color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(z.pos.x, z.pos.y + 0.03, z.pos.z); this.scene.add(m); return m;
    });
  }
  mistActive(m) { const c = this.prog.cleared?.[m.id]; return !c || Date.now() - c.at > 4 * 60 * 1000; }
  // ───────── Echo shards ─────────
  buildShards() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9af0ff, emissive: 0x40d0ff, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.2, flatShading: true });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x60e0ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
    this.shardObjs = this.city.shards.map((s) => {
      const g = new THREE.Group(); g.position.copy(s.pos);
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat); m.scale.y = 1.6; g.add(m);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 30, 8, 1, true), beamMat); beam.position.y = 15; g.add(beam);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: 0x60e0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 })); halo.scale.setScalar(1.6); g.add(halo);
      this.scene.add(g); return { s, g, m };
    });
  }
  refreshForSpecies() {
    for (const o of this.shardObjs) o.g.visible = !this.prog.shards.includes(o.s.id);
  }
  // ───────── Café cups ─────────
  buildCups() {
    const geo = new THREE.CylinderGeometry(0.06, 0.045, 0.11, 10), mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const cof = new THREE.MeshStandardMaterial({ color: 0x4a2a1a });
    this.cups = this.city.cafeCups.map((p) => {
      const m = new THREE.Mesh(geo, mat); m.position.copy(p).add(new THREE.Vector3(0, 0.055, 0)); m.castShadow = true;
      const c = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), cof); c.rotation.x = -Math.PI / 2; c.position.y = 0.05; m.add(c);
      this.scene.add(m);
      const it = { type: 'cup', pos: p.clone(), r: 0.9, label: 'Knock the cup off', icon: '☕', cup: m, home: m.position.clone(), cd: 0 };
      this.city.interact.push(it); return it;
    });
  }
  buildBoats() {
    this.boats = this.city.boats.map((b, i) => {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 8), new THREE.MeshStandardMaterial({ color: [0xe8e8e0, 0x3a6aa8, 0xc84a3a, 0x2a7a5a][i % 4], roughness: 0.6 })); hull.position.y = 0.2; hull.castShadow = true; g.add(hull);
      const bow = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.4, 4), hull.material); bow.rotation.set(Math.PI / 2, Math.PI / 4, 0); bow.scale.set(1, 1, 0.5); bow.position.set(0, 0.2, 5.1); g.add(bow);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 2.6), new THREE.MeshStandardMaterial({ color: 0xf4f0e8 })); cab.position.set(0, 1.4, -1.2); cab.castShadow = true; g.add(cab);
      g.position.set(b.x, -0.35, b.z); this.scene.add(g);
      const col = this.physics.addBox(b.x, b.z, 3.2, 8, 0.8, 'boat'); this.physics.addBox(b.x, b.z - 1.2, 2.2, 2.6, 2.1, 'boatcab');
      return { g, b, p: Math.random() * 6 };
    });
  }
  // ───────── Day / night ─────────
  updateSky(dt) {
    this.time = (this.time + dt / this.dayLength) % 1;
    const a = (this.time - 0.25) * TAU;
    const elev = Math.sin(a);
    this.sunDir.set(Math.cos(a) * 0.75, Math.max(0.08, elev), 0.45).normalize();
    const day = clamp(elev * 3.5 + 0.25, 0, 1), dusk = clamp(1 - Math.abs(elev) * 5, 0, 1) * (elev > -0.25 ? 1 : 0);
    this.daylight = day; this.night = 1 - day;
    const u = this.sky.material.uniforms;
    const mix = (k) => SKY.night[k].clone().lerp(SKY.day[k], day).lerp(SKY.dusk[k], dusk * 0.75);
    u.top.value.copy(mix('top')); u.horizon.value.copy(mix('hor')); u.bottom.value.copy(mix('bot'));
    u.sunDir.value.copy(elev > -0.1 ? this.sunDir : this.sunDir.clone().negate().setY(0.4)); u.night.value = this.night;
    u.sunColor.value.setRGB(1, 0.85 + day * 0.1, 0.7 + day * 0.25).multiplyScalar(elev > -0.1 ? 1 : 0.15);
    this.scene.fog.color.copy(u.horizon.value);
    // cat night vision
    const nv = this.player?.key === 'cat' ? this.night : 0;
    this.sun.intensity = elev > 0 ? lerp(0.4, 2.6, day) : 0.32 + nv * 0.5;
    this.sun.color.setRGB(1, lerp(0.62, 0.95, day), lerp(0.42, 0.88, day));
    if (elev <= 0) this.sun.color.setRGB(0.55, 0.65, 1);
    this.hemi.intensity = lerp(0.22, 0.75, day) + nv * 0.55;
    this.hemi.color.setRGB(lerp(0.35, 0.82, day), lerp(0.42, 0.9, day), lerp(0.7, 1, day));
    this.game.renderer.toneMappingExposure = lerp(1.0, 1.0, day) + nv * 0.35;
    const win = smooth(clamp((this.night - 0.2) * 1.6, 0, 1));
    for (const m of this.city.wallMats) m.emissiveIntensity = win * 1.3;
    MAT.lamp.emissiveIntensity = win * 3;
    for (const c of this.npcs.cars) c.head.emissiveIntensity = win * 2.5;
    this.scene.fog.near = lerp(30, 70, day); this.scene.fog.far = lerp(220, 430, day);
    audio.setAmbient(0.05 + day * 0.04, lerp(250, 450, day));
    const wantMusic = this.night > 0.6 ? 'night' : 'city';
    if (audio.musicMode !== wantMusic && (audio.musicMode === 'city' || audio.musicMode === 'night')) audio.setMusic(wantMusic);
  }
  clockText() { const h = (this.time * 24 + 0) % 24; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); const ap = hh >= 12 ? 'PM' : 'AM'; return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`; }
  // ───────── Events / progression ─────────
  event(ev, n = 1) {
    const prog = this.prog; prog.habits[ev] = (prog.habits[ev] || 0) + n;
    const habits = this.player.sp.habits;
    habits.forEach((h, i) => {
      if (h.ev !== ev) return;
      const need = h.n || 1; const key = 'h' + i;
      if (prog.habitsDone.includes(key)) return;
      if (prog.habits[ev] >= need) {
        prog.habitsDone.push(key);
        this.game.ui.toast(`🌟 Habit complete: ${h.t}`, 'good');
        audio.sfx('pickup'); this.player.mood = Math.min(100, this.player.mood + 15);
        this.game.addXP(40);
        if (prog.habitsDone.length === habits.length) { prog.sp += 1; this.game.ui.toast(`✨ All ${this.player.sp.name} habits complete! +1 Skill Point`, 'good'); }
        this.game.save();
      } else if (need > 1) this.game.ui.toast(`${h.t} (${prog.habits[ev]}/${need})`);
    });
  }
  eat(foodId, source) {
    const p = this.player, sp = p.sp;
    const [like, msg] = sp.foods[foodId] || [0];
    const F = FOODS[foodId];
    if (like === 0) { this.game.ui.toast(`${F.icon} ${msg || `A ${sp.name.toLowerCase()} isn't interested in ${F.name.toLowerCase()}.`}`); return false; }
    if (like < 0 && !(this.pendingBad && this.pendingBad.food === foodId && performance.now() - this.pendingBad.t < 4000)) {
      this.pendingBad = { food: foodId, t: performance.now() };
      this.game.ui.toast(`⚠️ ${F.icon} ${F.name}: ${msg || 'This is bad for you.'} (Interact again to eat anyway)`, 'warn');
      return false;
    }
    this.pendingBad = null;
    p.playAction(sp.rig === 'quad' ? 'bite' : 'strike', 0.4);
    audio.sfx('eat');
    const head = p.centerPos().addScaledVector(p.forward, 0.3);
    if (like === 2) {
      p.hunger = Math.min(100, p.hunger + 35); p.mood = Math.min(100, p.mood + 18); p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.15);
      this.game.ui.toast(`${F.icon} ${msg || `${F.name} — delicious!`}`, 'good'); audio.sfx('happy');
      this.vfx.number(head.clone().setY(head.y + 0.4), '❤', '#ff7aa8', true);
      if (sp.key === 'cat') setTimeout(() => audio.voice('purr'), 400);
    } else if (like === 1) {
      p.hunger = Math.min(100, p.hunger + 25); p.mood = Math.min(100, p.mood + 5);
      this.game.ui.toast(`${F.icon} ${msg || `Ate some ${F.name.toLowerCase()}.`}`);
    } else {
      p.hunger = Math.min(100, p.hunger + 10); p.mood = Math.max(0, p.mood - 18); p.hp = Math.max(1, p.hp - p.maxHp * 0.2);
      this.game.ui.toast(`🤢 ${msg || 'Your tummy hurts.'}`, 'bad'); audio.sfx('sad');
    }
    this.vfx.sparkle(head, 0xffe080, 10);
    this.event('eat:' + foodId);
    return true;
  }
  addTempFood(pos, foods, label, icon, t) { const it = { type: 'food', pos: pos.clone(), r: 1.8, foods, label, icon, cd: 0, respawn: 999, temp: t }; this.city.interact.push(it); this.tempFood.push(it); return it; }
  // ───────── Instincts ─────────
  useInstinct(p) {
    const ins = p.sp.instinct;
    if (ins.id === 'sneak') { p.crouch = !p.crouch; p.stealth = p.crouch; this.game.ui.toast(p.crouch ? '🐾 Sneaking — humans and animals barely notice you.' : 'Stopped sneaking.'); return; }
    if (ins.id === 'hide') { p.hidden = !p.hidden; p.stealth = p.hidden; this.game.ui.toast(p.hidden ? '🌿 Camouflaged. Stay still or move slowly.' : 'You stop hiding.'); return; }
    if (p.instinctCd > 0) { this.game.ui.toast(`${ins.name} recharging…`); return; }
    if (ins.id === 'sniff') {
      p.instinctCd = 8; audio.sfx('dig'); p.playAction('bite', 0.6);
      this.revealT = 8; this.revealKind = 'scent'; this.game.ui.toast('👃 You pick up scents… follow the trails!');
    } else if (ins.id === 'listen') {
      p.instinctCd = 8; this.revealT = 7; this.revealKind = 'sound'; this.vfx.ring(p.pos, 0xffffff, 40, 1.4, 0.15, 0.03);
      this.game.ui.toast('👂 Ears up — you sense everything nearby.');
    } else if (ins.id === 'sing') {
      p.instinctCd = 6; audio.voice('bird'); setTimeout(() => audio.voice('bird'), 450);
      this.vfx.number(p.centerPos().setY(p.pos.y + 0.6), '♪ ♫', '#ffe080', true);
      p.mood = Math.min(100, p.mood + 6); this.event('sing');
      for (const c of this.npcs.critters) if (c.kind === 'pigeon' && c.pos.distanceTo(p.pos) < 25) { c.lure = p.pos.clone(); c.t = 0; setTimeout(() => (c.lure = null), 9000); }
    } else if (ins.id === 'updraft') {
      p.instinctCd = 12; p.updraft = 4.5; audio.sfx('dodge'); this.vfx.burst(p.pos, 0xffffff, 30, 3, 1.2, 0.2, -4, { flat: true });
      this.game.ui.toast('🌬️ A warm updraft lifts you!');
    }
  }
  // ───────── Interaction ─────────
  findPrompt() {
    const p = this.player, sp = p.sp; let best = null, bd = 1e9;
    const pp = p.pos;
    const consider = (d, o) => { if (d < bd) { bd = d; best = o; } };
    for (const it of this.city.interact) {
      if (it.cd > 0) continue;
      const d = Math.hypot(it.pos.x - pp.x, it.pos.z - pp.z); if (d > it.r + p.radius + 0.4) continue;
      if (Math.abs(it.pos.y - pp.y) > (it.type === 'cup' ? 0.6 : 1.4) && !(p.flyingNow() && it.pos.y - pp.y < 0.5 && pp.y - it.pos.y < 2.5)) continue;
      let label = it.label, icon = it.icon;
      if (it.type === 'food') {
        if (it.carryItem) continue;
        const f = this.bestFood(it.foods); label = it.fisher && sp.key === 'cat' ? 'Beg the fisherman for a fish' : it.steal ? `${it.label}: ${FOODS[f].name}` : `${it.label}`; icon = FOODS[f].icon;
      } else if (it.type === 'cup' && sp.key !== 'cat') continue;
      else if (it.type === 'dig' && !['dog', 'rabbit'].includes(sp.key)) continue;
      else if (it.type === 'flower') { label = sp.key === 'butterfly' ? 'Sip nectar' : 'Smell the flowers'; }
      else if (it.type === 'bush' && !['rabbit', 'snake', 'cat', 'bird'].includes(sp.key)) continue;
      else if (it.type === 'bush') label = 'Hide in the bush';
      else if (it.type === 'water') label = it.bath && sp.key === 'bird' ? 'Bathe in the fountain' : sp.key === 'butterfly' ? 'Drink a droplet' : 'Drink water';
      consider(d - it.r * 0.5, { label, icon, act: () => this.interact(it) });
    }
    const h = this.npcs.nearestHuman(pp, 2.3);
    if (h && !h.react) {
      const d = Math.hypot(h.pos.x - pp.x, h.pos.z - pp.z);
      let label = sp.key === 'snake' ? 'Slither up to the human' : 'Greet the human';
      if (h.fetcher && sp.key === 'dog') label = this.carry === 'ball' ? 'Give the ball back' : 'Ask to play fetch';
      consider(d - 0.3, { label, icon: '🧑', act: () => this.greetHuman(h) });
    }
    const c = this.npcs.nearestCritter(pp, 2.0);
    if (c) {
      const d = Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z);
      let label = null;
      if (c.kind === 'mouse' && (sp.key === 'cat' || sp.key === 'snake')) label = 'Catch the mouse';
      else if (c.kind === 'butterfly' && sp.key === 'butterfly') label = 'Dance together';
      else if (c.kind === 'cat') label = sp.key === 'cat' ? 'Nose boop' : 'Approach the stray cat';
      else if (c.kind === 'pigeon' && !c.flying) label = sp.key === 'bird' ? 'Chirp at the pigeon' : null;
      else if (c.kind === 'duck' && p.swimming) label = 'Swim with the duck';
      if (label) consider(d - 0.5, { label, icon: '🐾', act: () => this.greetCritter(c) });
    }
    if (this.ball && !this.carry && sp.key === 'dog') { const d = Math.hypot(this.ball.position.x - pp.x, this.ball.position.z - pp.z); if (d < 1.4 && this.ballLanded) consider(d - 1, { label: 'Pick up the ball', icon: '🎾', act: () => this.pickBall() }); }
    return best;
  }
  bestFood(foods) { const sp = this.player.sp; let best = foods[0], bl = -9; for (const f of foods) { const l = (sp.foods[f] || [0])[0]; if (l > bl) { bl = l; best = f; } } return best; }
  interact(it) {
    const p = this.player, sp = p.sp;
    if (it.type === 'food') {
      let food = it.random ? pick(it.foods) : this.bestFood(it.foods);
      if (it.label.includes('trash') || it.label.includes('dumpster')) food = this.pendingBad?.src === it ? this.pendingBad.food : pick(it.foods);
      if (it.steal) {
        const v = it.vendor; const watching = v && v.busy <= 0 && !p.stealth && !v.react;
        if (watching && sp.key !== 'butterfly') {
          v.setReact('chase', 4); audio.sfx('scream'); this.game.ui.toast('🧑‍🍳 "Hey! Shoo, get away from my stall!" — try sneaking, or wait until the vendor looks away.', 'warn');
          return;
        }
        if (p.stealth && sp.key === 'cat') this.game.ui.toast('😼 A perfect sneaky steal!', 'good');
      }
      if (it.fisher && sp.key === 'cat') { this.game.ui.toast('🎣 The fisherman chuckles and tosses you a fish.'); audio.sfx('laugh'); const fh = this.npcs.nearestHuman(it.pos, 4, (h) => h.role === 'fisher'); fh?.setReact('throw', 1.5); }
      if (this.eat(food, it)) { it.cd = it.respawn || 60; if (it.temp) it.cd = 999; }
      else if (it.label.includes('trash') || it.label.includes('dumpster')) { if (this.pendingBad) this.pendingBad.src = it; }
    } else if (it.type === 'water') {
      p.energy = Math.min(100, p.energy + 15); p.mood = Math.min(100, p.mood + 4); audio.sfx('splash');
      this.vfx.splash(it.pos.clone().setY(it.pos.y + 0.2));
      if (it.bath && sp.key === 'bird') { this.event('bathe'); this.game.ui.toast('💦 Splish splash! A refreshing bath.', 'good'); p.mood = Math.min(100, p.mood + 12); }
      else this.game.ui.toast('💧 Refreshing!');
      it.cd = 4;
    } else if (it.type === 'flower') {
      if (sp.key === 'butterfly') {
        if (this.eat('nectar')) {
          it.cd = it.respawn;
          // pollination — the flower bed blooms
          this.vfx.sparkle(it.pos, it.color || 0xffc0e0, 26); this.vfx.burst(it.pos, 0xfff080, 16, 1.2, 1.4, 0.12, -0.6);
        }
      } else { p.mood = Math.min(100, p.mood + 3); this.game.ui.toast('🌸 Mmm, flowers smell nice.'); this.vfx.sparkle(it.pos, 0xffc0e0, 8); it.cd = 20; }
    } else if (it.type === 'cup') {
      it.cd = 90; p.playAction('swipe', 0.35); audio.sfx('knock'); this.event('knock_cup');
      const cup = it.cup, dir = new THREE.Vector3(it.pos.x - p.pos.x, 0, it.pos.z - p.pos.z).normalize();
      const v = new THREE.Vector3(dir.x * 1.6, 1.2, dir.z * 1.6); const spin = rand(5, 9);
      this.vfx.custom(new THREE.Group(), 1.2, (f, k, dt) => { if (!dt) return; v.y -= 9.8 * dt; cup.position.addScaledVector(v, dt); cup.rotation.x += spin * dt; if (cup.position.y < 0.2) { cup.position.y = 0.2; v.set(v.x * 0.3, 0, v.z * 0.3); } });
      setTimeout(() => { this.vfx.burst(cup.position, 0x6a4a2a, 10, 2, 0.5, 0.1, 6); }, 600);
      setTimeout(() => { audio.sfx('laugh'); this.game.ui.toast('😹 Gravity check: confirmed.'); }, 900);
      setTimeout(() => { cup.position.copy(it.home); cup.rotation.set(0, 0, 0); }, 90000);
    } else if (it.type === 'dig') {
      it.cd = 120; p.playAction('bite', 1.2); p.lockMove = 1.4; audio.sfx('dig'); setTimeout(() => audio.sfx('dig'), 500);
      for (let i = 0; i < 3; i++) setTimeout(() => this.vfx.dust(p.pos.clone().addScaledVector(p.forward, 0.3), 10), i * 400);
      setTimeout(() => { this.event('dig'); const f = this.bestFood(it.foods); this.game.ui.toast(`🕳️ You dug up: ${FOODS[f].icon} ${FOODS[f].name}!`, 'good'); this.eat(f); }, 1400);
    } else if (it.type === 'bush') {
      p.inBush = it; p.stealth = true; p.sit = 1; p.sitTime = 0; this.event('bush'); this.game.ui.toast('🌿 Hidden in the bush. Nobody can see you here.');
    }
  }
  greetHuman(h) {
    const p = this.player, sp = p.sp;
    audio.voice(sp.voice);
    if (sp.key === 'snake') { h.setReact('flee', 5); audio.sfx('scream'); this.event('startle'); this.game.ui.toast('😱 "AAH! A SNAKE!" — the human runs away.'); return; }
    if (sp.key === 'dog' && h.fetcher) {
      if (this.carry === 'ball') { this.carry = null; this.removeBall(); this.event('fetch'); p.mood = Math.min(100, p.mood + 20); h.setReact('pet', 3); audio.sfx('happy'); this.game.ui.toast('🎾 "Good dog!" — the best game ever.', 'good'); return; }
      h.setReact('throw', 1.2); setTimeout(() => this.throwBall(h), 500); this.game.ui.toast('🎾 "Wanna play? Go get it!"'); return;
    }
    if (sp.key === 'butterfly') { p.mood = Math.min(100, p.mood + 6); h.setReact(h.rig.child ? 'crouch' : 'crouch', 2); this.game.ui.toast(h.rig.child ? '🧒 "A butterfly! So pretty!"' : '🙂 "Oh, how beautiful."'); return; }
    if (sp.key === 'bird' && Math.random() < 0.6) { h.setReact('throw', 2); const pos = h.pos.clone().add(new THREE.Vector3(Math.sin(h.yaw) * 1.2, 0, Math.cos(h.yaw) * 1.2)); setTimeout(() => { this.vfx.burst(pos.clone().setY(pos.y + 0.8), 0xd8b070, 14, 1.5, 0.8, 0.08, 6); this.addTempFood(pos, ['seeds', 'bread'], 'Crumbs on the ground', '🍞', 30); }, 700); this.game.ui.toast('🍞 The human tosses you some crumbs.'); return; }
    h.setReact('pet', 3.2);
    setTimeout(() => {
      p.mood = Math.min(100, p.mood + 15); this.event('petted'); audio.sfx('happy');
      if (sp.key === 'cat') audio.voice('purr');
      this.vfx.number(p.centerPos().setY(p.pos.y + p.height + 0.4), '❤', '#ff7aa8', true);
      const msgs = { cat: '😽 Scritches behind the ears… purrrr.', dog: '🐶 Belly rubs! Your tail is a blur.', rabbit: '🐰 Gentle head strokes. You flop over happily.', bird: '🐦 The human holds out a careful finger.' };
      this.game.ui.toast(msgs[sp.key] || 'The human pets you.', 'good');
      if (Math.random() < 0.3) { const fav = Object.keys(sp.foods).find((f) => sp.foods[f][0] === 2); if (fav) setTimeout(() => { this.game.ui.toast(`They had a treat for you!`); this.eat(fav); }, 900); }
    }, 900);
  }
  greetCritter(c) {
    const p = this.player, sp = p.sp;
    if (c.kind === 'mouse') {
      if (c.flee > 0 || (!p.stealth && Math.random() < 0.45)) { c.scare(p.pos, 2); this.game.ui.toast('🐭 Too slow — it scurries away! (Sneak up on it.)'); return; }
      p.playAction(sp.key === 'cat' ? 'swipe' : 'strike', 0.35); p.dashVel = { x: Math.sin(p.yaw) * 4, z: Math.cos(p.yaw) * 4, t: 0.15 };
      c.hidden = true; c.hideT = 60; this.eat('mouse'); return;
    }
    if (c.kind === 'butterfly') { c.dance = 5; this.event('dance'); this.game.ui.toast('🦋 You twirl through the air together.', 'good'); p.mood = Math.min(100, p.mood + 12); return; }
    if (c.kind === 'cat') {
      if (sp.key === 'cat') { p.mood = Math.min(100, p.mood + 8); audio.voice('cat'); this.vfx.number(p.centerPos().setY(p.pos.y + 0.6), '❤', '#ff9ac0'); this.game.ui.toast('😺 Boop! The stray cat greets you back.'); }
      else if (sp.key === 'dog') { audio.voice('hiss'); c.scare(p.pos, 2); this.game.ui.toast('🙀 HISSS! The cat bolts away.'); }
      else { audio.voice('cat'); this.game.ui.toast('🐱 The cat watches you curiously.'); }
      return;
    }
    if (c.kind === 'pigeon') { audio.voice('pigeon'); this.game.ui.toast('🐦 Coo coo.'); p.mood = Math.min(100, p.mood + 3); return; }
    if (c.kind === 'duck') { audio.voice('duck'); this.game.ui.toast('🦆 Quack!'); p.mood = Math.min(100, p.mood + 4); }
  }
  throwBall(h) {
    this.removeBall();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd8f040, roughness: 0.6 })); ball.castShadow = true;
    ball.position.copy(h.pos).add(new THREE.Vector3(0, 1.5, 0)); this.scene.add(ball); this.ball = ball; this.ballLanded = false;
    const a = h.yaw + rand(-0.8, 0.8); const v = new THREE.Vector3(Math.sin(a) * 9, 6, Math.cos(a) * 9);
    this.ballVel = v; audio.sfx('swipe');
  }
  pickBall() { this.carry = 'ball'; this.ballLanded = false; this.game.ui.toast('🎾 Got it! Bring it back to the human.'); audio.sfx('pickup'); }
  removeBall() { if (this.ball) this.scene.remove(this.ball); this.ball = null; }
  onScatter(c) { const p = this.player; if (p.key === 'dog' && p.barkT > 0) this.event('scare_pigeons'); }
  onCarHit(car, dir) {
    const p = this.player; if (p.invuln > 0) return;
    p.invuln = 1.5; p.knock = dir.multiplyScalar(9); p.vel.y = 4; p.onGround = false; p.hp = Math.max(1, p.hp - p.maxHp * 0.12); p.mood = Math.max(0, p.mood - 12);
    audio.sfx('hurt'); audio.sfx('car'); this.game.camRig.addShake(0.6); this.game.ui.hurtFlash(); this.game.ui.toast('🚗 Ouch! Watch out for cars!', 'bad');
  }
  onShooed(h) { const p = this.player; p.knock = new THREE.Vector3(p.pos.x - h.pos.x, 0, p.pos.z - h.pos.z).normalize().multiplyScalar(6); p.mood = Math.max(0, p.mood - 6); audio.voice(p.sp.voice); }
  onSwim(p) { if (p.key === 'dog' || p.key === 'snake') this.event('swim'); if (p.key === 'cat') this.game.ui.toast('🙀 Water! Cats hate getting wet.', 'warn'); }
  onLand(box) {
    const p = this.player; if (!box) return;
    if (box.roof && p.key === 'cat' && box.top > 4) this.event('roof');
    if (box.tag === 'lamp' && p.key === 'bird') this.event('perch');
  }
  // ───────── Per-frame ─────────
  update(dt, input) {
    const p = this.player, game = this.game;
    globalUniforms.uTime.value += dt;
    this.updateSky(dt);
    // city "call" action: meow / bark / chirp — scares nearby critters
    if (input.hit('atk1') || input.hit('voice')) {
      audio.voice(p.sp.voice); p.playAction(p.key === 'dog' ? 'roar' : p.key === 'cat' ? 'roar' : 'bite', 0.4);
      if (p.key === 'dog') p.barkT = 1.5;
      let scared = 0;
      for (const c of this.npcs.critters) if (c.pos.distanceTo(p.pos) < (p.key === 'dog' ? 9 : 5) && c.kind !== 'butterfly' && c.scare(p.pos, 1)) scared++;
      if (scared && p.key === 'dog') this.event('scare_pigeons');
      p.crouch = false; if (p.key !== 'snake') p.stealth = p.crouch;
    }
    p.barkT = (p.barkT || 0) - dt;
    if (p.inBush && (p.speed > 0.5 || p.pos.distanceTo(p.inBush.pos) > 1.8)) { p.inBush = null; p.stealth = p.crouch || p.hidden; }
    if (p.hidden && p.speed > 2.5) { p.hidden = false; p.stealth = false; game.ui.toast('You were spotted moving fast.'); }
    p.update(dt, input, game.camRig.yaw, this.physics);
    p.onLand ||= (b) => this.onLand(b);
    // fall out of world safety
    if (p.pos.y < -10) p.teleport(this.city.spawn.clone());
    // napping in a sunny spot
    if (p.sit && p.sitTime > 2.2) {
      const sunny = this.daylight > 0.5 && this.city.sunSpots.find((s) => s.pos.distanceTo(p.pos) < s.r + 0.6);
      if (sunny && !p.napLogged && p.sitTime > 4) { p.napLogged = true; this.event('nap_sun'); p.mood = Math.min(100, p.mood + 20); game.ui.toast(`☀️ ${sunny.label}: a perfect warm nap.`, 'good'); }
      if (sunny) p.energy = Math.min(100, p.energy + dt * 10);
    } else p.napLogged = false;
    // fly above the tallest tower
    if ((p.key === 'bird' || p.key === 'butterfly') && p.pos.y > this.city.tallest + 2 && !this.prog.habits.fly_high) { this.event('fly_high'); this.game.ui.toast('🏙️ The whole city is below you!', 'good'); }
    // district discovery
    const d = districtAt(p.pos.x, p.pos.z);
    if (d !== this.district) { this.district = d; game.ui.district(d); if (!this.prog.discovered.includes(d)) { this.prog.discovered.push(d); game.ui.toast(`🗺️ Discovered: ${d}`, 'good'); game.addXP(15); } }
    // interactables cooldowns + temp food
    for (const it of this.city.interact) if (it.cd > 0) it.cd -= dt;
    for (let i = this.tempFood.length - 1; i >= 0; i--) { const t = this.tempFood[i]; t.temp -= dt; if (t.temp <= 0) { this.tempFood.splice(i, 1); const k = this.city.interact.indexOf(t); if (k >= 0) this.city.interact.splice(k, 1); } }
    // plaza feeder throws seeds periodically
    this.feedT -= dt;
    if (this.feedT <= 0 && this.npcs.feeder) {
      this.feedT = 28; const h = this.npcs.feeder; h.setReact('throw', 2.5);
      const pos = h.pos.clone().add(new THREE.Vector3(Math.sin(h.yaw) * 2, 0, Math.cos(h.yaw) * 2));
      setTimeout(() => { this.vfx.burst(pos.clone().setY(pos.y + 0.6), 0xd8b070, 20, 2, 0.9, 0.07, 6); this.addTempFood(pos, ['seeds', 'bread'], 'Scattered seeds', '🌻', 22); for (const c of this.npcs.critters) if (c.kind === 'pigeon' && c.pos.distanceTo(pos) < 20) { c.lure = pos; c.t = 0; setTimeout(() => (c.lure = null), 15000); } }, 900);
    }
    // ball physics
    if (this.ball && !this.carry && !this.ballLanded) {
      this.ballVel.y -= 18 * dt; this.ball.position.addScaledVector(this.ballVel, dt);
      const g = this.physics.groundAt(this.ball.position.x, this.ball.position.z, this.ball.position.y, 0.1, 0.3) + 0.1;
      this.physics.resolve(this.ball.position, 0.1, this.ball.position.y, 0.2, 0.2);
      if (this.ball.position.y <= g) { this.ball.position.y = g; if (Math.abs(this.ballVel.y) > 2) { this.ballVel.y *= -0.45; this.ballVel.x *= 0.7; this.ballVel.z *= 0.7; } else this.ballLanded = true; }
    }
    if (this.carry === 'ball' && this.ball) { this.ball.position.copy(p.centerPos().addScaledVector(p.forward, p.radius + 0.25)); }
    this.npcs.update(dt, p);
    // mist proximity
    let ai = 0;
    for (let i = 0; i < this.city.mist.length; i++) {
      const m = this.city.mist[i]; const act = this.mistActive(m);
      this.mistAlpha[i] += ((act ? 1 : 0) - this.mistAlpha[i]) * Math.min(1, dt * 2);
      this.mistRings[i].material.opacity = 0.85 * this.mistAlpha[i];
      if (!act) continue; ai++;
      const d = Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
      if (d > 9) this.mistDismissed.delete(m.id);
      if (d < 4.5 && !this.mistDismissed.has(m.id) && !game.ui.modalOpen) {
        this.mistDismissed.add(m.id); audio.sfx('mist');
        const rec = TIER_LEVEL[m.tier]; const lv = this.prog.level;
        const warn = lv < rec ? `<p class="warnText">⚠ Recommended level ${rec}. You are level ${lv}.</p>` : `<p>Recommended level ${rec}.</p>`;
        game.ui.confirm(`<div class="mistIcon"></div><h2>${m.name}</h2><p>A black mist only the chosen can see. Something from another world writhes inside…</p><p class="tier">${'◆'.repeat(m.tier)}${'◇'.repeat(5 - m.tier)}  Tier ${m.tier}${m.tier === 5 ? ' — BOSS' : ''}</p>${warn}<p>Do you want to challenge it?</p>`, 'Enter the Mist', 'Not now', (yes) => { if (yes) game.enterRift(m); });
      }
    }
    // shards
    for (const o of this.shardObjs) {
      if (!o.g.visible) continue;
      o.m.rotation.y += dt * 1.6; o.g.position.y = o.s.pos.y + Math.sin(globalUniforms.uTime.value * 2 + o.s.pos.x) * 0.12;
      if (o.g.position.distanceTo(p.centerPos()) < 1.0 + p.radius) {
        o.g.visible = false; this.prog.shards.push(o.s.id); this.prog.sp += 1;
        audio.sfx('shard'); this.vfx.burst(o.g.position, 0x80e8ff, 50, 4, 1.2, 0.25, -1, { vary: true }); this.vfx.ring(p.pos, 0x80e8ff, 4, 0.8);
        game.ui.toast(`💎 Echo Shard found! (${this.prog.shards.length}/${this.city.shards.length}) +1 Skill Point — open Abilities (I) to learn a new skill.`, 'good');
        if (this.prog.shards.length === 1) setTimeout(() => game.ui.story('The shard hums with a memory of the old world. Echo Shards hold the power the mist is trying to steal — gather them to grow stronger.'), 1200);
        game.save();
      }
    }
    // reveal (sniff / listen)
    if (this.revealT > 0) {
      this.revealT -= dt;
      const targets = [];
      for (const it of this.city.interact) if (it.type === 'food' && it.cd <= 0 && it.pos.distanceTo(p.pos) < 55) { const best = this.bestFood(it.foods); if ((p.sp.foods[best] || [0])[0] >= 1) targets.push({ pos: it.pos, c: 0x9aff70 }); }
      for (const o of this.shardObjs) if (o.g.visible && o.g.position.distanceTo(p.pos) < 90) targets.push({ pos: o.g.position, c: 0x60e8ff });
      if (this.revealKind === 'sound') for (const c of this.npcs.critters) if (!c.hidden && c.pos.distanceTo(p.pos) < 40) targets.push({ pos: c.pos, c: 0xffd070 });
      for (const t of targets.slice(0, 26)) {
        if (this.revealKind === 'scent') {
          if (Math.random() < dt * 6) { const k = Math.random(); const q = p.pos.clone().lerp(t.pos, k); q.y = lerp(p.pos.y, t.pos.y, k) + 0.3 + Math.sin(k * 20 + globalUniforms.uTime.value * 3) * 0.1; this.vfx.trail(q, t.c, 0.25, 1.2); }
        } else if (Math.random() < dt * 3) this.vfx.trail(t.pos.clone().setY(t.pos.y + 0.8), t.c, 0.5, 0.8);
      }
    }
    // HD-2D ambience: drifting light motes by day, fireflies at night
    this.moteT = (this.moteT || 0) - dt;
    if (this.moteT <= 0) {
      this.moteT = 0.12;
      const night = this.night > 0.6, a = Math.random() * TAU, r = 3 + Math.random() * 12;
      const q = new THREE.Vector3(p.pos.x + Math.cos(a) * r, p.pos.y + 0.3 + Math.random() * 3.5, p.pos.z + Math.sin(a) * r);
      const c = new THREE.Color(night ? 0xc8ff70 : 0xffe6a0);
      this.vfx.emit({ x: q.x, y: q.y, z: q.z, vx: (Math.random() - 0.5) * 0.3, vy: 0.08 + Math.random() * 0.15, vz: (Math.random() - 0.5) * 0.3, life: 4, max: 4, size: night ? 0.16 : 0.09, r: c.r * (night ? 1 : 0.7), g: c.g * (night ? 1 : 0.7), b: c.b * (night ? 1 : 0.7), grav: 0, drag: 0.2, grow: 0 });
    }
    // boats bob
    for (const b of this.boats) { b.p += dt; b.g.position.y = -0.35 + Math.sin(b.p * 0.9) * 0.08; b.g.rotation.z = Math.sin(b.p * 0.7) * 0.03; b.g.rotation.x = Math.sin(b.p * 0.5) * 0.02; }
    // water texture flow
    this.city.waterNormal.offset.x += dt * 0.01; this.city.waterNormal.offset.y += dt * 0.006;
    // shadow follows player (texel snapped)
    const sd = this.sunDir; const t = p.pos;
    const snap = 76 / this.sun.shadow.mapSize.x;
    const tx = Math.round(t.x / snap) * snap, tz = Math.round(t.z / snap) * snap;
    this.sun.position.set(tx + sd.x * 120, t.y + sd.y * 120, tz + sd.z * 120); this.sun.target.position.set(tx, t.y, tz);
    if (this.night > 0.75) { this.sun.position.set(tx - sd.x * 120, t.y + 100, tz - sd.z * 120); }
    // camera
    game.camRig.update(dt, input, p, this.physics, {});
    // interaction prompt
    this.promptT -= dt;
    if (this.promptT <= 0) { this.promptT = 0.12; this.prompt = game.ui.modalOpen ? null : this.findPrompt(); game.ui.setPrompt(this.prompt); }
    if (input.hit('interact') && this.prompt) { this.prompt.act(); this.promptT = 0; }
  }
}
