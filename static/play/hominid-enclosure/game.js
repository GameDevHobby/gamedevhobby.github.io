// Hominid Enclosure — an alien zookeeping sim.
// Three.js, no build step. Systems follow the Trello milestones:
//   M1 core loop (needs + utility AI), M2 social layer, M3 hygiene/decay,
//   M4 alien tools, polish, and a handful of stretch goals.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const W = 34, D = 22, HW = W / 2, HD = D / 2, WALL_H = 3.2;
const HOUR = 10;              // sim-seconds per in-game hour (a day = 4 minutes at 1x)
const POP_CAP = 12;
const START_HOUR = 7;
const V3 = THREE.Vector3;

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angLerp = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const $ = (id) => document.getElementById(id);

function stdMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...extra });
}
function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
const box = (w, h, d, c, extra) => mesh(new THREE.BoxGeometry(w, h, d), stdMat(c, extra));
const cyl = (rt, rb, h, seg, c, extra) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), stdMat(c, extra));

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a1f4a);
scene.fog = new THREE.Fog(0x2a1f4a, 70, 170);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 17, 21);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.46;
controls.minDistance = 5;
controls.maxDistance = 70;
controls.screenSpacePanning = false;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Lights
const hemi = new THREE.HemisphereLight(0xd8ecff, 0x40305a, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 1, far: 120 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
const nightLamp = new THREE.PointLight(0x8fa8ff, 0, 0, 0);
nightLamp.position.set(0, 14, 0);
scene.add(nightLamp);

// ---------------------------------------------------------------------------
// Audio — tiny WebAudio synth (eating, snoring, panicking, chatter...)
// ---------------------------------------------------------------------------
const sfx = {
  ctx: null, master: null, muted: false, noiseBuf: null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { console.warn('Audio unavailable', e); }
  },
  vol(pos) {
    if (!pos) return 1;
    const d = camera.position.distanceTo(pos);
    return clamp(1.5 - d / 40, 0.06, 1);
  },
  ok() { return this.ctx && !this.muted; },
  tone({ f = 440, f2, dur = 0.15, type = 'sine', g = 0.2, pos, delay = 0, q }) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), gn = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const v = g * this.vol(pos);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(v, t + 0.015);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (q) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = q; o.connect(fl); node = fl; }
    node.connect(gn); gn.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise({ dur = 0.2, g = 0.2, freq = 1000, type = 'bandpass', freq2, pos, delay = 0 }) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(freq, t);
    if (freq2) fl.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    const gn = c.createGain(); const v = g * this.vol(pos);
    gn.gain.setValueAtTime(v, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  },
  eat(p) { for (let i = 0; i < 3; i++) this.noise({ dur: 0.06, g: 0.25, freq: rand(1500, 2600), pos: p, delay: i * 0.09 }); },
  snore(p) { this.tone({ f: 85, f2: 55, dur: 1.1, type: 'sawtooth', g: 0.08, pos: p, q: 380 }); },
  panic(p) { this.tone({ f: rand(500, 650), f2: 1500, dur: 0.35, type: 'square', g: 0.07, pos: p, q: 2400 }); this.tone({ f: 1400, f2: 700, dur: 0.3, type: 'square', g: 0.05, pos: p, delay: 0.32, q: 2400 }); },
  chirp(p) { const n = randi(2, 4); for (let i = 0; i < n; i++) this.tone({ f: rand(260, 720), f2: rand(260, 900), dur: 0.09, type: 'triangle', g: 0.11, pos: p, delay: i * 0.11 }); },
  spray(p) { this.noise({ dur: 0.45, g: 0.25, freq: 3500, type: 'highpass', pos: p }); },
  flush(p) { this.noise({ dur: 0.9, g: 0.25, freq: 1800, freq2: 200, type: 'lowpass', pos: p }); },
  place() { this.tone({ f: 220, f2: 70, dur: 0.18, type: 'sine', g: 0.3 }); },
  refill(p) { this.tone({ f: 500, f2: 900, dur: 0.12, g: 0.15, pos: p }); this.tone({ f: 900, f2: 1200, dur: 0.12, g: 0.12, pos: p, delay: 0.1 }); },
  ding() { this.tone({ f: 880, dur: 0.25, g: 0.12 }); this.tone({ f: 1320, dur: 0.35, g: 0.1, delay: 0.12 }); },
  bad() { this.tone({ f: 300, f2: 140, dur: 0.35, type: 'square', g: 0.06, q: 1200 }); },
  boing(p) { this.tone({ f: 180, f2: 420, dur: 0.18, type: 'sine', g: 0.2, pos: p }); },
  baby() { [523, 659, 784, 1046].forEach((f, i) => this.tone({ f, dur: 0.25, g: 0.12, type: 'triangle', delay: i * 0.12 })); },
  zap(p) { this.tone({ f: 1800, f2: 300, dur: 0.3, type: 'sawtooth', g: 0.07, pos: p, q: 3000 }); },
};

// ---------------------------------------------------------------------------
// Sprites: emoji icons + debug overlay labels
// ---------------------------------------------------------------------------
const emojiCache = new Map();
function emojiTex(e, bubble = false) {
  const key = e + (bubble ? '|b' : '');
  if (emojiCache.has(key)) return emojiCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  if (bubble) {
    g.fillStyle = 'rgba(255,255,255,0.88)';
    g.beginPath(); g.arc(64, 60, 52, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(52, 108); g.lineTo(64, 126); g.lineTo(76, 108); g.fill();
  }
  g.font = '72px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(e, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(key, t);
  return t;
}
function makeSprite(tex, size = 0.7) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(size, size, 1); s.renderOrder = 10;
  return s;
}
const floaters = [];
function floatEmoji(pos, e, size = 0.8) {
  const s = makeSprite(emojiTex(e), size);
  s.position.copy(pos); s.position.y += 1.2;
  scene.add(s);
  floaters.push({ s, t: 0 });
}
function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]; f.t += dt;
    f.s.position.y += dt * 1.1;
    f.s.material.opacity = clamp(1.6 - f.t, 0, 1);
    if (f.t > 1.6) { scene.remove(f.s); f.s.material.dispose(); floaters.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const state = {
  started: false, over: false, speed: 1, time: 0,
  rp: 20, lifetimeRP: 0, engagement: 60,
  tool: 'inspect', selected: null, follow: false, debug: false,
  temp: 21, setpoint: 21,
  upgrades: {}, purchases: {},
  stats: { interactions: 0, refills: 0, pellets: 0, sprays: 0, cures: 0, toys: 0, births: 0, confiscated: 0, messesCleaned: 0, accidents: 0, purchases: 0, lastInteraction: 0 },
  event: null, nextEventDay: 2, babyCooldown: 0,
  objectivesDone: new Set(), certified: false,
};
const world = {
  humans: [], furniture: [], pellets: [], toys: [], messes: [], bots: [],
  colliders: [], decor: [], nextId: 1,
};
const hour = () => (START_HOUR + state.time / HOUR) % 24;
const day = () => Math.floor((START_HOUR * HOUR + state.time) / (24 * HOUR)) + 1;
function daylight() { const h = hour(); return clamp(Math.sin(((h - 6) / 13) * Math.PI), 0, 1); }
function isNight() { const h = hour(); return h >= 21.5 || h < 6; }

// ---------------------------------------------------------------------------
// Environment: terrarium + alien lab
// ---------------------------------------------------------------------------
const envRoot = new THREE.Group(); scene.add(envRoot);
let floor;
function buildEnvironment() {
  // floor with per-triangle colour variation for a low-poly look
  const g = new THREE.PlaneGeometry(W, D, 34, 22).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const colors = []; const c = new THREE.Color();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    const x = pos.getX(i), z = pos.getZ(i);
    const path = Math.abs(z - Math.sin(x * 0.25) * 2.5) < 1.2;
    if (path) c.setHSL(0.09, 0.35, rand(0.52, 0.58)); else c.setHSL(0.27 + rand(-0.025, 0.025), 0.42, rand(0.4, 0.47));
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  floor = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  floor.receiveShadow = true;
  envRoot.add(floor);

  // base plinth + glowing rim
  const base = box(W + 1.4, 1.4, D + 1.4, 0x3b3552, { metalness: 0.5, roughness: 0.5 });
  base.position.y = -0.71; envRoot.add(base);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x7dffcf, emissive: 0x3dffb0, emissiveIntensity: 1.2 });
  const rims = [[W + 1.4, 0.06, 0.06, 0, (D + 1.4) / 2], [W + 1.4, 0.06, 0.06, 0, -(D + 1.4) / 2], [0.06, 0.06, D + 1.4, (W + 1.4) / 2, 0], [0.06, 0.06, D + 1.4, -(W + 1.4) / 2, 0]];
  for (const [w, h, d, x, z] of rims) { const r = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rimMat); r.position.set(x, -0.05, z); envRoot.add(r); }

  // glass walls (invisible bounds are enforced in code)
  const glass = new THREE.MeshStandardMaterial({ color: 0xaee6ff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const walls = [[W, WALL_H, 0.08, 0, -HD - 0.04], [W, WALL_H, 0.08, 0, HD + 0.04], [0.08, WALL_H, D, -HW - 0.04, 0], [0.08, WALL_H, D, HW + 0.04, 0]];
  for (const [w, h, d, x, z] of walls) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glass); m.position.set(x, h / 2, z); m.renderOrder = 2; envRoot.add(m); }
  const frameMat = stdMat(0x5b5378, { metalness: 0.6, roughness: 0.4 });
  for (const x of [-HW, HW]) for (const z of [-HD, HD]) { const p = mesh(new THREE.BoxGeometry(0.25, WALL_H + 0.1, 0.25), frameMat); p.position.set(x, WALL_H / 2, z); envRoot.add(p); }
  for (const [w, d, x, z] of [[W, 0.15, 0, -HD], [W, 0.15, 0, HD], [0.15, D, -HW, 0], [0.15, D, HW, 0]]) { const t = mesh(new THREE.BoxGeometry(w, 0.12, d), frameMat, false); t.position.set(x, WALL_H, z); envRoot.add(t); }

  // alien lab outside
  const labFloor = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshStandardMaterial({ color: 0x1d1530, roughness: 0.9 }));
  labFloor.rotation.x = -Math.PI / 2; labFloor.position.y = -1.4; labFloor.receiveShadow = true; envRoot.add(labFloor);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xc38bff, emissive: 0x8a3bff, emissiveIntensity: 0.9 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(30, 30.4, 64), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = -1.38; envRoot.add(ring);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const p = cyl(1.4, 1.8, 38, 6, 0x2c2245, { metalness: 0.4 }); p.position.set(Math.cos(a) * 55, 17, Math.sin(a) * 55); envRoot.add(p);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 30, 0.2), ringMat); strip.position.set(Math.cos(a) * 53.4, 15, Math.sin(a) * 53.4); envRoot.add(strip);
  }
  // observation console + giant alien silhouettes looking in
  for (const [x, z, s] of [[-24, 18, 1], [26, -16, 1.2], [20, 22, 0.9]]) {
    const alien = new THREE.Group();
    const bodyM = stdMat(0x3a6b52, { roughness: 0.6 });
    const torso = mesh(new THREE.CylinderGeometry(1.2, 2.2, 6, 7), bodyM); torso.position.y = 3; alien.add(torso);
    const head = mesh(new THREE.IcosahedronGeometry(2.2, 1), bodyM); head.position.y = 8; head.scale.set(1, 1.25, 1); alien.add(head);
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x220033, roughness: 0.2 });
    for (const ex of [-0.8, 0.8]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), eyeM); eye.scale.set(1, 1.6, 0.5); eye.position.set(ex, 8.2, 1.9); alien.add(eye); }
    alien.position.set(x, -1.4, z); alien.scale.setScalar(s);
    alien.lookAt(0, 3, 0);
    alien.userData.bob = rand(0, 6);
    envRoot.add(alien); world.decor.push(alien);
  }
  // stars
  const sg = new THREE.BufferGeometry(); const sp = [];
  for (let i = 0; i < 1200; i++) {
    const th = rand(0, Math.PI * 2), ph = rand(0.05, Math.PI * 0.48), r = 200;
    sp.push(r * Math.cos(th) * Math.sin(ph), r * Math.cos(ph), r * Math.sin(th) * Math.sin(ph));
  }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.6, fog: false }));
  envRoot.add(stars); world.stars = stars;

  // in-enclosure decor (also obstacles)
  const tree = (x, z, s = 1) => {
    const t = new THREE.Group();
    const trunk = cyl(0.15, 0.22, 1.2, 6, 0x6b4423); trunk.position.y = 0.6; t.add(trunk);
    [[1.1, 1.5, 1.6, 0x3f8f4a], [0.85, 1.25, 2.35, 0x4fa457], [0.55, 1.0, 2.95, 0x62b865]].forEach(([r, h, y, c]) => { const cn = mesh(new THREE.ConeGeometry(r, h, 7), stdMat(c)); cn.position.y = y; t.add(cn); });
    t.position.set(x, 0, z); t.scale.setScalar(s); t.rotation.y = rand(0, 6);
    envRoot.add(t); world.colliders.push({ x, z, r: 0.45 * s, owner: 'decor' });
  };
  const rock = (x, z, r) => {
    const m = mesh(new THREE.DodecahedronGeometry(r, 0), stdMat(0x8a8798));
    m.scale.y = 0.6; m.position.set(x, r * 0.25, z); m.rotation.set(rand(0, 3), rand(0, 3), 0);
    envRoot.add(m); world.colliders.push({ x, z, r: r * 0.9, owner: 'decor' });
  };
  tree(-HW + 1.6, HD - 1.6, 1.1); tree(HW - 1.6, HD - 1.8, 0.95); tree(-2.5, HD - 1.4, 0.8);
  rock(6, 6.5, 0.8); rock(-7, 4, 0.6); rock(HW - 2, 3, 0.7);
  // a little pond (visual only, at the edge)
  const pond = new THREE.Mesh(new THREE.CircleGeometry(1.6, 9), new THREE.MeshStandardMaterial({ color: 0x4fb3d9, roughness: 0.1, metalness: 0.3, flatShading: true }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(-HW + 2.6, 0.02, 2); envRoot.add(pond);
  world.colliders.push({ x: -HW + 2.6, z: 2, r: 1.5, owner: 'decor' });
}

// ---------------------------------------------------------------------------
// Furniture (beds, dispensers, toilets, showers)
// ---------------------------------------------------------------------------
function buildBed() {
  const g = new THREE.Group();
  const frame = box(1.5, 0.45, 2.7, 0x6b4f8a); frame.position.y = 0.225; g.add(frame);
  const mattress = box(1.35, 0.2, 2.45, 0xdfe7ff); mattress.position.set(0, 0.55, 0.05); g.add(mattress);
  const pillow = box(1.0, 0.14, 0.45, 0xffffff); pillow.position.set(0, 0.72, -0.9); g.add(pillow);
  const blanket = box(1.38, 0.06, 1.4, pick([0x58c4b5, 0xe4718a, 0xf2c14e, 0x7d8cff])); blanket.position.set(0, 0.68, 0.55); g.add(blanket);
  const head = box(1.5, 1.0, 0.15, 0x4e3a68); head.position.set(0, 0.5, -1.3); g.add(head);
  return g;
}
function buildDispenser(f) {
  const g = new THREE.Group();
  const base = box(1.1, 0.3, 1.1, 0x444a66, { metalness: 0.5 }); base.position.y = 0.15; g.add(base);
  const body = cyl(0.42, 0.5, 0.55, 8, 0x8a93b8, { metalness: 0.5 }); body.position.y = 0.57; g.add(body);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 1.05, 10), new THREE.MeshStandardMaterial({ color: 0xbfefff, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false }));
  tube.position.y = 1.37; g.add(tube);
  const fillGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.0, 10); fillGeo.translate(0, 0.5, 0);
  const fill = mesh(fillGeo, stdMat(0xffa53a, { emissive: 0x552200, emissiveIntensity: 0.4 }), false); fill.position.y = 0.86; g.add(fill);
  const cap = cyl(0.38, 0.34, 0.2, 8, 0x6c7396, { metalness: 0.5 }); cap.position.y = 1.98; g.add(cap);
  const tray = box(0.7, 0.08, 0.45, 0x30354d); tray.position.set(0, 0.62, 0.55); g.add(tray);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x55ff99, emissive: 0x22ff66, emissiveIntensity: 1 });
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), lightMat); light.position.y = 2.15; g.add(light);
  if (f) { f.fill = fill; f.lightMat = lightMat; }
  return g;
}
function buildToilet() {
  const g = new THREE.Group();
  const tank = box(0.62, 0.6, 0.26, 0xf4f4f4); tank.position.set(0, 0.62, -0.36); g.add(tank);
  const bowl = cyl(0.3, 0.22, 0.42, 8, 0xf4f4f4); bowl.position.set(0, 0.21, -0.02); g.add(bowl);
  const seat = cyl(0.31, 0.31, 0.06, 8, 0xa7c7ff); seat.position.set(0, 0.45, -0.02); g.add(seat);
  const mat = box(1.1, 0.03, 1.4, 0x6f8fb8); mat.position.set(0, 0.015, 0.25); mat.castShadow = false; g.add(mat);
  return g;
}
function buildShower(f) {
  const g = new THREE.Group();
  const tray = box(1.4, 0.12, 1.4, 0x9bd6e8); tray.position.y = 0.06; g.add(tray);
  const chrome = { metalness: 0.8, roughness: 0.25 };
  const pole = cyl(0.05, 0.05, 2.4, 6, 0xc0c0c0, chrome); pole.position.set(0, 1.2, -0.62); g.add(pole);
  const arm = box(0.06, 0.06, 0.6, 0xc0c0c0, chrome); arm.position.set(0, 2.4, -0.35); g.add(arm);
  const head = cyl(0.18, 0.12, 0.08, 8, 0xc0c0c0, chrome); head.position.set(0, 2.36, -0.05); g.add(head);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.55, 2.2, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
  water.position.set(0, 1.25, -0.05); water.visible = false; g.add(water);
  if (f) f.water = water;
  return g;
}
const FURN = {
  bed: { name: 'Sleeping Pod', build: buildBed, colliders: [{ x: 0, z: -0.65, r: 0.78 }, { x: 0, z: 0.65, r: 0.78 }], approach: [0, 1.95], pose: [0, 0.8, 1.05], icon: '🛏️' },
  dispenser: { name: 'Food Dispenser', build: buildDispenser, colliders: [{ x: 0, z: 0, r: 0.62 }], approach: [0, 1.15], icon: '🍽️' },
  toilet: { name: 'Waste Receptacle', build: buildToilet, colliders: [{ x: 0, z: -0.3, r: 0.42 }], approach: [0, 0.95], pose: [0, 0, 0.0], icon: '🚽' },
  shower: { name: 'Hygiene Station', build: buildShower, colliders: [{ x: 0, z: -0.65, r: 0.22 }], approach: [0, 0.15], pose: [0, 0.12, 0.05], icon: '🚿' },
};
const DISPENSER_MAX = 6;

