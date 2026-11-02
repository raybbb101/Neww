// Ability definitions. `kind` selects the executor in game/combat.js.
// slot: 'normal' | 'skill' | 'ult'. dmg is a multiplier of the creature's ATK.
// unlock: { sp: skill points, lv: min level }  (first normal/skill/ult are free)
export const ABILITIES = {
  // ───────── CAT ─────────
  cat_claw:   { slot: 'normal', name: 'Claw Swipe', icon: '🐾', kind: 'melee', dmg: 1.0, range: 1.6, arc: 120, cd: 0.38, combo: 3, kb: 1.5, color: 0xffe2b0, desc: 'Quick three-hit claw combo.' },
  cat_pounce: { slot: 'normal', name: 'Pounce', icon: '⤴️', kind: 'leap', dmg: 2.2, range: 6, radius: 2, cd: 1.6, kb: 4, color: 0xffc070, desc: 'Leap onto the nearest foe like a hunting cat.', unlock: { sp: 1, lv: 2 } },
  cat_hiss:   { slot: 'skill', name: 'Hiss Wave', icon: '💨', kind: 'cone', dmg: 2.0, range: 6, arc: 80, cd: 6, kb: 8, stun: 0.8, color: 0xc8f0ff, desc: 'A furious hiss that blasts and stuns enemies in front.' },
  cat_stalk:  { slot: 'skill', name: 'Shadow Stalk', icon: '🌑', kind: 'dash', dmg: 2.4, dist: 9, cd: 7, buff: { dur: 3, crit: 0.6 }, color: 0x8a6cff, desc: 'Vanish into a shadow dash; your next hits are likely critical.', unlock: { sp: 1, lv: 1 } },
  cat_purr:   { slot: 'skill', name: 'Healing Purr', icon: '💗', kind: 'heal', amount: 0.3, regen: 0.03, dur: 5, cd: 14, color: 0xff9ad0, desc: 'Cats purr to heal — restore 30% HP and regenerate.', unlock: { sp: 1, lv: 3 } },
  cat_whisker:{ slot: 'skill', name: 'Whisker Sense', icon: '〰️', kind: 'buff', buff: { dur: 6, speed: 1.35, dodge: 0.35, dmg: 1.2 }, cd: 15, color: 0xfff1a0, desc: 'Whiskers feel every motion: faster, more evasive, stronger.', unlock: { sp: 2, lv: 5 } },
  cat_frenzy: { slot: 'ult', name: 'Feral Frenzy', icon: '🌪️', kind: 'flurry', dmg: 0.9, hits: 14, interval: 0.08, radius: 4.5, cd: 25, color: 0xff7a50, desc: 'A whirlwind of claws hitting everything around you.' },
  cat_moon:   { slot: 'ult', name: 'Moonlit Eyes', icon: '🌕', kind: 'beam', dmg: 0.7, length: 18, width: 1.6, dur: 2.0, tick: 0.1, stun: 0.3, cd: 32, color: 0xa8e8ff, desc: 'Night-vision eyes focus into a piercing beam of moonlight.', unlock: { sp: 3, lv: 6 } },

  // ───────── DOG ─────────
  dog_bite:   { slot: 'normal', name: 'Bite', icon: '🦷', kind: 'melee', dmg: 1.2, range: 1.8, arc: 90, cd: 0.45, combo: 2, kb: 2, color: 0xfff0d0, desc: 'Strong two-hit bite combo.' },
  dog_tackle: { slot: 'normal', name: 'Tackle', icon: '💥', kind: 'dash', dmg: 2.0, dist: 7, cd: 1.8, kb: 6, color: 0xffd080, desc: 'Charge shoulder-first through enemies.', unlock: { sp: 1, lv: 2 } },
  dog_howl:   { slot: 'skill', name: 'Rally Howl', icon: '🐺', kind: 'buff', buff: { dur: 8, dmg: 1.4, dr: 0.2 }, fear: 4.5, cd: 14, color: 0xffd36a, desc: 'A pack howl: +40% damage, tougher hide, nearby foes flinch.' },
  dog_dig:    { slot: 'skill', name: 'Dig Burst', icon: '🕳️', kind: 'burrow', dmg: 3.0, radius: 3.5, dur: 1.0, cd: 9, kb: 7, color: 0xb08050, desc: 'Dig underground (invulnerable) and burst out beneath foes.', unlock: { sp: 1, lv: 1 } },
  dog_fetch:  { slot: 'skill', name: 'Fetch Stick', icon: '🪵', kind: 'boomerang', dmg: 1.6, speed: 18, dist: 12, cd: 5, color: 0xc89060, desc: 'Throw a spinning stick that returns — hits twice.', unlock: { sp: 1, lv: 3 } },
  dog_loyal:  { slot: 'skill', name: 'Loyal Heart', icon: '🛡️', kind: 'heal', amount: 0.2, shield: 0.35, dur: 6, cd: 16, color: 0x80d0ff, desc: 'Heal and gain a shield worth 35% of max HP.', unlock: { sp: 2, lv: 5 } },
  dog_pack:   { slot: 'ult', name: 'Pack Spirit', icon: '🐕', kind: 'summon', count: 3, dur: 10, dmg: 0.9, cd: 30, color: 0x9ad8ff, desc: 'Summon three spectral dogs that hunt alongside you.' },
  dog_thunder:{ slot: 'ult', name: 'Thunder Bark', icon: '⚡', kind: 'nova', dmg: 5.0, radius: 9, delay: 0.25, kb: 12, stun: 1.5, cd: 28, color: 0xfff27a, rings: 3, desc: 'A bark so loud it becomes a thunderous shockwave.', unlock: { sp: 3, lv: 6 } },

  // ───────── RABBIT ─────────
  rab_kick:   { slot: 'normal', name: 'Thump Kick', icon: '🦶', kind: 'melee', dmg: 1.1, range: 1.7, arc: 110, cd: 0.42, combo: 2, kb: 3, color: 0xffffff, desc: 'Powerful hind-leg kicks.' },
  rab_stomp:  { slot: 'normal', name: 'Hop Stomp', icon: '⬇️', kind: 'leap', dmg: 1.9, range: 5, radius: 2.6, cd: 1.5, kb: 5, color: 0xe8ffd0, desc: 'Hop high and stomp down on enemies.', unlock: { sp: 1, lv: 2 } },
  rab_binky:  { slot: 'skill', name: 'Binky Dash', icon: '✨', kind: 'dash', dmg: 1.4, dist: 10, cd: 4.5, zigzag: true, color: 0xfff6c0, desc: 'A joyful zig-zag leap — untouchable while dashing.' },
  rab_carrot: { slot: 'skill', name: 'Carrot Barrage', icon: '🥕', kind: 'proj', dmg: 0.9, count: 5, spread: 30, speed: 20, homing: 2.5, cd: 6, color: 0xff9030, model: 'carrot', desc: 'Fire a volley of homing carrots.', unlock: { sp: 1, lv: 1 } },
  rab_burrow: { slot: 'skill', name: 'Burrow Escape', icon: '🌀', kind: 'burrow', dmg: 2.2, radius: 3, dur: 1.4, cd: 10, kb: 6, heal: 0.12, color: 0x9a7048, desc: 'Vanish into a burrow, heal a little, and pop out with a shockwave.', unlock: { sp: 1, lv: 3 } },
  rab_clover: { slot: 'skill', name: 'Lucky Clover', icon: '🍀', kind: 'buff', buff: { dur: 8, crit: 0.45, speed: 1.2 }, cd: 15, color: 0x70ff90, desc: 'Luck is on your side: +45% crit chance, +20% speed.', unlock: { sp: 2, lv: 5 } },
  rab_moonhop:{ slot: 'ult', name: 'Moon Hop', icon: '🌙', kind: 'multileap', dmg: 3.0, leaps: 4, radius: 4, range: 9, cd: 26, color: 0xd8e8ff, desc: 'Four colossal leaps, each landing with a crater.' },
  rab_quake:  { slot: 'ult', name: 'Warren Quake', icon: '🌋', kind: 'nova', dmg: 2.2, radius: 11, delay: 0.4, kb: 6, stun: 2.2, cd: 30, color: 0xc0a070, rings: 4, desc: 'Thump the ground until it quakes, stunning everything.', unlock: { sp: 3, lv: 6 } },

  // ───────── BIRD ─────────
  bird_peck:  { slot: 'normal', name: 'Peck', icon: '🎯', kind: 'melee', dmg: 0.85, range: 1.6, arc: 70, cd: 0.28, combo: 4, kb: 1, color: 0xfff4c0, desc: 'Rapid four-peck combo.' },
  bird_gust:  { slot: 'normal', name: 'Wing Gust', icon: '🌬️', kind: 'cone', dmg: 1.2, range: 5, arc: 70, cd: 1.2, kb: 7, color: 0xe0f4ff, desc: 'A strong wingbeat that knocks enemies back.', unlock: { sp: 1, lv: 2 } },
  bird_darts: { slot: 'skill', name: 'Feather Darts', icon: '🪶', kind: 'proj', dmg: 0.9, count: 6, spread: 50, speed: 26, homing: 1.5, cd: 4, color: 0x8ac8ff, model: 'feather', desc: 'Fling a fan of razor feathers.' },
  bird_dive:  { slot: 'skill', name: 'Dive Bomb', icon: '🔻', kind: 'leap', dmg: 3.0, range: 10, radius: 3, cd: 7, kb: 7, color: 0xffd080, desc: 'Plunge from the sky onto your target.', unlock: { sp: 1, lv: 1 } },
  bird_song:  { slot: 'skill', name: 'Dawn Song', icon: '🎶', kind: 'field', heal: 0.05, radius: 5, dur: 6, tick: 0.5, cd: 16, color: 0xffe080, desc: 'A healing song that restores HP while you stay nearby.', unlock: { sp: 1, lv: 3 } },
  bird_tail:  { slot: 'skill', name: 'Tailwind', icon: '💨', kind: 'buff', buff: { dur: 8, speed: 1.5, cdr: 0.4 }, cd: 16, color: 0xb0ffe0, desc: 'Ride the wind: +50% speed and faster cooldowns.', unlock: { sp: 2, lv: 5 } },
  bird_storm: { slot: 'ult', name: 'Feather Storm', icon: '⛈️', kind: 'rain', dmg: 1.4, count: 26, radius: 9, area: 1.8, dur: 3, cd: 26, color: 0x9ad0ff, model: 'feather', desc: 'Rain razor feathers over a wide area.' },
  bird_lance: { slot: 'ult', name: 'Sky Lance', icon: '☄️', kind: 'leap', dmg: 7.0, range: 14, radius: 6, cd: 30, kb: 12, stun: 1.5, big: true, color: 0xfff0a0, desc: 'Climb to the heavens and strike down like a comet.', unlock: { sp: 3, lv: 6 } },

  // ───────── SNAKE ─────────
  snk_fang:   { slot: 'normal', name: 'Fang Strike', icon: '🐍', kind: 'melee', dmg: 1.3, range: 2.4, arc: 50, cd: 0.5, combo: 2, kb: 1.5, lunge: 1.4, poison: 0.15, color: 0xb8ff70, desc: 'Lightning lunges that inject a little venom.' },
  snk_whip:   { slot: 'normal', name: 'Tail Whip', icon: '🌀', kind: 'melee', dmg: 1.4, range: 2.4, arc: 360, cd: 1.2, kb: 5, color: 0xd0ff90, desc: 'Sweep your tail all around you.', unlock: { sp: 1, lv: 2 } },
  snk_venom:  { slot: 'skill', name: 'Venom Spit', icon: '🧪', kind: 'proj', dmg: 1.2, count: 3, spread: 18, speed: 18, poison: 0.5, cd: 5, color: 0x90ff40, desc: 'Spit venom globs that poison over time.' },
  snk_coil:   { slot: 'skill', name: 'Constrict', icon: '➰', kind: 'grab', dmg: 0.6, hits: 8, interval: 0.2, range: 4, cd: 9, stun: 1.8, color: 0x80d040, desc: 'Coil around a foe: squeeze and stun it.', unlock: { sp: 1, lv: 1 } },
  snk_shed:   { slot: 'skill', name: 'Shed Skin', icon: '🫧', kind: 'heal', amount: 0.25, invuln: 1.5, cleanse: true, cd: 16, color: 0xe0ffd0, desc: 'Shed your old skin: heal, cleanse and become briefly invulnerable.', unlock: { sp: 1, lv: 3 } },
  snk_heat:   { slot: 'skill', name: 'Heat Sense', icon: '🌡️', kind: 'buff', buff: { dur: 8, crit: 0.5, critDmg: 0.5 }, cd: 15, color: 0xff7040, desc: 'Sense body heat: +50% crit chance and crit damage.', unlock: { sp: 2, lv: 5 } },
  snk_gaze:   { slot: 'ult', name: 'Basilisk Gaze', icon: '👁️', kind: 'beam', dmg: 0.6, length: 16, width: 2.4, dur: 2.2, tick: 0.12, stun: 0.5, poison: 0.2, cd: 28, color: 0xc0ff40, desc: 'A legendary gaze that petrifies and burns.' },
  snk_vortex: { slot: 'ult', name: 'Serpent Coil', icon: '🌪️', kind: 'vortex', dmg: 0.7, radius: 7, dur: 3, tick: 0.15, pull: 6, cd: 30, color: 0x70e060, desc: 'Spin into a coil storm that pulls foes in.', unlock: { sp: 3, lv: 6 } },

  // ───────── BUTTERFLY ─────────
  bfy_dust:   { slot: 'normal', name: 'Scale Dust', icon: '✨', kind: 'proj', dmg: 0.9, count: 1, speed: 22, homing: 4, cd: 0.32, color: 0xffb0f0, desc: 'Shimmering wing-scale bolts that seek foes.' },
  bfy_flutter:{ slot: 'normal', name: 'Flutter Burst', icon: '🦋', kind: 'nova', dmg: 1.4, radius: 3.5, delay: 0.05, kb: 6, cd: 1.6, color: 0xd0b0ff, desc: 'A burst of wing wind around you.', unlock: { sp: 1, lv: 2 } },
  bfy_pollen: { slot: 'skill', name: 'Pollen Cloud', icon: '🌼', kind: 'field', dmg: 0.45, radius: 4.5, dur: 5, tick: 0.4, slow: 0.5, at: 'target', cd: 8, color: 0xfff070, desc: 'A golden cloud that damages and slows foes inside.' },
  bfy_mirror: { slot: 'skill', name: 'Mirror Wings', icon: '🪞', kind: 'decoy', count: 2, dur: 5, cd: 12, color: 0xa0e0ff, desc: 'Create shimmering copies that distract monsters.', unlock: { sp: 1, lv: 1 } },
  bfy_bloom:  { slot: 'skill', name: 'Nectar Bloom', icon: '🌺', kind: 'field', heal: 0.06, radius: 5, dur: 6, tick: 0.5, cd: 15, color: 0xff80b0, desc: 'Grow a magic flower that heals you.', unlock: { sp: 1, lv: 3 } },
  bfy_prism:  { slot: 'skill', name: 'Prism Ray', icon: '🌈', kind: 'beam', dmg: 0.45, length: 14, width: 1.1, dur: 1.2, tick: 0.1, cd: 9, color: 0xffffff, rainbow: true, desc: 'Split light through your wings into a rainbow ray.', unlock: { sp: 2, lv: 5 } },
  bfy_kaleido:{ slot: 'ult', name: 'Kaleidoscope', icon: '🔮', kind: 'proj', dmg: 1.1, count: 20, spread: 360, speed: 14, homing: 5, cd: 24, color: 0xff70ff, model: 'butterfly', desc: 'Release a swarm of light-butterflies that hunt every foe.' },
  bfy_meta:   { slot: 'ult', name: 'Metamorphosis', icon: '🌟', kind: 'buff', buff: { dur: 10, dmg: 2.0, speed: 1.4, dr: 0.4, cdr: 0.5, scale: 1.8 }, heal: 0.3, cd: 35, color: 0xffe0ff, desc: 'Transform into a radiant giant: double damage, tougher, faster.', unlock: { sp: 3, lv: 6 } },
};
