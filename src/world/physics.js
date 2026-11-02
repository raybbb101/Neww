// Lightweight collision world: axis-aligned boxes (optionally rotated 90°), spatial hash, terrain height function.
const CELL = 12;
export class CollisionWorld {
  constructor() { this.boxes = []; this.grid = new Map(); this.dynamic = []; this.terrain = () => 0; this.waterAt = () => null; this.bounds = 1e9; }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  /** box: {minX,maxX,minZ,maxZ,top,bottom=0,tag} */
  add(b) {
    b.bottom ??= 0; this.boxes.push(b);
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL), z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this.key(x, z); let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(b);
    }
    return b;
  }
  addBox(cx, cz, w, d, top, tag, bottom = 0) { return this.add({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top, bottom, tag }); }
  query(x, z, r, out = []) {
    out.length = 0; this._stamp = (this._stamp || 0) + 1;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = this.grid.get(this.key(cx, cz)); if (!a) continue;
      for (const b of a) { if (b._s === this._stamp) continue; b._s = this._stamp; if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) out.push(b); }
    }
    for (const b of this.dynamic) if (b.active !== false && x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) out.push(b);
    return out;
  }
  /** Height of the highest walkable surface under (x,z) that is reachable from height y (with step). */
  groundAt(x, z, y, r = 0.1, step = 0.45) {
    let g = this.terrain(x, z);
    const list = this.query(x, z, r * 0.5, this._q1 || (this._q1 = []));
    let tag = null;
    for (const b of list) if (b.top <= y + step && b.top > g && (b.bottom <= y + step || b.bottom <= g)) { g = b.top; tag = b; }
    this.lastGroundBox = tag;
    return g;
  }
  /** Push a circle at (p.x,p.z) of radius r out of boxes that block it at feet height y. Mutates p. Returns true if collided. */
  resolve(p, r, y, height, step = 0.45) {
    let hit = false; this.lastWall = null;
    const list = this.query(p.x, p.z, r + 0.05, this._q2 || (this._q2 = []));
    for (const b of list) {
      if (b.top <= y + step) continue;            // can step/stand on it
      if (b.bottom >= y + height) continue;        // passes under (e.g. awnings, bridges)
      if (b.noBlock) continue;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), push = r - d; p.x += (dx / d) * push; p.z += (dz / d) * push; }
      else {
        // center inside box — push out along shortest axis
        const l = p.x - b.minX, rr = b.maxX - p.x, f = p.z - b.minZ, k = b.maxZ - p.z, m = Math.min(l, rr, f, k);
        if (m === l) p.x = b.minX - r; else if (m === rr) p.x = b.maxX + r; else if (m === f) p.z = b.minZ - r; else p.z = b.maxZ + r;
      }
      hit = true; this.lastWall = b;
    }
    const B = this.bounds; if (p.x < -B) { p.x = -B; hit = true; } if (p.x > B) { p.x = B; hit = true; } if (p.z < -B) { p.z = -B; hit = true; } if (p.z > B) { p.z = B; hit = true; }
    return hit;
  }
  /** Ceiling above y at (x,z) (for not jumping through awnings/bridges). */
  ceilingAt(x, z, y, r) {
    let c = Infinity; const list = this.query(x, z, r * 0.5, this._q3 || (this._q3 = []));
    for (const b of list) if (b.bottom > y + 0.05 && b.bottom < c && b.bottom > 0.01) c = b.bottom;
    return c;
  }
  /** Segment (a→b) vs boxes taller than minTop: returns fraction t (0..1) of first hit or 1. Used by camera. */
  raycast(ax, ay, az, bx, by, bz, minTop = 1.5) {
    let tMin = 1;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / CELL));
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; const x = ax + dx * t, z = az + dz * t;
      const list = this.query(x, z, CELL * 0.75, this._q4 || (this._q4 = []));
      for (const b of list) {
        if (seen.has(b) || b.top < minTop || b.noCam || b.noBlock) continue; seen.add(b);
        // slab test in 3D
        let t0 = 0, t1 = 1;
        const test = (o, d, mn, mx) => {
          if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
          let ta = (mn - o) / d, tb = (mx - o) / d; if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); return t0 <= t1;
        };
        if (test(ax, dx, b.minX, b.maxX) && test(ay, dy, b.bottom, b.top) && test(az, dz, b.minZ, b.maxZ) && t0 < tMin) tMin = t0;
      }
    }
    return tMin;
  }
}