function addFurniture(kind, x, z, rot = 0) {
  const def = FURN[kind];
  const f = { kind, def, id: world.nextId++, occupant: null, stock: DISPENSER_MAX, rot, x, z };
  const g = def.build(f);
  g.position.set(x, 0, z); g.rotation.y = rot;
  g.traverse((o) => { o.userData.owner = f; });
  scene.add(g); g.updateMatrixWorld(true);
  f.mesh = g;
  const toWorld = (lx, ly, lz) => g.localToWorld(new V3(lx, ly, lz));
  f.colliders = def.colliders.map((c) => { const p = toWorld(c.x, 0, c.z); return { x: p.x, z: p.z, r: c.r, owner: f }; });
  world.colliders.push(...f.colliders);
  rebuildGrid();
  f.approach = toWorld(def.approach[0], 0, def.approach[1]); f.approach.y = 0;
  if (def.pose) f.posePos = toWorld(...def.pose);
  if (kind === 'dispenser') updateDispenser(f);
  world.furniture.push(f);
  return f;
}
function updateDispenser(f) {
  const k = f.stock / DISPENSER_MAX;
  f.fill.scale.y = Math.max(0.001, k);
  f.fill.visible = f.stock > 0;
  f.lightMat.color.set(f.stock === 0 ? 0xff3355 : f.stock <= 2 ? 0xffaa33 : 0x55ff99);
  f.lightMat.emissive.set(f.stock === 0 ? 0xff1133 : f.stock <= 2 ? 0xff7700 : 0x22ff66);
  if (f.stock === 0 && !f.alert) { f.alert = makeSprite(emojiTex('❗', true), 0.8); f.alert.position.set(f.x, 2.9, f.z); scene.add(f.alert); }
  if (f.stock > 0 && f.alert) { scene.remove(f.alert); f.alert = null; }
}
function refillDispenser(f) {
  if (f.stock >= DISPENSER_MAX) { toast('Dispenser is already full.'); return; }
  f.stock = DISPENSER_MAX; updateDispenser(f);
  sfx.refill(f.mesh.position); floatEmoji(f.mesh.position.clone().setY(1.4), '✅');
  state.stats.refills++; interacted(); completeObjective('refill');
}

// ---------------------------------------------------------------------------
// Small dynamic things: pellets, toys, messes, scrubber drones
// ---------------------------------------------------------------------------
const pelletGeo = new THREE.IcosahedronGeometry(0.18, 0);
const pelletMat = stdMat(0xff9a3c, { emissive: 0x552000, emissiveIntensity: 0.3 });
function addPellet(x, z) {
  const m = mesh(pelletGeo, pelletMat); m.position.set(x, 0.18, z);
  const p = { kind: 'pellet', pos: new V3(x, 0, z), mesh: m, reservedBy: null, t: rand(0, 6) };
  m.userData.owner = p; scene.add(m); world.pellets.push(p);
  return p;
}
function removePellet(p) { scene.remove(p.mesh); world.pellets.splice(world.pellets.indexOf(p), 1); }

const TOY_COLORS = [0xff4f6d, 0xffd23f, 0x3fb8ff, 0x9b5cff, 0x4fe39b];
function addToy(x, z) {
  const m = mesh(new THREE.IcosahedronGeometry(0.32, 1), stdMat(pick(TOY_COLORS), { roughness: 0.5 }));
  m.position.set(x, 0.32, z);
  const t = { kind: 'toy', pos: new V3(x, 0, z), vel: new V3(), mesh: m, occupant: null, id: world.nextId++ };
  m.userData.owner = t; scene.add(m); world.toys.push(t);
  return t;
}
function updateToys(dt) {
  for (const t of world.toys) {
    t.pos.addScaledVector(t.vel, dt);
    t.vel.multiplyScalar(Math.max(0, 1 - 1.4 * dt));
    if (t.pos.x < -HW + 0.35) { t.pos.x = -HW + 0.35; t.vel.x = Math.abs(t.vel.x) * 0.7; }
    if (t.pos.x > HW - 0.35) { t.pos.x = HW - 0.35; t.vel.x = -Math.abs(t.vel.x) * 0.7; }
    if (t.pos.z < -HD + 0.35) { t.pos.z = -HD + 0.35; t.vel.z = Math.abs(t.vel.z) * 0.7; }
    if (t.pos.z > HD - 0.35) { t.pos.z = HD - 0.35; t.vel.z = -Math.abs(t.vel.z) * 0.7; }
    for (const c of world.colliders) {
      const dx = t.pos.x - c.x, dz = t.pos.z - c.z, d = Math.hypot(dx, dz), R = c.r + 0.32;
      if (d < R && d > 1e-4) {
        const nx = dx / d, nz = dz / d; t.pos.x = c.x + nx * R; t.pos.z = c.z + nz * R;
        const vn = t.vel.x * nx + t.vel.z * nz; if (vn < 0) { t.vel.x -= 1.7 * vn * nx; t.vel.z -= 1.7 * vn * nz; }
      }
    }
    const sp = t.vel.length();
    t.mesh.position.set(t.pos.x, 0.32, t.pos.z);
    if (sp > 0.01) { t.mesh.rotation.x += t.vel.z * dt * 3; t.mesh.rotation.z -= t.vel.x * dt * 3; }
  }
}

const MAX_MESSES = 40;
const messMats = {
  puddle: new THREE.MeshStandardMaterial({ color: 0xd9cf54, transparent: true, opacity: 0.75, roughness: 0.1, flatShading: true }),
  poop: stdMat(0x5a3a1a, { roughness: 0.6 }),
  crumbs: stdMat(0xd2a35a),
  vomit: new THREE.MeshStandardMaterial({ color: 0x9bc43a, transparent: true, opacity: 0.85, roughness: 0.2, flatShading: true }),
};
function spawnMess(type, x, z) {
  if (world.messes.length >= MAX_MESSES) return null;
  x = clamp(x, -HW + 0.4, HW - 0.4); z = clamp(z, -HD + 0.4, HD - 0.4);
  const g = new THREE.Group();
  if (type === 'puddle' || type === 'vomit') {
    const m = new THREE.Mesh(new THREE.CircleGeometry(rand(0.4, 0.6), 7), messMats[type]);
    m.rotation.x = -Math.PI / 2; m.position.y = 0.015; m.receiveShadow = true; g.add(m);
  } else if (type === 'poop') {
    [[0.22, 0.12, 0.06], [0.16, 0.12, 0.15], [0.09, 0.14, 0.24]].forEach(([r, h, y]) => { const c = mesh(new THREE.ConeGeometry(r, h, 7), messMats.poop); c.position.y = y; g.add(c); });
    const fly = makeSprite(emojiTex('〰️'), 0.35); fly.position.y = 0.6; fly.material.opacity = 0.5; g.add(fly);
  } else {
    for (let i = 0; i < 6; i++) { const c = mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), messMats.crumbs, false); c.position.set(rand(-0.3, 0.3), 0.025, rand(-0.3, 0.3)); c.rotation.y = rand(0, 3); g.add(c); }
  }
  g.position.set(x, 0, z); g.rotation.y = rand(0, 6);
  const mess = { kind: 'mess', type, pos: new V3(x, 0, z), mesh: g, reservedBy: null };
  g.traverse((o) => { o.userData.owner = mess; });
  scene.add(g); world.messes.push(mess);
  return mess;
}
function removeMess(m, byPlayer = false) {
  const i = world.messes.indexOf(m); if (i < 0) return;
  world.messes.splice(i, 1); scene.remove(m.mesh);
  floatEmoji(m.pos, '✨', 0.6);
  if (byPlayer) { state.stats.messesCleaned++; gainRP(1); completeObjective('clean'); }
}

function addBot(x, z) {
  const g = new THREE.Group();
  const b = cyl(0.36, 0.42, 0.18, 10, 0x9aa0b5, { metalness: 0.6, roughness: 0.3 }); b.position.y = 0.14; g.add(b);
  const dome = mesh(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7dffcf, emissive: 0x2aff9f, emissiveIntensity: 0.8 }));
  dome.position.y = 0.23; g.add(dome);
  g.position.set(x, 0, z); scene.add(g);
  const bot = { kind: 'bot', pos: new V3(x, 0, z), vel: new V3(), mesh: g, target: null, t: 0, wander: null };
  world.bots.push(bot);
  return bot;
}
function updateBots(dt) {
  for (const b of world.bots) {
    if (b.target && !world.messes.includes(b.target)) b.target = null;
    if (!b.target) {
      let best = null, bd = 1e9;
      for (const m of world.messes) { if (m.reservedBy && m.reservedBy !== b) continue; const d = dist2(m.pos, b.pos); if (d < bd) { bd = d; best = m; } }
      if (best) { b.target = best; best.reservedBy = b; b.t = 0; }
    }
    if (b.target) {
      if (navigate(b, b.target.pos, 2.4, dt, 0.3)) {
        b.t += dt; b.mesh.rotation.y += dt * 12;
        if (b.t > 1.4) { removeMess(b.target); b.target = null; }
      }
    } else {
      if (!b.wander || navigate(b, b.wander, 1.2, dt, 0.3)) b.wander = randomFloorPoint();
    }
    b.mesh.position.set(b.pos.x, 0, b.pos.z);
  }
}

