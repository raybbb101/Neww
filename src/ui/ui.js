import * as THREE from 'three';
import { SPECIES, SPECIES_ORDER } from '../data/species.js';
import { ABILITIES } from '../data/abilities.js';
import { isTouch } from '../core/input.js';
import { audio } from '../core/audio.js';
import { clamp } from '../core/utils.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export class UI {
  constructor(game) {
    this.game = game; this.root = $('#ui'); this.modalOpen = false; this.toasts = []; this.nums = [];
    this.root.innerHTML = `
      <div id="hud" class="hidden">
        <div id="status">
          <div class="portrait"><span id="pEmoji"></span><b id="pLv">1</b></div>
          <div class="bars">
            <div class="nameRow"><span id="pName"></span><span id="pMoodTag"></span></div>
            <div class="bar hp"><i></i><em></em><span></span></div>
            <div class="bar en"><i></i><span></span></div>
            <div class="needs"><span id="nHunger" title="Hunger">🍖 <b></b></span><span id="nMood" title="Mood">😊 <b></b></span><span id="nXP" title="Experience">⭐ <b></b></span></div>
          </div>
        </div>
        <div id="topRight">
          <div id="clock"></div>
          <canvas id="minimap" width="168" height="168"></canvas>
          <div class="trBtns"><button id="btnMap" title="Map (M)">🗺️</button><button id="btnFs" title="Fullscreen">⛶</button><button id="btnMenu" title="Menu (Esc)">☰</button></div>
        </div>
        <div id="district"></div>
        <div id="buffs"></div>
        <div id="prompt"><kbd>E</kbd><span class="pi"></span><span class="pl"></span></div>
        <div id="abilityBar"></div>
        <div id="spirit"><i></i><span>SPIRIT</span></div>
        <div id="bossBar"><span></span><div><i></i></div></div>
        <div id="hints"></div>
      </div>
      <div id="touch" class="hidden">
        <div id="joy"><div id="joyKnob"></div></div>
        <div id="tBtns"></div>
      </div>
      <div id="nums"></div>
      <div id="toasts"></div>
      <div id="banner"></div>
      <div id="flash"></div>
      <div id="modal" class="hidden"><div class="card"></div></div>
      <div id="screen" class="hidden"></div>
      <div id="fade"></div>
    `;
    this.hud = $('#hud'); this.mm = $('#minimap'); this.mmCtx = this.mm.getContext('2d');
    $('#btnFs').onclick = () => this.toggleFullscreen();
    $('#btnMenu').onclick = () => this.openPause();
    $('#btnMap').onclick = () => this.openMap();
    this.enemyBars = new Map();
    document.addEventListener('fullscreenchange', () => this.game.onResize());
  }
  // ───────── Fullscreen ─────────
  async toggleFullscreen() {
    const d = document, e = d.documentElement;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) { await (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
      const req = e.requestFullscreen || e.webkitRequestFullscreen;
      if (req) { await req.call(e, { navigationUI: 'hide' }); try { await screen.orientation?.lock?.('landscape'); } catch (_) {} }
      else this.toast('📱 On iPhone: tap Share → "Add to Home Screen" to play fullscreen.', 'warn');
    } catch (err) { this.toast('Fullscreen not available here — try the browser menu.', 'warn'); }
    audio.sfx('ui');
  }
  // ───────── Screens ─────────
  showScreen(html, cls = '') { const s = $('#screen'); s.className = cls; s.innerHTML = html; s.classList.remove('hidden'); return s; }
  hideScreen() { $('#screen').classList.add('hidden'); $('#screen').innerHTML = ''; }
  title(onPlay) {
    const s = this.showScreen(`
      <div class="titleWrap">
        <div class="logo"><span class="l1">MIST</span><span class="l2">WALKERS</span></div>
        <div class="tag">A city adventure for the small and the brave</div>
        <button class="big" id="play">▶ Play</button>
        <div class="row"><button id="tFs">⛶ Fullscreen</button><button id="tSet">⚙ Settings</button></div>
        <div class="foot">${isTouch ? 'Tip: play fullscreen in landscape for the best experience.' : 'WASD move · Mouse look · Space jump · E interact · Shift sprint · F instinct'}</div>
      </div>`, 'title');
    $('#play', s).onclick = () => { audio.init(); audio.sfx('ui'); onPlay(); };
    $('#tFs', s).onclick = () => { audio.init(); this.toggleFullscreen(); };
    $('#tSet', s).onclick = () => { audio.init(); this.openSettings(true); };
  }
  select(state, onChange, onStart) {
    const g = this.game;
    const s = this.showScreen(`
      <div class="selWrap">
        <div class="selHead"><button id="selBack">←</button><h1>Choose your creature</h1></div>
        <div class="selGrid">${SPECIES_ORDER.map((k) => `<button class="sp" data-k="${k}"><span class="e">${SPECIES[k].emoji}</span><span>${SPECIES[k].name}</span><small>${SPECIES[k].group}</small><em class="lv"></em></button>`).join('')}</div>
        <div class="selInfo">
          <h2 id="sName"></h2><div id="sGroup" class="group"></div>
          <p id="sBlurb"></p>
          <ul id="sTraits"></ul>
          <div id="sStats"></div>
          <div class="coats"><span>Coat</span><div id="sCoats"></div></div>
          <button class="big" id="sStart">Start Adventure</button>
        </div>
        <div class="selHint">Drag to rotate</div>
      </div>`, 'select');
    const render = () => {
      const sp = SPECIES[state.key];
      $('#sName', s).textContent = `${sp.emoji} ${sp.name}`; $('#sGroup', s).textContent = sp.group;
      $('#sBlurb', s).textContent = sp.blurb;
      $('#sTraits', s).innerHTML = sp.traits.map((t) => `<li>${t}</li>`).join('');
      const st = sp.stats; const M = sp.move;
      const bar = (n, v, max) => `<div class="stat"><span>${n}</span><div><i style="width:${clamp((v / max) * 100, 5, 100)}%"></i></div></div>`;
      $('#sStats', s).innerHTML = bar('Health', st.hp, 140) + bar('Power', st.atk, 11.5) + bar('Speed', M.flySprint || M.sprint, 15) + bar('Jump', M.chargeJump || M.jump || (M.fly ? 12 : 0), 12) + bar('Toughness', st.def * 100 + 5, 20);
      $('#sCoats', s).innerHTML = sp.coats.map((c, i) => `<button class="coat ${i === state.coat ? 'on' : ''}" data-i="${i}" title="${c.name}" style="background:linear-gradient(135deg,#${new THREE.Color(c.base).getHexString()} 55%,#${new THREE.Color(c.belly).getHexString()} 56%)"></button>`).join('') + `<em>${sp.coats[state.coat].name}</em>`;
      s.querySelectorAll('.coat').forEach((b) => (b.onclick = () => { state.coat = +b.dataset.i; audio.sfx('ui'); render(); onChange(); }));
      s.querySelectorAll('.sp').forEach((b) => { b.classList.toggle('on', b.dataset.k === state.key); const pr = g.progFor(b.dataset.k); b.querySelector('.lv').textContent = pr.level > 1 || pr.xp > 0 ? 'Lv ' + pr.level : ''; });
    };
    s.querySelectorAll('.sp').forEach((b) => (b.onclick = () => { state.key = b.dataset.k; state.coat = g.progFor(state.key).coat || 0; audio.sfx('ui'); audio.voice(SPECIES[state.key].voice); render(); onChange(); }));
    $('#sStart', s).onclick = () => { audio.sfx('ui'); onStart(); };
    $('#selBack', s).onclick = () => { audio.sfx('uiBack'); g.toTitle(); };
    render();
    // drag to rotate preview
    let drag = null;
    s.addEventListener('pointerdown', (e) => { if (e.target === s || e.target.classList.contains('selWrap')) drag = e.clientX; });
    window.addEventListener('pointermove', (e) => { if (drag != null) { g.previewYaw += (e.clientX - drag) * 0.01; drag = e.clientX; } });
    window.addEventListener('pointerup', () => (drag = null));
  }
  // ───────── HUD ─────────
  showHUD(on) {
    this.hud.classList.toggle('hidden', !on);
    $('#touch').classList.toggle('hidden', !(on && isTouch));
    if (on && isTouch) this.buildTouch();
  }
  buildTouch() {
    const g = this.game, inp = g.input;
    const rift = g.state === 'rift';
    const sp = g.player.sp;
    const L = g.loadout();
    const btns = $('#tBtns'); btns.innerHTML = ''; btns.className = rift ? 'rift' : 'city';
    const mk = (cls, label, action, extra = '') => { const b = el('button', 'tb ' + cls, `<span>${label}</span>${extra}`); btns.appendChild(b); inp.bindButton(b, action); return b; };
    if (rift) {
      mk('atk1 big', ABILITIES[L.normal[0]]?.icon || '⚔', 'atk1', '<i class="cd"></i>');
      if (L.normal[1]) mk('atk2', ABILITIES[L.normal[1]].icon, 'atk2', '<i class="cd"></i>');
      L.skill.forEach((id, i) => id && mk('sk sk' + (i + 1), ABILITIES[id].icon, 'skill' + (i + 1), '<i class="cd"></i>'));
      L.ult.forEach((id, i) => id && mk('ul ul' + (i + 1), ABILITIES[id].icon, 'ult' + (i + 1), '<i class="cd"></i>'));
      mk('dodge', '💨', 'dodge'); mk('jump', '⤒', 'jump');
    } else {
      mk('jump big', sp.rig === 'butterfly' ? '⇧' : sp.rig === 'snake' ? '⚡' : '⤒', 'jump');
      this.tInteract = mk('interact', '✋', 'interact');
      mk('instinct', sp.instinct.icon, 'instinct');
      mk('sit', sp.rig === 'bird' ? '⬇' : '💤', 'sit');
      mk('voice', '💬', 'atk1');
    }
    // joystick visual
    inp.onJoy = (j) => {
      const joy = $('#joy');
      if (!j) { joy.classList.remove('on'); return; }
      joy.classList.add('on'); joy.style.left = j.ox + 'px'; joy.style.top = j.oy + 'px';
      const dx = clamp(j.x - j.ox, -55, 55), dy = clamp(j.y - j.oy, -55, 55);
      $('#joyKnob').style.transform = `translate(${dx}px,${dy}px)`;
    };
  }
  buildAbilityBar() {
    const g = this.game, L = g.loadout(); const bar = $('#abilityBar');
    const rift = g.state === 'rift';
    bar.classList.toggle('hidden', !rift || isTouch); $('#spirit').classList.toggle('hidden', !rift);
    if (!rift) return;
    const keys = { normal: ['LMB', 'RMB'], skill: ['1', '2', '3'], ult: ['Q', 'R'] };
    let h = '';
    for (const slot of ['normal', 'skill', 'ult']) {
      h += `<div class="grp ${slot}">`;
      L[slot].forEach((id, i) => { const a = ABILITIES[id]; h += `<div class="ab ${a ? '' : 'empty'}" data-id="${id || ''}" title="${a ? a.name + ' — ' + a.desc : 'Empty slot'}"><span>${a ? a.icon : ''}</span><kbd>${keys[slot][i]}</kbd><i class="cd"></i></div>`; });
      h += '</div>';
    }
    h += `<div class="grp"><div class="ab"><span>💨</span><kbd>Shift</kbd></div></div>`;
    bar.innerHTML = h;
  }
  update(dt) {
    const g = this.game, p = g.player; if (!p) return;
    $('#pEmoji').textContent = p.sp.emoji; $('#pLv').textContent = g.prog.level; $('#pName').textContent = p.sp.name;
    const hp = $('.bar.hp'); hp.querySelector('i').style.width = (p.hp / p.maxHp) * 100 + '%'; hp.querySelector('em').style.width = (Math.min(p.shield, p.maxHp) / p.maxHp) * 100 + '%';
    hp.querySelector('span').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    const en = $('.bar.en'); en.querySelector('i').style.width = p.energy + '%'; en.querySelector('span').textContent = 'Energy';
    $('#nHunger b').textContent = Math.round(p.hunger); $('#nHunger').classList.toggle('low', p.hunger < 20);
    const moodE = p.mood > 80 ? '😄' : p.mood > 60 ? '😊' : p.mood > 40 ? '🙂' : p.mood > 20 ? '😟' : '😢';
    $('#nMood').firstChild.textContent = moodE + ' '; $('#nMood b').textContent = Math.round(p.mood);
    const need = g.xpNeed(g.prog.level); $('#nXP b').textContent = `${Math.floor(g.prog.xp)}/${need}`;
    $('#pMoodTag').textContent = p.mood > 70 ? 'Happy +10% dmg' : p.mood < 30 ? 'Gloomy −10% dmg' : '';
    if (g.world) $('#clock').textContent = (g.state === 'rift' ? '◈ Rift' : (g.world.night > 0.5 ? '🌙 ' : '☀️ ') + g.world.clockText()) + (p.key === 'cat' && g.world.night > 0.5 && g.state !== 'rift' ? ' · Night vision' : '');
    // status tags
    const tags = []; if (p.crouch) tags.push('🐾 Sneaking'); if (p.hidden || p.inBush) tags.push('🌿 Hidden'); if (p.swimming) tags.push('🌊 Swimming'); if (p.sit && p.sitTime > 2.2) tags.push(p.sitTime > 4 ? '💤 Napping' : '🛌 Resting'); else if (p.sit) tags.push('🪑 Sitting');
    if (p.charging && p.charge > 0.12) tags.push(`⤒ Jump ${Math.round(p.charge * 100)}%`);
    for (const b of p.buffs) if (b.name) tags.push(`✨ ${b.name} ${b.t.toFixed(0)}s`);
    $('#buffs').innerHTML = tags.map((t) => `<span>${t}</span>`).join('');
    // ability cooldowns
    if (g.state === 'rift') {
      $('#spirit i').style.width = p.spirit + '%'; $('#spirit').classList.toggle('full', p.spirit >= 100);
      const cdEls = isTouch ? document.querySelectorAll('#tBtns .tb') : document.querySelectorAll('#abilityBar .ab');
      const L = g.loadout(); const ids = isTouch ? [L.normal[0], L.normal[1], ...L.skill, ...L.ult].filter(Boolean) : [...L.normal, ...L.skill, ...L.ult];
      ids.forEach((id, i) => {
        const e = cdEls[i]; if (!e || !id) return; const a = ABILITIES[id]; const cd = Math.max(0, p.cds[id] || 0); const c = e.querySelector('.cd'); if (!c) return;
        if (a.slot === 'ult') { const k = 1 - p.spirit / 100; c.style.height = k * 100 + '%'; e.classList.toggle('ready', p.spirit >= 100); }
        else c.style.height = clamp(cd / (a.cd * 1.6), 0, 1) * 100 + '%';
      });
      this.updateEnemyBars();
    }
    if (this.boss) { $('#bossBar i').style.width = clamp(this.boss.hp / this.boss.maxHp, 0, 1) * 100 + '%'; }
    this.drawMinimap();
    this.updateNumbers(dt);
  }
  setPrompt(pr) {
    const e = $('#prompt');
    if (!pr) { e.classList.remove('on'); if (this.tInteract) this.tInteract.classList.remove('on'); return; }
    e.classList.add('on'); e.querySelector('.pi').textContent = pr.icon || ''; e.querySelector('.pl').textContent = pr.label;
    e.querySelector('kbd').style.display = isTouch ? 'none' : '';
    if (this.tInteract) { this.tInteract.classList.add('on'); this.tInteract.querySelector('span').textContent = pr.icon || '✋'; }
  }
  district(name) { const e = $('#district'); e.textContent = name; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }
  toast(msg, kind = '') {
    const t = el('div', 'toast ' + kind, msg); $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 3600); setTimeout(() => t.remove(), 4200);
    const all = $('#toasts').children; if (all.length > 4) all[0].remove();
  }
  banner(text) { const b = $('#banner'); b.textContent = text; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
  hurtFlash() { const f = $('#flash'); f.className = 'hurt'; void f.offsetWidth; f.className = 'hurt go'; }
  ultFlash(def) { const f = $('#flash'); f.style.setProperty('--c', '#' + new THREE.Color(def.color).getHexString()); f.className = 'ult'; void f.offsetWidth; f.className = 'ult go'; this.banner(`${def.icon} ${def.name}`); }
  bossBar(e) { this.boss = e; const b = $('#bossBar'); b.classList.toggle('on', !!e); if (e) b.querySelector('span').textContent = e.def.name; }
  fade(on, purple) { const f = $('#fade'); f.classList.toggle('purple', !!purple); f.classList.toggle('on', on); }
  // ───────── Damage numbers ─────────
  updateNumbers(dt) {
    const g = this.game, cam = g.camera, vfx = g.vfx; const box = $('#nums');
    while (vfx.numbers.length) { const n = vfx.numbers.shift(); const d = el('div', 'num' + (n.big ? ' big' : ''), n.text); d.style.color = n.color; box.appendChild(d); this.nums.push({ ...n, el: d, t: 0 }); if (this.nums.length > 40) { this.nums[0].el.remove(); this.nums.shift(); } }
    const v = new THREE.Vector3(), W = window.innerWidth, H = window.innerHeight;
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i]; n.t += dt;
      if (n.t > 1.1) { n.el.remove(); this.nums.splice(i, 1); continue; }
      v.copy(n.pos); v.y += n.t * 0.9; v.project(cam);
      if (v.z > 1) { n.el.style.opacity = 0; continue; }
      n.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px,${(-v.y * 0.5 + 0.5) * H}px) translate(-50%,-50%) scale(${n.t < 0.12 ? 0.6 + n.t * 5 : 1})`;
      n.el.style.opacity = n.t > 0.75 ? 1 - (n.t - 0.75) / 0.35 : 1;
    }
  }
  updateEnemyBars() {
    const g = this.game, r = g.rift; if (!r) return;
    const box = $('#nums'); const v = new THREE.Vector3(), W = window.innerWidth, H = window.innerHeight;
    const seen = new Set();
    for (const e of r.enemies) {
      if (!e.alive || e.def.boss) continue; seen.add(e);
      let b = this.enemyBars.get(e); if (!b) { b = el('div', 'ebar', '<i></i>'); box.appendChild(b); this.enemyBars.set(e, b); }
      v.copy(e.center()); v.y += e.radius + 0.5; v.project(g.camera);
      if (v.z > 1) { b.style.display = 'none'; continue; }
      b.style.display = ''; b.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px,${(-v.y * 0.5 + 0.5) * H}px) translate(-50%,-50%)`;
      b.firstChild.style.width = clamp(e.hp / e.maxHp, 0, 1) * 100 + '%'; b.classList.toggle('stun', e.stun > 0); b.classList.toggle('poison', e.poisonT > 0);
    }
    for (const [e, b] of this.enemyBars) if (!seen.has(e)) { b.remove(); this.enemyBars.delete(e); }
  }
  clearEnemyBars() { for (const [, b] of this.enemyBars) b.remove(); this.enemyBars.clear(); }
  // ───────── Minimap ─────────
  drawMinimap(full = null) {
    const g = this.game; if (!g.world || g.state !== 'city') { if (!full) this.mm.style.opacity = g.state === 'rift' ? 0.25 : 1; if (g.state === 'rift' && !full) return; }
    this.mm.style.opacity = 1;
    const M = g.world.city.minimap, p = g.player;
    const c = full ? full.getContext('2d') : this.mmCtx; const S = full ? full.width : this.mm.width;
    const zoom = full ? S / (M.size) : 2.2;
    const px = (p.pos.x + M.offset) * M.scale, pz = (p.pos.z + M.offset) * M.scale;
    c.save(); c.clearRect(0, 0, S, S);
    if (!full) { c.beginPath(); c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); c.clip(); c.translate(S / 2, S / 2); c.rotate(g.camRig.yaw - Math.PI); c.scale(zoom, zoom); c.translate(-px, -pz); }
    else c.scale(zoom, zoom);
    c.drawImage(M.canvas, 0, 0);
    const P = (v) => [(v.x + M.offset) * M.scale, (v.z + M.offset) * M.scale];
    const inv = 1 / zoom;
    // mist
    g.world.city.mist.forEach((m) => { if (!g.world.mistActive(m)) return; const [x, y] = P(m.pos); c.fillStyle = 'rgba(30,0,40,0.85)'; c.beginPath(); c.arc(x, y, (full ? 7 : 5) * inv, 0, 7); c.fill(); c.strokeStyle = '#c070ff'; c.lineWidth = 1.5 * inv; c.stroke(); if (full) { c.fillStyle = '#e8c0ff'; c.font = `${11 * inv}px sans-serif`; c.fillText(`${m.name} (T${m.tier})`, x + 9 * inv, y + 4 * inv); } });
    // revealed shards (sniff/listen) or full map shows collected count only
    if (g.world.revealT > 0) for (const o of g.world.shardObjs) if (o.g.visible) { const [x, y] = P(o.g.position); c.fillStyle = '#60e8ff'; c.beginPath(); c.arc(x, y, 3.5 * inv, 0, 7); c.fill(); }
    if (full) { c.fillStyle = 'rgba(255,255,255,0.9)'; c.font = `bold ${12 * inv}px sans-serif`; c.textAlign = 'center'; for (const l of g.world.city.landmarks) { const [x, y] = P(l.pos); c.fillText(l.name, x, y); } }
    // player arrow
    const [x, y] = [px, pz]; c.translate(x, y); c.rotate(-p.yaw + Math.PI); c.scale(inv, inv);
    c.fillStyle = '#ffd040'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 6); c.lineTo(0, 3); c.lineTo(-6, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
  // ───────── Modals ─────────
  openModal(html, cls = '') {
    const m = $('#modal'); m.className = cls; m.querySelector('.card').innerHTML = html; m.classList.remove('hidden');
    this.modalOpen = true; this.game.input.clearAll(); if (document.pointerLockElement) document.exitPointerLock();
    return m;
  }
  closeModal() { $('#modal').classList.add('hidden'); this.modalOpen = false; this.game.input.clearAll(); }
  confirm(html, yes, no, cb) {
    const m = this.openModal(`${html}<div class="btns"><button class="primary" id="mYes">${yes}</button><button id="mNo">${no}</button></div>`, 'mist');
    $('#mYes', m).onclick = () => { this.closeModal(); audio.sfx('ui'); cb(true); };
    $('#mNo', m).onclick = () => { this.closeModal(); audio.sfx('uiBack'); cb(false); };
  }
  story(text, title = '') {
    const m = this.openModal(`${title ? `<h2>${title}</h2>` : ''}<p class="story">${text}</p><div class="btns"><button class="primary" id="mOk">Continue</button></div>`, 'storyM');
    $('#mOk', m).onclick = () => { this.closeModal(); audio.sfx('ui'); };
  }
  openPause() {
    if (this.modalOpen) { this.closeModal(); return; }
    audio.sfx('ui');
    const g = this.game;
    const m = this.openModal(`<h2>Paused</h2><div class="menuList">
      <button id="pRes" class="primary">▶ Resume</button>
      <button id="pAb">✨ Abilities${g.prog.sp ? ` <b class="badge">${g.prog.sp} SP</b>` : ''}</button>
      <button id="pJo">📔 Journal</button>
      <button id="pMap">🗺️ Map</button>
      <button id="pSet">⚙ Settings</button>
      <button id="pFs">⛶ Fullscreen</button>
      ${g.state === 'city' ? '<button id="pSw">🔄 Change creature</button>' : '<button id="pLeave">🚪 Leave the Rift</button>'}
      <button id="pHelp">❓ Controls</button>
    </div>`, 'pause');
    $('#pRes', m).onclick = () => this.closeModal();
    $('#pAb', m).onclick = () => this.openAbilities();
    $('#pJo', m).onclick = () => this.openJournal();
    $('#pMap', m).onclick = () => this.openMap();
    $('#pSet', m).onclick = () => this.openSettings();
    $('#pFs', m).onclick = () => this.toggleFullscreen();
    $('#pHelp', m).onclick = () => this.openHelp();
    const sw = $('#pSw', m); if (sw) sw.onclick = () => { this.closeModal(); g.save(); g.toSelect(); };
    const lv = $('#pLeave', m); if (lv) lv.onclick = () => { this.closeModal(); g.rift.finish(false); };
  }
  openHelp() {
    const pc = `<table class="keys">
      <tr><td>Move</td><td><kbd>W A S D</kbd></td></tr><tr><td>Camera</td><td>Click, then move mouse · wheel to zoom</td></tr>
      <tr><td>Jump / Fly / Rise</td><td><kbd>Space</kbd> (cats: hold to charge)</td></tr><tr><td>Sprint</td><td><kbd>Shift</kbd></td></tr>
      <tr><td>Interact / Eat</td><td><kbd>E</kbd></td></tr><tr><td>Instinct</td><td><kbd>F</kbd></td></tr><tr><td>Sit / Nap / Dive</td><td><kbd>X</kbd></td></tr>
      <tr><td>Call (meow, bark…)</td><td><kbd>LMB</kbd> in the city</td></tr>
      <tr><td>Attacks (Rift)</td><td><kbd>LMB</kbd> <kbd>RMB</kbd></td></tr><tr><td>Skills</td><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td></tr><tr><td>Ultimates</td><td><kbd>Q</kbd> <kbd>R</kbd></td></tr><tr><td>Dodge</td><td><kbd>Shift</kbd> / <kbd>C</kbd> in the Rift</td></tr>
      <tr><td>Map · Abilities · Journal</td><td><kbd>M</kbd> · <kbd>I</kbd> · <kbd>L</kbd></td></tr><tr><td>Camera mode (3D / 2.5D)</td><td><kbd>V</kbd></td></tr></table>`;
    const touch = `<p>Left side: drag to move (push to the edge to sprint).<br>Right side: drag to look around.<br>Buttons: Jump, Interact (appears when something is nearby), Instinct, Sit/Nap, Call.<br>In the Rift: attack, skills, ultimates and dodge buttons appear.</p>`;
    const m = this.openModal(`<h2>Controls</h2>${isTouch ? touch : pc}<div class="btns"><button id="mBack">Back</button></div>`, 'pause');
    $('#mBack', m).onclick = () => this.openPause();
  }
  openSettings(fromTitle) {
    const g = this.game, S = g.settings;
    const m = this.openModal(`<h2>Settings</h2><div class="settings">
      <label>Graphics<select id="sQ"><option value="low">Low (fastest)</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label>Camera<select id="sCam"><option value="free">Free 3D</option><option value="iso">2.5D (angled, top-down)</option></select></label>
      <label>Look sensitivity<input type="range" id="sSens" min="0.3" max="2.5" step="0.1"></label>
      <label>Music<input type="range" id="sMus" min="0" max="1" step="0.05"></label>
      <label>Sound<input type="range" id="sSfx" min="0" max="1" step="0.05"></label>
      <label>Show FPS<input type="checkbox" id="sFps"></label>
    </div><div class="btns"><button class="primary" id="mDone">Done</button><button id="mReset" class="danger">Reset all progress</button></div>`, 'pause');
    $('#sQ', m).value = S.quality; $('#sCam', m).value = S.camMode; $('#sSens', m).value = S.sens; $('#sMus', m).value = S.music; $('#sSfx', m).value = S.sfx; $('#sFps', m).checked = S.fps;
    const apply = () => { S.quality = $('#sQ', m).value; S.camMode = $('#sCam', m).value; S.sens = +$('#sSens', m).value; S.music = +$('#sMus', m).value; S.sfx = +$('#sSfx', m).value; S.fps = $('#sFps', m).checked; g.applySettings(); g.saveSettings(); };
    m.querySelectorAll('select,input').forEach((i) => (i.oninput = apply));
    $('#mDone', m).onclick = () => { apply(); if (fromTitle) this.closeModal(); else this.openPause(); };
    $('#mReset', m).onclick = () => { if (window.confirm('Erase all saved progress for every creature?')) { localStorage.removeItem('mistwalkers_save_v1'); location.reload(); } };
  }
  openAbilities() {
    const g = this.game, prog = g.prog, sp = g.player.sp;
    const L = prog.equipped;
    const card = (id) => {
      const a = ABILITIES[id]; const owned = prog.unlocked.includes(id);
      const eq = L[a.slot].includes(id);
      const req = a.unlock || { sp: 0, lv: 1 };
      const can = !owned && prog.sp >= req.sp && prog.level >= req.lv;
      return `<div class="abCard ${owned ? 'owned' : ''} ${eq ? 'eq' : ''}" data-id="${id}">
        <div class="ic">${a.icon}</div><div class="tx"><b>${a.name}</b><small>${a.slot === 'normal' ? 'Normal attack' : a.slot === 'skill' ? 'Skill' : 'Ultimate'}${a.cd && a.slot !== 'ult' ? ` · ${a.cd}s` : a.slot === 'ult' ? ' · needs full Spirit' : ''}</small><p>${a.desc}</p></div>
        <div class="act">${owned ? (a.slot === 'normal' ? '<span class="tagEq">Equipped</span>' : eq ? '<button data-un="1">Unequip</button>' : '<button data-eq="1">Equip</button>') : `<button data-buy="1" ${can ? '' : 'disabled'}>Learn · ${req.sp} SP${req.lv > 1 ? ` · Lv ${req.lv}` : ''}</button>`}</div></div>`;
    };
    const sec = (slot, title, max) => `<h3>${title} <small>(${L[slot].filter(Boolean).length}/${max} equipped)</small></h3>${sp.abilities[slot].map(card).join('')}`;
    const m = this.openModal(`<h2>${sp.emoji} ${sp.name} Abilities</h2><div class="spLine">Skill Points: <b>${prog.sp}</b> · Level ${prog.level} <small>— earn SP by levelling up (fight in the mist), finding Echo Shards 💎, and completing habits.</small></div>
      <div class="abList">${sec('normal', 'Normal attacks', 2)}${sec('skill', 'Skills', 3)}${sec('ult', 'Ultimates', 2)}</div>
      <div class="btns"><button class="primary" id="mBack">Back</button></div>`, 'pause wide');
    m.querySelectorAll('.abCard').forEach((c) => {
      const id = c.dataset.id, a = ABILITIES[id];
      c.querySelector('[data-buy]')?.addEventListener('click', () => { const req = a.unlock; prog.sp -= req.sp; prog.unlocked.push(id); audio.sfx('levelup'); g.autoEquip(id); g.save(); this.toast(`✨ Learned ${a.name}!`, 'good'); this.openAbilities(); });
      c.querySelector('[data-eq]')?.addEventListener('click', () => { const arr = L[a.slot]; const free = arr.indexOf(null); if (free >= 0) arr[free] = id; else arr[arr.length - 1] = id; audio.sfx('ui'); g.save(); g.refreshControls(); this.openAbilities(); });
      c.querySelector('[data-un]')?.addEventListener('click', () => { const arr = L[a.slot]; if (arr.filter(Boolean).length <= 1) { this.toast('Keep at least one equipped.'); return; } arr[arr.indexOf(id)] = null; arr.sort((x, y) => (x ? 0 : 1) - (y ? 0 : 1)); audio.sfx('uiBack'); g.save(); g.refreshControls(); this.openAbilities(); });
    });
    $('#mBack', m).onclick = () => { this.closeModal(); g.refreshControls(); };
  }
  openJournal() {
    const g = this.game, prog = g.prog, sp = g.player.sp, W = g.world;
    const habits = sp.habits.map((h, i) => { const done = prog.habitsDone.includes('h' + i); const n = h.n || 1; const c = Math.min(n, prog.habits[h.ev] || 0); return `<li class="${done ? 'done' : ''}">${done ? '✅' : '⬜'} ${h.t}${n > 1 ? ` <small>(${c}/${n})</small>` : ''}</li>`; }).join('');
    const rifts = W.city.mist.map((m) => { const c = prog.cleared[m.id]; return `<li class="${c ? 'done' : ''}">${c ? '✅' : '◈'} ${m.name} <small>Tier ${m.tier}${c ? ` · cleared ×${c.n}` : ''}</small></li>`; }).join('');
    const shards = W.city.shards.map((s) => `<li class="${prog.shards.includes(s.id) ? 'done' : ''}">${prog.shards.includes(s.id) ? '💎 Found' : '❔ ' + s.hint}</li>`).join('');
    const likes = Object.entries(sp.foods).filter(([, v]) => v[0] === 2).map(([k]) => k);
    const bad = Object.entries(sp.foods).filter(([, v]) => v[0] === -1).map(([k]) => k);
    const m = this.openModal(`<h2>📔 Journal — ${sp.name}</h2><div class="jGrid">
      <div><h3>Habits</h3><ul class="jl">${habits}</ul><h3>Diet</h3><p>Favourites: ${likes.map((f) => g.foodName(f)).join(', ')}</p><p class="warnText">Avoid: ${bad.length ? bad.map((f) => g.foodName(f)).join(', ') : '—'}</p></div>
      <div><h3>Rifts</h3><ul class="jl">${rifts}</ul><h3>Echo Shards (${prog.shards.length}/${W.city.shards.length})</h3><ul class="jl">${shards}</ul></div>
      <div class="lore"><h3>The Story so far</h3><p>One night a seam split open above the city. Black mist began to seep from it — invisible to humans, who walk right through it without a shiver. Only a few animals and small creatures can see it… and you are one of them.</p><p>Inside the mist lie strange stages from another world, crawling with things that are neither animal nor human. Each rift you cleanse pushes them back. Echo Shards, scattered across the city, hold the old power that lets the chosen grow stronger.</p><p>Districts discovered: ${prog.discovered.length}</p></div>
    </div><div class="btns"><button class="primary" id="mBack">Back</button></div>`, 'pause wide');
    $('#mBack', m).onclick = () => this.closeModal();
  }
  openMap() {
    if (this.game.state !== 'city') { this.toast('No map inside the Rift.'); return; }
    const S = Math.min(window.innerWidth, window.innerHeight) * 0.78;
    const m = this.openModal(`<h2>City Map</h2><canvas id="bigMap" width="${Math.round(S)}" height="${Math.round(S)}"></canvas><p class="small">◈ purple = black mist rift · yellow arrow = you</p><div class="btns"><button class="primary" id="mBack">Close</button></div>`, 'pause mapM');
    this.drawMinimap($('#bigMap', m));
    $('#mBack', m).onclick = () => this.closeModal();
  }
  results(win, xp, levels, firstClear) {
    const m = this.openModal(`<h2>${win ? '✨ Rift Cleansed' : '💨 Pushed out of the mist'}</h2>
      <p>${win ? 'The mist fades from this corner of the city — for now.' : 'You were overwhelmed, but you escaped safely. Train, eat well, and try again.'}</p>
      <div class="res"><div>⭐ +${xp} XP</div>${levels ? `<div>🎉 Level up! → Lv ${this.game.prog.level} (+${levels} SP)</div>` : ''}${firstClear ? '<div>💠 First clear bonus: +1 SP</div>' : ''}</div>
      <div class="btns"><button class="primary" id="mOk">Continue</button>${(levels || firstClear) ? '<button id="mAb">Learn abilities</button>' : ''}</div>`, 'storyM');
    $('#mOk', m).onclick = () => this.closeModal();
    const ab = $('#mAb', m); if (ab) ab.onclick = () => this.openAbilities();
  }
}
