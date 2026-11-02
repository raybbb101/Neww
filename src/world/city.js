import * as THREE from 'three';
import { Batcher, BOX, CYL, CYL6, CONE, ICO, MAT, canvasTex, jitteredIco, makeWindowTextures, noiseTexture, waterNormalTexture, globalUniforms } from '../gfx/gfx.js';
import { RNG, clamp, TAU } from '../core/utils.js';

export const ROADS = [-180, -120, -60, 0, 60, 120, 180];
export const HALF_ROAD = 6;
export const MAP_MIN = -205, MAP_MAX_X = 250, MAP_MAX = 205;
export const SEA_X = 196;
export const PARK = { minX: -114, maxX: -6, minZ: -114, maxZ: -6 };
export const POND = { x: -66, z: -58, r: 15 };
export const MARKET = { minX: -54, maxX: 54, minZ: 6, maxZ: 54 };
const BLOCK_TYPES = [
  // iz →  0           1          2           3            4            5
  ['oldtown', 'oldtown', 'oldtown', 'residential', 'residential', 'residential'], // ix0
  ['oldtown', 'park', 'park', 'residential', 'residential', 'residential'],        // ix1
  ['garden', 'park', 'park', 'market', 'residential', 'residential'],              // ix2
  ['downtown', 'downtown', 'downtown', 'market', 'cafe', 'school'],                // ix3
  ['downtown', 'plaza', 'downtown', 'mixed', 'mixed', 'mixed'],                    // ix4
  ['construction', 'harbor', 'harbor', 'harbor', 'harbor', 'harbor'],              // ix5
];
export function blockRect(ix, iz) { return { minX: ROADS[ix] + HALF_ROAD, maxX: ROADS[ix + 1] - HALF_ROAD, minZ: ROADS[iz] + HALF_ROAD, maxZ: ROADS[iz + 1] - HALF_ROAD }; }
export function districtAt(x, z) {
  if (x > SEA_X) return 'Harbor Bay';
  const ix = ROADS.findIndex((r, i) => i < 6 && x >= r && x < ROADS[i + 1]), iz = ROADS.findIndex((r, i) => i < 6 && z >= r && z < ROADS[i + 1]);
  if (ix < 0 || iz < 0) return x > 180 ? 'Harbor Quay' : 'City Outskirts';
  return { oldtown: 'Old Town', park: 'Central Park', garden: 'Community Garden', market: 'Market Street', downtown: 'Downtown', plaza: 'Fountain Plaza', residential: 'Maple Residences', cafe: 'Café Corner', school: 'Schoolyard', mixed: 'Midtown', construction: 'Construction Yard', harbor: 'Harbor Docks' }[BLOCK_TYPES[ix][iz]];
}
// Road segments removed (park & market pedestrianised)
function roadRemoved(x, z) {
  if (x > PARK.minX && x < PARK.maxX && z > PARK.minZ && z < PARK.maxZ) return true;
  if (x > MARKET.minX && x < MARKET.maxX && z > MARKET.minZ && z < MARKET.maxZ) return true;
  return false;
}
export function isRoad(x, z) {
  if (x > 186 + 10 || x < -186 || z < -186 || z > 186) return false;
  if (roadRemoved(x, z)) return false;
  for (const r of ROADS) { if (Math.abs(x - r) < HALF_ROAD && z > -186 && z < 186) return true; if (Math.abs(z - r) < HALF_ROAD && x > -186 && x < 186) return true; }
  return false;
}