// ---------------------------------------------------------------------------
// Navigation: grid A* + path smoothing, then seek with separation
// ---------------------------------------------------------------------------
const CELL = 0.5, GW = Math.round(W / CELL), GD = Math.round(D / CELL);
const grid = new Uint8Array(GW * GD);
const gScore = new Float32Array(GW * GD), came = new Int32Array(GW * GD), closed = new Uint8Array(GW * GD);
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
function rebuildGrid() {
  grid.fill(0);
  for (let j = 0; j < GD; j++) for (let i = 0; i < GW; i++) {
    const x = -HW + (i + 0.5) * CELL, z = -HD + (j + 0.5) * CELL;
    if (Math.abs(x) > HW - 0.4 || Math.abs(z) > HD - 0.4) { grid[j * GW + i] = 1; continue; }
    for (const c of world.colliders) if (Math.hypot(x - c.x, z - c.z) < c.r + 0.33) { grid[j * GW + i] = 1; break; }
  }
  for (const h of world.humans) h.nav = null;
  for (const b of world.bots) b.nav = null;
}
const cellOf = (x, z) => [clamp(Math.floor((x + HW) / CELL), 0, GW - 1), clamp(Math.floor((z + HD) / CELL), 0, GD - 1)];
const blockedAt = (x, z) => { const [i, j] = cellOf(x, z); return grid[j * GW + i] === 1; };
function nearestFree(i, j) {
  if (!grid[j * GW + i]) return [i, j];
  for (let r = 1; r < 24; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const a = i + di, b = j + dj;
    if (a >= 0 && b >= 0 && a < GW && b < GD && !grid[b * GW + a]) return [a, b];
  }
  return [i, j];
}
function los(ax, az, bx, bz) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2);
  for (let k = 1; k < n; k++) { const t = k / n; if (blockedAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
  return true;
}
function findPath(from, to) {
  if (!blockedAt(from.x, from.z) && los(from.x, from.z, to.x, to.z)) return [to.clone()];
  const [si, sj] = nearestFree(...cellOf(from.x, from.z)), [gi, gj] = nearestFree(...cellOf(to.x, to.z));
  const S = sj * GW + si, G = gj * GW + gi;
  gScore.fill(Infinity); closed.fill(0); came.fill(-1);
  const heap = [];
  const push = (f, n) => { heap.push([f, n]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top[1]; };
  const hdist = (n) => { const dx = Math.abs((n % GW) - gi), dz = Math.abs(((n / GW) | 0) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  gScore[S] = 0; push(hdist(S), S);
  while (heap.length) {
    const cur = pop();
    if (cur === G) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % GW, cj = (cur / GW) | 0;
    for (const [di, dj, cost] of NB) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GD) continue;
      const n = nj * GW + ni;
      if (grid[n] || closed[n]) continue;
      if (di && dj && (grid[cj * GW + ni] || grid[nj * GW + ci])) continue;
      const g = gScore[cur] + cost;
      if (g < gScore[n]) { gScore[n] = g; came[n] = cur; push(g + hdist(n), n); }
    }
  }
  if (G !== S && came[G] === -1) return [to.clone()];
  const cells = []; for (let c = G; c !== -1 && c !== S; c = came[c]) cells.push(c);
  cells.push(S); cells.reverse();
  const pts = cells.map((c) => new V3(-HW + ((c % GW) + 0.5) * CELL, 0, -HD + (((c / GW) | 0) + 0.5) * CELL));
  pts.push(to.clone());
  // string pulling: skip waypoints that are in direct line of sight
  const out = []; let ax = from.x, az = from.z, k = 0;
  while (k < pts.length) {
    let far = k;
    while (far + 1 < pts.length && los(ax, az, pts[far + 1].x, pts[far + 1].z)) far++;
    out.push(pts[far]); ax = pts[far].x; az = pts[far].z; k = far + 1;
  }
  return out;
}
function navigate(ent, dest, speed, dt, radius = 0.32) {
  let n = ent.nav;
  if (!n || dist2(n.dest, dest) > 0.75 || (n.age += dt) > 6) {
    n = ent.nav = { dest: dest.clone(), path: findPath(ent.pos, dest), i: 0, age: 0 };
  }
  n.path[n.path.length - 1].copy(dest);
  while (n.i < n.path.length - 1 && dist2(ent.pos, n.path[n.i]) < 0.45) n.i++;
  return seek(ent, n.path[n.i], speed, dt, radius, n.i === n.path.length - 1);
}
const _d = new V3(), _a = new V3();
function seek(ent, wp, speed, dt, radius, last) {
  _d.set(wp.x - ent.pos.x, 0, wp.z - ent.pos.z);
  const dist = _d.length();
  if (last && dist < 0.18) { ent.vel.set(0, 0, 0); ent.moving = false; return true; }
  if (dist > 1e-4) _d.multiplyScalar(1 / dist);
  _a.set(0, 0, 0);
  if (ent.isHuman) {
    for (const o of world.humans) {
      if (o === ent || o.fixedPose) continue;
      const dx = ent.pos.x - o.pos.x, dz = ent.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.85 && d > 1e-4) { const k = (0.85 - d) / 0.85 * (last ? clamp(dist, 0.2, 1) : 1); _a.x += (dx / d) * k; _a.z += (dz / d) * k; }
    }
  }
  _d.add(_a);
  if (_d.lengthSq() > 1e-6) _d.normalize();
  const slow = last && dist < 1 ? lerp(0.45, 1, dist) : 1;
  ent.vel.lerp(_d.multiplyScalar(speed * slow), clamp(dt * 8, 0, 1));
  ent.pos.addScaledVector(ent.vel, dt);
  resolveCollisions(ent, radius);
  ent.moving = true;
  return false;
}
function resolveCollisions(ent, radius) {
  for (const c of world.colliders) {
    const dx = ent.pos.x - c.x, dz = ent.pos.z - c.z, d = Math.hypot(dx, dz), R = c.r + radius * 0.8;
    if (d < R) {
      if (d < 1e-4) { ent.pos.x += R; continue; }
      ent.pos.x = c.x + (dx / d) * R; ent.pos.z = c.z + (dz / d) * R;
    }
  }
  ent.pos.x = clamp(ent.pos.x, -HW + 0.4, HW - 0.4);
  ent.pos.z = clamp(ent.pos.z, -HD + 0.4, HD - 0.4);
}
function pointFree(x, z, margin = 0.6) {
  if (Math.abs(x) > HW - 0.8 || Math.abs(z) > HD - 0.8) return false;
  for (const c of world.colliders) if (Math.hypot(x - c.x, z - c.z) < c.r + margin) return false;
  return true;
}
function randomFloorPoint() {
  for (let i = 0; i < 30; i++) { const x = rand(-HW + 1, HW - 1), z = rand(-HD + 1, HD - 1); if (pointFree(x, z)) return new V3(x, 0, z); }
  return new V3(0, 0, 0);
}

// ---------------------------------------------------------------------------
// Humans
// ---------------------------------------------------------------------------
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4423, 0xd9a066, 0xa86b3c, 0xf5d0b5];
const HAIR_COL = [0x1d1a17, 0x4a2f1b, 0x8a5a2b, 0xd8b56a, 0xb33a1e, 0x777777, 0xeeeeee, 0x2e3d8f, 0xd13f8a];
const HAIR_STYLES = ['bald', 'buzz', 'buzz', 'bun', 'spiky', 'mohawk', 'long', 'long', 'afro'];
const HATS = ['none', 'none', 'none', 'none', 'tophat', 'beanie', 'cap', 'party'];
const NAMES = ['Dave', 'Karen', 'Bob', 'Linda', 'Gary', 'Susan', 'Kevin', 'Brenda', 'Steve', 'Doris', 'Chad', 'Pam', 'Larry', 'Tina', 'Phil', 'Gloria', 'Ron', 'Deb', 'Hank', 'Wendy', 'Mo', 'Zoe', 'Ike', 'Fay', 'Ned', 'Ivy', 'Otis', 'June', 'Rex', 'Pearl', 'Barb', 'Todd', 'Marge', 'Lou', 'Nell', 'Gus'];
const TRAITS = {
  lazy: { label: 'Lazy', icon: '🦥', desc: 'Tires quickly, walks slowly.' },
  social: { label: 'Social', icon: '🗣️', desc: 'Needs company more often.' },
  clean: { label: 'Clean Freak', icon: '🧼', desc: 'Hates mess. Tidies up after others.' },
  glutton: { label: 'Glutton', icon: '🍗', desc: 'Always hungry.' },
  playful: { label: 'Playful', icon: '🎈', desc: 'Bores easily. Loves toys.' },
  hardy: { label: 'Hardy', icon: '💪', desc: 'Rarely gets sick.' },
};
const NEEDS = [
  { k: 'food', label: 'Hunger', icon: '🍔', w: 1.3 },
  { k: 'energy', label: 'Energy', icon: '💤', w: 1.1 },
  { k: 'bladder', label: 'Bladder', icon: '🚽', w: 1.0 },
  { k: 'hygiene', label: 'Hygiene', icon: '🧼', w: 0.9 },
  { k: 'social', label: 'Social', icon: '💬', w: 0.9 },
  { k: 'fun', label: 'Fun', icon: '🎈', w: 0.8 },
];
const needColor = (v) => v > 60 ? '#6dff9b' : v > 30 ? '#ffd166' : '#ff5d73';

let usedNames = new Set();
function newName() {
  const free = NAMES.filter((n) => !usedNames.has(n));
  const n = free.length ? pick(free) : pick(NAMES) + ' ' + randi(2, 9);
  usedNames.add(n); return n;
}

class Human {
  constructor(opts = {}) {
    this.isHuman = true;
    this.id = world.nextId++;
    this.specimen = opts.specimen ?? (state.specimenCount = (state.specimenCount || 0) + 1);
    this.name = opts.name || newName();
    this.child = !!opts.child;
    this.growth = this.child ? 0 : 1;
    const tkeys = Object.keys(TRAITS);
    this.traits = opts.traits || (() => { const t = new Set([pick(tkeys)]); if (Math.random() < 0.6) t.add(pick(tkeys)); return [...t]; })();
    this.skin = opts.skin ?? pick(SKIN);
    this.hairCol = opts.hairCol ?? pick(HAIR_COL);
    this.hair = opts.hair ?? pick(HAIR_STYLES);
    this.hat = opts.hat ?? pick(HATS);
    this.size = opts.size ?? rand(0.88, 1.1);
    this.width = opts.width ?? rand(0.85, 1.25);
    this.needs = { food: rand(55, 90), energy: rand(60, 95), bladder: rand(50, 95), hygiene: rand(60, 95), social: rand(40, 80), fun: rand(50, 85) };
    if (opts.needs) Object.assign(this.needs, opts.needs);
    this.health = 100; this.sick = false; this.sickT = 0; this.mood = 70;
    this.moodlets = [];
    this.rel = new Map();
    this.pos = new V3(opts.x ?? 0, 0, opts.z ?? 0);
    this.vel = new V3();
    this.heading = rand(0, Math.PI * 2);
    this.action = null; this.thinkT = 0; this.phase = rand(0, 6); this.animT = 0;
    this.pendingChat = null; this.fixedPose = false; this.moving = false;
    this.lastComplaint = -100; this.messNear = 0;
    this.buildMesh();
  }
  has(t) { return this.traits.includes(t); }
  get speed() { return (this.has('lazy') ? 1.7 : 2.2) * (this.sick ? 0.7 : 1) * (this.child ? 0.85 : 1) * (this.needs.energy < 15 ? 0.75 : 1); }

