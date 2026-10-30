// SAENSA — scroll-driven 3D hero.
// Pipeline per frame:
//   1. world (field) -> HDR render target
//   2. two-pass gaussian blur of that target (the out-of-focus "real world" around the tablet)
//   3. background quad: blurred world fading into brand navy
//   4. studio scene: the tablet; its screen samples the sharp world target in screen space (AR passthrough)
//      and composites the holographic HUD canvas on top.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createWorld } from './world.js';
import { HUD } from './hud.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const lerp = (a, b, t) => a + (b - a) * t;

// Piecewise ramp over the scroll timeline T: [[t, v], ...]
function ramp(T, pts, curve = ease) {
  if (T <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
    if (T <= t1) return lerp(v0, v1, curve((T - t0) / (t1 - t0)));
  }
  return pts[pts.length - 1][1];
}

function sampleKeys(keys, T, props) {
  const out = {};
  if (T <= keys[0].t) { props.forEach((p) => (out[p] = keys[0][p])); return out; }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (T <= b.t) {
      const u = ease((T - a.t) / (b.t - a.t));
      props.forEach((p) => (out[p] = Array.isArray(a[p]) ? a[p].map((v, j) => lerp(v, b[p][j], u)) : lerp(a[p], b[p], u)));
      return out;
    }
  }
  props.forEach((p) => (out[p] = keys[keys.length - 1][p]));
  return out;
}

const GLSL_COMMON = /* glsl */ `
  vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
  vec3 toSRGB(vec3 c){ return mix(1.055*pow(c, vec3(1.0/2.4)) - 0.055, c*12.92, step(c, vec3(0.0031308))); }
  vec3 grade(vec3 hdr, float exposure){
    vec3 c = aces(hdr*exposure);
    c = pow(c, vec3(0.96,1.0,1.06));      // gentle warm split
    return toSRGB(c);
  }`;

const NAVY = new THREE.Color('#0D111D');

