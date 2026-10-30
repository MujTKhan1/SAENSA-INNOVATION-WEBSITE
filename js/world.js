// The "real world": a procedural golden-hour field with crops, crates of produce and a SAENSA sensor node.
// Rendered into an HDR render target; the tablet screen samples it in screen space (AR passthrough).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const SUN_DIR = new THREE.Vector3(-0.24, 0.075, -0.97).normalize();

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- procedural textures ----------
function canvasTex(size, paint, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

function soilTexture() {
  const rnd = mulberry32(7);
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#5a3d27';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 26000; i++) {
      const v = rnd();
      const l = 18 + v * 30;
      g.fillStyle = `hsla(${22 + rnd() * 10}, ${30 + rnd() * 20}%, ${l}%, ${0.25 + rnd() * 0.5})`;
      const r = rnd() * 2.2 + 0.3;
      g.beginPath();
      g.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(190,170,140,${0.15 + rnd() * 0.25})`;
      g.beginPath();
      g.ellipse(rnd() * s, rnd() * s, 2 + rnd() * 4, 1.5 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function woodTexture() {
  const rnd = mulberry32(11);
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#b48a5c';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 1) {
      const n = Math.sin(y * 0.09 + Math.sin(y * 0.013) * 6) * 0.5 + 0.5;
      g.fillStyle = `rgba(${90 + n * 40},${60 + n * 25},${35 + n * 15},${0.18 + n * 0.22})`;
      g.fillRect(0, y, s, 1);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(70,45,25,${rnd() * 0.18})`;
      g.fillRect(rnd() * s, rnd() * s, 20 + rnd() * 90, 1);
    }
    for (let i = 0; i < 4; i++) {
      const x = rnd() * s, y = rnd() * s;
      g.strokeStyle = 'rgba(80,50,28,0.35)';
      for (let r = 2; r < 14; r += 2.5) {
        g.beginPath();
        g.ellipse(x, y, r * 2.4, r, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  });
}

// ---------- geometry builders ----------
function leafGeometry(len, wid, bend) {
  const g = new THREE.PlaneGeometry(wid, len, 3, 6);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const t = y / len;
    const w = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 1.05;
    p.setX(i, x * w);
    p.setZ(i, -bend * t * t * len + Math.abs(x) * 0.6 * wid * 0.5 - (x * x) * 2.0);
  }
  g.computeVertexNormals();
  return g;
}

function rosetteGeometry(rnd, leaves = 9) {
  const parts = [];
  for (let i = 0; i < leaves; i++) {
    const inner = i < 3;
    const leaf = leafGeometry(inner ? 0.13 : 0.2 + rnd() * 0.05, inner ? 0.09 : 0.13, inner ? 0.2 : 0.55);
    leaf.rotateX(-(inner ? 0.35 : 0.85 + rnd() * 0.35));
    leaf.rotateY((i / leaves) * Math.PI * 2 + rnd() * 0.4);
    parts.push(leaf);
  }
  const head = new THREE.SphereGeometry(0.055, 10, 8);
  head.scale(1, 0.75, 1);
  head.translate(0, 0.035, 0);
  head.deleteAttribute('uv');
  parts.forEach((p) => p.deleteAttribute('uv'));
  return mergeGeometries([...parts, head]);
}