  buildMesh() {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const mat = stdMat(this.skin); this.mat = mat; this.baseColor = new THREE.Color(this.skin);
    const w = this.width;
    const legGeo = new THREE.BoxGeometry(0.15, 0.75, 0.17); legGeo.translate(0, -0.375, 0);
    const legL = new THREE.Group(), legR = new THREE.Group();
    legL.position.set(-0.1 * w, 0.75, 0); legR.position.set(0.1 * w, 0.75, 0);
    legL.add(mesh(legGeo, mat)); legR.add(mesh(legGeo, mat));
    const torso = mesh(new THREE.CylinderGeometry(0.19 * w, 0.24 * w, 0.64, 6), mat); torso.position.y = 1.06;
    const armGeo = new THREE.BoxGeometry(0.1, 0.55, 0.1); armGeo.translate(0, -0.27, 0);
    const armL = new THREE.Group(), armR = new THREE.Group();
    armL.position.set(-(0.2 * w + 0.07), 1.33, 0); armR.position.set(0.2 * w + 0.07, 1.33, 0);
    armL.add(mesh(armGeo, mat)); armR.add(mesh(armGeo, mat));
    const head = new THREE.Group(); head.position.y = 1.4;
    const skull = mesh(new THREE.IcosahedronGeometry(0.2, 1), mat); skull.position.y = 0.19; head.add(skull);
    this.addHair(head);
    body.add(legL, legR, torso, armL, armR, head);
    Object.assign(this, { root, body, legL, legR, armL, armR, head });
    root.traverse((o) => { o.userData.owner = this; });
    scene.add(root);
    this.icon = makeSprite(emojiTex('💬', true), 0.62); this.icon.visible = false; scene.add(this.icon);
    this.iconKey = null;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 24), new THREE.MeshBasicMaterial({ color: 0x7dffcf, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false; scene.add(this.ring);
    this.updateScale();
  }
  addHair(head) {
    const hm = stdMat(this.hairCol);
    const cap = (r = 0.215, c = hm) => { const m = mesh(new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), c); m.position.y = 0.2; return m; };
    switch (this.hair) {
      case 'buzz': head.add(cap()); break;
      case 'bun': { head.add(cap()); const b = mesh(new THREE.IcosahedronGeometry(0.1, 0), hm); b.position.set(0, 0.42, -0.1); head.add(b); break; }
      case 'spiky': { head.add(cap()); for (let i = 0; i < 6; i++) { const s = mesh(new THREE.ConeGeometry(0.06, 0.18, 4), hm); const a = (i / 6) * Math.PI * 2; s.position.set(Math.cos(a) * 0.1, 0.4, Math.sin(a) * 0.1); s.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); head.add(s); } break; }
      case 'mohawk': { const m = mesh(new THREE.BoxGeometry(0.06, 0.16, 0.36), hm); m.position.set(0, 0.42, 0); head.add(m); break; }
      case 'long': { head.add(cap()); const l = mesh(new THREE.BoxGeometry(0.4, 0.42, 0.12), hm); l.position.set(0, 0.12, -0.14); head.add(l); break; }
      case 'afro': { const a = mesh(new THREE.IcosahedronGeometry(0.3, 1), hm); a.position.set(0, 0.3, -0.04); head.add(a); break; }
    }
    const hatCol = pick([0x222233, 0xd94848, 0x3a7bd5, 0xf2c14e, 0x2fbf71, 0x9b5cff]);
    const hc = stdMat(hatCol);
    switch (this.hat) {
      case 'tophat': { const b = mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.03, 10), hc); b.position.y = 0.34; const t = mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.32, 10), hc); t.position.y = 0.5; head.add(b, t); break; }
      case 'beanie': { const b = cap(0.23, hc); b.scale.y = 1.15; const p = mesh(new THREE.IcosahedronGeometry(0.06, 0), stdMat(0xffffff)); p.position.y = 0.47; head.add(b, p); break; }
      case 'cap': { const b = cap(0.225, hc); const brim = mesh(new THREE.BoxGeometry(0.3, 0.025, 0.22), hc); brim.position.set(0, 0.25, 0.22); head.add(b, brim); break; }
      case 'party': { const c = mesh(new THREE.ConeGeometry(0.12, 0.34, 7), hc); c.position.y = 0.52; c.rotation.z = 0.15; head.add(c); break; }
    }
  }
  updateScale() {
    const age = this.child ? lerp(0.55, 1, this.growth) : 1;
    this.scale = this.size * age;
    this.root.scale.setScalar(this.scale);
  }

  // ---- moodlets / relationships
  addMoodlet(name, val, dur) {
    const m = this.moodlets.find((x) => x.name === name);
    if (m) { m.val = val; m.t = dur; } else this.moodlets.push({ name, val, t: dur });
  }
  relWith(o) { return this.rel.get(o.id) || 0; }
  addRel(o, v) { this.rel.set(o.id, clamp(this.relWith(o) + v, -100, 100)); }

  // ---- per-tick
  update(dt) {
    this.updateNeeds(dt);
    if (this.removed) return;
    if (this.action) this.runAction(dt);
    if (!this.action) { this.thinkT = 0; this.think(); }
    else if ((this.thinkT -= dt) <= 0) { this.thinkT = 1; this.reconsider(); }
  }

  updateNeeds(dt) {
    const n = this.needs, a = this.action?.type, sleeping = a === 'sleep' || a === 'faint';
    const ph = this.action?.phase === 'perform';
    const slow = sleeping ? 0.35 : 1;
    const t = state.temp;
    n.food -= 0.55 * (this.has('glutton') ? 1.35 : 1) * (this.child ? 1.15 : 1) * slow * dt;
    if (!sleeping) n.energy -= 0.32 * (isNight() ? 1.7 : 1) * (this.has('lazy') ? 1.35 : 1) * (t < 15 ? 1.3 : 1) * (a === 'play' && ph ? 1.8 : 1) * (a === 'panic' ? 2 : 1) * dt;
    if (a !== 'chat') n.social -= 0.45 * (this.has('social') ? 1.5 : 1) * (sleeping ? 0.15 : 1) * dt;
    // hygiene decays over time, faster near messes and in the heat
    this.messNear = 0;
    for (const m of world.messes) if (dist2(m.pos, this.pos) < 3) this.messNear++;
    if (a !== 'shower') n.hygiene -= (0.24 + Math.min(3, this.messNear) * 0.3) * (this.has('clean') ? 1.3 : 1) * (t > 28 ? 1.5 : 1) * slow * dt;
    if (a !== 'toilet') n.bladder -= 0.6 * (sleeping ? 0.45 : 1) * (a === 'eat' && ph ? 2 : 1) * dt;
    if (a !== 'play' && a !== 'chat') n.fun -= 0.4 * (this.has('playful') ? 1.5 : 1) * (sleeping ? 0.15 : 1) * (this.child ? 1.2 : 1) * dt;
    for (const k in n) n[k] = clamp(n[k], 0, 100);

    for (let i = this.moodlets.length - 1; i >= 0; i--) { if ((this.moodlets[i].t -= dt) <= 0) this.moodlets.splice(i, 1); }
    this.computeMood();
    this.updateHealth(dt);
    if (this.removed) return;

    if (this.child) {
      this.growth = clamp(this.growth + dt / (HOUR * 36), 0, 1);
      this.updateScale();
      if (this.growth >= 1) { this.child = false; log(`🎓 ${this.name} has grown into an adult specimen.`, 'good'); }
    }

    // forced behaviours
    if (n.bladder <= 0 && a !== 'toilet' && a !== 'accident') this.forceAction('accident');
    else if (n.energy <= 0 && !sleeping && a !== 'accident') this.forceAction('faint');
  }
  computeMood() {
    const n = this.needs;
    let s = 0, ws = 0;
    for (const nd of NEEDS) { s += n[nd.k] * nd.w; ws += nd.w; if (n[nd.k] < 15) s -= 6 * nd.w; }
    let m = s / ws;
    for (const ml of this.moodlets) m += ml.val;
    if (this.sick) m -= 15;
    const dT = Math.abs(state.temp - 21);
    if (dT > 3) m -= (dT - 3) * 2.5;
    m -= Math.min(15, world.messes.length * 0.7) * (this.has('clean') ? 2 : 1);
    this.mood = clamp(m, 0, 100);
  }
  updateHealth(dt) {
    let dh = 0.3;
    if (this.needs.food <= 0) dh = -1.4;
    if (this.sick) dh -= 0.35;
    if (Math.abs(state.temp - 21) > 9) dh -= 0.2;
    this.health = clamp(this.health + dh * dt, 0, 100);
    // sickness from grime, mess and harsh climate
    if (!this.sick) {
      let p = 0;
      if (this.needs.hygiene < 25) p += 0.004;
      p += Math.min(4, this.messNear) * 0.0015;
      if (Math.abs(state.temp - 21) > 7) p += 0.002;
      if (state.event?.id === 'spores') p *= 3, p += 0.001;
      if (this.has('hardy')) p *= 0.3;
      if (Math.random() < p * dt) this.getSick();
    } else {
      this.sickT += dt;
      if (this.sickT > HOUR * 2 && Math.random() < 0.004 * dt) this.vomit();
      if (this.sickT > HOUR * 16 && Math.random() < 0.01 * dt) this.cure(false);
    }
    if (this.health <= 0) confiscate(this);
  }
  getSick() {
    if (this.sick) return;
    this.sick = true; this.sickT = 0;
    log(`🤒 ${this.name} has fallen ill.`, 'warn');
    floatEmoji(this.pos, '🤢');
  }
  cure(byPlayer) {
    this.sick = false; this.sickT = 0;
    this.mat.color.copy(this.baseColor);
    floatEmoji(this.pos, '✨');
    if (byPlayer) this.addMoodlet('Feeling better', 6, HOUR * 3);
  }
  vomit() {
    spawnMess('vomit', this.pos.x + rand(-0.4, 0.4), this.pos.z + rand(-0.4, 0.4));
    this.needs.hygiene -= 15; floatEmoji(this.pos, '🤮');
  }

  // ---- AI: utility scoring
  think() {
    const opts = [];
    for (const type in ACTIONS) {
      const def = ACTIONS[type];
      if (!def.score) continue;
      const s = def.score(this);
      if (s > 0) opts.push({ type, s: s + rand(0, 4) });
    }
    opts.sort((a, b) => b.s - a.s);
    for (const o of opts) {
      const target = ACTIONS[o.type].find ? ACTIONS[o.type].find(this) : true;
      if (target) { this.startAction(o.type, target, o.s); return; }
    }
  }
  reconsider() {
    const a = this.action;
    if (!a || a.phase !== 'move' && a.type !== 'wander') return;
    if (['panic', 'accident', 'faint', 'chat'].includes(a.type)) return;
    let best = null;
    for (const type in ACTIONS) {
      const def = ACTIONS[type];
      if (!def.score || type === a.type) continue;
      const s = def.score(this);
      if (s > (a.score || 0) + 18 && (!best || s > best.s)) best = { type, s };
    }
    if (best) {
      const target = ACTIONS[best.type].find ? ACTIONS[best.type].find(this) : true;
      if (target) { this.endAction(); this.startAction(best.type, target, best.s); }
    }
  }
  startAction(type, target, score = 0, data = {}) {
    const def = ACTIONS[type];
    this.action = { type, target, phase: def.noMove ? 'perform' : 'move', t: 0, moveT: 0, score, data };
    this.nav = null;
    if (target && typeof target === 'object') {
      if ('occupant' in target && target.kind !== 'pellet') target.occupant = this;
      if ('reservedBy' in target) target.reservedBy = this;
      if (target.isHuman && type === 'socialize') target.pendingChat = this;
    }
    def.start?.(this, this.action);
    if (this.action?.phase === 'perform') def.arrive?.(this, this.action);
    if (state.debug) console.log(`[AI] ${this.name} → ${type} (score ${score.toFixed(1)})`);
  }
  endAction() {
    const a = this.action; if (!a) return;
    this.action = null;
    const t = a.target;
    if (t && t !== true) {
      if (t.occupant === this) t.occupant = null;
      if (t.reservedBy === this) t.reservedBy = null;
      if (t.isHuman && t.pendingChat === this) t.pendingChat = null;
    }
    ACTIONS[a.type].end?.(this, a);
    if (this.fixedPose) { this.fixedPose = false; }
  }
  forceAction(type, data = {}) {
    if (this.action?.type === 'chat') { const p = this.action.target; this.endAction(); if (p.action?.type === 'chat' && p.action.target === this) p.endAction(); }
    this.endAction();
    this.startAction(type, true, 999, data);
  }
  runAction(dt) {
    const a = this.action, def = ACTIONS[a.type];
    if (a.phase === 'move') {
      a.moveT += dt;
      const dest = def.dest(this, a);
      if (!dest) { this.endAction(); return; }
      const arrived = navigate(this, dest, this.speed * (def.speedMul || 1), dt) || (def.arriveDist && dist2(this.pos, dest) < def.arriveDist) || (a.moveT > 8 && dist2(this.pos, dest) < 1);
      if (arrived) {
        this.moving = false; this.vel.set(0, 0, 0);
        if (def.arrive && def.arrive(this, a) === false) { this.endAction(); return; }
        if (this.action === a) a.phase = 'perform';
      } else if (a.moveT > 25) { this.endAction(); }
    } else {
      a.t += dt;
      if (def.perform(this, dt, a)) { if (this.action === a) this.endAction(); }
    }
  }
  canChat(other) {
    if (this.removed || this.health <= 0) return false;
    const a = this.action;
    if (this.pendingChat && this.pendingChat !== other) return false;
    if (!a) return true;
    if (a.type === 'wander') return true;
    if (a.type === 'socialize' && a.target === other) return true;
    return false;
  }

  // ---- visuals
  animate(dt, rdt) {
    const a = this.action;
    const perf = a && a.phase === 'perform';
    const walking = a && (a.type === 'play' && a.phase === 'perform' ? this.moving : a.phase === 'move');
    const pose = a ? (walking ? (a.type === 'panic' ? 'run' : 'walk') : ACTIONS[a.type].pose || 'stand') : 'stand';
    this.animT += dt;
    const { body, legL, legR, armL, armR, head } = this;
    body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
    legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, 0.08); armR.rotation.set(0, 0, -0.08);
    head.rotation.set(0, 0, 0);
    let rootPos = this.pos, rootRot = null;
    this.fixedPose = false;
    const T = this.animT;
    if (pose === 'walk' || pose === 'run') {
      const run = pose === 'run';
      this.phase += dt * this.speed * (run ? 7 : 4.6);
      const s = Math.sin(this.phase);
      legL.rotation.x = s * 0.65; legR.rotation.x = -s * 0.65;
      if (run) { armL.rotation.z = 2.7 + s * 0.3; armR.rotation.z = -2.7 - s * 0.3; }
      else { armL.rotation.x = -s * 0.55; armR.rotation.x = s * 0.55; }
      body.position.y = Math.abs(Math.cos(this.phase)) * 0.05;
    } else if (pose === 'lie' || pose === 'faint') {
      body.rotation.x = -Math.PI / 2; this.fixedPose = true;
      if (pose === 'lie' && a.target?.posePos) { rootPos = a.target.posePos; rootRot = a.target.rot; }
      else { rootPos = _tmpV.copy(this.pos).setY(0.14); }
      body.position.y = 0.12 + Math.sin(T * 1.6) * 0.01;
      armL.rotation.z = 0.25; armR.rotation.z = -0.25;
    } else if (pose === 'sit') {
      this.fixedPose = true;
      rootPos = a.target.posePos; rootRot = a.target.rot;
      legL.rotation.x = legR.rotation.x = -Math.PI / 2;
      body.position.y = 0.48 / this.scale - 0.75;
      armL.rotation.x = armR.rotation.x = -0.5;
      head.rotation.x = 0.2 + Math.sin(T * 0.8) * 0.1;
    } else if (pose === 'eat') {
      armR.rotation.x = -1.6 + Math.sin(T * 9) * 0.35; armL.rotation.x = -0.6;
      head.rotation.x = 0.1 + Math.sin(T * 9) * 0.06;
    } else if (pose === 'chat') {
      armR.rotation.x = -0.7 + Math.sin(T * 4.3) * 0.5; armL.rotation.x = -0.3 + Math.sin(T * 3.1 + 1) * 0.3;
      head.rotation.z = Math.sin(T * 3) * 0.12; body.position.y = Math.abs(Math.sin(T * 4)) * 0.03;
    } else if (pose === 'shower') {
      this.fixedPose = true; rootPos = a.target.posePos; rootRot = a.target.rot + Math.sin(T * 0.7) * 0.6;
      armL.rotation.set(-2.6 + Math.sin(T * 8) * 0.3, 0, 0.3); armR.rotation.set(-2.6 - Math.sin(T * 8) * 0.3, 0, -0.3);
      head.rotation.x = -0.3;
    } else if (pose === 'clean') {
      body.rotation.x = 0.45; armL.rotation.x = armR.rotation.x = -1.0 + Math.sin(T * 10) * 0.35;
      legL.rotation.x = legR.rotation.x = -0.45;
    } else if (pose === 'accident') {
      legL.rotation.z = 0.12; legR.rotation.z = -0.12;
      armL.rotation.set(-0.4, 0, 0.6); armR.rotation.set(-0.4, 0, -0.6);
      body.position.x = Math.sin(T * 30) * 0.02; head.rotation.x = 0.4;
    } else if (pose === 'cheer') {
      armL.rotation.z = 2.6 + Math.sin(T * 12) * 0.2; armR.rotation.z = -2.6 - Math.sin(T * 12) * 0.2;
      body.position.y = Math.abs(Math.sin(T * 6)) * 0.25;
    } else { // stand / idle
      head.rotation.y = Math.sin(T * 0.6 + this.id) * 0.5;
      body.position.y = Math.sin(T * 2) * 0.008;
      if (this.needs.energy < 25) { head.rotation.x = 0.35; armL.rotation.z = armR.rotation.z = 0; }
    }
    if (!this.fixedPose && walking) {
      const v = this.vel; if (v.lengthSq() > 0.02) this.heading = angLerp(this.heading, Math.atan2(v.x, v.z), clamp(dt * 10, 0, 1));
    }
    if (a?.face && !this.fixedPose && !walking) this.heading = angLerp(this.heading, Math.atan2(a.face.x - this.pos.x, a.face.z - this.pos.z), clamp(dt * 6, 0, 1));
    this.root.position.copy(rootPos);
    this.root.rotation.y = rootRot ?? this.heading;

    // sick tint
    if (this.sick) this.mat.color.copy(this.baseColor).lerp(_green, 0.35 + Math.sin(this.animT * 3) * 0.08);

    // status icon (current action, else most urgent need)
    let ic = null;
    if (a && ACTIONS[a.type].icon) ic = typeof ACTIONS[a.type].icon === 'function' ? ACTIONS[a.type].icon(this, a) : ACTIONS[a.type].icon;
    if (!ic && this.sick) ic = '🤒';
    if (!ic) { let low = null; for (const nd of NEEDS) if (this.needs[nd.k] < 22 && (!low || this.needs[nd.k] < this.needs[low.k])) low = nd; if (low) ic = low.icon; }
    if (ic !== this.iconKey) { this.iconKey = ic; if (ic) this.icon.material.map = emojiTex(ic, true); this.icon.material.needsUpdate = true; }
    this.icon.visible = !!ic;
    const top = this.fixedPose && (pose === 'lie' || pose === 'faint') ? 1.2 : 2.25 * this.scale;
    this.icon.position.set(this.root.position.x, (pose === 'lie' ? this.root.position.y : 0) + top + Math.sin(this.animT * 3) * 0.04, this.root.position.z);
    this.ring.visible = state.selected === this;
    this.ring.position.set(this.root.position.x, (this.fixedPose ? this.root.position.y : 0) + 0.03, this.root.position.z);
    if (this.dbg) {
      this.dbg.visible = state.debug;
      this.dbg.position.set(this.root.position.x, this.icon.position.y + 0.75, this.root.position.z);
    }
  }
  updateDebugLabel() {
    if (!state.debug) return;
    if (!this.dbg) {
      this.dbgCanvas = document.createElement('canvas'); this.dbgCanvas.width = 256; this.dbgCanvas.height = 128;
      this.dbgTex = new THREE.CanvasTexture(this.dbgCanvas); this.dbgTex.colorSpace = THREE.SRGBColorSpace;
      this.dbg = makeSprite(this.dbgTex, 1); this.dbg.scale.set(2, 1, 1); scene.add(this.dbg);
    }
    const g = this.dbgCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(10,6,24,0.78)'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#7dffcf'; g.font = 'bold 20px sans-serif'; g.fillText(this.name, 8, 22);
    g.fillStyle = '#ffd166'; g.font = '16px sans-serif';
    g.fillText(`${this.action ? this.action.type + (this.action.phase === 'move' ? '→' : '') : 'idle'}  ☺${this.mood | 0}`, 120, 22);
    NEEDS.forEach((nd, i) => {
      const x = 8 + (i % 2) * 124, y = 38 + Math.floor(i / 2) * 30;
      g.fillStyle = '#aaa'; g.font = '13px sans-serif'; g.fillText(nd.label, x, y + 10);
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + 56, y, 60, 12);
      g.fillStyle = needColor(this.needs[nd.k]); g.fillRect(x + 56, y, 60 * this.needs[nd.k] / 100, 12);
    });
    this.dbgTex.needsUpdate = true;
  }
  dispose() {
    scene.remove(this.root, this.icon, this.ring);
    if (this.dbg) scene.remove(this.dbg);
  }
}
const _tmpV = new V3();
const _green = new THREE.Color(0x7fd34e);