function main() {
  const canvas = document.getElementById('scene');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const lite = coarse || Math.min(innerWidth, innerHeight) < 700;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    document.documentElement.classList.add('no-webgl');
    return null;
  }
  let dpr = Math.min(devicePixelRatio || 1, lite ? 1.5 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;

  // ---------- render targets ----------
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true };
  const rtWorld = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, samples: lite ? 0 : 4 });
  const rtA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const rtB = rtA.clone();

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const blurMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: quadVert,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
        c += texture2D(tSrc, vUv + uDir*1.3846153).rgb * 0.3162162;
        c += texture2D(tSrc, vUv - uDir*1.3846153).rgb * 0.3162162;
        c += texture2D(tSrc, vUv + uDir*3.2307692).rgb * 0.0702702;
        c += texture2D(tSrc, vUv - uDir*3.2307692).rgb * 0.0702702;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const bgMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      tBlur: { value: rtB.texture }, uDark: { value: 0 }, uGrid: { value: 0 }, uTime: { value: 0 },
      uAspect: { value: 1 }, uExposure: { value: 0.82 }, uNavy: { value: new THREE.Vector3(NAVY.r, NAVY.g, NAVY.b) },
      uGlowX: { value: 0.7 },
    },
    vertexShader: quadVert,
    fragmentShader: `${GLSL_COMMON}
      uniform sampler2D tBlur; uniform float uDark, uGrid, uTime, uAspect, uExposure, uGlowX; uniform vec3 uNavy; varying vec2 vUv;
      float gridLines(vec2 p){ vec2 w = fwidth(p); vec2 g = abs(fract(p) - 0.5); vec2 l = 1.0 - smoothstep(vec2(0.0), w*1.4, 0.5 - g); return max(l.x, l.y); }
      void main(){
        vec3 w = grade(texture2D(tBlur, vUv).rgb, uExposure);
        float l = dot(w, vec3(0.299,0.587,0.114));
        w = mix(w, vec3(l), 0.2) * 0.62;
        vec3 navy = toSRGB(uNavy);
        vec2 c = vUv - 0.5; c.x *= uAspect;
        vec3 col = mix(w, navy, uDark);
        // warm residual glow behind the tablet, a memory of the field's sun
        float glow = exp(-dot(vec2((vUv.x-uGlowX)*uAspect, vUv.y-0.48), vec2((vUv.x-uGlowX)*uAspect, vUv.y-0.48))*3.0);
        col += vec3(0.78,0.36,0.2) * glow * 0.09 * uDark * (1.0 - uGrid*0.6);
        // data floor grid for the lower sections
        if (uGrid > 0.0 && vUv.y < 0.46) {
          float d = 0.46 - vUv.y;
          float z = 0.18 / d;
          vec2 p = vec2(c.x * z * 1.6, z * 1.2 + uTime * 0.12);
          float g = gridLines(p) * smoothstep(0.0, 0.12, d) * exp(-z * 0.12);
          float pulse = smoothstep(0.92, 1.0, sin(p.y * 0.8 - uTime * 2.0 + floor(p.x) * 1.7));
          col += (vec3(0.35,0.75,0.9) * 0.10 + vec3(0.9,0.45,0.25) * pulse * 0.18) * g * uGrid;
        }
        col *= 1.0 - dot(c, c) * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const quad = new THREE.Mesh(quadGeo, blurMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---------- world ----------
  const world = createWorld(renderer, { lite });

  // ---------- studio (tablet) ----------
  const studio = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  studio.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight(new THREE.Color(1.0, 0.8, 0.62), 2.2);
  key.position.set(-3, 2, 2);
  const rim = new THREE.DirectionalLight(new THREE.Color(0.55, 0.75, 1.0), 3.0);
  rim.position.set(3, 1.5, -2);
  studio.add(key, rim);
  const studioCam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  const tanH = Math.tan(THREE.MathUtils.degToRad(16));

  let portrait = innerWidth / innerHeight < 0.85;
  const hud = new HUD(portrait);

  const screenMat = new THREE.ShaderMaterial({
    uniforms: {
      tWorld: { value: rtWorld.texture }, tHud: { value: hud.texture }, uRes: { value: new THREE.Vector2(1, 1) },
      uHudOn: { value: 0 }, uDim: { value: 0 }, uGlass: { value: 0 }, uExposure: { value: 0.82 }, uTime: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `${GLSL_COMMON}
      uniform sampler2D tWorld, tHud; uniform vec2 uRes; uniform float uHudOn, uDim, uGlass, uExposure, uTime;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vec2 suv = gl_FragCoord.xy / uRes;
        vec3 col = grade(texture2D(tWorld, suv).rgb, uExposure);
        // screen processing: cool cast + contrast when the interface is live
        float l = dot(col, vec3(0.299,0.587,0.114));
        col = mix(col, mix(vec3(l), col, 0.85) * vec3(0.92,1.0,1.06), uHudOn * 0.5);
        col = mix(col, col * vec3(0.28,0.36,0.44), uDim);
        vec4 h = texture2D(tHud, vUv);
        col = col * (1.0 - h.a * 0.55) + h.rgb * h.a * 1.05;
        // scanlines + inner vignette
        col *= 1.0 - uHudOn * 0.035 * (0.5 + 0.5 * sin(gl_FragCoord.y * 2.2));
        vec2 sc = suv - 0.5; sc.x *= uRes.x / uRes.y;
        col *= mix(1.0 - dot(sc, sc) * 0.55, 1.0, uGlass);
        vec2 e = vUv * (1.0 - vUv);
        col *= mix(1.0, pow(clamp(e.x * e.y * 18.0, 0.0, 1.0), 0.22), uGlass * 0.6);
        // glass: fresnel sheen + soft diagonal reflection band
        float fr = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 3.0);
        float band = smoothstep(0.22, 0.0, abs(vUv.x * 0.65 + vUv.y * 0.55 - 0.82)) * 0.06 + smoothstep(0.06, 0.0, abs(vUv.x * 0.65 + vUv.y * 0.55 - 1.02)) * 0.03;
        col += (band + fr * 0.25) * uGlass;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const tablet = new THREE.Group();
  studio.add(tablet);
  let screen, tabletW, tabletH;
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x24272d, metalness: 1, roughness: 0.3, envMapIntensity: 1.3 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x030405, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x0a1424, roughness: 0.1, clearcoat: 1, metalness: 0.4 });

  function roundedRect(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  function buildTablet() {
    tablet.children.slice().forEach((c) => { tablet.remove(c); c.geometry.dispose(); });
    tabletW = portrait ? 1.0 : 1.6;
    tabletH = portrait ? 1.6 : 1.0;
    const B = 0.07, R = 0.09, depth = 0.032, bt = 0.008;
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(roundedRect(tabletW + 2 * B - 2 * bt, tabletH + 2 * B - 2 * bt, R - bt), { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 6, curveSegments: 24 }).translate(0, 0, -depth / 2),
      bodyMat
    );
    const front = depth / 2 + bt;
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(tabletW + 2 * B - 0.022, tabletH + 2 * B - 0.022, R - 0.012), 24), glassMat);
    glass.position.z = front + 0.0004;
    screen = new THREE.Mesh(new THREE.PlaneGeometry(tabletW, tabletH), screenMat);
    screen.position.z = front + 0.0012;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.009, 24), lensMat);
    lens.position.set(portrait ? 0 : -tabletW / 2 - B / 2, portrait ? tabletH / 2 + B / 2 : 0, front + 0.0008);
    tablet.add(body, glass, screen, lens);
  }
  buildTablet();

  // ---------- layout + scroll timeline ----------
  const story = document.getElementById('story');
  let vw = innerWidth, vh = innerHeight, aspect = vw / vh;
  let heroLen = 1, howLen = 1, storyEnd = 1;
  let tabletKeys = [];
  const res = new THREE.Vector2();

  function layoutKeys() {
    const a = aspect, P = portrait;
    const Wt = tabletW + 0.16, Ht = tabletH + 0.16;
    const hh = (d) => d * tanH, hw = (d) => d * tanH * a;
    const fit = (fw, fh) => Math.max(Wt / (2 * tanH * a * fw), Ht / (2 * tanH * fh));
    const d0 = Math.min(tabletH / (2 * tanH), tabletW / (2 * tanH * a)) * 0.955;
    const k0 = { t: 0, x: 0, y: 0, z: -d0, rx: 0, ry: 0, rz: 0 };
    const d1 = fit(0.84, 0.78);
    const k1 = { t: 0.5, x: 0, y: P ? -hh(d1) * 0.02 : 0, z: -d1, rx: -0.03, ry: 0.06, rz: 0 };
    let k2, k3;
    if (!P) {
      const d2 = fit(0.5, 0.64);
      k2 = { t: 0.88, x: hw(d2) * 0.42, y: -hh(d2) * 0.03, z: -d2, rx: -0.05, ry: -0.36, rz: 0.012 };
      const d3 = fit(0.54, 0.78);
      k3 = { t: 1.08, x: hw(d3) * 0.37, y: -hh(d3) * 0.02, z: -d3, rx: -0.02, ry: -0.2, rz: 0 };
    } else {
      const d2 = fit(0.8, 0.48);
      k2 = { t: 0.88, x: 0, y: -hh(d2) * 0.4, z: -d2, rx: -0.16, ry: 0.06, rz: 0 };
      const d3 = fit(0.86, 0.54);
      k3 = { t: 1.08, x: 0, y: hh(d3) * 0.2, z: -d3, rx: -0.04, ry: 0, rz: 0 };
    }
    const k4 = { ...k3, t: 2.6, y: k3.y + hh(-k3.z) * 2.4, z: k3.z - 1.2, rx: 0.7, ry: k3.ry - 0.35 };
    tabletKeys = [k0, k1, k2, { ...k2, t: 1.0 }, k3, { ...k3, t: 2.02 }, k4];
    bgMat.uniforms.uGlowX.value = P ? 0.5 : 0.7;
  }

  function resize() {
    vw = Math.max(1, innerWidth); vh = Math.max(1, innerHeight); aspect = vw / vh;
    renderer.setSize(vw, vh, false);
    renderer.getDrawingBufferSize(res);
    rtWorld.setSize(res.x, res.y);
    const bw = Math.max(1, Math.round(res.x / 4)), bh = Math.max(1, Math.round(res.y / 4));
    rtA.setSize(bw, bh); rtB.setSize(bw, bh);
    screenMat.uniforms.uRes.value.copy(res);
    bgMat.uniforms.uAspect.value = aspect;
    world.camera.aspect = aspect;
    world.camera.fov = aspect < 1 ? 64 : 42; // keep the field's horizontal framing on phones
    world.camera.updateProjectionMatrix();
    studioCam.aspect = aspect; studioCam.updateProjectionMatrix();
    const p = aspect < 0.85;
    if (p !== portrait) { portrait = p; hud.setOrientation(p); buildTablet(); }
    layoutKeys();
    const storyLen = Math.max(2, story.offsetHeight - vh);
    heroLen = storyLen * 0.42;
    howLen = storyLen - heroLen;
    storyEnd = story.offsetHeight;
  }

  function timelineFromScroll(y) {
    if (y <= heroLen) return y / heroLen;
    if (y <= heroLen + howLen) return 1 + (y - heroLen) / howLen;
    return 2 + clamp01((y - heroLen - howLen) / vh) + Math.max(0, (y - storyEnd) / vh) * 0.0001;
  }
  function scrollForT(T) {
    if (T <= 1) return T * heroLen;
    if (T <= 2) return heroLen + (T - 1) * howLen;
    return heroLen + howLen + (T - 2) * vh;
  }

  // World camera choreography: pos / target per timeline key.
  const S = (i, a) => 1 + i * 0.25 + a;
  const worldKeys = [
    { t: 0, pos: [-0.34, 0.78, 3.45], tgt: [0.24, 0.5, 0.4] },
    { t: 1.0, pos: [-0.12, 0.9, 3.05], tgt: [0.24, 0.46, 0.4] },
    { t: S(0, 0.07), pos: [0.12, 0.44, 2.3], tgt: [0.4, 0.22, 1.6] },
    { t: S(0, 0.2), pos: [0.12, 0.44, 2.3], tgt: [0.4, 0.22, 1.6] },
    { t: S(1, 0.07), pos: [-0.3, 1.75, 3.9], tgt: [0.0, 0.2, -5] },
    { t: S(1, 0.2), pos: [-0.2, 1.8, 3.6], tgt: [0.0, 0.2, -5] },
    { t: S(2, 0.07), pos: [0.22, 1.0, 2.4], tgt: [0.4, 0.24, 1.45] },
    { t: S(2, 0.2), pos: [0.22, 1.0, 2.4], tgt: [0.4, 0.24, 1.45] },
    { t: S(3, 0.07), pos: [-0.55, 1.35, 4.3], tgt: [0.1, 0.6, -10] },
    { t: 3, pos: [-0.55, 1.45, 4.3], tgt: [0.1, 0.6, -10] },
  ];

  // ---------- HUD anchor projection (world -> viewport -> tablet screen UV via inverse homography) ----------
  const v3 = new THREE.Vector3();
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  function toPx(v, cam) { v.project(cam); return [((v.x + 1) / 2) * vw, ((1 - v.y) / 2) * vh, v.z]; }
  function homographyInverse() {
    const hw = tabletW / 2, hh = tabletH / 2;
    corners[0].set(-hw, -hh, 0); corners[1].set(hw, -hh, 0); corners[2].set(hw, hh, 0); corners[3].set(-hw, hh, 0);
    const p = corners.map((c) => toPx(screen.localToWorld(c), studioCam));
    const [x0, y0] = p[0], [x1, y1] = p[1], [x2, y2] = p[2], [x3, y3] = p[3];
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
    const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
    const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
    const m = new THREE.Matrix3().set(a, b, c, d, e, f, g, h, 1);
    return m.invert();
  }
  function anchorUV(worldPos, inv) {
    const [px, py, z] = toPx(v3.copy(worldPos), world.camera);
    if (z > 1 || z < -1) return { vis: false };
    const e = inv.elements; // column-major
    const X = e[0] * px + e[3] * py + e[6], Y = e[1] * px + e[4] * py + e[7], Wd = e[2] * px + e[5] * py + e[8];
    const u = X / Wd, v = Y / Wd;
    return { vis: true, x: u, y: 1 - v };
  }

  // ---------- DOM sync ----------
  const timed = [...document.querySelectorAll('[data-t]')].map((el) => {
    const [a, b] = el.dataset.t.split(',').map(Number);
    return { el, a, b, last: -1 };
  });
  const steps = [...document.querySelectorAll('.step')];
  const stepBars = steps.map((s) => s.querySelector('.step-bar i'));
  const nav = document.querySelector('.nav');
  let lastStep = -1;

  function syncDOM(T) {
    for (const o of timed) {
      const ain = o.a < 0 ? 1 : ease((T - o.a) / 0.05);
      const aout = 1 - ease((T - o.b) / 0.05);
      const v = Math.round(ain * aout * 1000) / 1000;
      if (v === o.last) continue;
      o.last = v;
      const dir = T > o.b ? -1 : 1;
      o.el.style.opacity = v;
      o.el.style.transform = `translate3d(0, ${((1 - v) * 28 * dir).toFixed(1)}px, 0)`;
      o.el.style.visibility = v <= 0.001 ? 'hidden' : 'visible';
      o.el.style.pointerEvents = v > 0.6 ? 'auto' : 'none';
    }
    const local = (T - 1) * 4;
    const active = T < 1 ? -1 : Math.min(3, Math.floor(local));
    if (active !== lastStep) {
      steps.forEach((s, i) => s.classList.toggle('active', i === active));
      lastStep = active;
    }
    stepBars.forEach((b, i) => { b.style.transform = `scaleX(${clamp01(local - i).toFixed(3)})`; });
    nav.classList.toggle('solid', T > 2.4);
  }

  // ---------- input ----------
  let scrollY = window.scrollY;
  addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener('pointermove', (e) => { mouse.x = (e.clientX / vw) * 2 - 1; mouse.y = (e.clientY / vh) * 2 - 1; }, { passive: true });
  addEventListener('resize', resize);
  document.querySelectorAll('[data-goto]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: scrollForT(parseFloat(a.dataset.goto)), behavior: 'smooth' }); })
  );

  resize();
  // Deep link into the timeline, e.g. index.html#t=1.4 (handy for reviewing a specific beat)
  const deep = /t=([\d.]+)/.exec(location.hash);
  if (deep) { scrollY = scrollForT(parseFloat(deep[1])); window.scrollTo(0, scrollY); }
  let Ts = timelineFromScroll(scrollY);
  let time = 0, last = performance.now();
  let slowFrames = 0, frames = 0;
  const pos = new THREE.Vector3(), tgt = new THREE.Vector3();

  function render(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    const Tt = timelineFromScroll(scrollY);
    Ts += (Tt - Ts) * (1 - Math.exp(-dt * 4.2));
    if (!Number.isFinite(Ts)) Ts = Number.isFinite(Tt) ? Tt : 0;
    if (Math.abs(Tt - Ts) < 1e-4) Ts = Tt;
    const T = Ts;
    mouse.sx += (mouse.x - mouse.sx) * (1 - Math.exp(-dt * 3));
    mouse.sy += (mouse.y - mouse.sy) * (1 - Math.exp(-dt * 3));

    // scalar choreography
    const glass = ramp(T, [[0, 0], [0.28, 1]]);
    const boot = clamp01((T - 0.1) / 0.42);
    const heroA = ramp(T, [[1.0, 1], [1.07, 0]]);
    const stepsA = [0, 1, 2, 3].map((i) => {
      const a = 1 + i * 0.25;
      const fin = i === 0 ? ramp(T, [[1.04, 0], [1.09, 1]]) : ramp(T, [[a - 0.015, 0], [a + 0.03, 1]]);
      const fout = i === 3 ? 1 : ramp(T, [[a + 0.235, 1], [a + 0.255, 0]]);
      return fin * fout;
    });
    const stepsAny = Math.max(...stepsA);
    const dim = ramp(T, [[1.0, 0], [1.08, 0.62]]);
    const dark = ramp(T, [[0, 0], [0.35, 0.12], [0.86, 0.8], [1.1, 0.9], [2.2, 1]]);
    const settle = ramp(T, [[0.3, 0], [0.9, 1]]);
    const grid = ramp(T, [[2.05, 0], [2.6, 1]]);
    const worldVisible = T < 2.62;

    // world camera
    const wk = sampleKeys(worldKeys, T, ['pos', 'tgt']);
    pos.fromArray(wk.pos); tgt.fromArray(wk.tgt);
    pos.x += Math.sin(time * 0.23) * 0.035 + mouse.sx * 0.06;
    pos.y += Math.sin(time * 0.31) * 0.018 - mouse.sy * 0.03;
    world.update(time, pos, tgt);

    // tablet
    const k = sampleKeys(tabletKeys, T, ['x', 'y', 'z', 'rx', 'ry', 'rz']);
    tablet.position.set(k.x, k.y + Math.sin(time * 0.8) * 0.012 * settle, k.z);
    tablet.rotation.set(
      k.rx + (Math.sin(time * 0.6) * 0.012 + mouse.sy * 0.05) * settle,
      k.ry + mouse.sx * 0.08 * settle,
      k.rz
    );
    tablet.updateMatrixWorld(true);
    studioCam.updateMatrixWorld();

    // HUD
    const hudOn = Math.max(heroA * clamp01(boot * 3), stepsAny);
    if (hudOn > 0.001) {
      const inv = homographyInverse();
      const A = world.anchors;
      hud.draw({
        time, boot, hero: heroA, steps: stepsA, stepsAny,
        stepLocal: [0, 1, 2, 3].map((i) => clamp01((T - 1 - i * 0.25) / 0.25)),
        anchors: { crate: anchorUV(A.crate, inv), risk: anchorUV(A.risk, inv), sensor: anchorUV(A.sensor, inv), row: anchorUV(A.row, inv) },
      });
    } else if (hud._cleared !== true) {
      hud.ctx.clearRect(0, 0, hud.canvas.width, hud.canvas.height);
      hud.texture.needsUpdate = true;
    }
    hud._cleared = hudOn <= 0.001;
    screenMat.uniforms.uHudOn.value = hudOn;
    screenMat.uniforms.uDim.value = dim;
    screenMat.uniforms.uGlass.value = glass;
    screenMat.uniforms.uTime.value = time;
    bgMat.uniforms.uDark.value = dark;
    bgMat.uniforms.uGrid.value = grid;
    bgMat.uniforms.uTime.value = time;

    // ---- render ----
    if (worldVisible) {
      renderer.setRenderTarget(rtWorld);
      renderer.clear();
      renderer.render(world.scene, world.camera);
      if (dark < 0.999 && glass > 0.01) {
        const spread = ramp(T, [[0, 0.8], [0.6, 2.2]]);
        quad.material = blurMat;
        const passes = [[rtWorld, rtA, 1, 0], [rtA, rtB, 0, 1], [rtB, rtA, 1, 0], [rtA, rtB, 0, 1]];
        passes.forEach(([src, dst, x, y], i) => {
          blurMat.uniforms.tSrc.value = src.texture;
          const m = i < 2 ? spread : spread * 2;
          blurMat.uniforms.uDir.value.set((x * m) / dst.width, (y * m) / dst.height);
          renderer.setRenderTarget(dst);
          renderer.render(quadScene, quadCam);
        });
      }
    }
    renderer.setRenderTarget(null);
    renderer.clear();
    quad.material = bgMat;
    renderer.render(quadScene, quadCam);
    if (T < 2.62) renderer.render(studio, studioCam);

    syncDOM(T);

    // adaptive resolution
    frames++;
    if (frames > 30 && dt > 0.026) slowFrames++;
    if (slowFrames > 40 && dpr > 1) {
      dpr = Math.max(1, dpr - 0.25);
      renderer.setPixelRatio(dpr);
      resize();
      slowFrames = 0;
    }
    requestAnimationFrame(render);
  }

  return { start: () => requestAnimationFrame((t) => { last = t; render(t); }) };
}

// ---------- boot ----------
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!/t=/.test(location.hash)) window.scrollTo(0, 0);
const loader = document.getElementById('loader');
const app = main();
const fontsReady = document.fonts ? Promise.race([document.fonts.load('500 16px "Geist Mono"'), new Promise((r) => setTimeout(r, 2500))]) : Promise.resolve();
fontsReady.then(() => {
  app && app.start();
  requestAnimationFrame(() => requestAnimationFrame(() => loader.classList.add('done')));
  setTimeout(() => loader.classList.add('done'), 1500);
});

// Reveal-on-scroll for the regular sections
const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