function tomatoGeometry() {
  const g = new THREE.SphereGeometry(1, 40, 28);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const phi = Math.atan2(v.z, v.x);
    const band = 1 - Math.abs(v.y);
    const r = 1 + 0.035 * Math.cos(phi * 5) * band;
    v.x *= r; v.z *= r;
    v.y *= 0.8;
    const d = v.x * v.x + v.z * v.z;
    if (v.y > 0) v.y -= 0.12 * Math.exp(-d / 0.06);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function appleGeometry() {
  const g = new THREE.SphereGeometry(1, 40, 28);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.x * v.x + v.z * v.z;
    v.y *= 0.9;
    v.y -= Math.sign(v.y) * 0.22 * Math.exp(-d / 0.05);
    const s = 1 + 0.06 * v.y;
    v.x *= s; v.z *= s;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function calyxGeometry() {
  const shape = new THREE.Shape();
  const n = 5;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.28;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  const stem = new THREE.CylinderGeometry(0.1, 0.14, 0.5, 6);
  stem.translate(0, 0.25, 0);
  const nonIdx = g.toNonIndexed();
  nonIdx.deleteAttribute('uv');
  const s2 = stem.toNonIndexed();
  s2.deleteAttribute('uv');
  return mergeGeometries([nonIdx, s2]);
}

// Vegetation material: wind sway + backlit translucency toward the sun.
function vegetationMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = uniforms.uTime;
    s.uniforms.uSunView = uniforms.uSunView;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        float sway = sin(uTime*1.6 + ip.x*0.9 + ip.z*0.6) + 0.5*sin(uTime*2.7 + ip.z*1.3);
        transformed.x += sway * 0.05 * transformed.y * transformed.y * 8.0;
        transformed.z += sway * 0.03 * transformed.y * transformed.y * 8.0;`
      );
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float back = pow(max(dot(normalize(-vViewPosition), uSunView), 0.0), 5.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.6, 1.25, 0.5) * back * 0.9;`
      );
  };
  return m;
}