// ---------------------------------------------------------------------------
// Actions (utility AI). score() → find() → dest() → arrive() → perform()
// ---------------------------------------------------------------------------
const curve = (v) => { const x = 1 - v / 100; return x * x * 100 + (v < 15 ? 40 : 0); };
const nearest = (h, list, ok) => { let best = null, bd = 1e9; for (const o of list) { if (!ok(o)) continue; const d = dist2(o.pos || o.approach, h.pos); if (d < bd) { bd = d; best = o; } } return best; };
const freeFurn = (kind) => (f) => f.kind === kind && !f.occupant;

const ACTIONS = {
  eat: {
    icon: '🍔', pose: 'eat',
    score: (h) => h.needs.food > 88 ? 0 : curve(h.needs.food) * (h.has('glutton') ? 1.35 : 1),
    find: (h) => {
      const p = nearest(h, world.pellets, (p) => !p.reservedBy);
      const d = nearest(h, world.furniture, (f) => f.kind === 'dispenser' && !f.occupant && f.stock > 0);
      if (p && d) return dist2(p.pos, h.pos) - 3 < dist2(d.approach, h.pos) ? p : d;
      if (p || d) return p || d;
      // nothing to eat: complain (throttled) so the keeper notices
      if (h.needs.food < 30 && state.time - h.lastComplaint > HOUR * 2) {
        h.lastComplaint = state.time; floatEmoji(h.pos, '😠'); h.addMoodlet('No food!', -10, HOUR * 2);
        log(`😠 ${h.name} is hungry and can't find any food!`, 'bad');
      }
      return null;
    },
    dest: (h, a) => a.target.kind === 'pellet' ? (world.pellets.includes(a.target) ? a.target.pos : null) : a.target.approach,
    arrive: (h, a) => {
      const t = a.target;
      if (t.kind === 'dispenser') {
        if (t.stock <= 0) { floatEmoji(h.pos, '😠'); h.addMoodlet('Empty dispenser', -8, HOUR * 2); return false; }
        t.stock--; updateDispenser(t);
        if (t.stock === 0) log(`🍽️ A food dispenser is empty. Click it to refill.`, 'warn');
        a.face = t.mesh.position;
      } else {
        if (!world.pellets.includes(t)) return false;
        removePellet(t); a.target = true;
        h.addMoodlet('Gift from above', 4, HOUR * 2);
      }
    },
    perform: (h, dt, a) => {
      h.needs.food += 19 * dt;
      if ((a.data.crunch = (a.data.crunch || 0) - dt) <= 0) { a.data.crunch = 0.7; sfx.eat(h.pos); }
      if (a.t > 3.6 || h.needs.food >= 100) {
        if (Math.random() < 0.22) spawnMess('crumbs', h.pos.x + rand(-0.3, 0.3), h.pos.z + rand(-0.3, 0.3));
        completeObjective('eat');
        return true;
      }
    },
  },
  sleep: {
    icon: '💤', pose: 'lie',
    score: (h) => h.needs.energy > (isNight() ? 88 : 68) ? 0 : curve(h.needs.energy) * (isNight() ? 1.45 : 0.85) * (h.has('lazy') ? 1.25 : 1),
    find: (h) => nearest(h, world.furniture, freeFurn('bed')) || (h.needs.energy < 12 ? 'floor' : null),
    dest: (h, a) => a.target === 'floor' ? h.pos : a.target.approach,
    arrive: (h, a) => { if (a.target === 'floor') { a.data.floor = true; } },
    perform: (h, dt, a) => {
      const n = h.needs;
      n.energy += (a.data.floor ? 2 : 4.2) * dt;
      if ((a.data.snore = (a.data.snore || rand(0, 2)) - dt) <= 0) { a.data.snore = rand(2.2, 3.5); sfx.snore(h.root.position); }
      if (a.data.floor && a.t > 1 && a.data.floor !== 'moodlet') { a.data.floor = 'moodlet'; h.addMoodlet('Slept on the floor', -6, HOUR * 4); }
      const urgent = n.bladder < 12 || n.food < 10;
      return n.energy >= 100 || (urgent && n.energy > 30) || (!isNight() && n.energy > 92);
    },
    end: (h, a) => { if (a.phase === 'perform' && a.target !== 'floor') h.addMoodlet('Well rested', 5, HOUR * 3); },
  },
  toilet: {
    icon: '🚽', pose: 'sit',
    score: (h) => h.needs.bladder > 65 ? 0 : curve(h.needs.bladder) * 1.25,
    find: (h) => nearest(h, world.furniture, freeFurn('toilet')),
    dest: (h, a) => a.target.approach,
    perform: (h, dt, a) => {
      h.needs.bladder += 32 * dt;
      if (a.t > 3.4 || h.needs.bladder >= 100) { h.needs.bladder = 100; sfx.flush(h.pos); return true; }
    },
  },
  shower: {
    icon: '🚿', pose: 'shower',
    score: (h) => (h.needs.hygiene > 65 && !h.sick) ? 0 : curve(h.needs.hygiene) * (h.has('clean') ? 1.4 : 0.9) + (h.sick ? 22 : 0),
    find: (h) => nearest(h, world.furniture, freeFurn('shower')),
    dest: (h, a) => a.target.approach,
    arrive: (h, a) => { a.target.water.visible = true; },
    perform: (h, dt, a) => {
      h.needs.hygiene += 24 * dt;
      if ((a.data.sp = (a.data.sp || 0) - dt) <= 0) { a.data.sp = 1.2; sfx.noise({ dur: 1.2, g: 0.06, freq: 4000, type: 'highpass', pos: h.pos }); }
      return a.t > 4.5 || (h.needs.hygiene >= 100 && a.t > 2);
    },
    end: (h, a) => {
      if (a.target?.water) a.target.water.visible = false;
      if (a.phase === 'perform' && a.t > 2) { h.addMoodlet('Squeaky clean', 4, HOUR * 3); if (h.sick && Math.random() < 0.35) { h.cure(false); log(`🚿 ${h.name} showered off their illness.`, 'good'); } }
    },
  },
  socialize: {
    icon: '💬',
    score: (h) => h.needs.social > 72 ? 0 : curve(h.needs.social) * (h.has('social') ? 1.4 : 0.9),
    find: (h) => {
      let best = null, bs = -1e9;
      for (const o of world.humans) {
        if (o === h || !o.canChat(h)) continue;
        const d = dist2(o.pos, h.pos); if (d > 26) continue;
        const s = h.relWith(o) * 0.15 - d;
        if (s > bs) { bs = s; best = o; }
      }
      return best;
    },
    dest: (h, a) => (a.target.removed || !a.target.canChat(h)) ? null : a.target.pos,
    arriveDist: 1.3,
    arrive: (h, a) => {
      const o = a.target;
      if (!o.canChat(h)) return false;
      startChat(h, o);
    },
    perform: () => true,
  },
  chat: {
    icon: '💬', pose: 'chat', noMove: true,
    perform: (h, dt, a) => {
      const o = a.target;
      if (o.removed || o.action?.type !== 'chat' || o.action.target !== h) return true;
      a.face = o.pos;
      h.needs.social += 10 * dt; h.needs.fun += 2.5 * dt;
      h.addRel(o, 2.6 * dt * (h.has('social') ? 1.3 : 1));
      if (o.sick && !h.sick && Math.random() < 0.03 * dt * (h.has('hardy') ? 0.3 : 1)) h.getSick();
      if (a.data.leader && (a.data.ch = (a.data.ch || 0) - dt) <= 0) { a.data.ch = rand(0.7, 1.3); sfx.chirp(Math.random() < 0.5 ? h.pos : o.pos); }
      if (a.t >= a.data.dur) {
        if (a.data.leader) chatFinished(h, o);
        return true;
      }
    },
  },
  play: {
    icon: '⚽', pose: 'stand',
    score: (h) => h.needs.fun > 72 || !world.toys.length || h.needs.energy < 20 ? 0 : curve(h.needs.fun) * (h.has('playful') ? 1.45 : 0.9) + (h.child ? 10 : 0),
    find: (h) => nearest(h, world.toys, (t) => !t.occupant),
    dest: (h, a) => a.target.pos,
    arriveDist: 0.8,
    perform: (h, dt, a) => {
      const t = a.target;
      if (!world.toys.includes(t)) return true;
      const d = dist2(t.pos, h.pos);
      if (d > 0.75) navigate(h, t.pos, h.speed * 1.2, dt);
      else {
        h.moving = false;
        if ((a.data.kick = (a.data.kick || 0) - dt) <= 0) {
          a.data.kick = 0.4;
          const ang = Math.atan2(t.pos.x - h.pos.x, t.pos.z - h.pos.z) + rand(-0.9, 0.9);
          const p = rand(3.5, 6.5);
          t.vel.set(Math.sin(ang) * p, 0, Math.cos(ang) * p);
          h.needs.fun += 9; sfx.boing(t.pos);
        }
      }
      return a.t > 12 || h.needs.fun >= 100;
    },
    end: (h, a) => { if (a.phase === 'perform') h.addMoodlet('Had a ball', 5, HOUR * 3); },
  },
  clean: {
    icon: '🧽', pose: 'clean',
    score: (h) => {
      if (!world.messes.some((m) => !m.reservedBy)) return 0;
      if (h.has('clean')) return 30 + world.messes.length * 2;
      return h.needs.hygiene > 50 && world.messes.length > 5 ? 10 : 0;
    },
    find: (h) => nearest(h, world.messes, (m) => !m.reservedBy),
    dest: (h, a) => world.messes.includes(a.target) ? a.target.pos : null,
    arriveDist: 0.6,
    perform: (h, dt, a) => {
      if (!world.messes.includes(a.target)) return true;
      a.face = a.target.pos;
      if (a.t > 2.4) { removeMess(a.target); h.needs.hygiene -= 5; h.addMoodlet(h.has('clean') ? 'Tidied up!' : 'Did a chore', h.has('clean') ? 6 : 1, HOUR * 2); return true; }
    },
  },
  wander: {
    pose: 'stand',
    score: () => 10,
    start: (h, a) => { a.data.dest = randomFloorPoint(); a.data.wait = rand(1.5, 5); },
    dest: (h, a) => a.data.dest,
    perform: (h, dt, a) => { h.needs.fun += 0.25 * dt; return a.t > a.data.wait; },
  },
  // ---- forced (no score)
  panic: {
    icon: '😱', speedMul: 2.1,
    start: (h, a) => { a.data.dest = h.pos.clone(); sfx.panic(h.pos); },
    dest: (h, a) => {
      const from = a.data.from || camera.position;
      const dx = h.pos.x - from.x, dz = h.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
      a.data.dest.set(h.pos.x + dx / d * 3, 0, h.pos.z + dz / d * 3);
      a.data.dest.x = clamp(a.data.dest.x, -HW + 1, HW - 1); a.data.dest.z = clamp(a.data.dest.z, -HD + 1, HD - 1);
      if (a.moveT > 2.6) return h.pos; // calm down
      return a.data.dest;
    },
    perform: (h, dt, a) => a.t > 0.6,
  },
  accident: {
    icon: '😳', pose: 'accident', noMove: true,
    arrive: (h) => {
      const poop = Math.random() < 0.45;
      spawnMess(poop ? 'poop' : 'puddle', h.pos.x + rand(-0.2, 0.2), h.pos.z + rand(-0.2, 0.2));
      h.needs.bladder = 100; h.needs.hygiene -= 35; h.addMoodlet('Had an accident', -15, HOUR * 4);
      state.stats.accidents++;
      log(`💩 ${h.name} couldn't find a toilet in time.`, 'bad'); sfx.bad();
    },
    perform: (h, dt, a) => a.t > 1.8,
  },
  faint: {
    icon: '😵', pose: 'faint', noMove: true,
    arrive: (h) => { log(`😵 ${h.name} passed out from exhaustion.`, 'bad'); h.addMoodlet('Passed out', -10, HOUR * 4); },
    perform: (h, dt, a) => { h.needs.energy += 2 * dt; if ((a.data.snore = (a.data.snore || 1) - dt) <= 0) { a.data.snore = 3; sfx.snore(h.pos); } return h.needs.energy > 55; },
  },
  cheer: {
    icon: '🤩', pose: 'cheer', noMove: true,
    perform: (h, dt, a) => a.t > 2.5,
  },
};

