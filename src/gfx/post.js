import * as THREE from 'three';

// HD-2D pipeline:
//  A) world (layer 0) at full resolution      → rtA (+depth)
//  B) "sprites" (layer 1: creatures, NPCs, monsters, foliage) at low resolution → rtB (+depth)
//  C) composite: depth-merge B over A with nearest-neighbour pixels, outlines, palette posterize
//  D) half-res blur (DOF) + quarter-res blur (bloom)
//  E) final: depth-of-field, bloom, grading, vignette, ACES tone map, sRGB
export const SPRITE_LAYER = 1;
export function toSprite(obj) {
  obj.traverse((o) => { if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.material?.map && !o.material.depthWrite) o.layers.set(0); else o.layers.set(SPRITE_LAYER); });
  return obj;
}
const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const LIN = `uniform float near; uniform float far; float lin(float d){ float z = d*2.0-1.0; return 2.0*near*far/(far+near - z*(far-near)); }`;

function rt(w, h, depth, type) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: !!depth });
  if (depth) { t.depthTexture = new THREE.DepthTexture(Math.max(1, w), Math.max(1, h)); t.depthTexture.type = THREE.UnsignedIntType; }
  return t;
}

export class Post {
  constructor(renderer) {
    this.r = renderer; this.enabled = true; this.quality = 'high'; this.pixelScale = 3;
    this.type = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false; this.scene.add(this.quad);
    this.focus = 6; this.dof = 1; this.bloom = 0.55; this.exposure = 1; this.grade = new THREE.Vector3(1.04, 1.0, 0.94); this.vignette = 0.38;
    this.matComp = new THREE.ShaderMaterial({
      uniforms: { tA: { value: null }, tAd: { value: null }, tB: { value: null }, tBd: { value: null }, resB: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 1000 } },
      vertexShader: VERT,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tA, tAd, tB, tBd; uniform vec2 resB; ${LIN}
        vec3 poster(vec3 c){ vec3 g = sqrt(max(c, 0.0)); g = floor(g*14.0+0.5)/14.0; return g*g; }
        void main(){
          vec2 tb = 1.0/resB; vec2 uvB = (floor(vUv*resB)+0.5)*tb;
          vec3 a = texture2D(tA, vUv).rgb; float da = lin(texture2D(tAd, vUv).r);
          vec4 b = texture2D(tB, uvB); float rb = texture2D(tBd, uvB).r; float db = lin(rb);
          bool solid = rb < 0.99999 && db < da + 0.08;
          vec3 col = a; float depth = da;
          vec2 off[4]; off[0]=vec2(1.,0.); off[1]=vec2(-1.,0.); off[2]=vec2(0.,1.); off[3]=vec2(0.,-1.);
          if (solid) {
            col = poster(b.rgb); depth = db;
            // inner contour lines where a much closer part overlaps
            float k = 0.12 + db*0.015;
            for (int i=0;i<4;i++){ float rn = texture2D(tBd, uvB+off[i]*tb).r; if (rn < 0.99999 && lin(rn) < db - k) { col *= 0.45; break; } }
          } else {
            float best = 1e9; vec3 nc = vec3(0.0);
            for (int i=0;i<4;i++){ vec2 u = uvB+off[i]*tb; float rn = texture2D(tBd, u).r; if (rn < 0.99999){ float dn = lin(rn); if (dn < da + 0.08 && dn < best){ best = dn; nc = texture2D(tB, u).rgb; } } }
            if (best < 1e8) { col = poster(nc)*0.16 + vec3(0.012,0.008,0.02); depth = best; }
            else if (rb >= 0.99999) col += b.rgb; // depthless glows (halos)
          }
          gl_FragColor = vec4(col, depth);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.matBlur = new THREE.ShaderMaterial({
      uniforms: { t: { value: null }, dir: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform vec2 dir;
        void main(){ vec4 s = texture2D(t, vUv)*0.227;
          s += (texture2D(t, vUv+dir*1.38)+texture2D(t, vUv-dir*1.38))*0.316;
          s += (texture2D(t, vUv+dir*3.23)+texture2D(t, vUv-dir*3.23))*0.07;
          gl_FragColor = s; }`,
      depthTest: false, depthWrite: false,
    });
    this.matFinal = new THREE.ShaderMaterial({
      uniforms: { tC: { value: null }, tH: { value: null }, tQ: { value: null }, focus: { value: 6 }, dof: { value: 1 }, bloom: { value: 0.5 }, exposure: { value: 1 }, grade: { value: this.grade }, vig: { value: 0.38 }, useBlur: { value: 1 }, time: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tC, tH, tQ; uniform float focus, dof, bloom, exposure, vig, useBlur, time; uniform vec3 grade;
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
        vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }
        void main(){
          vec4 c = texture2D(tC, vUv); vec3 col = c.rgb; float d = c.a;
          if (useBlur > 0.5) {
            vec3 h = texture2D(tH, vUv).rgb; vec3 q = texture2D(tQ, vUv).rgb;
            float range = focus*0.45 + 1.0;
            float back = smoothstep(focus + range, focus + range + focus*2.2 + 6.0, d);
            float front = 1.0 - smoothstep(focus*0.25, focus*0.7, d);
            float tilt = smoothstep(0.3, 0.55, abs(vUv.y - 0.47)) * 0.75;
            float coc = clamp(max(max(back, front*0.9), tilt), 0.0, 1.0) * dof;
            col = mix(col, mix(h, q, smoothstep(0.5, 1.0, coc)), coc);
            vec3 bl = max(q - vec3(0.78), 0.0) + max(h - vec3(1.05), 0.0)*0.5;
            col += bl * bloom * 1.4;
          }
          col *= exposure * grade;
          col = aces(col * 1.08);
          float l = dot(col, vec3(0.299,0.587,0.114)); col = mix(vec3(l), col, 1.12);
          vec2 v = vUv - 0.5; col *= 1.0 - vig * smoothstep(0.25, 0.85, dot(v,v)*1.9);
          gl_FragColor = vec4(toSRGB(clamp(col,0.0,1.0)), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.matPix = new THREE.ShaderMaterial({ // for the menu preview
      uniforms: { t: { value: null }, res: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform vec2 res;
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
        void main(){ vec2 tb = 1.0/res; vec2 u = (floor(vUv*res)+0.5)*tb; vec4 c = texture2D(t, u);
          if (c.a < 0.5) { float n = 0.0; n += texture2D(t, u+vec2(tb.x,0.)).a; n += texture2D(t, u-vec2(tb.x,0.)).a; n += texture2D(t, u+vec2(0.,tb.y)).a; n += texture2D(t, u-vec2(0.,tb.y)).a;
            if (n > 0.5) { gl_FragColor = vec4(0.07,0.05,0.1,1.0); return; } discard; }
          vec3 g = sqrt(max(c.rgb,0.0)); g = floor(g*14.0+0.5)/14.0; vec3 col = aces(g*g*1.1);
          gl_FragColor = vec4(pow(col, vec3(1.0/2.2)), 1.0); }`,
      depthTest: false, depthWrite: false, transparent: true,
    });
    this.size = new THREE.Vector2(); this.setSize();
  }
  setSize() {
    const r = this.r; r.getDrawingBufferSize(this.size);
    const W = this.size.x, H = this.size.y;
    this.pixelScale = Math.max(2, Math.round(H / 290));
    const bw = Math.ceil(W / this.pixelScale), bh = Math.ceil(H / this.pixelScale);
    for (const k of ['A', 'B', 'C', 'H1', 'H2', 'Q1', 'Q2']) this['rt' + k]?.dispose();
    this.rtA = rt(W, H, true, this.type);
    this.rtB = rt(bw, bh, true, this.type); this.rtB.texture.minFilter = this.rtB.texture.magFilter = THREE.NearestFilter;
    this.rtC = rt(W, H, false, this.type);
    this.rtH1 = rt(W >> 1, H >> 1, false, this.type); this.rtH2 = rt(W >> 1, H >> 1, false, this.type);
    this.rtQ1 = rt(W >> 2, H >> 2, false, this.type); this.rtQ2 = rt(W >> 2, H >> 2, false, this.type);
    this.matComp.uniforms.resB.value.set(bw, bh);
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }
  blur(src, a, b, steps = 1) {
    const u = this.matBlur.uniforms;
    for (let i = 0; i < steps; i++) {
      u.t.value = i === 0 ? src.texture : b.texture; u.dir.value.set(1 / a.width, 0); this.pass(this.matBlur, a);
      u.t.value = a.texture; u.dir.value.set(0, 1 / a.height); this.pass(this.matBlur, b);
    }
  }
  render(scene, camera) {
    const r = this.r;
    const bg = scene.background; const oldClear = r.getClearAlpha(); const oldColor = r.getClearColor(new THREE.Color());
    camera.layers.set(0); r.setRenderTarget(this.rtA); r.clear(); r.render(scene, camera);
    // sprites
    camera.layers.set(SPRITE_LAYER); scene.background = null; r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtB); r.clear(); r.render(scene, camera);
    scene.background = bg; r.setClearColor(oldColor, oldClear); camera.layers.enableAll();
    const cu = this.matComp.uniforms;
    cu.tA.value = this.rtA.texture; cu.tAd.value = this.rtA.depthTexture; cu.tB.value = this.rtB.texture; cu.tBd.value = this.rtB.depthTexture; cu.near.value = camera.near; cu.far.value = camera.far;
    this.pass(this.matComp, this.rtC);
    const hq = this.quality !== 'low';
    if (hq) { this.blur(this.rtC, this.rtH1, this.rtH2, 1); this.blur(this.rtH2, this.rtQ1, this.rtQ2, 2); }
    const fu = this.matFinal.uniforms;
    fu.tC.value = this.rtC.texture; fu.tH.value = this.rtH2.texture; fu.tQ.value = this.rtQ2.texture; fu.useBlur.value = hq ? 1 : 0;
    fu.focus.value = this.focus; fu.dof.value = this.dof; fu.bloom.value = this.bloom; fu.exposure.value = this.exposure; fu.vig.value = this.vignette;
    this.pass(this.matFinal, null);
  }
  /** Draw a scene pixelated into a screen rectangle (GL coords, bottom-left origin). */
  renderPixel(scene, camera, x, y, w, h) {
    const r = this.r, ps = this.pixelScale * 0.85, pr = r.getPixelRatio();
    const bw = Math.max(8, Math.round(w * pr / ps)), bh = Math.max(8, Math.round(h * pr / ps));
    if (!this.rtP || this.rtP.width !== bw || this.rtP.height !== bh) { this.rtP?.dispose(); this.rtP = rt(bw, bh, true, this.type); this.rtP.texture.minFilter = this.rtP.texture.magFilter = THREE.NearestFilter; }
    const oldColor = r.getClearColor(new THREE.Color()), oa = r.getClearAlpha();
    r.setClearColor(0, 0); r.setRenderTarget(this.rtP); r.clear(); r.render(scene, camera); r.setClearColor(oldColor, oa);
    this.matPix.uniforms.t.value = this.rtP.texture; this.matPix.uniforms.res.value.set(bw, bh);
    r.setRenderTarget(null); r.setViewport(x, y, w, h); r.setScissor(x, y, w, h); r.setScissorTest(true);
    this.quad.material = this.matPix; r.autoClear = false; r.render(this.scene, this.cam); r.autoClear = true;
    r.setScissorTest(false);
  }
}