export function buildCity(scene, physics) {
  const R = new RNG(20261102);
  const group = new THREE.Group(); scene.add(group);
  const out = { group, interact: [], mist: [], shards: [], lamps: [], sunSpots: [], benches: [], parkedCars: [], cafeCups: [], flowers: [], minimap: null, landmarks: [], walkNodes: [], spawn: new THREE.Vector3(-60, 0.15, -20), vendors: [], fishermen: [], dynamic: [], tallest: 0 };
  const solid = new Batcher(), flat = new Batcher(), foliage = new Batcher(), metal = new Batcher(), bulbs = new Batcher(), glass = new Batcher();
  const walls = [new Batcher(true), new Batcher(true)];
  const C = (box) => physics.add(box);
  const col = (x, z, w, d, top, tag, bottom = 0) => physics.addBox(x, z, w, d, top, tag, bottom);

  // ───────────── Terrain functions ─────────────
  const blocks = [];
  for (let ix = 0; ix < 6; ix++) for (let iz = 0; iz < 6; iz++) blocks.push({ ix, iz, type: BLOCK_TYPES[ix][iz], ...blockRect(ix, iz) });
  const inPond = (x, z) => (x - POND.x) ** 2 + (z - POND.z) ** 2 < POND.r * POND.r;
  physics.terrain = (x, z) => {
    if (x > SEA_X) return -2.6;
    if (inPond(x, z)) { const d = Math.sqrt((x - POND.x) ** 2 + (z - POND.z) ** 2) / POND.r; return -0.2 - (1 - d * d) * 0.9; }
    if (x < -186 || z < -186 || z > 186 || x > 186) return 0.15;
    if (isRoad(x, z)) return 0;
    return 0.15;
  };
  physics.waterAt = (x, z) => (x > SEA_X ? -0.35 : inPond(x, z) ? 0.08 : null);
  physics.bounds = 230;
  out.inPond = inPond;

  // ───────────── Ground texture (whole map) ─────────────
  const S = 512, PX = 4; // 512 m at 4 px/m
  const W2P = (v) => (v + S / 2) * PX;
  const groundTex = canvasTex(S * PX, S * PX, (g) => {
    g.fillStyle = '#7a9a58'; g.fillRect(0, 0, S * PX, S * PX); // outskirts grass
    // sidewalk base for city area
    g.fillStyle = '#bdb8ae'; g.fillRect(W2P(-186), W2P(-186), 372 * PX, 372 * PX);
    // block interiors
    for (const b of blocks) {
      const x = W2P(b.minX), z = W2P(b.minZ), w = (b.maxX - b.minX) * PX, d = (b.maxZ - b.minZ) * PX, i = 4 * PX;
      const fills = { park: '#6fae4e', garden: '#7aa850', residential: '#8ab45e', school: '#8ab45e', plaza: '#cfc4b2', market: '#c8b8a0', harbor: '#a4a29c', construction: '#b0a080', cafe: '#c8beb0' };
      if (fills[b.type]) { g.fillStyle = fills[b.type]; g.fillRect(x + i, z + i, w - 2 * i, d - 2 * i); }
      if (b.type === 'plaza') { // tile pattern
        g.strokeStyle = 'rgba(120,100,80,0.25)'; g.lineWidth = 1;
        for (let k = 0; k < w; k += 8) { g.beginPath(); g.moveTo(x + k, z); g.lineTo(x + k, z + d); g.stroke(); g.beginPath(); g.moveTo(x, z + k); g.lineTo(x + w, z + k); g.stroke(); }
        g.strokeStyle = 'rgba(160,120,90,0.5)'; g.lineWidth = 6; g.beginPath(); g.arc(x + w / 2, z + d / 2, 15 * PX, 0, TAU); g.stroke();
      }
    }
    // park: extend over removed roads
    g.fillStyle = '#6fae4e'; g.fillRect(W2P(PARK.minX + 4), W2P(PARK.minZ + 4), (PARK.maxX - PARK.minX - 8) * PX, (PARK.maxZ - PARK.minZ - 8) * PX);
    // park paths
    g.strokeStyle = '#d8c8a0'; g.lineCap = 'round'; g.lineWidth = 3.4 * PX;
    g.beginPath(); g.arc(W2P(POND.x), W2P(POND.z), (POND.r + 6) * PX, 0, TAU); g.stroke();
    const pp = [[-110, -110, -20, -20], [-110, -10, -76, -44], [-10, -110, -50, -70], [-60, -110, -60, -80], [-10, -60, -48, -60], [-30, -10, -40, -30]];
    for (const [a, b, c, d] of pp) { g.beginPath(); g.moveTo(W2P(a), W2P(b)); g.lineTo(W2P(c), W2P(d)); g.stroke(); }
    // dirt patches in park and gardens (dig spots drawn later)
    // market: pavers over removed road
    g.fillStyle = '#c8b49a'; g.fillRect(W2P(MARKET.minX + 4), W2P(MARKET.minZ + 4), (MARKET.maxX - MARKET.minX - 8) * PX, (MARKET.maxZ - MARKET.minZ - 8) * PX);
    g.strokeStyle = 'rgba(90,70,50,0.18)'; g.lineWidth = 1;
    for (let k = W2P(MARKET.minX); k < W2P(MARKET.maxX); k += 6) { g.beginPath(); g.moveTo(k, W2P(MARKET.minZ + 4)); g.lineTo(k, W2P(MARKET.maxZ - 4)); g.stroke(); }
    // roads
    g.fillStyle = '#4a4d52';
    for (const r of ROADS) {
      g.fillRect(W2P(r - HALF_ROAD), W2P(-186), 12 * PX, 372 * PX);
      g.fillRect(W2P(-186), W2P(r - HALF_ROAD), 372 * PX, 12 * PX);
    }
    // repaint removed segments
    g.fillStyle = '#6fae4e'; g.fillRect(W2P(PARK.minX + 4), W2P(PARK.minZ + 4), (PARK.maxX - PARK.minX - 8) * PX, (PARK.maxZ - PARK.minZ - 8) * PX);
    g.strokeStyle = '#d8c8a0'; g.lineWidth = 3.4 * PX;
    g.beginPath(); g.arc(W2P(POND.x), W2P(POND.z), (POND.r + 6) * PX, 0, TAU); g.stroke();
    for (const [a, b, c, d] of pp) { g.beginPath(); g.moveTo(W2P(a), W2P(b)); g.lineTo(W2P(c), W2P(d)); g.stroke(); }
    g.fillStyle = '#c8b49a'; g.fillRect(W2P(MARKET.minX + 4), W2P(MARKET.minZ + 4), (MARKET.maxX - MARKET.minX - 8) * PX, (MARKET.maxZ - MARKET.minZ - 8) * PX);
    // lane markings
    g.lineWidth = 0.18 * PX;
    for (const r of ROADS) for (let t = -186; t < 186; t += 6) {
      for (const [x, z, dx, dz] of [[r, t, 0, 3], [t, r, 3, 0]]) {
        const mx = x + dx / 2, mz = z + dz / 2;
        if (!isRoad(mx, mz)) continue;
        let nearX = false; for (const q of ROADS) if (Math.abs((dx ? mx : mz) - q) < 8) nearX = true;
        if (nearX) continue;
        g.strokeStyle = 'rgba(240,200,60,0.85)'; g.beginPath(); g.moveTo(W2P(x), W2P(z)); g.lineTo(W2P(x + dx), W2P(z + dz)); g.stroke();
      }
    }
    // crosswalks
    g.fillStyle = 'rgba(235,235,230,0.9)';
    for (const x of ROADS) for (const z of ROADS) {
      if (roadRemoved(x, z)) continue;
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = x + sx * 8.5, cz = z + sz * 8.5;
        if (!isRoad(cx, cz)) continue;
        for (let k = -5; k <= 4; k += 1.6) {
          if (sx) g.fillRect(W2P(cx - 1.2), W2P(z + k), 2.4 * PX, 0.8 * PX); else g.fillRect(W2P(x + k), W2P(cz - 1.2), 0.8 * PX, 2.4 * PX);
        }
      }
    }
    // harbor quay (concrete)
    g.fillStyle = '#a4a29c'; g.fillRect(W2P(186), W2P(-205), (SEA_X - 186) * PX, 410 * PX);
    // harbor quay edge line
    g.fillStyle = '#e0c040'; g.fillRect(W2P(SEA_X - 0.6), W2P(-186), 0.4 * PX, 372 * PX);
    // grime noise
    const r = new RNG(5);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${r.range(0.02, 0.07)})`; g.beginPath(); g.arc(r.range(0, S * PX), r.range(0, S * PX), r.range(1, 7), 0, TAU); g.fill(); }
  });
  groundTex.anisotropy = 8; groundTex.generateMipmaps = true; groundTex.minFilter = THREE.LinearMipmapLinearFilter;
  const detail = noiseTexture(256, 11, 1);
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 });
  groundMat.customProgramCacheKey = () => 'ground';
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(position,1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detailMap; varying vec2 vWorldXZ;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n float dn = texture2D(detailMap, vWorldXZ*0.35).r * 0.6 + texture2D(detailMap, vWorldXZ*0.05).r*0.4; diffuseColor.rgb *= 0.72 + dn*0.38;');
  };
  out.groundMat = groundMat;
  const worldUV = (geo) => { const p = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + S / 2) / S, 1 - (p.getZ(i) + S / 2) / S); return geo; };
  // Road-level plane
  {
    const g = new THREE.PlaneGeometry(S, S, 1, 1); g.rotateX(-Math.PI / 2); worldUV(g);
    const m = new THREE.Mesh(g, groundMat); m.receiveShadow = true; group.add(m);
  }
  // Raised blocks (sidewalk level 0.15) with curbs
  const curb = new Batcher();
  const raised = (minX, maxX, minZ, maxZ) => {
    const g = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, 1, 1); g.rotateX(-Math.PI / 2); g.translate((minX + maxX) / 2, 0.15, (minZ + maxZ) / 2); worldUV(g);
    const m = new THREE.Mesh(g, groundMat); m.receiveShadow = true; group.add(m);
    for (const [x, z, w, d] of [[(minX + maxX) / 2, minZ, maxX - minX, 0.3], [(minX + maxX) / 2, maxZ, maxX - minX, 0.3], [minX, (minZ + maxZ) / 2, 0.3, maxZ - minZ], [maxX, (minZ + maxZ) / 2, 0.3, maxZ - minZ]]) curb.box(x, 0.08, z, w, 0.16, d, 0x9a968e);
  };
  // city blocks: rows/cols merged where roads are removed
  for (const b of blocks) {
    if (b.type === 'park' || b.type === 'market') continue;
    raised(b.minX, b.maxX, b.minZ, b.maxZ);
  }
  raised(PARK.minX, PARK.maxX, PARK.minZ, PARK.maxZ);
  raised(MARKET.minX, MARKET.maxX, MARKET.minZ, MARKET.maxZ);
  // outskirts ring
  raised(-256, -186, -256, 256); raised(-186, SEA_X, -256, -186); raised(-186, SEA_X, 186, 256); raised(186, SEA_X, -186, 186);
  group.add(curb.build(MAT.batch, { cast: false }));

  // ───────────── Water ─────────────
  const wn = waterNormalTexture(256);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2a6a88, roughness: 0.08, metalness: 0.1, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.9 });
  out.waterMat = waterMat; out.waterNormal = wn;
  {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(800, 900), waterMat); sea.rotation.x = -Math.PI / 2; sea.position.set(SEA_X + 400, -0.35, 0); sea.receiveShadow = true; group.add(sea);
    const seabed = new THREE.Mesh(new THREE.PlaneGeometry(800, 900), new THREE.MeshStandardMaterial({ color: 0x1a3a40 })); seabed.rotation.x = -Math.PI / 2; seabed.position.set(SEA_X + 400, -2.6, 0); group.add(seabed);
    // quay wall
    solid.box(SEA_X - 0.5, -1.3, 0, 1, 3, 412, 0x8a8880);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.3, 48), waterMat); pond.rotation.x = -Math.PI / 2; pond.position.set(POND.x, 0.08, POND.z); pond.receiveShadow = true; group.add(pond);
    const bed = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 32), new THREE.MeshStandardMaterial({ color: 0x2a4a30 })); bed.rotation.x = -Math.PI / 2; bed.position.set(POND.x, 0.155, POND.z); bed.renderOrder = -1; group.add(bed);
    // stones around pond
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * TAU, rr = POND.r + R.range(-0.2, 0.6);
      flat.geo(jitteredIco(i, 0.25, 0), POND.x + Math.cos(a) * rr, 0.15, POND.z + Math.sin(a) * rr, R.pick([0x8a8a80, 0x9a968a, 0x7a7a72]), R.range(0, 6), R.range(0.8, 1.6), R.range(0.4, 0.7), R.range(0.8, 1.4));
    }
    // island with a tree
    flat.geo(jitteredIco(99, 0.15, 1), POND.x + 3, 0.0, POND.z - 2, 0x7a8a5a, 0, 5, 1.2, 4);
    col(POND.x + 3, POND.z - 2, 3.2, 2.6, 0.5, 'island');
    out.pondIsland = new THREE.Vector3(POND.x + 3, 0.5, POND.z - 2);
  }

  // ───────────── Helpers: props ─────────────
  const tree = (x, z, y = 0.15, kind = 'round', s = 1, noCol = false) => {
    const h = R.range(3.2, 5.2) * s;
    solid.geo(CYL6, x, y + h / 2, z, 0x6a4a32, R.range(0, 6), 0.32 * s, h, 0.32 * s);
    if (kind === 'pine') {
      for (let i = 0; i < 3; i++) foliage.geo(CONE, x, y + h * 0.55 + i * 1.3 * s, z, 0x2f6a3a, R.range(0, 6), (3.4 - i * 0.9) * s, 2.4 * s, (3.4 - i * 0.9) * s);
    } else {
      const c = kind === 'blossom' ? R.pick([0xf4b8cc, 0xf8c8d8, 0xeea8c0]) : kind === 'autumn' ? R.pick([0xd8862a, 0xc8562a, 0xe8b030]) : R.pick([0x4a8a3a, 0x5a9a3e, 0x3e7a34, 0x6aa040]);
      const n = R.int(3, 5);
      for (let i = 0; i < n; i++) {
        const a = R.range(0, TAU), rr = i === 0 ? 0 : R.range(0.8, 1.4) * s;
        const sc = (i === 0 ? 3.4 : R.range(2.0, 2.8)) * s;
        foliage.geo(jitteredIco(R.int(0, 999), 0.12, 1), x + Math.cos(a) * rr, y + h + (i === 0 ? 0.6 : R.range(-0.4, 0.5)) * s, z + Math.sin(a) * rr, c, R.range(0, 6), sc, sc * 0.85, sc);
      }
    }
    if (!noCol) col(x, z, 0.5 * s, 0.5 * s, y + h + 1, 'tree');
    // Canopy as a perch / leaves (birds, cats can't stand there)
    if (kind !== 'pine') col(x, z, 2.6 * s, 2.6 * s, y + h + 1.6 * s, 'canopy', y + h - 0.4 * s).noBlock = true;
  };
  const bush = (x, z, y = 0.15, s = 1, c) => {
    foliage.geo(jitteredIco(R.int(0, 999), 0.18, 1), x, y + 0.45 * s, z, c ?? R.pick([0x3e7a34, 0x4a8a3a, 0x52923e]), R.range(0, 6), 1.6 * s, 1.1 * s, 1.4 * s);
    out.interact.push({ type: 'bush', pos: new THREE.Vector3(x, y, z), r: 1.1 * s });
  };
  const lamp = (x, z, y = 0.15) => {
    metal.geo(CYL6, x, y + 2.3, z, 0x30343a, 0, 0.12, 4.6, 0.12);
    metal.geo(CYL6, x, y + 0.2, z, 0x30343a, 0, 0.3, 0.4, 0.3);
    solid.geo(BOX, x, y + 4.7, z, 0x30343a, 0, 0.5, 0.18, 0.5);
    bulbs.geo(SPHEREISH, x, y + 4.5, z, 0xffffff, 0, 0.36, 0.25, 0.36);
    col(x, z, 0.3, 0.3, y + 4.8, 'lamp');
    out.lamps.push(new THREE.Vector3(x, y + 4.5, z));
  };
  const bench = (x, z, rot, y = 0.15) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    let [ax, az] = P(0, 0); solid.geo(BOX, ax, y + 0.45, az, 0x9a6a3a, rot, 1.8, 0.08, 0.5);
    [ax, az] = P(0, -0.25); solid.geo(BOX, ax, y + 0.75, az, 0x9a6a3a, rot, 1.8, 0.4, 0.06);
    for (const lx of [-0.75, 0.75]) { [ax, az] = P(lx, 0); metal.geo(BOX, ax, y + 0.22, az, 0x30343a, rot, 0.08, 0.45, 0.5); }
    const w = Math.abs(c) > 0.5 ? 1.8 : 0.5, d = Math.abs(c) > 0.5 ? 0.5 : 1.8;
    col(x, z, w, d, y + 0.5, 'bench');
    out.benches.push({ pos: new THREE.Vector3(x, y, z), rot });
  };
  const trash = (x, z, y = 0.15) => {
    metal.geo(CYL, x, y + 0.45, z, 0x3a5a48, 0, 0.55, 0.9, 0.55);
    solid.geo(CYL, x, y + 0.92, z, 0x2a4a38, 0, 0.6, 0.06, 0.6);
    col(x, z, 0.55, 0.55, y + 0.95, 'trashcan');
    out.interact.push({ type: 'food', pos: new THREE.Vector3(x, y, z), r: 1.0, foods: ['trash', 'bread', 'chicken', 'chocolate'], label: 'Rummage in trash can', respawn: 90, icon: '🗑️' });
  };
  const hydrant = (x, z, y = 0.15) => { solid.geo(CYL, x, y + 0.35, z, 0xc83a2a, 0, 0.25, 0.7, 0.25); solid.geo(SPHEREISH, x, y + 0.72, z, 0xc83a2a, 0, 0.26, 0.2, 0.26); col(x, z, 0.3, 0.3, y + 0.8, 'hydrant'); };
  const crate = (x, z, y, s = 1, c = 0xa8804a) => { flat.geo(BOX, x, y + s / 2, z, c, R.range(-0.1, 0.1), s, s, s); col(x, z, s, s, y + s, 'crate'); };
  const planter = (x, z, y = 0.15) => { solid.box(x, y + 0.3, z, 1.6, 0.6, 1.6, 0x8a8478); out.flowers.push(flowerBed(x, z, y + 0.6, 1.3)); col(x, z, 1.6, 1.6, y + 0.6, 'planter'); };
  function flowerBed(x, z, y, size) {
    const n = Math.round(6 * size * size);
    const hue = R.pick([0xf05a7a, 0xf8d040, 0xb070e0, 0xffffff, 0xf08040, 0x60a0f0]);
    for (let i = 0; i < n; i++) {
      const fx = x + R.range(-size / 2, size / 2), fz = z + R.range(-size / 2, size / 2);
      const fh = R.range(0.18, 0.32);
      solid.geo(CYL6, fx, y + fh / 2, fz, 0x4a8a3a, 0, 0.025, fh, 0.025);
      solid.geo(SPHEREISH, fx, y + fh, fz, R.chance(0.8) ? hue : 0xffffff, R.range(0, 3), 0.17, 0.04, 0.17, R.range(-0.3, 0.3));
      solid.geo(SPHEREISH, fx, y + fh + 0.015, fz, 0xffd040, 0, 0.06, 0.04, 0.06);
      if (R.chance(0.5)) solid.geo(SPHEREISH, fx + 0.06, y + 0.06, fz, 0x5aa040, R.range(0, 3), 0.12, 0.03, 0.06);
    }
    const it = { type: 'flower', pos: new THREE.Vector3(x, y + 0.25, z), r: Math.max(1, size * 0.8), foods: ['nectar'], label: 'Sip nectar', respawn: 45, icon: '🌸', color: hue };
    out.interact.push(it); return it;
  }
  out.flowerBed = flowerBed;
  const car = (x, z, rot, y = 0) => {
    const c = R.pick([0xc83a3a, 0x3a6ac8, 0xe8e8e8, 0x2a2a2a, 0xe8c040, 0x5a9a6a, 0x8a8a90]);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    solid.geo(BOX, x, y + 0.6, z, c, rot, 1.8, 0.75, 4.2);
    const off = -0.2; solid.geo(BOX, x + sn * off, y + 1.2, z + cs * off, c, rot, 1.6, 0.55, 2.2);
    glass.geo(BOX, x + sn * off, y + 1.2, z + cs * off, 0x1a2a3a, rot, 1.62, 0.42, 2.0);
    for (const [lx, lz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) solid.geo(CYL, x + lx * cs + lz * sn, y + 0.35, z - lx * sn + lz * cs, 0x1a1a1a, rot, 0.7, 0.25, 0.7, 0, Math.PI / 2);
    const along = Math.abs(sn) > 0.5;
    col(x, z, along ? 4.2 : 1.8, along ? 1.8 : 4.2, y + 0.98, 'car');
    col(x + sn * off, z + cs * off, along ? 2.2 : 1.6, along ? 1.6 : 2.2, y + 1.48, 'carroof');
    out.parkedCars.push(new THREE.Vector3(x, y + 0.98, z));
    out.sunSpots.push({ pos: new THREE.Vector3(x + sn * 1.5, y + 0.98, z + cs * 1.5), r: 0.9, label: 'Warm car hood' });
  };
  out.makeCarParts = () => ({ solid, glass });

  // ───────────── Buildings ─────────────
  const winTex = [makeWindowTextures(0), makeWindowTextures(1)];
  const wallMats = winTex.map((t) => new THREE.MeshStandardMaterial({ vertexColors: true, map: t.albedo, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8 }));
  out.wallMats = wallMats;
  const CELLW = 3.2, ATL = 8;
  function wallGeo(cx, cz, w, d, y0, h, style) {
    const pos = [], nor = [], uv = [];
    const u0 = R.int(0, 7) / ATL, v0 = R.int(0, 7) / ATL;
    const faces = [
      [[cx - w / 2, cz + d / 2], [cx + w / 2, cz + d / 2], [0, 0, 1], w], [[cx + w / 2, cz + d / 2], [cx + w / 2, cz - d / 2], [1, 0, 0], d],
      [[cx + w / 2, cz - d / 2], [cx - w / 2, cz - d / 2], [0, 0, -1], w], [[cx - w / 2, cz - d / 2], [cx - w / 2, cz + d / 2], [-1, 0, 0], d],
    ];
    const cw = style === 1 ? 3.6 : CELLW;
    for (const [[ax, az], [bx, bz], n, len] of faces) {
      const U = Math.max(1, Math.round(len / cw)) / ATL, V = Math.max(1, Math.round(h / 3.2)) / ATL;
      const quad = [[ax, y0, az, 0, 0], [bx, y0, bz, U, 0], [bx, y0 + h, bz, U, V], [ax, y0, az, 0, 0], [bx, y0 + h, bz, U, V], [ax, y0 + h, az, 0, V]];
      for (const [x, y, z, u, v] of quad) { pos.push(x, y, z); nor.push(...n); uv.push(u + u0, v + v0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }
  const IDENT = new THREE.Matrix4();
  /** Building with flat roof, parapet, rooftop clutter, optional fire escape. */
  function building(cx, cz, w, d, h, color, opts = {}) {
    const y0 = 0.15, style = opts.style ?? 0;
    walls[style].add(wallGeo(cx, cz, w, d, y0, h, style), IDENT, color);
    solid.box(cx, y0 + 0.3, cz, w + 0.12, 0.6, d + 0.12, new THREE.Color(color).multiplyScalar(0.6)); // base
    solid.box(cx, y0 + h + 0.05, cz, w, 0.1, d, opts.roof ?? 0x6a6660); // roof slab
    const pc = new THREE.Color(color).multiplyScalar(0.8);
    const ph = opts.parapet ?? 0.5;
    if (ph > 0) for (const [x, z, ww, dd] of [[cx, cz - d / 2 + 0.15, w, 0.3], [cx, cz + d / 2 - 0.15, w, 0.3], [cx - w / 2 + 0.15, cz, 0.3, d], [cx + w / 2 - 0.15, cz, 0.3, d]]) {
      solid.box(x, y0 + h + ph / 2, z, ww, ph, dd, pc);
      col(x, z, ww, dd, y0 + h + ph, 'parapet', y0 + h);
    }
    const b = col(cx, cz, w, d, y0 + h + 0.1, opts.tag || 'building');
    b.roof = true;
    out.tallest = Math.max(out.tallest, y0 + h);
    // rooftop clutter
    if (opts.clutter !== false) {
      const n = Math.floor((w * d) / 80) + 1;
      for (let i = 0; i < n; i++) {
        const ax = cx + R.range(-w / 2 + 2, w / 2 - 2), az = cz + R.range(-d / 2 + 2, d / 2 - 2);
        if (R.chance(0.6)) { const s = R.range(1, 1.8); solid.box(ax, y0 + h + 0.1 + s * 0.4, az, s, s * 0.8, s * 1.2, 0xb0b0b0); col(ax, az, s, s * 1.2, y0 + h + 0.1 + s * 0.8, 'ac'); }
        else { solid.geo(CYL, ax, y0 + h + 1.6, az, 0x8a6a4a, 0, 2, 2.2, 2); metal.geo(CYL6, ax, y0 + h + 0.3, az, 0x404040, 0, 2.1, 0.5, 2.1); col(ax, az, 2, 2, y0 + h + 2.7, 'tank'); }
      }
    }
    // door
    if (opts.door) { const [dx, dz, rot] = opts.door; solid.geo(BOX, dx, y0 + 1.1, dz, 0x5a3a2a, rot, 1.4, 2.2, 0.15); }
    // fire escape (zig-zag platforms every 2.1 m) — lets cats climb to the roof
    if (opts.fireEscape) {
      const [side] = opts.fireEscape; // 'n','s','e','w'
      const nx = side === 'e' ? 1 : side === 'w' ? -1 : 0, nz = side === 's' ? 1 : side === 'n' ? -1 : 0;
      const fx = cx + nx * (w / 2 + 0.6), fz = cz + nz * (d / 2 + 0.6);
      const along = nx === 0; // platform spans along x
      for (let y = 2.3, i = 0; y < h - 0.5; y += 2.1, i++) {
        const off = (i % 2 ? 1 : -1) * 1.0;
        const px = fx + (along ? off : 0), pz = fz + (along ? 0 : off);
        metal.geo(BOX, px, y0 + y, pz, 0x2a2e34, 0, along ? 2.4 : 1.1, 0.08, along ? 1.1 : 2.4);
        metal.geo(BOX, px + (along ? 0 : nx * 0.55), y0 + y + 0.5, pz + (along ? nz * 0.55 : 0), 0x2a2e34, 0, along ? 2.4 : 0.04, 0.04, along ? 0.04 : 2.4);
        col(px, pz, along ? 2.4 : 1.1, along ? 1.1 : 2.4, y0 + y + 0.04, 'fireescape', y0 + y - 0.06);
      }
      // dumpster at the base
      const dx = fx + (along ? -2.6 : nx * 0.6), dz = fz + (along ? nz * 0.6 : -2.6);
      solid.geo(BOX, dx, y0 + 0.65, dz, 0x2a6a4a, 0, along ? 2 : 1.3, 1.3, along ? 1.3 : 2);
      solid.geo(BOX, dx, y0 + 1.33, dz, 0x1a4a3a, 0, along ? 2.05 : 1.35, 0.06, along ? 1.35 : 2.05);
      col(dx, dz, along ? 2 : 1.3, along ? 1.3 : 2, y0 + 1.36, 'dumpster');
      out.interact.push({ type: 'food', pos: new THREE.Vector3(dx, y0, dz), r: 1.6, foods: ['trash', 'chicken', 'fish', 'mouse', 'bread'], label: 'Search the dumpster', respawn: 80, icon: '🗑️' });
    }
    if (opts.awning) {
      const [ax, az, aw, ad, c] = opts.awning;
      solid.box(ax, y0 + 2.7, az, aw, 0.12, ad, c);
      col(ax, az, aw, ad, y0 + 2.76, 'awning', y0 + 2.62);
    }
    return b;
  }

  const OLD = [0xb86a50, 0xc8906a, 0xd8b890, 0xa85a48, 0xc8a080, 0x9a7a6a, 0xd0a878];
  const DOWN = [0x8aa0b8, 0xc0c8d0, 0x6a7888, 0xa8b8c8, 0x7a8a9a, 0xd8d0c0];
  const PASTEL = [0xf0d8b0, 0xc8e0d0, 0xe8c0c0, 0xd0d8f0, 0xf4e8c8, 0xe0d0e8];
  const HARB = [0xa8a8a0, 0x8a9aa8, 0xa0603a, 0x7a8a7a, 0xb0a890];

  function fillBlock(b) {
    const { minX, maxX, minZ, maxZ, type } = b;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, W = maxX - minX, D = maxZ - minZ;
    const inner = 4; // sidewalk width
    // street furniture on sidewalks (not for park/market which handle their own)
    if (!['park', 'market'].includes(type)) {
      for (let t = minX + 6; t < maxX - 4; t += 16) { lamp(t, minZ + 1.2); lamp(t + 8, maxZ - 1.2); }
      for (let t = minZ + 10; t < maxZ - 4; t += 16) { lamp(minX + 1.2, t); lamp(maxX - 1.2, t + 4); }
      if (R.chance(0.7)) trash(minX + 2.5, minZ + 2.5);
      if (R.chance(0.5)) hydrant(maxX - 1.5, maxZ - 2.5);
      if (type !== 'harbor' && type !== 'construction') { for (let t = minX + 12; t < maxX - 8; t += 20) tree(t, maxZ - 2, 0.15, 'round', 0.65); }
    }
    const L = { minX: minX + inner, maxX: maxX - inner, minZ: minZ + inner, maxZ: maxZ - inner };
    if (type === 'oldtown') {
      // perimeter row-houses with alleys, rooftops close together (cat parkour!)
      const lots = [];
      for (let x = L.minX; x < L.maxX - 5; ) { const w = R.range(8, 12); lots.push([x, L.minZ, Math.min(w, L.maxX - x), 13]); lots.push([x, L.maxZ - 13, Math.min(w, L.maxX - x), 13]); x += w + R.pick([0, 0, 1.8]); }
      for (const [x, z, w, d] of lots) {
        if (w < 4) continue;
        const h = R.range(6, 12.5);
        building(x + w / 2, z + d / 2, w - 0.2, d, h, R.pick(OLD), { fireEscape: R.chance(0.45) ? [z < cz ? 's' : 'n'] : null, parapet: 0.6, awning: R.chance(0.4) ? [x + w / 2, z < cz ? z + d + 0.8 : z - 0.8, w * 0.7, 1.6, R.pick([0xc83a3a, 0x2a7a5a, 0xe8b040, 0x3a5aa8])] : null });
      }
      // courtyard alley clutter
      for (let i = 0; i < 6; i++) crate(R.range(L.minX + 3, L.maxX - 3), R.range(cz - 6, cz + 6), 0.15, R.range(0.8, 1.2));
      tree(cx, cz, 0.15, 'round', 0.9);
      bench(cx + 4, cz, 0);
      out.interact.push({ type: 'food', pos: new THREE.Vector3(cx - 5, 0.15, cz + 2), r: 1.2, foods: ['catfood', 'milk'], label: 'Bowl left out for strays', respawn: 120, icon: '🥣', model: 'bowl' });
    } else if (type === 'downtown') {
      const n = R.chance(0.5) ? 1 : 2;
      if (n === 1) building(cx, cz, W - inner * 2 - 4, D - inner * 2 - 4, R.range(36, 72), R.pick(DOWN), { style: 1, parapet: 1.2 });
      else {
        building(cx - W / 4 + 1, cz, W / 2 - inner - 3, D - inner * 2 - 4, R.range(24, 56), R.pick(DOWN), { style: 1, parapet: 1 });
        building(cx + W / 4 - 1, cz, W / 2 - inner - 3, D - inner * 2 - 4, R.range(18, 46), R.pick(DOWN), { style: 1, parapet: 1 });
      }
      for (let i = 0; i < 4; i++) planter(minX + 6 + i * 12, minZ + 5.5);
      bench(cx, maxZ - 5, Math.PI);
    } else if (type === 'residential') {
      // 2x2 houses with yards and fences
      const hw = (W - inner * 2) / 2, hd = (D - inner * 2) / 2;
      for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) {
        const yx = L.minX + a * hw, yz = L.minZ + c * hd;
        const hx = yx + hw / 2 + (a ? -2 : 2), hz = yz + hd / 2 + (c ? -3 : 3);
        const bw = R.range(9, 12), bd = R.range(8, 10), bh = R.range(5.6, 7.2);
        const col1 = R.pick(PASTEL);
        building(hx, hz, bw, bd, bh, col1, { parapet: 0, clutter: false, door: [hx, hz + (c ? bd / 2 : -bd / 2), 0] });
        // hip roof
        const roofC = R.pick([0x8a3a2a, 0x3a4a5a, 0x5a3a2a, 0x4a5a4a]);
        solid.geo(new THREE.ConeGeometry(1, 1, 4, 1), hx, 0.15 + bh + 0.9, hz, roofC, Math.PI / 4, (bw / 2 + 0.8) * 1.42, 1.8, (bd / 2 + 0.8) * 1.42);
        col(hx, hz, bw * 0.6, bd * 0.6, 0.15 + bh + 0.9, 'roof');
        // fence around the yard (1.3 m high — cats walk along fence tops!)
        const fc = R.pick([0xf0f0ea, 0xa07a50, 0xe8e0d0]);
        const fx0 = yx + 1, fx1 = yx + hw - 1, fz0 = yz + 1, fz1 = yz + hd - 1;
        const fence = (x0, z0, x1, z1) => {
          const len = Math.hypot(x1 - x0, z1 - z0), alongX = Math.abs(x1 - x0) > 0.1;
          for (let t = 0; t <= len; t += 0.5) { const x = x0 + (x1 - x0) * (t / len), z = z0 + (z1 - z0) * (t / len); solid.geo(BOX, x, 0.15 + 0.6, z, fc, 0, 0.12, 1.2, 0.08); }
          solid.geo(BOX, (x0 + x1) / 2, 0.15 + 1.25, (z0 + z1) / 2, fc, 0, alongX ? len : 0.14, 0.1, alongX ? 0.14 : len);
          solid.geo(BOX, (x0 + x1) / 2, 0.15 + 0.5, (z0 + z1) / 2, fc, 0, alongX ? len : 0.1, 0.08, alongX ? 0.1 : len);
          col((x0 + x1) / 2, (z0 + z1) / 2, alongX ? len : 0.2, alongX ? 0.2 : len, 0.15 + 1.3, 'fence');
        };
        const gateZ = c ? fz0 : fz1; // gate toward street side
        fence(fx0, gateZ, (fx0 + fx1) / 2 - 1.5, gateZ); fence((fx0 + fx1) / 2 + 1.5, gateZ, fx1, gateZ);
        fence(a ? fx0 : fx1, fz0, a ? fx0 : fx1, fz1);
        // garden bed
        const gx = yx + hw / 2 + (a ? 3 : -3), gz = c ? fz1 - 3 : fz0 + 3;
        solid.box(gx, 0.2, gz, 4, 0.12, 2.2, 0x5a3a24);
        for (let i = 0; i < 8; i++) solid.geo(SPHEREISH, gx - 1.6 + (i % 4) * 1.05, 0.38, gz - 0.5 + Math.floor(i / 4), R.chance(0.5) ? 0x5ab040 : 0x3a8a30, 0, 0.6, 0.4, 0.6);
        out.interact.push({ type: 'food', pos: new THREE.Vector3(gx, 0.15, gz), r: 2.2, foods: R.chance(0.5) ? ['lettuce', 'carrot'] : ['carrot', 'lettuce', 'worm'], label: 'Nibble the vegetable patch', respawn: 70, icon: '🥬', guarded: true });
        if (R.chance(0.6)) { // doghouse + bowl
          const dx = yx + hw / 2 + (a ? -4 : 4), dz = gz;
          solid.box(dx, 0.75, dz, 1.4, 1.2, 1.4, R.pick([0xb04a3a, 0x8a6a4a]));
          solid.geo(new THREE.ConeGeometry(1, 1, 4, 1), dx, 1.7, dz, 0x5a3a2a, Math.PI / 4, 1.3, 0.7, 1.3);
          col(dx, dz, 1.4, 1.4, 1.5, 'doghouse');
          out.interact.push({ type: 'food', pos: new THREE.Vector3(dx + 1.2, 0.15, dz + 0.8), r: 1, foods: ['kibble', 'bone'], label: 'Eat from the dog bowl', respawn: 100, icon: '🥣', model: 'bowl' });
        } else bush(yx + hw / 2 + (a ? -4 : 4), gz);
        if (R.chance(0.5)) flowerBed(yx + hw / 2, c ? fz1 - 1.2 : fz0 + 1.2, 0.15, 1.6);
        tree(a ? fx0 + 2 : fx1 - 2, c ? fz0 + 2.5 : fz1 - 2.5, 0.15, R.chance(0.3) ? 'blossom' : 'round', 0.85);
        out.sunSpots.push({ pos: new THREE.Vector3(hx + (a ? -bw / 2 - 1 : bw / 2 + 1), 0.15, hz), r: 1.2, label: 'Sunny porch' });
      }
    } else if (type === 'plaza') {
      // fountain
      const fx = cx, fz = cz;
      solid.geo(CYL, fx, 0.45, fz, 0xb8b0a0, 0, 12, 0.6, 12); col(fx, fz, 9, 9, 0.75, 'fountain');
      const fw = new THREE.Mesh(new THREE.CircleGeometry(5.6, 32), waterMat); fw.rotation.x = -Math.PI / 2; fw.position.set(fx, 0.7, fz); group.add(fw);
      solid.geo(CYL, fx, 1.6, fz, 0xc8c0b0, 0, 1.2, 2.4, 1.2); solid.geo(CYL, fx, 2.9, fz, 0xc8c0b0, 0, 3.2, 0.3, 3.2);
      const top = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), waterMat); top.rotation.x = -Math.PI / 2; top.position.set(fx, 3.06, fz); group.add(top);
      col(fx, fz, 1.2, 1.2, 3.05, 'fountaintop');
      out.fountain = new THREE.Vector3(fx, 0.75, fz);
      out.interact.push({ type: 'water', pos: new THREE.Vector3(fx, 0.75, fz + 5.2), r: 2.2, label: 'Drink / bathe in the fountain', icon: '⛲', bath: true });
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; bench(fx + Math.cos(a) * 12, fz + Math.sin(a) * 12, -a + Math.PI / 2); }
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; planter(fx + Math.cos(a) * 19, fz + Math.sin(a) * 19); tree(fx + Math.cos(a + 0.4) * 19, fz + Math.sin(a + 0.4) * 19, 0.15, 'round', 0.9); }
      for (let t = minX + 6; t < maxX - 4; t += 16) { lamp(t, minZ + 1.2); lamp(t + 8, maxZ - 1.2); }
      // kiosk
      building(minX + 9, maxZ - 9, 5, 4, 3, 0xe8b040, { parapet: 0.2, clutter: false, awning: [minX + 9, maxZ - 11.6, 6, 1.4, 0xc83a3a] });
      out.interact.push({ type: 'food', pos: new THREE.Vector3(minX + 9, 0.15, maxZ - 12.5), r: 1.6, foods: ['sausage', 'bread'], label: 'Snack kiosk scraps', respawn: 90, icon: '🌭' });
      out.plaza = new THREE.Vector3(fx, 0.15, fz);
    } else if (type === 'cafe') {
      building(cx + 8, cz - 6, 24, 18, 9, 0xe8d8c0, { door: [cx + 8, cz + 3, 0], awning: [cx + 8, cz + 4, 22, 2.4, 0x2a6a4a] });
      // outdoor tables with cups (knock them off!)
      for (let i = 0; i < 6; i++) {
        const tx = cx - 12 + (i % 3) * 7, tz = cz + 9 + Math.floor(i / 3) * 6;
        metal.geo(CYL6, tx, 0.15 + 0.38, tz, 0x30343a, 0, 0.08, 0.76, 0.08);
        solid.geo(CYL, tx, 0.15 + 0.78, tz, 0xf0f0ea, 0, 1.0, 0.05, 1.0);
        col(tx, tz, 0.9, 0.9, 0.15 + 0.8, 'table');
        for (const s of [-1, 1]) { solid.geo(BOX, tx + s * 0.85, 0.15 + 0.25, tz, 0x8a5a3a, 0, 0.45, 0.06, 0.45); col(tx + s * 0.85, tz, 0.45, 0.45, 0.15 + 0.46, 'chair'); }
        out.cafeCups.push(new THREE.Vector3(tx + R.range(-0.25, 0.25), 0.15 + 0.81, tz + R.range(-0.25, 0.25)));
        if (i === 4) out.interact.push({ type: 'food', pos: new THREE.Vector3(tx, 0.15 + 0.8, tz), r: 1.0, foods: ['chocolate'], label: 'Chocolate cake on the table', respawn: 120, icon: '🍰' });
        if (i % 2 === 0) { metal.geo(CYL6, tx, 1.5, tz, 0xd0d0d0, 0, 0.05, 2.6, 0.05); solid.geo(new THREE.ConeGeometry(1, 1, 8, 1, true), tx, 2.7, tz, R.pick([0xe86a4a, 0xf0f0e8]), 0, 1.6, 0.5, 1.6); }
      }
      out.cafe = new THREE.Vector3(cx - 5, 0.15, cz + 12);
      for (let i = 0; i < 3; i++) planter(cx - 18 + i * 9, maxZ - 5.5);
    } else if (type === 'school') {
      building(cx, cz - 10, W - 14, 14, 10, 0xe8c8a0, { door: [cx, cz - 3, 0], fireEscape: ['w'] });
      // playground-yard: field with a goal
      solid.box(cx, 0.17, cz + 10, W - 16, 0.04, 16, 0x6aa850);
      for (const s of [-1, 1]) { metal.geo(BOX, cx + s * 14, 1.2, cz + 10, 0xf0f0f0, 0, 0.12, 2.2, 3.6); }
      out.schoolField = new THREE.Vector3(cx, 0.15, cz + 10);
    } else if (type === 'mixed') {
      const twoRows = R.chance(0.5);
      building(cx - W / 4 + 1, cz - (twoRows ? D / 4 : 0), W / 2 - inner - 3, twoRows ? D / 2 - inner - 3 : D - inner * 2 - 4, R.range(12, 26), R.pick([...DOWN, ...OLD]), { fireEscape: R.chance(0.5) ? ['e'] : null, awning: [cx - W / 4 + 1, minZ + 4.8, 10, 1.6, R.pick([0xc83a3a, 0x3a5aa8])] });
      building(cx + W / 4 - 1, cz, W / 2 - inner - 3, D - inner * 2 - 4, R.range(10, 22), R.pick([...DOWN, ...PASTEL]), {});
      if (twoRows) { tree(cx - W / 4, cz + D / 4, 0.15, 'round'); bench(cx - W / 4 + 4, cz + D / 4, 0); bush(cx - W / 4 - 5, cz + D / 4 + 3); }
    } else if (type === 'harbor') {
      building(cx - 4, cz, 26, D - inner * 2 - 8, R.range(7, 10), R.pick(HARB), { parapet: 0.3, fireEscape: ['e'], clutter: true });
      // crates stacks — a climbing playground
      for (let i = 0; i < 5; i++) { const x = maxX - 6 - R.range(0, 6), z = minZ + 8 + i * 8; crate(x, z, 0.15, 1.2, R.pick([0xa8804a, 0x3a6aa8, 0xc84a3a])); if (R.chance(0.6)) crate(x + R.range(-0.2, 0.2), z, 1.35, 1.0); if (R.chance(0.3)) crate(x, z + 1.3, 0.15, 1.2); }
    } else if (type === 'construction') {
      // half-built structure + crane
      for (let f = 0; f < 4; f++) {
        solid.box(cx, 0.15 + f * 3.2 + 3.1, cz, 22, 0.2, 18, 0x9a9a98);
        col(cx, cz, 22, 18, 0.15 + f * 3.2 + 3.2, 'slab', 0.15 + f * 3.2 + 3.0);
        for (const [px, pz] of [[-10, -8], [10, -8], [-10, 8], [10, 8], [0, 0]]) { solid.box(cx + px, 0.15 + f * 3.2 + 1.5, cz + pz, 0.5, 3.0, 0.5, 0x8a8a88); col(cx + px, cz + pz, 0.5, 0.5, 0.15 + f * 3.2 + 3.0, 'pillar'); }
      }
      // stair-like girders to climb
      for (let i = 0; i < 6; i++) { crate(cx + 12.5, cz - 6 + i * 1.3, 0.15, 1.1, 0xd0a030); }
      for (let i = 0; i < 4; i++) crate(cx + 12.5, cz + 2.5 + i * 0.01, 1.25 + i * 0.0, 1.0, 0xd0a030);
      metal.geo(BOX, cx - 16, 20, cz - 14, 0xe8b020, 0, 1.2, 40, 1.2); col(cx - 16, cz - 14, 1.2, 1.2, 40, 'crane');
      metal.geo(BOX, cx - 4, 40.5, cz - 14, 0xe8b020, 0, 28, 1, 1); col(cx - 4, cz - 14, 28, 1, 41, 'cranearm', 40);
      solid.box(cx + 4, 0.6, cz + 12, 6, 0.9, 3, 0xa08a6a); col(cx + 4, cz + 12, 6, 3, 1.05, 'sand');
      out.crane = new THREE.Vector3(cx + 8, 41, cz - 14);
      // dig spots in sand
      out.interact.push({ type: 'dig', pos: new THREE.Vector3(cx + 8, 0.15, cz + 12), r: 1.5, label: 'Dig in the sand', icon: '🕳️', foods: ['bone', 'worm'] });
    } else if (type === 'garden') {
      // community garden
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        const gx = L.minX + 6 + i * 9.5, gz = L.minZ + 6 + j * 11;
        solid.box(gx, 0.3, gz, 6, 0.3, 3, 0x6a4a2a); col(gx, gz, 6, 3, 0.45, 'bed');
        for (let k = 0; k < 10; k++) solid.geo(SPHEREISH, gx - 2.5 + (k % 5) * 1.25, 0.55, gz - 0.6 + Math.floor(k / 5) * 1.2, R.pick([0x5ab040, 0x3a8a30, 0x7ac050]), 0, 0.7, 0.45, 0.7);
        const foods = [['lettuce', 'worm'], ['carrot', 'clover'], ['berries', 'lettuce'], ['clover', 'carrot']][(i + j) % 4];
        out.interact.push({ type: 'food', pos: new THREE.Vector3(gx, 0.45, gz), r: 2.4, foods, label: 'Garden bed', respawn: 60, icon: '🥬', guarded: false });
      }
      // greenhouse
      glass.box(maxX - 9, 1.9, maxZ - 9, 9, 3.5, 7, 0x9ad0c0);
      col(maxX - 9, maxZ - 9, 9, 7, 3.7, 'greenhouse');
      out.greenhouse = new THREE.Vector3(maxX - 9, 3.7, maxZ - 9);
      for (let i = 0; i < 3; i++) tree(minX + 8 + i * 14, maxZ - 7, 0.15, 'round', 1.0);
      out.interact.push({ type: 'food', pos: new THREE.Vector3(minX + 22, 0.15, maxZ - 7), r: 2, foods: ['apple', 'fruit'], label: 'Fallen apples', respawn: 80, icon: '🍎' });
      out.interact.push({ type: 'dig', pos: new THREE.Vector3(minX + 6, 0.15, cz), r: 1.5, label: 'Dig in the compost', icon: '🕳️', foods: ['worm', 'carrot'] });
      flowerBed(cx, maxZ - 14, 0.15, 3); flowerBed(cx - 12, maxZ - 14, 0.15, 2.4);
      // scarecrow
      solid.geo(CYL6, cx + 6, 1.1, cz, 0x6a4a2a, 0, 0.12, 2.2, 0.12); solid.box(cx + 6, 1.6, cz, 1.6, 0.12, 0.12, 0x6a4a2a); solid.geo(SPHEREISH, cx + 6, 2.3, cz, 0xe8d090, 0, 0.5, 0.5, 0.5); solid.geo(new THREE.ConeGeometry(0.5, 0.4, 8), cx + 6, 2.6, cz, 0x8a6a3a);
    }
  }
  for (const b of blocks) if (b.type !== 'park' && b.type !== 'market') fillBlock(b);

  // ───────────── Park ─────────────
  {
    const P = PARK;
    for (let t = P.minX + 4; t < P.maxX; t += 14) { lamp(t, P.minZ + 1.2); lamp(t, P.maxZ - 1.2); }
    for (let t = P.minZ + 10; t < P.maxZ; t += 14) { lamp(P.minX + 1.2, t); lamp(P.maxX - 1.2, t); }
    // trees around but not on paths / pond
    let placed = 0;
    for (let i = 0; i < 400 && placed < 70; i++) {
      const x = R.range(P.minX + 4, P.maxX - 4), z = R.range(P.minZ + 4, P.maxZ - 4);
      const dp = Math.hypot(x - POND.x, z - POND.z);
      if (dp < POND.r + 9) continue;
      if (Math.abs(x - (-12)) < 9 && Math.abs(z - (-100)) < 10) continue; // playground
      // avoid diagonal path roughly
      if (Math.abs((x - z)) < 4 || Math.abs(x + 60) < 3 || Math.abs(z + 60) < 3) continue;
      tree(x, z, 0.15, R.chance(0.15) ? 'blossom' : R.chance(0.15) ? 'autumn' : 'round', R.range(0.85, 1.25)); placed++;
      if (R.chance(0.3)) bush(x + R.range(-3, 3), z + R.range(-3, 3), 0.15, R.range(0.8, 1.3));
    }
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + 0.2; bench(POND.x + Math.cos(a) * (POND.r + 9.5), POND.z + Math.sin(a) * (POND.r + 9.5), -a - Math.PI / 2); }
    // flower beds
    for (const [x, z, s] of [[-30, -30, 3], [-92, -30, 2.5], [-30, -92, 2.5], [-100, -100, 2], [-20, -60, 2.2], [-60, -20, 2.2], [-88, -76, 2], [-44, -40, 2]]) flowerBed(x, z, 0.15, s);
    // bird feeder near pond
    metal.geo(CYL6, -42, 1.0, -70, 0x5a3a2a, 0, 0.1, 1.8, 0.1); solid.geo(new THREE.ConeGeometry(0.5, 0.4, 4), -42, 2.1, -70, 0x8a3a2a, Math.PI / 4); solid.box(-42, 1.85, -70, 0.5, 0.3, 0.5, 0xd8b070);
    col(-42, -70, 0.2, 0.2, 2.2, 'feeder');
    out.interact.push({ type: 'food', pos: new THREE.Vector3(-42, 0.15, -70), r: 1.6, foods: ['seeds'], label: 'Seeds under the bird feeder', respawn: 40, icon: '🌻' });
    // warm rocks for basking
    for (const [x, z] of [[-96, -46], [-24, -78], [-80, -100]]) { flat.geo(jitteredIco(x, 0.2, 1), x, 0.15, z, 0x9a9488, R.range(0, 6), 3, 1.4, 2.4); col(x, z, 2.2, 1.6, 0.75, 'rock'); out.sunSpots.push({ pos: new THREE.Vector3(x, 0.75, z), r: 1.4, label: 'Warm rock', rock: true }); }
    // dig spots (dirt)
    for (const [x, z] of [[-100, -62], [-20, -24], [-70, -100], [-38, -100]]) { solid.geo(new THREE.CylinderGeometry(1, 1.2, 0.08, 10), x, 0.17, z, 0x6a4a30); out.interact.push({ type: 'dig', pos: new THREE.Vector3(x, 0.15, z), r: 1.4, label: 'Dig here', icon: '🕳️', foods: ['bone', 'worm', 'clover'] }); }
    // clover patches
    for (const [x, z] of [[-50, -100], [-104, -20], [-14, -42]]) { for (let i = 0; i < 20; i++) solid.geo(SPHEREISH, x + R.range(-1.5, 1.5), 0.18, z + R.range(-1.5, 1.5), 0x5ab84a, 0, 0.3, 0.1, 0.3); out.interact.push({ type: 'food', pos: new THREE.Vector3(x, 0.15, z), r: 1.8, foods: ['clover'], label: 'Clover patch', respawn: 50, icon: '🍀' }); }
    // playground near (-12,-100)
    const px = -16, pz = -100;
    metal.geo(BOX, px, 1.25, pz - 2, 0xe84a3a, 0, 1.4, 2.5, 1.4); col(px, pz - 2, 1.4, 1.4, 2.6, 'slidetop');
    solid.geo(BOX, px, 1.3, pz + 0.9, 0x3a8ae8, 0, 0.9, 0.08, 4.6, -0.5); col(px, pz + 0.3, 0.9, 1.2, 1.9, 'slide'); col(px, pz + 1.6, 0.9, 1.4, 1.0, 'slide');
    for (let i = 0; i < 4; i++) col(px - 0.9, pz - 2 - 0.6 + 0.01, 0.4, 0.4, 0.6 + i * 0.6 > 2.6 ? 2.6 : 0.6 + i * 0.6, 'ladder');
    solid.box(px - 0.9, 1.25, pz - 2, 0.3, 2.5, 0.6, 0xe8e040);
    metal.geo(BOX, px + 6, 1.4, pz, 0x30343a, 0, 0.12, 2.8, 0.12); metal.geo(BOX, px + 10, 1.4, pz, 0x30343a, 0, 0.12, 2.8, 0.12); metal.geo(BOX, px + 8, 2.8, pz, 0x30343a, 0, 4.2, 0.12, 0.12);
    out.swings = [new THREE.Vector3(px + 7, 2.8, pz), new THREE.Vector3(px + 9, 2.8, pz)];
    solid.box(px + 3, 0.18, pz, 16, 0.05, 10, 0xd8c090);
    out.playground = new THREE.Vector3(px + 3, 0.15, pz);
    // puddles (butterfly puddling)
    for (const [x, z] of [[-74, -24], [-30, -64]]) { const pud = new THREE.Mesh(new THREE.CircleGeometry(1.1, 16), waterMat); pud.rotation.x = -Math.PI / 2; pud.position.set(x, 0.17, z); group.add(pud); out.interact.push({ type: 'food', pos: new THREE.Vector3(x, 0.15, z), r: 1.4, foods: ['minerals'], label: 'Muddy puddle', respawn: 30, icon: '💧', water: true }); }
    out.interact.push({ type: 'water', pos: new THREE.Vector3(POND.x + POND.r + 0.5, 0.15, POND.z), r: 2, label: 'Drink from the pond', icon: '💧' });
    out.interact.push({ type: 'food', pos: new THREE.Vector3(out.pondIsland.x, 0.5, out.pondIsland.z), r: 1.6, foods: ['egg'], label: 'Duck nest', respawn: 150, icon: '🪺' });
    out.parkCenter = new THREE.Vector3(-60, 0.15, -60);
  }
  // ───────────── Outskirts: hedge/tree wall ─────────────
  for (let t = -200; t <= 200; t += 7) {
    tree(-195 + R.range(-3, 3), t, 0.15, 'pine', R.range(1.2, 1.7), true);
    if (t < SEA_X) { tree(t, -195 + R.range(-3, 3), 0.15, 'pine', R.range(1.2, 1.7), true); tree(t, 195 + R.range(-3, 3), 0.15, R.chance(0.5) ? 'pine' : 'round', R.range(1.2, 1.6), true); }
  }
  col(-200, 0, 12, 420, 60, 'boundary'); col(0, -200, 420, 12, 60, 'boundary'); col(0, 200, 420, 12, 60, 'boundary');
  col(MAP_MAX_X + 5, 0, 10, 420, 60, 'boundary').noCam = true;
  physics.boxes.filter((b) => b.tag === 'boundary').forEach((b) => (b.noCam = true));

  // ───────────── Market street ─────────────
  {
    const stalls = [
      { foods: ['fish'], label: 'Fish stall', icon: '🐟', c: 0x3a7ac8, items: 0xb8c8d8 },
      { foods: ['lettuce', 'carrot'], label: 'Vegetable stall', icon: '🥬', c: 0x3aa85a, items: 0x6ac040 },
      { foods: ['fruit', 'apple', 'berries'], label: 'Fruit stall', icon: '🍑', c: 0xe8a030, items: 0xf06a3a },
      { foods: ['bone', 'sausage', 'chicken'], label: 'Butcher stall', icon: '🥩', c: 0xc83a3a, items: 0xd86a6a },
      { foods: ['bread', 'seeds'], label: 'Bakery stall', icon: '🍞', c: 0xd8b070, items: 0xe8c080 },
      { foods: ['egg', 'milk'], label: 'Dairy & eggs', icon: '🥚', c: 0xf0f0e8, items: 0xfaf4e0 },
    ];
    let i = 0;
    for (let z = MARKET.minZ + 8; z < MARKET.maxZ - 6; z += 13) for (const side of [-1, 1]) {
      const s = stalls[i++ % stalls.length];
      const x = side * 6.5;
      solid.box(x, 0.15 + 0.5, z, 2.2, 1.0, 4, 0x8a6a4a); // counter
      solid.box(x, 0.15 + 1.08, z, 2.0, 0.16, 3.8, s.items); // goods
      for (let k = 0; k < 6; k++) solid.geo(SPHEREISH, x + R.range(-0.7, 0.7), 0.15 + 1.2, z + R.range(-1.6, 1.6), s.items, 0, 0.3, 0.18, 0.4);
      for (const dz of [-1.9, 1.9]) for (const dx of [-1, 1]) metal.geo(CYL6, x + dx, 0.15 + 1.4, z + dz, 0x5a5a5a, 0, 0.08, 2.8, 0.08);
      // striped awning (walkable for cats)
      for (let k = 0; k < 6; k++) solid.box(x, 0.15 + 2.85 + (side * (k - 2.5)) * 0.0, z - 2 + k * 0.8 + 0.4, 2.8, 0.1, 0.8, k % 2 ? 0xffffff : s.c);
      col(x, z, 2.2, 4, 0.15 + 1.16, 'stall');
      col(x, z, 2.8, 4.8, 0.15 + 2.92, 'awning', 0.15 + 2.78);
      const vendorPos = new THREE.Vector3(x + side * 2.0, 0.15, z);
      const it = { type: 'food', pos: new THREE.Vector3(x - side * 1.3, 0.15, z), r: 1.6, foods: s.foods, label: s.label, respawn: 45, icon: s.icon, steal: true, vendorPos };
      out.interact.push(it); out.vendors.push({ pos: vendorPos, face: -side, stall: it });
    }
    for (let z = MARKET.minZ + 2; z < MARKET.maxZ; z += 12) { lamp(-2, z); lamp(2, z + 6); }
    // shop buildings on either side of the market
    for (const side of [-1, 1]) for (let z = MARKET.minZ + 6; z < MARKET.maxZ - 6; z += 14) {
      building(side * 30, z + 6, 30, 12, R.range(8, 14), R.pick([...OLD, ...PASTEL]), { fireEscape: R.chance(0.4) ? [side > 0 ? 'w' : 'e'] : null, awning: [side * 13.5, z + 6, 2.4, 9, R.pick([0xc83a3a, 0x2a7a5a, 0xe8b040])] });
    }
    out.market = new THREE.Vector3(0, 0.15, 30);
  }

  // ───────────── Harbor quay, piers, boats ─────────────
  {
    for (let z = -170; z < 180; z += 16) { lamp(SEA_X - 2, z); metal.geo(CYL6, SEA_X - 0.8, 0.4, z + 8, 0x2a2a2a, 0, 0.35, 0.5, 0.35); col(SEA_X - 0.8, z + 8, 0.35, 0.35, 0.65, 'bollard'); }
    out.boats = [];
    for (const pz of [-120, -40, 40, 120]) {
      const len = 34;
      solid.box(SEA_X + len / 2, 0.0, pz, len, 0.3, 4, 0x8a6a48);
      for (let t = 0; t < len; t += 4) for (const s of [-1.8, 1.8]) solid.geo(CYL6, SEA_X + t + 2, -1.2, pz + s, 0x5a4a3a, 0, 0.3, 2.6, 0.3);
      col(SEA_X + len / 2, pz, len, 4, 0.15, 'pier');
      for (let k = 0; k < 3; k++) crate(SEA_X + 6 + k * 9, pz + R.pick([-1, 1]), 0.15, 1.0, R.pick([0xa8804a, 0x3a6aa8]));
      out.fishermen.push({ pos: new THREE.Vector3(SEA_X + len - 1.2, 0.15, pz + 1.3), face: Math.PI / 2 });
      out.interact.push({ type: 'food', pos: new THREE.Vector3(SEA_X + len - 2.5, 0.15, pz + 0.3), r: 1.8, foods: ['fish'], label: 'Fisherman\'s bucket', respawn: 60, icon: '🪣', fisher: true });
      // moored boat (bobbing, dynamic)
      out.boats.push({ x: SEA_X + 14, z: pz + 6.5, rot: 0 });
    }
    out.pierEnd = new THREE.Vector3(SEA_X + 33, 0.15, 120);
  }

  // ───────────── Parked cars along roads ─────────────
  for (const r of ROADS) for (let t = -170; t < 170; t += R.range(14, 30)) {
    if (R.chance(0.5)) continue;
    const z = t, x = r + 4.6; // parked on east edge of N-S roads
    if (isRoad(x, z) && isRoad(x, z + 3) && isRoad(x, z - 3) && !ROADS.some((q) => Math.abs(z - q) < 12)) car(x, z, 0);
    const x2 = t, z2 = r - 4.6;
    if (isRoad(x2, z2) && isRoad(x2 + 3, z2) && isRoad(x2 - 3, z2) && !ROADS.some((q) => Math.abs(x2 - q) < 12)) car(x2, z2, Math.PI / 2);
  }

  // ───────────── Build batched meshes ─────────────
  group.add(walls[0].build(wallMats[0]), walls[1].build(wallMats[1]));
  group.add(solid.build(MAT.batch));
  group.add(flat.build(MAT.batchFlat));
  group.add(foliage.build(MAT.foliage));
  group.add(metal.build(MAT.metal));
  const gl = glass.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.75 }), { cast: false });
  group.add(gl);
  const lampMesh = bulbs.build(MAT.lamp, { cast: false, receive: false }); group.add(lampMesh);

  // ───────────── Grass tufts (instanced) ─────────────
  out.buildGrass = (count) => {
    const blade = new THREE.BufferGeometry();
    const P = [], Cc = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI, c = Math.cos(a) * 0.12, s = Math.sin(a) * 0.12;
      P.push(-c, 0, -s, c, 0, s, 0, 0.42, 0);
      Cc.push(0.25, 0.42, 0.18, 0.25, 0.42, 0.18, 0.6, 0.85, 0.35);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); blade.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); blade.computeVertexNormals();
    // normals up for nicer lighting
    const N = blade.attributes.normal; for (let i = 0; i < N.count; i++) N.setXYZ(i, 0, 1, 0);
    const mesh = new THREE.InstancedMesh(blade, MAT.grass, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const gr = new RNG(42); let n = 0;
    const zones = [PARK, ...blocks.filter((b) => ['residential', 'garden', 'school'].includes(b.type))];
    for (let i = 0; i < count * 3 && n < count; i++) {
      const zn = i % 3 === 0 ? PARK : zones[gr.int(0, zones.length - 1)];
      const x = gr.range(zn.minX + 4.5, zn.maxX - 4.5), z = gr.range(zn.minZ + 4.5, zn.maxZ - 4.5);
      if (inPond(x, z) || Math.hypot(x - POND.x, z - POND.z) < POND.r + 1.5) continue;
      if (zn === PARK && Math.abs(Math.hypot(x - POND.x, z - POND.z) - (POND.r + 6)) < 2) continue;
      const list = physics.query(x, z, 0.2); if (list.some((b) => b.top > 0.5 && b.tag !== 'canopy')) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), gr.range(0, TAU)); const s = gr.range(0.7, 1.4); sc.set(s, s * gr.range(0.7, 1.3), s); p.set(x, 0.15, z);
      m.compose(p, q, sc); mesh.setMatrixAt(n++, m);
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    return mesh;
  };

  // ───────────── Mist zones & Echo shards ─────────────
  out.mist = [
    { id: 'm1', name: 'Park Rift', tier: 1, pos: new THREE.Vector3(-96, 0.15, -88) },
    { id: 'm2', name: 'Alley Rift', tier: 1, pos: new THREE.Vector3(-150, 0.15, -90) },
    { id: 'm3', name: 'Market Rift', tier: 2, pos: new THREE.Vector3(-22, 0.15, 48) },
    { id: 'm4', name: 'Garden Rift', tier: 2, pos: new THREE.Vector3(-150, 0.15, 100) },
    { id: 'm5', name: 'Dockside Rift', tier: 3, pos: new THREE.Vector3(186, 0.15, 80) },
    { id: 'm6', name: 'Plaza Rift', tier: 3, pos: new THREE.Vector3(104, 0.15, -72) },
    { id: 'm7', name: 'Construction Rift', tier: 4, pos: new THREE.Vector3(160, 0.15, -160) },
    { id: 'm8', name: 'The Heart Rift', tier: 5, pos: new THREE.Vector3(60, 0.15, -150) },
  ];
  out.shards = [
    { id: 's1', pos: out.pondIsland.clone().add(new THREE.Vector3(-0.8, 0.6, 0.6)), hint: 'On the pond island' },
    { id: 's2', pos: new THREE.Vector3(-16, 3.2, -102), hint: 'Atop the playground slide' },
    { id: 's3', pos: new THREE.Vector3(-150, 0.8, -150), hint: 'Hidden in an Old Town courtyard' },
    { id: 's4', pos: out.greenhouse.clone().add(new THREE.Vector3(0, 0.7, 0)), hint: 'On the greenhouse roof' },
    { id: 's5', pos: out.pierEnd.clone().add(new THREE.Vector3(0, 0.7, 0)), hint: 'At the end of the south pier' },
    { id: 's6', pos: out.fountain.clone().add(new THREE.Vector3(0, 2.9, 0)), hint: 'Top of the plaza fountain' },
    { id: 's7', pos: out.crane.clone().add(new THREE.Vector3(0, 0.8, 0)), hint: 'On the crane arm (flyers only)' },
    { id: 's8', pos: new THREE.Vector3(0, 0.8, 52), hint: 'End of Market Street' },
    { id: 's9', pos: new THREE.Vector3(-150, 0.8, 150), hint: 'Behind a house in Maple Residences' },
    { id: 's10', pos: new THREE.Vector3(30, out.tallest + 1, -30), hint: 'Somewhere very high' },
  ];
  // the 10th shard sits on the actual tallest roof
  {
    let best = null; for (const b of physics.boxes) if (b.roof && (!best || b.top > best.top)) best = b;
    if (best) out.shards[9].pos.set((best.minX + best.maxX) / 2, best.top + 0.8, (best.minZ + best.maxZ) / 2);
  }
  // an old-town roof shard (cats can climb)
  {
    const roofs = physics.boxes.filter((b) => b.roof && b.minX > -180 && b.maxX < -120 && b.minZ > -180 && b.maxZ < -10 && b.top < 13);
    if (roofs.length) { const b = roofs[Math.floor(roofs.length / 2)]; out.shards[2].pos.set((b.minX + b.maxX) / 2, b.top + 0.8, (b.minZ + b.maxZ) / 2); out.shards[2].hint = 'On an Old Town rooftop'; }
  }

  // ───────────── Minimap image ─────────────
  out.minimap = (() => {
    const N = 512, sc = N / 460, o = 230;
    const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    g.fillStyle = '#5a7a48'; g.fillRect(0, 0, N, N);
    g.fillStyle = '#b8b2a8'; g.fillRect((-186 + o) * sc, (-186 + o) * sc, 382 * sc, 372 * sc);
    for (const b of blocks) { const f = { park: '#6faa52', garden: '#7aa850', residential: '#9ab870', school: '#9ab870', plaza: '#d8ccb8' }[b.type]; if (f) { g.fillStyle = f; g.fillRect((b.minX + o) * sc, (b.minZ + o) * sc, (b.maxX - b.minX) * sc, (b.maxZ - b.minZ) * sc); } }
    g.fillStyle = '#6faa52'; g.fillRect((PARK.minX + o) * sc, (PARK.minZ + o) * sc, (PARK.maxX - PARK.minX) * sc, (PARK.maxZ - PARK.minZ) * sc);
    g.fillStyle = '#3a4048';
    for (const r of ROADS) { g.fillRect((r - 6 + o) * sc, (-186 + o) * sc, 12 * sc, 372 * sc); g.fillRect((-186 + o) * sc, (r - 6 + o) * sc, 372 * sc, 12 * sc); }
    g.fillStyle = '#6faa52'; g.fillRect((PARK.minX + 4 + o) * sc, (PARK.minZ + 4 + o) * sc, (PARK.maxX - PARK.minX - 8) * sc, (PARK.maxZ - PARK.minZ - 8) * sc);
    g.fillStyle = '#d8c8a8'; g.fillRect((MARKET.minX + 4 + o) * sc, (MARKET.minZ + 4 + o) * sc, (MARKET.maxX - MARKET.minX - 8) * sc, (MARKET.maxZ - MARKET.minZ - 8) * sc);
    g.fillStyle = '#3a7aa8'; g.fillRect((SEA_X + o) * sc, 0, N, N);
    g.beginPath(); g.arc((POND.x + o) * sc, (POND.z + o) * sc, POND.r * sc, 0, TAU); g.fill();
    for (const b of physics.boxes) if (b.roof || b.tag === 'building' || b.tag === 'greenhouse') { const h = clamp(b.top / 70, 0, 1); g.fillStyle = `rgb(${120 - h * 50},${118 - h * 50},${130 - h * 40})`; g.fillRect((b.minX + o) * sc, (b.minZ + o) * sc, (b.maxX - b.minX) * sc, (b.maxZ - b.minZ) * sc); }
    return { canvas: c, scale: sc, offset: o, size: N };
  })();
  out.landmarks = [
    { name: 'Central Park', pos: out.parkCenter }, { name: 'Fountain Plaza', pos: out.plaza }, { name: 'Market St.', pos: out.market },
    { name: 'Café', pos: out.cafe }, { name: 'Harbor', pos: new THREE.Vector3(205, 0, 0) }, { name: 'Old Town', pos: new THREE.Vector3(-150, 0, -100) },
    { name: 'Residences', pos: new THREE.Vector3(-110, 0, 120) }, { name: 'Garden', pos: new THREE.Vector3(-30, 0, -150) }, { name: 'Construction', pos: new THREE.Vector3(150, 0, -150) },
  ];
  out.isRoad = isRoad;
  return out;
}
const SPHEREISH = new THREE.SphereGeometry(0.5, 8, 6);