function startChat(a, b) {
  b.endAction(); a.endAction();
  const dur = rand(4.5, 7);
  a.action = { type: 'chat', target: b, phase: 'perform', t: 0, moveT: 0, score: 50, data: { dur, leader: true } };
  b.action = { type: 'chat', target: a, phase: 'perform', t: 0, moveT: 0, score: 50, data: { dur: dur + 0.2 } };
  a.pendingChat = b.pendingChat = null;
  a.moving = b.moving = false; a.vel.set(0, 0, 0); b.vel.set(0, 0, 0);
  sfx.chirp(a.pos);
}
function chatFinished(a, b) {
  const r = (a.relWith(b) + b.relWith(a)) / 2;
  a.addMoodlet('Nice chat', 4, HOUR * 2); b.addMoodlet('Nice chat', 4, HOUR * 2);
  gainRP(0.5);
  // breeding / reproduction
  if (!a.child && !b.child && r > 45 && a.mood > 58 && b.mood > 58 && world.humans.length < POP_CAP && state.babyCooldown <= 0 && Math.random() < 0.4) {
    state.babyCooldown = HOUR * 10;
    const mid = a.pos.clone().add(b.pos).multiplyScalar(0.5);
    floatEmoji(mid, '💕', 1.1);
    setTimeout(() => floatEmoji(mid, '👶', 1.1), 500);
    const baby = new Human({ child: true, x: mid.x + 0.4, z: mid.z + 0.4,
      skin: new THREE.Color(a.skin).lerp(new THREE.Color(b.skin), 0.5).getHex(),
      hairCol: Math.random() < 0.5 ? a.hairCol : b.hairCol, hat: 'none', hair: pick([a.hair, b.hair, 'bald']),
      traits: [pick([...a.traits, ...b.traits])], needs: { food: 80, energy: 80, bladder: 90, hygiene: 90, social: 70, fun: 80 } });
    baby.addRel(a, 50); baby.addRel(b, 50); a.addRel(baby, 50); b.addRel(baby, 50);
    world.humans.push(baby);
    a.addMoodlet('New family', 15, HOUR * 8); b.addMoodlet('New family', 15, HOUR * 8);
    log(`👶 ${a.name} and ${b.name} have produced a new specimen: ${baby.name}!`, 'good');
    sfx.baby(); gainRP(15); state.stats.births++;
    completeObjective('birth');
  } else if (r > 30 && Math.random() < 0.3) {
    floatEmoji(a.pos.clone().add(b.pos).multiplyScalar(0.5), pick(['😂', '❤️', '🤝', '😊']), 0.7);
  }
}

function confiscate(h) {
  if (h.removed) return;
  h.removed = true;
  if (h.action) h.endAction();
  for (const o of world.humans) if (o.action?.target === h) o.endAction();
  world.humans.splice(world.humans.indexOf(h), 1);
  floatEmoji(h.pos, '🛸', 1.2);
  h.dispose();
  state.stats.confiscated++;
  log(`🛸 ${h.name} was confiscated by the Galactic Welfare Bureau!`, 'bad'); sfx.bad();
  if (state.selected === h) select(null);
  if (!world.humans.length) gameOver();
}

// ---------------------------------------------------------------------------
// Player interaction: tools, picking, placement
// ---------------------------------------------------------------------------
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const groundPlane = new THREE.Plane(new V3(0, 1, 0), 0);
let placing = null; // { kind, ghost, rot, cost, item }

function setMouse(e) { mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = -(e.clientY / innerHeight) * 2 + 1; ray.setFromCamera(mouse, camera); }
function ownerOf(hits) { for (const h of hits) { let o = h.object; while (o) { if (o.userData.owner) return { owner: o.userData.owner, point: h.point }; o = o.parent; } } return null; }
function pickHuman() { return ownerOf(ray.intersectObjects(world.humans.map((h) => h.root), true)); }
function pickFurniture() { return ownerOf(ray.intersectObjects(world.furniture.map((f) => f.mesh), true)); }
function floorPoint() { const p = new V3(); return ray.ray.intersectPlane(groundPlane, p) ? p : null; }
function inEnclosure(p, m = 0.3) { return p && Math.abs(p.x) < HW - m && Math.abs(p.z) < HD - m; }

function interacted() {
  state.stats.interactions++; state.stats.lastInteraction = state.time;
  state.engagement = clamp(state.engagement + 12, 0, 100);
}
function gainRP(v) { state.rp += v; state.lifetimeRP += v; }
function spend(v) { if (state.rp < v) { toast(`Not enough research (${v} RP needed).`); sfx.bad(); return false; } state.rp -= v; return true; }

function onClick(e) {
  setMouse(e);
  if (placing) { tryPlace(); return; }
  const hh = pickHuman(), ff = pickFurniture(), fp = floorPoint();
  const tool = state.tool;
  if (ff && ff.owner.kind === 'dispenser' && !hh) { refillDispenser(ff.owner); return; }
  if (tool === 'inspect') {
    if (hh) { select(hh.owner); interacted(); }
    else if (ff) toast(`${ff.owner.def.icon} ${ff.owner.def.name}${ff.owner.occupant ? ' (in use by ' + ff.owner.occupant.name + ')' : ''}`);
    else select(null);
  } else if (tool === 'food') {
    if (!inEnclosure(fp)) return;
    if (world.pellets.length >= 15) { toast('That\'s plenty of food on the floor.'); return; }
    if (!spend(1)) return;
    addPellet(fp.x, fp.z); sfx.place(); floatEmoji(fp, '🍖', 0.5);
    state.stats.pellets++; interacted();
  } else if (tool === 'spray') {
    if (hh) {
      const h = hh.owner;
      h.needs.hygiene = clamp(h.needs.hygiene + 40, 0, 100);
      h.addMoodlet('Hosed down by aliens', -8, HOUR * 2);
      h.forceAction('panic', { from: camera.position.clone() });
      sfx.spray(h.pos); floatEmoji(h.pos, '💦');
      state.stats.sprays++; interacted();
      return;
    }
    if (!fp) return;
    sfx.spray(fp); floatEmoji(fp, '💦', 0.6);
    let cleaned = 0;
    for (const m of [...world.messes]) if (dist2(m.pos, fp) < 1.3) { if (m.reservedBy?.action?.target === m) m.reservedBy.endAction(); removeMess(m, true); cleaned++; }
    state.stats.sprays++; interacted();
    // nearby humans get startled
    for (const h of world.humans) if (dist2(h.pos, fp) < 1.6 && !h.fixedPose) h.forceAction('panic', { from: fp.clone() });
  } else if (tool === 'medi') {
    if (!hh) return;
    const h = hh.owner;
    if (!h.sick) { toast(`${h.name} is not sick.`); return; }
    if (!spend(4)) return;
    h.cure(true); sfx.zap(h.pos); state.stats.cures++; interacted();
    log(`💉 You cured ${h.name}.`, 'good');
  }
}

function startPlacing(kind, cost, item) {
  cancelPlacing();
  let ghost;
  if (kind === 'toy') ghost = mesh(new THREE.IcosahedronGeometry(0.32, 1), stdMat(0xffffff));
  else ghost = FURN[kind].build({});
  ghost.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.material.depthWrite = false; } o.castShadow = false; });
  ghost.visible = false; scene.add(ghost);
  placing = { kind, ghost, rot: 0, cost, item, valid: false };
  $('tool-hint').textContent = 'Click to place · R rotate · Esc cancel';
}
function cancelPlacing() {
  if (!placing) return;
  scene.remove(placing.ghost); placing = null;
  if (state.tool === 'toy') {
    state.tool = 'inspect'; canvas.style.cursor = 'default';
    document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === 'inspect'));
  }
  updateToolHint();
}
const _localColliders = (kind, rot) => kind === 'toy' ? [{ x: 0, z: 0, r: 0.35 }] : FURN[kind].colliders.map((c) => ({ x: c.x * Math.cos(rot) + c.z * Math.sin(rot), z: -c.x * Math.sin(rot) + c.z * Math.cos(rot), r: c.r }));
function updatePlacing() {
  if (!placing) return;
  const p = floorPoint();
  if (!p) { placing.ghost.visible = false; return; }
  p.x = Math.round(p.x * 4) / 4; p.z = Math.round(p.z * 4) / 4;
  placing.ghost.visible = true;
  placing.ghost.position.set(p.x, placing.kind === 'toy' ? 0.32 : 0, p.z);
  placing.ghost.rotation.y = placing.rot;
  let ok = inEnclosure(p, 1);
  for (const c of _localColliders(placing.kind, placing.rot)) {
    const x = p.x + c.x, z = p.z + c.z;
    if (Math.abs(x) > HW - c.r - 0.1 || Math.abs(z) > HD - c.r - 0.1) ok = false;
    for (const o of world.colliders) if (Math.hypot(x - o.x, z - o.z) < c.r + o.r + 0.3) ok = false;
  }
  if (placing.kind !== 'toy' && FURN[placing.kind]) {
    const ap = FURN[placing.kind].approach; const r = placing.rot;
    const ax = p.x + ap[0] * Math.cos(r) + ap[1] * Math.sin(r), az = p.z - ap[0] * Math.sin(r) + ap[1] * Math.cos(r);
    if (!inEnclosure({ x: ax, z: az }, 0.5)) ok = false;
    for (const o of world.colliders) if (Math.hypot(ax - o.x, az - o.z) < o.r + 0.35) ok = false;
  }
  placing.valid = ok; placing.point = p;
  placing.ghost.traverse((o) => { if (o.material?.emissive) o.material.emissive.set(ok ? 0x115533 : 0x661111); });
}
function tryPlace() {
  updatePlacing();
  if (!placing.valid) { toast('Can\'t place that here.'); sfx.bad(); return; }
  if (!spend(placing.cost)) return;
  const { kind, point, rot, item } = placing;
  if (kind === 'toy') { addToy(point.x, point.z); state.stats.toys++; completeObjective('toy'); }
  else addFurniture(kind, point.x, point.z, rot);
  sfx.place(); interacted(); state.stats.purchases++;
  if (item) state.purchases[item.id] = (state.purchases[item.id] || 0) + 1;
  log(`🛠️ Installed: ${kind === 'toy' ? 'Enrichment Ball' : FURN[kind].name}.`);
  cancelPlacing();
  if (state.tool === 'toy') setTool('inspect');
}