// ---------- the world ----------
export function createWorld(renderer, { lite = false } = {}) {
  const scene = new THREE.Scene();
  const rnd = mulberry32(42);
  const uniforms = { uTime: { value: 0 }, uSunView: { value: new THREE.Vector3() } };

  const fogColor = new THREE.Color(0.9, 0.52, 0.3);
  scene.fog = new THREE.FogExp2(fogColor, 0.0062);

  // Sky
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zenith = vec3(0.12,0.2,0.42);
        vec3 mid = vec3(0.62,0.44,0.36);
        vec3 horizon = vec3(1.25,0.62,0.3);
        vec3 col = mix(horizon, mid, smoothstep(0.0,0.2,h));
        col = mix(col, zenith, smoothstep(0.12,0.8,h));
        col = mix(col, vec3(0.9,0.52,0.3), smoothstep(0.0,-0.06,h));
        float sd = max(dot(d,uSun),0.0);
        col += vec3(2.4,1.3,0.55)*pow(sd,4.0)*0.7;
        col += vec3(4.0,2.4,1.0)*pow(sd,40.0)*1.6;
        col += vec3(6.0,3.6,1.5)*pow(sd,400.0)*2.0;
        col += vec3(60.0,42.0,24.0)*smoothstep(0.99935,0.9997,sd);
        gl_FragColor = vec4(col,1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  // Environment from the sky for believable reflections on produce.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();

  // Lights
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.76, 0.5), 7.5);
  sun.position.copy(SUN_DIR).multiplyScalar(30).add(new THREE.Vector3(0, 0, 0));
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 70;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(1.0, 0.85, 0.7), 0.7);
  fill.position.set(1, 2, 5);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.55, 0.65, 0.9), new THREE.Color(0.35, 0.22, 0.12), 0.35));

  // Ground: large meadow + furrowed field
  const meadow = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0.16, 0.17, 0.06), roughness: 1 })
  );
  meadow.position.y = -0.03;
  meadow.receiveShadow = true;
  scene.add(meadow);

  const ROW = 0.75, PATH = 0.95;
  const fieldGeo = new THREE.PlaneGeometry(36, 120, 288, 240).rotateX(-Math.PI / 2);
  fieldGeo.translate(0, 0, -50);
  const fp = fieldGeo.attributes.position;
  const ridge = (x) => {
    const pathMask = THREE.MathUtils.smoothstep(Math.abs(x), PATH - 0.2, PATH + 0.1);
    return (0.06 * Math.cos(((x - ROW / 2) / ROW) * Math.PI * 2) + 0.02) * pathMask;
  };
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i), z = fp.getZ(i);
    const edge = THREE.MathUtils.smoothstep(Math.abs(x), 18, 16.5);
    fp.setY(i, ridge(x) * edge + Math.sin(x * 3.1 + z * 2.3) * 0.006);
  }
  fieldGeo.computeVertexNormals();
  const soil = new THREE.Mesh(
    fieldGeo,
    new THREE.MeshStandardMaterial({ map: soilTexture(), color: new THREE.Color(0.95, 0.9, 0.85), roughness: 1 })
  );
  soil.material.map.repeat.set(24, 80);
  soil.receiveShadow = true;
  scene.add(soil);

  // Crops: instanced rosettes along the ridges
  const plantGeo = rosetteGeometry(rnd);
  const vegMat = vegetationMaterial(uniforms);
  const positions = [];
  const zStep = 0.42;
  const rowsHalf = lite ? 9 : 14;
  for (let r = -rowsHalf; r < rowsHalf; r++) {
    const x = r * ROW + ROW / 2;
    if (Math.abs(x) < PATH) continue;
    const zEnd = Math.abs(x) > 7 ? -45 : -68;
    for (let z = 4.2; z > zEnd; z -= zStep * (z < -25 ? 1.6 : 1)) {
      positions.push([x + (rnd() - 0.5) * 0.06, z + (rnd() - 0.5) * 0.12]);
    }
  }
  const plants = new THREE.InstancedMesh(plantGeo, vegMat, positions.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  const col = new THREE.Color();
  positions.forEach(([x, z], i) => {
    const sc = 0.85 + rnd() * 0.5;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    p3.set(x, ridge(x) - 0.005, z);
    s3.set(sc, sc * (0.85 + rnd() * 0.3), sc);
    plants.setMatrixAt(i, m4.compose(p3, q, s3));
    col.setRGB(0.07 + rnd() * 0.07, 0.19 + rnd() * 0.12, 0.03 + rnd() * 0.03);
    plants.setColorAt(i, col);
  });
  plants.castShadow = true;
  plants.receiveShadow = true;
  scene.add(plants);

  // Distant tree line + hills (fog turns them into silhouettes)
  const crown = new THREE.IcosahedronGeometry(1, 3);
  const trees = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: new THREE.Color(0.03, 0.05, 0.02), roughness: 1 }), 700);
  for (let i = 0; i < 700; i++) {
    const x = (rnd() - 0.5) * 320;
    const z = -105 - rnd() * 20 - Math.abs(x) * 0.08;
    const s = 1.1 + rnd() * 1.6;
    trees.setMatrixAt(i, m4.compose(p3.set(x, s * 0.9, z), q.identity(), s3.set(s, s * (1.2 + rnd() * 0.6), s)));
  }
  scene.add(trees);
  const hillMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1, 0.12, 0.08), roughness: 1 });
  [[-160, -240, 80, 9], [120, -280, 110, 10], [-20, -300, 90, 7]].forEach(([x, z, r, h]) => {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), hillMat);
    hill.scale.set(r, h, r * 0.6);
    hill.position.set(x, -2, z);
    scene.add(hill);
  });

  // Crates
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.8, color: new THREE.Color(0.5, 0.44, 0.38) });
  function crate(L, W, H) {
    const g = new THREE.Group();
    const t = 0.014;
    const slatH = H * 0.36;
    const add = (w, h, d, x, y, z) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, woodMat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    add(L, t, W, 0, t / 2, 0);
    [slatH / 2 + 0.01, H - slatH / 2].forEach((y) => {
      add(L, slatH, t, 0, y, W / 2 - t / 2);
      add(L, slatH, t, 0, y, -W / 2 + t / 2);
      add(t, slatH, W - 2 * t, L / 2 - t / 2, y, 0);
      add(t, slatH, W - 2 * t, -L / 2 + t / 2, y, 0);
    });
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => add(0.03, H, 0.03, a * (L / 2 - 0.022), H / 2, b * (W / 2 - 0.022)));
    return g;
  }

  function fillCrate(group, L, W, H, geo, radius, colorFn, count, seed, withCalyx) {
    const r = mulberry32(seed);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: withCalyx ? 0.26 : 0.38, clearcoat: withCalyx ? 0.8 : 0.4, clearcoatRoughness: 0.18 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const cal = withCalyx ? new THREE.InstancedMesh(calyxGeometry(), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.08, 0.2, 0.03), roughness: 0.7 }), count) : null;
    const items = [];
    let i = 0;
    const nx = Math.floor((L - 0.04) / (radius * 2.05)), nz = Math.floor((W - 0.04) / (radius * 2.05));
    for (let layer = 0; layer < 3 && i < count; layer++) {
      for (let a = 0; a < nx && i < count; a++) {
        for (let b = 0; b < nz && i < count; b++) {
          const x = -L / 2 + 0.03 + radius + a * ((L - 0.06 - 2 * radius) / Math.max(1, nx - 1)) + (r() - 0.5) * 0.012 + (layer % 2) * radius * 0.5;
          const z = -W / 2 + 0.03 + radius + b * ((W - 0.06 - 2 * radius) / Math.max(1, nz - 1)) + (r() - 0.5) * 0.012;
          const cx = x / (L / 2), cz = z / (W / 2);
          const heap = (1 - cx * cx * 0.6 - cz * cz * 0.6);
          const y = H * 0.35 + layer * radius * 1.5 * heap + radius * 0.8;
          if (layer === 2 && heap < 0.6) continue;
          const s = radius * (0.88 + r() * 0.24);
          q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5));
          m4.compose(p3.set(x, y, z), q, s3.set(s, s, s));
          inst.setMatrixAt(i, m4);
          inst.setColorAt(i, colorFn(r, i));
          if (cal) {
            const up = new THREE.Vector3(0, 0.8 * s, 0).applyQuaternion(q);
            cal.setMatrixAt(i, new THREE.Matrix4().compose(p3.clone().add(up), q, s3.set(s * 0.45, s * 0.45, s * 0.45)));
          }
          items.push(new THREE.Vector3(x, y, z));
          i++;
        }
      }
    }
    inst.count = i;
    inst.castShadow = inst.receiveShadow = true;
    group.add(inst);
    if (cal) { cal.count = i; cal.castShadow = true; group.add(cal); }
    return items;
  }

  const tomatoGeo = tomatoGeometry();
  const crateA = crate(0.6, 0.4, 0.28);
  crateA.position.set(0.4, 0.0, 1.45);
  crateA.rotation.y = 0.32;
  const AT_RISK = 9;
  const tomatoes = fillCrate(crateA, 0.6, 0.4, 0.28, tomatoGeo, 0.042, (r, i) =>
    i === AT_RISK ? new THREE.Color(0.24, 0.02, 0.01) : new THREE.Color(0.5 + r() * 0.2, 0.025 + r() * 0.07, 0.012), 70, 3, true);
  scene.add(crateA);

  const crateB = crate(0.6, 0.4, 0.28);
  crateB.position.set(-0.55, 0.0, -1.1);
  crateB.rotation.y = -0.45;
  fillCrate(crateB, 0.6, 0.4, 0.28, appleGeometry(), 0.048, (r) =>
    r() > 0.35 ? new THREE.Color(0.45 + r() * 0.2, 0.04 + r() * 0.06, 0.02) : new THREE.Color(0.5, 0.42, 0.06), 50, 5, false);
  scene.add(crateB);

  const crateC = crate(0.6, 0.4, 0.28);
  crateC.position.set(-0.6, 0, -4.2);
  crateC.rotation.y = -0.2;
  scene.add(crateC);

  // Loose produce on the soil
  const looseMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.6, 0.04, 0.015), roughness: 0.26, clearcoat: 0.8 });
  [[0.88, 1.75, 0.045], [0.82, 1.9, 0.04], [-0.05, 1.95, 0.043]].forEach(([x, z, s]) => {
    const t = new THREE.Mesh(tomatoGeo, looseMat);
    t.scale.setScalar(s);
    t.position.set(x, s * 0.75, z);
    t.rotation.set(0.3, x * 4, 0.2);
    t.castShadow = true;
    scene.add(t);
  });
  const lettuce = new THREE.Mesh(plantGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.42, 0.07), roughness: 0.7, side: THREE.DoubleSide }));
  lettuce.scale.setScalar(1.3);
  lettuce.position.set(-0.32, 0, 1.25);
  lettuce.castShadow = true;
  scene.add(lettuce);

  // SAENSA sensor node clipped on crate A
  const sensor = new THREE.Group();
  const puck = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.08, 0.024, 4, 0.01), new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.85, 0.86, 0.88), roughness: 0.35, clearcoat: 0.5 }));
  puck.castShadow = true;
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.35, 0.12), emissiveIntensity: 4 });
  const led = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0035, 8, 32), ledMat);
  led.position.z = 0.013;
  sensor.add(puck, led);
  sensor.position.set(0.0, 0.2, 0.2 + 0.013);
  crateA.add(sensor);

  // Dust motes catching the sun
  const N = lite ? 260 : 600;
  const dustPos = new Float32Array(N * 3), dustSeed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    dustPos[i * 3] = (rnd() - 0.5) * 7;
    dustPos[i * 3 + 1] = rnd() * 2.6;
    dustPos[i * 3 + 2] = 3.5 - rnd() * 9;
    dustSeed[i] = rnd();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: uniforms.uTime, uSun: { value: SUN_DIR }, uPx: { value: renderer.getPixelRatio() } },
      vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uSun; uniform float uPx; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y + uTime*(0.03+aSeed*0.05), 2.6);
          p.x += sin(uTime*0.4 + aSeed*30.0)*0.15;
          p.z += cos(uTime*0.3 + aSeed*20.0)*0.1;
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          vec3 vd = normalize((modelMatrix*vec4(p,1.0)).xyz - cameraPosition);
          float toward = pow(max(dot(vd,uSun),0.0),3.0);
          vA = (0.15 + toward*1.6) * (0.4+0.6*sin(uTime*2.0+aSeed*40.0)*0.5+0.5);
          gl_PointSize = (2.0 + aSeed*3.0) * uPx * (2.2 / -mv.z);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `varying float vA;
        void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vec3(2.4,1.7,1.0)*a*vA, 1.0); }`,
    })
  );
  dust.frustumCulled = false;
  scene.add(dust);

  // Camera
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 900);

  // Anchors exposed for the AR HUD (world space)
  scene.updateMatrixWorld(true);
  const anchor = (obj, local) => obj.localToWorld(local.clone());
  const anchors = {
    crate: anchor(crateA, new THREE.Vector3(0, 0.34, 0)),
    sensor: anchor(crateA, new THREE.Vector3(0, 0.2, 0.23)),
    risk: anchor(crateA, tomatoes[AT_RISK] || new THREE.Vector3()),
    row: new THREE.Vector3(2 * ROW + ROW / 2, 0.15, -3.5),
    apples: anchor(crateB, new THREE.Vector3(0, 0.36, 0)),
  };

  const tmp = new THREE.Vector3();
  function update(time, pos, target) {
    uniforms.uTime.value = time;
    camera.position.copy(pos);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);
    uniforms.uSunView.value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
    ledMat.emissiveIntensity = 2 + 4 * Math.pow(0.5 + 0.5 * Math.sin(time * 3.2), 3);
    dust.material.uniforms.uPx.value = renderer.getPixelRatio();
    return tmp;
  }

  return { scene, camera, anchors, update };
}
