import * as THREE from 'three';
import { Input, isTouch } from './core/input.js';
import { audio } from './core/audio.js';
import { initMaterials, blobShadow } from './gfx/gfx.js';
import { VFX } from './gfx/vfx.js';
import { CameraRig } from './game/camera.js';
import { Player } from './game/player.js';
import { World } from './world/world.js';
import { Rift } from './rift/rift.js';
import { UI } from './ui/ui.js';
import { SPECIES } from './data/species.js';
import { FOODS } from './data/foods.js';
import { ABILITIES } from './data/abilities.js';
import { buildCreature, defaultAnimState } from './models/creatures.js';
import { clamp } from './core/utils.js';

const SAVE_KEY = 'mistwalkers_save_v1';
const DEFAULT_SETTINGS = { quality: isTouch ? 'medium' : 'high', camMode: 'free', sens: 1, music: 0.45, sfx: 0.8, fps: false };

class Game {
  constructor() {
    this.canvas = document.getElementById('c');
    this.loadSave();
    const q = this.settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: q !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 1600);
    this.input = new Input(this.canvas); this.input.wantPointerLock = !isTouch;
    this.input.onPointerLockChange = (locked) => { if (!locked && (this.state === 'city' || this.state === 'rift') && !this.ui.modalOpen) this.ui.openPause(); };
    this.camRig = new CameraRig(this.camera);
    this.vfx = new VFX();
    this.ui = new UI(this);
    this.state = 'loading'; this.timeScale = 1; this.hitT = 0;
    this.previewYaw = 0;
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    this.clock = new THREE.Clock(); this.fpsT = 0; this.fpsN = 0;
    this.applySettings(true);
    initMaterials();
    this.boot();
  }
  async boot() {
    this.ui.showScreen(`<div class="loading"><div class="logo"><span class="l1">MIST</span><span class="l2">WALKERS</span></div><div class="spinner"></div><p>Building the city…</p></div>`, 'title');
    await new Promise((r) => setTimeout(r, 50));
    this.world = new World(this);
    this.world.setShadowQuality(this.settings.quality);
    this.vfx.attach(this.world.scene);
    this.rift = new Rift(this);
    // warm up shaders
    this.buildPreview();
    this.renderer.compile(this.world.scene, this.camera);
    this.loop();
    this.toTitle();
  }
  // ───────── Save ─────────
  loadSave() {
    let s = null; try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (_) {}
    this.saveData = s || { species: {}, last: { key: 'cat', coat: 0 } };
    this.settings = { ...DEFAULT_SETTINGS, ...(this.saveData.settings || {}) };
  }
  progFor(key) {
    const sd = this.saveData.species;
    if (!sd[key]) {
      const A = SPECIES[key].abilities;
      sd[key] = { level: 1, xp: 0, sp: 0, unlocked: [A.normal[0], A.skill[0], A.ult[0]], equipped: { normal: [A.normal[0], null], skill: [A.skill[0], null, null], ult: [A.ult[0], null] }, shards: [], habits: {}, habitsDone: [], cleared: {}, discovered: [], coat: 0, pos: null, intro: false };
    }
    return sd[key];
  }
  save() {
    try {
      if (this.player && this.state === 'city') { this.prog.pos = [this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.yaw]; this.prog.needs = [this.player.hunger, this.player.energy, this.player.mood, this.player.hp]; }
      this.saveData.settings = this.settings; this.saveData.time = this.world?.time;
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.saveData));
    } catch (_) {}
  }
  saveSettings() { this.save(); }
  applySettings(initial) {
    const S = this.settings;
    audio.setMusicVolume(S.music); audio.setVolume(S.sfx);
    this.input.lookSensitivity = S.sens;
    const pr = Math.min(window.devicePixelRatio || 1, S.quality === 'high' ? 2 : S.quality === 'medium' ? 1.4 : 1);
    this.renderer.setPixelRatio(pr); this.onResize();
    this.renderer.shadowMap.enabled = S.quality !== 'low';
    if (!initial && this.world) { this.world.setGrass(S.quality); this.world.setShadowQuality(S.quality); this.renderer.shadowMap.needsUpdate = true; }
    if (this.camRig.mode !== S.camMode) this.camRig.setMode(S.camMode);
    document.getElementById('fps').style.display = S.fps ? 'block' : 'none';
  }
  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vfx.setViewport(h * this.renderer.getPixelRatio());
    if (this.world) this.world.mistMat.uniforms.scale.value = h * this.renderer.getPixelRatio() * 0.9;
  }
  // ───────── Flow ─────────
  toTitle() {
    this.state = 'title'; this.ui.showHUD(false); this.cleanupPlayer();
    audio.setMusic('menu');
    this.ui.title(() => this.toSelect());
  }
  toSelect() {
    this.cleanupPlayer(); this.ui.showHUD(false); this.state = 'select';
    this.sel = { key: this.saveData.last.key || 'cat', coat: this.progFor(this.saveData.last.key || 'cat').coat || 0 };
    this.setPreview();
    this.ui.select(this.sel, () => this.setPreview(), () => this.startGame());
  }
  buildPreview() {
    const s = new THREE.Scene(); this.preview = s;
    s.background = null;
    s.add(new THREE.HemisphereLight(0xfff4e0, 0x404860, 1.2));
    const k = new THREE.DirectionalLight(0xffffff, 2.2); k.position.set(2, 4, 3); k.castShadow = true; k.shadow.mapSize.set(1024, 1024); s.add(k);
    const r = new THREE.DirectionalLight(0x80c0ff, 1.2); r.position.set(-3, 2, -3); s.add(r);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.25, 48), new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.6 }));
    ped.position.y = -0.125; ped.receiveShadow = true; s.add(ped); this.ped = ped;
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.02, 48), new THREE.MeshStandardMaterial({ color: 0x5a9a48, roughness: 1 })); grass.position.y = 0.005; grass.receiveShadow = true; ped.add(grass); grass.position.y = 0.13;
    this.previewCam = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  }
  setPreview() {
    if (this.previewRig) { this.preview.remove(this.previewRig.root); this.previewRig.worldObjects?.forEach((o) => this.preview.remove(o)); }
    const sp = SPECIES[this.sel.key];
    const rig = buildCreature(this.sel.key, sp, sp.coats[this.sel.coat]);
    rig.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.preview.add(rig.root); rig.worldObjects?.forEach((o) => this.preview.add(o));
    rig.reset?.();
    this.previewRig = rig; this.previewAnim = defaultAnimState();
    this.previewAnim.flying = sp.rig === 'butterfly'; this.previewAnim.mood = 0.8;
    const size = { cat: 1, dog: 1.5, rabbit: 0.85, bird: 0.55, snake: 1.6, butterfly: 0.32 }[this.sel.key];
    this.previewSize = size; this.ped.scale.set(size * 0.55, 1, size * 0.55);
  }
  startGame() {
    const key = this.sel.key; const prog = this.progFor(key); prog.coat = this.sel.coat;
    this.saveData.last = { key, coat: this.sel.coat };
    this.prog = prog;
    if (this.saveData.time != null) this.world.time = this.saveData.time;
    this.ui.hideScreen();
    this.player = new Player(this, key, this.sel.coat, prog);
    this.player.addTo(this.world.scene);
    const sp = this.world.city.spawn.clone();
    if (prog.pos) this.player.teleport(new THREE.Vector3(prog.pos[0], prog.pos[1], prog.pos[2]), prog.pos[3]);
    else this.player.teleport(sp, Math.PI);
    if (prog.needs) [this.player.hunger, this.player.energy, this.player.mood, this.player.hp] = prog.needs;
    if (key === 'butterfly' || key === 'bird') this.player.pos.y = Math.max(this.player.pos.y, 0.6);
    this.camRig.snapBehind(this.player); this.camRig.setMode(this.settings.camMode);
    this.world.refreshForSpecies();
    this.state = 'city'; this.ui.showHUD(true); this.ui.buildAbilityBar();
    audio.setMusic(this.world.night > 0.6 ? 'night' : 'city');
    this.ui.district(this.world.district || 'Central Park');
    if (!prog.intro) {
      prog.intro = true;
      const sp2 = SPECIES[key];
      this.ui.story(`One night, a seam tore open above the city and a <b>black mist</b> began to seep out. Humans can't see it. Most animals can't either.<br><br>But you can.<br><br>Live your life as a ${sp2.name.toLowerCase()} — explore, eat, nap, make friends. And when you're ready, step into the mist and fight what's hiding inside.<br><br><small>${isTouch ? 'Left side: move · Right side: look · Buttons: jump, interact, instinct.' : 'Click the game to control the camera. WASD to move, Space to jump, E to interact, F for your instinct.'}</small>`, `${sp2.emoji} You are a ${sp2.name}`);
    }
    this.save();
  }
  cleanupPlayer() {
    if (this.player) { this.player.removeFrom(this.world.scene); this.player.removeFrom(this.rift.scene); this.player = null; }
  }
  loadout() { return this.prog.equipped; }
  autoEquip(id) { const a = ABILITIES[id], arr = this.prog.equipped[a.slot]; if (arr.includes(id)) return; const free = arr.indexOf(null); if (free >= 0) arr[free] = id; this.refreshControls(); }
  refreshControls() { if (this.state === 'city' || this.state === 'rift') { this.ui.buildAbilityBar(); if (isTouch) this.ui.buildTouch(); } }
  foodName(f) { return `${FOODS[f].icon} ${FOODS[f].name}`; }
  xpNeed(lv) { return 80 + 55 * (lv - 1); }
  addXP(n) {
    const prog = this.prog; let levels = 0; prog.xp += n;
    while (prog.level < 20 && prog.xp >= this.xpNeed(prog.level)) { prog.xp -= this.xpNeed(prog.level); prog.level++; prog.sp++; levels++; }
    if (levels) {
      this.player.recalcStats(); this.player.hp = this.player.maxHp; audio.sfx('levelup');
      this.ui.toast(`🎉 Level ${prog.level}! +${levels} Skill Point${levels > 1 ? 's' : ''} — press I to learn abilities.`, 'good');
      this.vfx.burst(this.player.centerPos(), 0xffe080, 50, 4, 1.2, 0.25, -2, { vary: true });
    }
    return levels;
  }
  hitstop(t) { this.hitT = Math.max(this.hitT, t); }
  enterRift(mist) {
    if (this.state !== 'city') return;
    this.state = 'transition'; this.input.clearAll();
    audio.sfx('portal'); this.ui.fade(true, true); this.ui.setPrompt(null);
    this.returnPos = this.player.pos.clone(); this.returnYaw = this.player.yaw;
    setTimeout(() => {
      this.player.removeFrom(this.world.scene);
      this.save();
      this.rift.enter(mist);
      this.state = 'rift'; this.ui.buildAbilityBar(); this.ui.showHUD(true);
      setTimeout(() => this.ui.fade(false), 200);
    }, 900);
  }
  exitRift(win, xp) {
    this.state = 'transition'; this.ui.fade(true, true);
    setTimeout(() => {
      this.rift.exit(); this.ui.clearEnemyBars();
      const p = this.player; p.mode = 'city'; p.buffs = []; p.cds = {}; p.shield = 0; p.burrowed = 0; p.dashVel = null; p.knock = null;
      p.addTo(this.world.scene); this.vfx.clear(); this.vfx.attach(this.world.scene);
      const m = this.rift.mist;
      const back = this.returnPos.clone().add(new THREE.Vector3(m.pos.x - this.returnPos.x, 0, m.pos.z - this.returnPos.z).normalize().multiplyScalar(-3));
      back.y = this.returnPos.y;
      p.teleport(back, this.returnYaw + Math.PI); p.flying = p.sp.rig === 'butterfly';
      if (!win) p.hp = Math.max(p.hp, p.maxHp * 0.5); else p.hp = Math.max(p.hp, p.maxHp * 0.6);
      let first = false;
      if (win) { const c = this.prog.cleared[m.id]; first = !c; this.prog.cleared[m.id] = { at: Date.now(), n: (c?.n || 0) + 1 }; if (first) this.prog.sp += 1; p.mood = Math.min(100, p.mood + 15); }
      this.world.mistDismissed.add(m.id);
      const levels = this.addXP(xp);
      this.state = 'city'; this.camRig.snapBehind(p); this.ui.showHUD(true); this.ui.buildAbilityBar();
      audio.setMusic(this.world.night > 0.6 ? 'night' : 'city');
      this.ui.fade(false);
      this.ui.results(win, xp, levels, first && win);
      this.save();
    }, 900);
  }
  // ───────── Loop ─────────
  loop() {
    requestAnimationFrame(() => this.loop());
    let dt = Math.min(this.clock.getDelta(), 0.05);
    const realDt = dt;
    if (this.hitT > 0) { this.hitT -= dt; dt *= 0.08; }
    const inp = this.input; inp.sample();
    // global hotkeys
    if (this.state === 'city' || this.state === 'rift') {
      if (inp.hit('pause')) this.ui.openPause();
      if (inp.hit('map')) { if (this.ui.modalOpen) this.ui.closeModal(); else this.ui.openMap(); }
      if (inp.hit('abilities') && !this.ui.modalOpen) this.ui.openAbilities();
      if (inp.hit('journal') && !this.ui.modalOpen) this.ui.openJournal();
      if (inp.hit('camMode')) { this.settings.camMode = this.settings.camMode === 'free' ? 'iso' : 'free'; this.camRig.setMode(this.settings.camMode); this.ui.toast(this.settings.camMode === 'iso' ? '🎥 2.5D camera' : '🎥 Free 3D camera'); this.saveSettings(); }
    }
    inp.enabled = !this.ui.modalOpen;
    const paused = this.ui.modalOpen;
    if (this.state === 'city') { if (!paused) { this.world.update(dt, inp); this.vfx.update(dt); } this.ui.update(paused ? 0 : realDt); this.renderer.render(this.world.scene, this.camera); this.autosave(realDt); }
    else if (this.state === 'rift') { if (!paused) { this.rift.update(dt, inp); this.vfx.update(dt); } this.ui.update(paused ? 0 : realDt); this.renderer.render(this.rift.scene, this.camera); }
    else if (this.state === 'select' || this.state === 'title' || this.state === 'loading') this.renderMenu(realDt);
    else if (this.state === 'transition') { const sc = this.rift.done || !this.player || this.player.mode === 'city' ? this.world.scene : this.rift.scene; this.vfx.update(dt); this.renderer.render(this.player?.mode === 'rift' ? this.rift.scene : this.world.scene, this.camera); }
    audio.update();
    inp.endFrame();
    if (this.settings.fps) { this.fpsN++; this.fpsT += realDt; if (this.fpsT > 0.5) { document.getElementById('fps').textContent = Math.round(this.fpsN / this.fpsT) + ' fps'; this.fpsN = 0; this.fpsT = 0; } }
  }
  autosave(dt) { this.saveT = (this.saveT || 0) + dt; if (this.saveT > 15) { this.saveT = 0; this.save(); } }
  renderMenu(dt) {
    if (!this.world) return;
    // slow cinematic orbit around the city behind the menu
    const t = performance.now() * 0.00004;
    this.world.updateSky(0);
    const cx = -60 + Math.cos(t) * 90, cz = -60 + Math.sin(t) * 90;
    this.camera.position.set(cx, 34, cz); this.camera.lookAt(-30, 0, -40);
    this.camera.fov = 55; this.camera.updateProjectionMatrix();
    this.world.sun.position.set(-30 + this.world.sunDir.x * 120, this.world.sunDir.y * 120, -40 + this.world.sunDir.z * 120); this.world.sun.target.position.set(-30, 0, -40);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.world.scene, this.camera);
    if (this.state === 'select' && this.previewRig) {
      const W = window.innerWidth, H = window.innerHeight;
      const mobile = W < 820 && H > W;
      let vx, vy, vw, vh;
      if (mobile) { vw = W; vh = H * 0.34; vx = 0; vy = H - H * 0.07 - vh; } // GL origin is bottom-left
      else { vw = W * 0.42; vh = H * 0.8; vx = W * 0.29; vy = H * 0.1; }
      this.renderer.setViewport(vx, vy, vw, vh); this.renderer.setScissor(vx, vy, vw, vh); this.renderer.setScissorTest(true);
      const r = this.previewRig, a = this.previewAnim;
      this.previewYaw += dt * 0.35;
      r.root.rotation.y = this.previewYaw;
      a.speed = 0; a.flying = this.sel.key === 'butterfly';
      if (this.sel.key === 'butterfly') r.root.position.y = 0.35 + Math.sin(performance.now() * 0.002) * 0.04;
      if (r.worldObjects) { a.speed = 0.8; const yaw = this.previewYaw; const pos = new THREE.Vector3(Math.sin(yaw) * 0.35, 0, Math.cos(yaw) * 0.35); r.update(dt, a, pos, yaw + Math.PI / 2); }
      else r.update(dt, a);
      const s = this.previewSize;
      this.previewCam.aspect = vw / vh; this.previewCam.position.set(0, 0.55 * s, 2.2 * s); this.previewCam.lookAt(0, 0.2 * s, 0); this.previewCam.updateProjectionMatrix();
      this.renderer.autoClear = false; this.renderer.clearDepth();
      this.renderer.render(this.preview, this.previewCam);
      this.renderer.autoClear = true;
      this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, W, H);
    }
  }
}
window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) window.game?.save(); });
window.addEventListener('pagehide', () => window.game?.save());