// ---------------------------------------------------------------------------
// Research lab (tech tree)
// ---------------------------------------------------------------------------
const LAB = [
  { id: 'bed', icon: '🛏️', name: 'Sleeping Pod', cost: 20, desc: 'One specimen per pod. Floor-sleepers get grumpy.', place: 'bed' },
  { id: 'dispenser', icon: '🍽️', name: 'Food Dispenser', cost: 25, desc: 'Holds 6 meals. Refill by clicking it.', place: 'dispenser' },
  { id: 'toilet', icon: '🚽', name: 'Waste Receptacle', cost: 22, desc: 'Fewer accidents, fewer puddles.', place: 'toilet' },
  { id: 'shower', icon: '🚿', name: 'Hygiene Station', cost: 22, desc: 'Lets specimens clean themselves (and rinse off illness).', place: 'shower' },
  { id: 'toy', icon: '⚽', name: 'Enrichment Ball', cost: 8, desc: 'Specimens kick it around. Restores fun.', place: 'toy' },
  { id: 'specimen', icon: '🧍', name: 'Acquire Specimen', cost: 35, desc: 'Abduct a fresh hominid. Max 12.', unlock: 20, buy: () => {
    if (world.humans.length >= POP_CAP) { toast('Enclosure is at capacity.'); return false; }
    const p = randomFloorPoint(); const h = new Human({ x: p.x, z: p.z }); world.humans.push(h);
    floatEmoji(h.pos, '🛸', 1.2); log(`🛸 New specimen acquired: ${h.name} (${h.traits.map((t) => TRAITS[t].label).join(', ')}).`, 'good');
    return true;
  } },
  { id: 'scrubber', icon: '🤖', name: 'Scrubber Drone', cost: 50, desc: 'Roams the floor cleaning up messes.', unlock: 60, max: 3, buy: () => { const p = randomFloorPoint(); addBot(p.x, p.z); log('🤖 A scrubber drone has been deployed.', 'good'); return true; } },
  { id: 'climate', icon: '❄️', name: 'Climate Stabilizer', cost: 45, desc: 'Halves temperature swings from night and climate events.', unlock: 80, max: 1, buy: () => { state.upgrades.climate = true; return true; } },
  { id: 'autofeed', icon: '⚙️', name: 'Auto-Refill Module', cost: 60, desc: 'Dispensers slowly restock themselves.', unlock: 110, max: 1, buy: () => { state.upgrades.autofeed = true; return true; } },
  { id: 'xenoscope', icon: '🔭', name: 'Xeno-Scope', cost: 80, desc: '+50% research from happy specimens.', unlock: 160, max: 1, buy: () => { state.upgrades.xenoscope = true; return true; } },
];
function renderLab() {
  $('lab-rp').textContent = Math.floor(state.rp);
  $('lab-life').textContent = Math.floor(state.lifetimeRP);
  const wrap = $('lab-items'); wrap.innerHTML = '';
  for (const it of LAB) {
    const owned = state.purchases[it.id] || 0;
    const locked = (it.unlock || 0) > state.lifetimeRP;
    const maxed = it.max && owned >= it.max;
    const b = document.createElement('button');
    b.className = 'lab-item' + (locked ? ' locked' : '');
    b.disabled = locked || maxed || state.rp < it.cost;
    b.innerHTML = `<span class="t">${it.icon} ${it.name}</span><span class="d">${it.desc}</span>
      <span class="c">${locked ? `🔒 Unlocks at ${it.unlock} lifetime RP` : maxed ? '✔ Installed' : `🔬 ${it.cost} RP`}${owned && !maxed ? ` · owned ${owned}` : ''}</span>`;
    b.onclick = () => {
      if (it.place) { closeModal('lab'); startPlacing(it.place, it.cost, it); return; }
      if (!spend(it.cost)) return;
      if (it.buy() === false) { state.rp += it.cost; return; }
      state.purchases[it.id] = owned + 1; state.stats.purchases++; interacted(); sfx.ding(); renderLab();
      if (it.max === 1) log(`🧪 Research complete: ${it.name}.`, 'good');
    };
    wrap.appendChild(b);
  }
  const s = state.stats, mins = (state.time - s.lastInteraction) / HOUR;
  const rows = [
    ['Total interactions', s.interactions], ['Hours since last contact', mins.toFixed(1)],
    ['Engagement', Math.round(state.engagement) + '%'], ['Research multiplier', '×' + rpMult().toFixed(2)],
    ['Dispenser refills', s.refills], ['Food pellets dropped', s.pellets], ['Spray blasts', s.sprays],
    ['Cures administered', s.cures], ['Messes you cleaned', s.messesCleaned], ['Accidents', s.accidents],
    ['Births observed', s.births], ['Specimens confiscated', s.confiscated],
  ];
  $('lab-report').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}
const rpMult = () => (0.6 + 0.8 * state.engagement / 100) * (state.upgrades.xenoscope ? 1.5 : 1);

// ---------------------------------------------------------------------------
// Environmental events (weather-ish) & climate
// ---------------------------------------------------------------------------
const EVENTS = [
  { id: 'heat', short: 'solar flare', name: '🔥 Solar Flare: the enclosure is heating up', temp: 10, dur: 4 },
  { id: 'cold', short: 'coolant leak', name: '🧊 Coolant Leak: temperatures are dropping', temp: -11, dur: 4 },
  { id: 'spores', short: 'spore drift', name: '🍄 Spore Drift: illness spreads more easily', temp: 0, dur: 5 },
  { id: 'meteor', short: 'meteor shower', name: '🌠 Meteor Shower: the specimens are delighted', temp: 0, dur: 2, night: true },
];
const meteors = [];
function updateEvents(dt) {
  if (!state.event && day() >= state.nextEventDay && hour() > 9) {
    if (Math.random() < 0.0035 * dt * 10) {
      const options = EVENTS.filter((e) => !e.night || isNight() || hour() > 19);
      const ev = pick(options);
      state.event = { ...ev, t: 0 };
      state.nextEventDay = day() + randi(1, 2);
      $('event-banner').textContent = ev.name; $('event-banner').classList.remove('hidden');
      log(ev.name + '.', ev.id === 'meteor' ? 'good' : 'warn');
      if (ev.id === 'meteor') for (const h of world.humans) if (!['sleep', 'faint', 'toilet', 'shower'].includes(h.action?.type)) { h.forceAction('cheer'); h.addMoodlet('Saw shooting stars', 10, HOUR * 6); h.needs.fun = 100; }
    }
  }
  if (state.event) {
    state.event.t += dt;
    if (state.event.id === 'meteor' && Math.random() < dt * 4) spawnMeteor();
    if (state.event.t > state.event.dur * HOUR) { log(`The ${state.event.short} has passed.`); state.event = null; $('event-banner').classList.add('hidden'); }
  }
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i]; m.t += dt; m.l.position.addScaledVector(m.v, dt); m.l.material.opacity = clamp(1 - m.t, 0, 1);
    if (m.t > 1) { scene.remove(m.l); meteors.splice(i, 1); }
  }
  // climate: thermostat + day/night + events
  const swing = state.upgrades.climate ? 0.5 : 1;
  const dayOff = isNight() ? -4 : lerp(-1, 2.5, daylight());
  const target = state.setpoint + swing * (dayOff + (state.event?.temp || 0));
  state.temp = lerp(state.temp, target, clamp(dt * 0.04, 0, 1));
}
function spawnMeteor() {
  const g = new THREE.BufferGeometry().setFromPoints([new V3(0, 0, 0), new V3(6, 3, 0)]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true, fog: false }));
  l.position.set(rand(-80, 80), rand(60, 100), rand(-120, -40));
  scene.add(l); meteors.push({ l, v: new V3(-90, -45, 0), t: 0 });
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------
const OBJECTIVES = [
  { id: 'eat', text: 'Watch a specimen eat' },
  { id: 'refill', text: 'Refill a food dispenser' },
  { id: 'toy', text: 'Place an enrichment ball' },
  { id: 'clean', text: 'Spray away a mess' },
  { id: 'pop5', text: 'Keep 5 specimens at once' },
  { id: 'birth', text: 'Observe a birth' },
  { id: 'rp200', text: 'Earn 200 lifetime research' },
  { id: 'day5', text: 'Reach day 5' },
];
function renderObjectives() {
  $('obj-list').innerHTML = OBJECTIVES.map((o) => `<li class="${state.objectivesDone.has(o.id) ? 'done' : ''}">${o.text}</li>`).join('');
}
function completeObjective(id) {
  if (state.objectivesDone.has(id)) return;
  state.objectivesDone.add(id);
  const o = OBJECTIVES.find((x) => x.id === id);
  log(`📋 Objective complete: ${o.text}. (+5 RP)`, 'good'); gainRP(5); sfx.ding();
  renderObjectives();
  if (!state.certified && state.objectivesDone.size === OBJECTIVES.length) {
    state.certified = true;
    log('🏆 The Galactic Zoological Society certifies your enclosure. Splendid keeping!', 'good');
    toast('🏆 Enclosure certified! Keep going as long as you like.', 5000);
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function log(text, kind = '') {
  const el = document.createElement('div'); el.textContent = text; if (kind) el.className = kind;
  const box = $('log'); box.appendChild(el);
  while (box.children.length > 7) box.removeChild(box.firstChild);
  [...box.children].forEach((c, i, arr) => c.classList.toggle('old', i < arr.length - 3));
  console.log('[log]', text);
}
let toastTimer = 0;
function toast(text, ms = 2200) {
  const t = $('toast'); t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
const TOOL_HINTS = {
  inspect: 'Click a specimen to inspect it. Click a dispenser to refill.',
  food: 'Click the floor to drop a nutrient pellet (1 RP).',
  toy: 'Place an enrichment ball (8 RP).',
  spray: 'Click messes to clean. Click a specimen to hose them down.',
  medi: 'Click a sick specimen to cure them (4 RP).',
};
function updateToolHint() { $('tool-hint').textContent = TOOL_HINTS[state.tool] || ''; }
function setTool(t) {
  cancelPlacing();
  state.tool = t;
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  updateToolHint();
  if (t === 'toy') startPlacing('toy', 8, LAB.find((l) => l.id === 'toy'));
  canvas.style.cursor = t === 'inspect' ? 'default' : 'crosshair';
}
function setSpeed(s) {
  state.speed = s;
  document.querySelectorAll('.speed button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s));
}
function select(h) {
  state.selected = h;
  if (!h) state.follow = false;
  $('inspector').classList.toggle('hidden', !h);
  document.body.classList.toggle('has-inspector', !!h);
  if (h) {
    $('ins-needs').innerHTML = NEEDS.map((n) => `<div class="bar"><label>${n.icon} ${n.label}<span id="nv-${n.k}"></span></label><div><i id="nb-${n.k}"></i></div></div>`).join('');
    updateInspector();
  }
}
const MOOD_LABELS = [[80, '😄 Ecstatic'], [62, '🙂 Happy'], [45, '😐 Fine'], [28, '😟 Uncomfortable'], [0, '😫 Miserable']];
const moodLabel = (m) => MOOD_LABELS.find(([t]) => m >= t)[1];
const ACTION_LABELS = { eat: 'Eating', sleep: 'Sleeping', toilet: 'Using the toilet', shower: 'Showering', socialize: 'Looking for company', chat: 'Chatting', play: 'Playing ball', clean: 'Cleaning up', wander: 'Wandering', panic: 'PANICKING', accident: 'Having an accident', faint: 'Passed out', cheer: 'Stargazing!' };
function updateInspector() {
  const h = state.selected; if (!h) return;
  $('ins-name').textContent = h.name;
  $('ins-sub').textContent = `Specimen #${h.specimen} · ${h.child ? `Juvenile (${Math.round(h.growth * 100)}% grown)` : 'Adult'} · ${h.hat !== 'none' ? 'wears a ' + ({ tophat: 'top hat', party: 'party hat' }[h.hat] || h.hat) : 'hatless'}`;
  $('ins-traits').innerHTML = h.traits.map((t) => `<span class="chip" title="${TRAITS[t].desc}">${TRAITS[t].icon} ${TRAITS[t].label}</span>`).join('') + (h.sick ? '<span class="chip sick">🤒 Sick</span>' : '');
  const a = h.action;
  $('ins-action').textContent = a ? (ACTION_LABELS[a.type] || a.type) + (a.phase === 'move' && !['wander', 'panic'].includes(a.type) ? ' (on the way)' : '') + (a.type === 'chat' ? ` with ${a.target.name}` : '') : 'Thinking…';
  const mb = $('ins-mood'); mb.style.width = h.mood + '%'; mb.style.background = needColor(h.mood);
  $('ins-mood-label').textContent = moodLabel(h.mood);
  const hb = $('ins-health'); hb.style.width = h.health + '%'; hb.style.background = needColor(h.health);
  $('ins-health-label').textContent = Math.round(h.health) + '%';
  for (const n of NEEDS) {
    const v = h.needs[n.k], b = $('nb-' + n.k);
    if (b) { b.style.width = v + '%'; b.style.background = needColor(v); $('nv-' + n.k).textContent = Math.round(v); }
  }
  const ml = [...h.moodlets];
  if (h.sick) ml.push({ name: 'Sick', val: -15 });
  if (world.messes.length > 2) ml.push({ name: 'Messy enclosure', val: -Math.round(Math.min(15, world.messes.length * 0.7) * (h.has('clean') ? 2 : 1)) });
  const dT = Math.abs(state.temp - 21); if (dT > 3) ml.push({ name: state.temp > 21 ? 'Too hot' : 'Too cold', val: -Math.round((dT - 3) * 2.5) });
  $('ins-moodlets').innerHTML = ml.length ? ml.map((m) => `<div><span>${m.name}</span><b class="${m.val >= 0 ? 'pos' : 'neg'}">${m.val > 0 ? '+' : ''}${Math.round(m.val)}</b></div>`).join('') : '<div><i>None</i></div>';
  const rels = [...h.rel.entries()].map(([id, v]) => ({ o: world.humans.find((x) => x.id === id), v })).filter((r) => r.o).sort((a, b) => b.v - a.v).slice(0, 4);
  $('ins-rels').innerHTML = rels.length ? rels.map((r) => `<div><span>${r.o.name}</span><b class="${r.v >= 0 ? 'pos' : 'neg'}">${r.v >= 60 ? '💖' : r.v >= 30 ? '😊' : '🙂'} ${Math.round(r.v)}</b></div>`).join('') : '<div><i>Hasn\'t met anyone yet</i></div>';
  $('ins-follow').classList.toggle('on', state.follow);
}
function updateHUD() {
  const h = hour(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60 / 10) * 10;
  $('clock-day').textContent = `Day ${day()}`;
  $('clock-time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  $('clock-phase').textContent = isNight() ? '🌙' : h < 9 ? '🌅' : h > 18 ? '🌇' : '☀️';
  $('stat-rp').textContent = Math.floor(state.rp);
  $('stat-pop').textContent = world.humans.length;
  const avg = world.humans.length ? world.humans.reduce((s, x) => s + x.mood, 0) / world.humans.length : 0;
  $('stat-mood').textContent = Math.round(avg);
  $('stat-mess').textContent = world.messes.length;
  $('stat-temp').textContent = Math.round(state.temp);
  $('stat-eng').style.width = state.engagement + '%';
  if (!$('lab').classList.contains('hidden') && !labPointerDown) {
    const sig = Math.floor(state.rp) + '|' + state.stats.purchases + '|' + Math.floor(state.lifetimeRP / 10);
    if (sig !== labSig) { labSig = sig; renderLab(); }
  }
  if (world.humans.length >= 5) completeObjective('pop5');
  if (state.lifetimeRP >= 200) completeObjective('rp200');
  if (day() >= 5) completeObjective('day5');
}
let labSig = '', labPointerDown = false;
$('lab').addEventListener('pointerdown', () => { labPointerDown = true; });
addEventListener('pointerup', () => { setTimeout(() => { labPointerDown = false; }, 0); });
function openModal(id) { $(id).classList.remove('hidden'); if (id === 'lab') renderLab(); }
function closeModal(id) { $(id).classList.add('hidden'); }

// ---------------------------------------------------------------------------
// Simulation tick
// ---------------------------------------------------------------------------
let autoFeedT = 0;
function simulate(dt) {
  state.time += dt;
  state.babyCooldown -= dt;
  state.engagement = clamp(state.engagement - 0.18 * dt, 0, 100);
  for (const h of [...world.humans]) if (!h.removed) h.update(dt);
  updateToys(dt);
  updateBots(dt);
  updateEvents(dt);
  // research from happy specimens
  let r = 0; for (const h of world.humans) r += (h.mood / 100) * 0.06;
  gainRP(r * rpMult() * dt);
  if (state.upgrades.autofeed && (autoFeedT += dt) > 25) {
    autoFeedT = 0;
    for (const f of world.furniture) if (f.kind === 'dispenser' && f.stock < DISPENSER_MAX) { f.stock++; updateDispenser(f); }
  }
}

function updateLighting() {
  const dl = daylight(), h = hour();
  const ang = ((h - 6) / 13) * Math.PI;
  sun.position.set(Math.cos(ang) * 30, 8 + Math.sin(Math.max(0, ang)) * 26, -10 + Math.sin(ang) * 6);
  sun.intensity = 0.15 + 2.4 * dl;
  const warm = 1 - Math.abs(dl - 0.5) * 2;
  sun.color.setRGB(1, lerp(0.93, 0.75, warm * (1 - dl)), lerp(0.84, 0.6, warm * (1 - dl)));
  hemi.intensity = 0.35 + 0.75 * dl;
  nightLamp.intensity = (1 - dl) * 0.9;
  const bg = _bg.setHex(0x0b0820).lerp(_bgDay, dl);
  if (state.event?.id === 'heat') bg.lerp(_heat, 0.25); else if (state.event?.id === 'cold') bg.lerp(_cold, 0.25); else if (state.event?.id === 'spores') bg.lerp(_spore, 0.3);
  scene.background.copy(bg); scene.fog.color.copy(bg);
  if (world.stars) world.stars.material.opacity = 0.15 + (1 - dl) * 0.8;
}
const _bg = new THREE.Color(), _bgDay = new THREE.Color(0x5b4a8c), _heat = new THREE.Color(0xff7b3a), _cold = new THREE.Color(0x6fc8ff), _spore = new THREE.Color(0x8bd34e);

// ---------------------------------------------------------------------------
// Camera keys & follow
// ---------------------------------------------------------------------------
const keys = new Set();
function updateCamera(rdt) {
  const panSpeed = 14 * rdt * (controls.getDistance() / 30);
  const fwd = new V3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new V3(-fwd.z, 0, fwd.x);
  const mv = new V3();
  if (keys.has('w') || keys.has('arrowup')) mv.add(fwd);
  if (keys.has('s') || keys.has('arrowdown')) mv.sub(fwd);
  if (keys.has('d') || keys.has('arrowright')) mv.add(right);
  if (keys.has('a') || keys.has('arrowleft')) mv.sub(right);
  if (mv.lengthSq()) { state.follow = false; mv.normalize().multiplyScalar(panSpeed); camera.position.add(mv); controls.target.add(mv); }
  const rot = (keys.has('q') ? 1 : 0) - (keys.has('e') ? 1 : 0);
  if (rot) {
    const off = camera.position.clone().sub(controls.target);
    off.applyAxisAngle(new V3(0, 1, 0), rot * rdt * 1.6);
    camera.position.copy(controls.target).add(off);
  }
  if (state.follow && state.selected) {
    const tgt = state.selected.root.position;
    const delta = new V3(tgt.x, 0.8, tgt.z).sub(controls.target).multiplyScalar(clamp(rdt * 4, 0, 1));
    controls.target.add(delta); camera.position.add(delta);
  }
  // keep the camera focused around the enclosure
  const t = controls.target, before = t.clone();
  t.x = clamp(t.x, -HW - 6, HW + 6); t.z = clamp(t.z, -HD - 6, HD + 6); t.y = clamp(t.y, 0, 4);
  camera.position.add(t.clone().sub(before));
}

// ---------------------------------------------------------------------------
// Input wiring
// ---------------------------------------------------------------------------
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || !state.started) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  if (moved < 6 && downAt.b === 0 && performance.now() - downAt.t < 600) onClick(e);
  else if (moved < 6 && downAt.b === 2 && placing) cancelPlacing();
  downAt = null;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
let hoverEvt = null;
canvas.addEventListener('pointermove', (e) => { hoverEvt = e; if (placing) { setMouse(e); updatePlacing(); } });
canvas.addEventListener('pointerleave', () => { hoverEvt = null; $('tooltip').classList.add('hidden'); });
function updateHover() {
  if (!hoverEvt) return;
  setMouse(hoverEvt);
  const tip = $('tooltip');
  const hh = pickHuman();
  let text = null;
  if (hh) { const h = hh.owner; text = `${h.name} · ${moodLabel(h.mood)}${h.sick ? ' · 🤒' : ''}`; }
  else { const ff = pickFurniture(); if (ff) { const f = ff.owner; text = `${f.def.icon} ${f.def.name}` + (f.kind === 'dispenser' ? ` · ${f.stock}/${DISPENSER_MAX} meals (click to refill)` : '') + (f.occupant ? ` · ${f.occupant.name}` : ''); } }
  if (text && !placing) { tip.textContent = text; tip.style.left = hoverEvt.clientX + 14 + 'px'; tip.style.top = hoverEvt.clientY + 14 + 'px'; tip.classList.remove('hidden'); }
  else tip.classList.add('hidden');
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (!state.started) return;
  if (k === '1') setTool('inspect');
  else if (k === '2') setTool('food');
  else if (k === '3') setTool('toy');
  else if (k === '4') setTool('spray');
  else if (k === '5') setTool('medi');
  else if (k === ' ') { e.preventDefault(); if (state.speed) { state.prevSpeed = state.speed; setSpeed(0); } else setSpeed(state.prevSpeed || 1); }
  else if (k === ',') setSpeed(1);
  else if (k === '.') setSpeed(3);
  else if (k === '/') setSpeed(6);
  else if (k === 't') $('lab').classList.contains('hidden') ? openModal('lab') : closeModal('lab');
  else if (k === 'g' || k === '`') toggleDebug();
  else if (k === 'm') toggleMute();
  else if (k === 'h') $('intro').classList.toggle('hidden');
  else if (k === 'f') { if (state.selected) state.follow = !state.follow; }
  else if (k === 'r' && placing) placing.rot += Math.PI / 2;
  else if (k === 'escape') { if (placing) cancelPlacing(); else if (!$('lab').classList.contains('hidden')) closeModal('lab'); else if (state.tool !== 'inspect') setTool('inspect'); else select(null); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

document.querySelectorAll('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('.speed button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
$('btn-lab').onclick = () => openModal('lab');
$('btn-help').onclick = () => $('intro').classList.remove('hidden');
$('btn-debug').onclick = toggleDebug;
$('btn-mute').onclick = toggleMute;
$('ins-close').onclick = () => select(null);
$('ins-follow').onclick = () => { state.follow = !state.follow; updateInspector(); };
$('thermo').addEventListener('input', (e) => { state.setpoint = +e.target.value; $('thermo-val').textContent = state.setpoint + '°'; });
$('thermo').addEventListener('change', (e) => { interacted(); e.target.blur(); });
// keep hotkeys (esp. Space) from re-triggering whatever button was last clicked
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
$('btn-start').onclick = () => {
  sfx.init(); if (sfx.ctx?.state === 'suspended') sfx.ctx.resume();
  $('intro').classList.add('hidden');
  if (!state.started) { state.started = true; log('👽 Observation log started. Keep your specimens alive and content.'); }
  $('btn-start').textContent = 'Resume';
};
$('btn-restart').onclick = () => location.reload();
function toggleDebug() { state.debug = !state.debug; $('btn-debug').classList.toggle('on', state.debug); for (const h of world.humans) { h.updateDebugLabel(); if (h.dbg) h.dbg.visible = state.debug; } }
function toggleMute() { sfx.muted = !sfx.muted; $('btn-mute').querySelector('span').textContent = sfx.muted ? '🔇' : '🔊'; }

function gameOver() {
  state.over = true;
  $('go-text').innerHTML = `Every specimen has been confiscated by the Galactic Welfare Bureau.<br>
    You lasted until <b>day ${day()}</b>, observed <b>${state.stats.births}</b> birth(s) and earned <b>${Math.floor(state.lifetimeRP)}</b> research.`;
  $('gameover').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Setup & main loop
// ---------------------------------------------------------------------------
function setup() {
  buildEnvironment();
  rebuildGrid();
  addFurniture('bed', -13.2, -HD + 1.7, 0);
  addFurniture('bed', -10.8, -HD + 1.7, 0);
  addFurniture('bed', -8.4, -HD + 1.7, 0);
  addFurniture('dispenser', -1.5, -HD + 1.0, 0);
  addFurniture('toilet', 10.5, -HD + 0.8, 0);
  addFurniture('shower', 13.5, -HD + 1.1, 0);
  for (let i = 0; i < 3; i++) { const p = randomFloorPoint(); world.humans.push(new Human({ x: p.x * 0.5, z: p.z * 0.5 })); }
  renderObjectives(); updateToolHint(); updateHUD();
}
setup();

let last = performance.now(), uiT = 0, dbgT = 0, frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000); last = now;
  const dt = state.started && !state.over ? rdt * state.speed : 0;
  if (dt > 0) {
    const steps = Math.ceil(dt / 0.05), sub = dt / steps;
    for (let i = 0; i < steps; i++) simulate(sub);
  }
  for (const h of world.humans) h.animate(dt, rdt);
  for (const p of world.pellets) { p.t += dt; p.mesh.rotation.y = p.t * 1.5; p.mesh.position.y = 0.2 + Math.sin(p.t * 3) * 0.04; }
  for (const a of world.decor) { a.userData.bob += rdt; a.position.y = -1.4 + Math.sin(a.userData.bob * 0.5) * 0.3; }
  for (const f of world.furniture) if (f.alert) f.alert.position.y = 2.9 + Math.sin(now / 200) * 0.08;
  updateFloaters(rdt);
  updateCamera(rdt);
  controls.update();
  updateLighting();
  if ((uiT -= rdt) <= 0) { uiT = 0.25; updateHUD(); updateInspector(); updateHover(); }
  if (state.debug && (dbgT -= rdt) <= 0) { dbgT = 0.25; for (const h of world.humans) h.updateDebugLabel(); }
  renderer.render(scene, camera);
  frames++;
}
requestAnimationFrame(frame);

// Exposed for debugging in the console.
window.HE = {
  state, world, ACTIONS, Human, setSpeed, select, spawnMess, camera,
  step(seconds) { for (let t = 0; t < seconds; t += 0.05) simulate(0.05); for (const h of world.humans) h.animate(0.05, 0.05); },
  screenOf(v) { const p = new V3(v.x, v.y || 0, v.z).project(camera); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; },
};
