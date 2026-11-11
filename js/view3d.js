// 3D replay of a play: same play data as the 2D board, drawn with Three.js.
// Loaded only when someone presses "3D", so the 2D board stays fast.
//
// World units are metres. The court is centred on the origin: x along the court (Blue end −9 … Red end +9),
// z across it (−4.5 … +4.5), y up. 2D board units are 30 per metre with (0,0) at Blue's end-line corner.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const U = 30;
const NET_H = 2.24;            // catchball net height (women's / mixed)
const BALL_R = 0.105;
const HAND_Y = 1.3;            // where a player holds the ball
const toWorld = (p) => new THREE.Vector3(p[0] / U - 9, 0, p[1] / U - 4.5);
const TEAM = { A: 0x1f5fbf, B: 0xc8362d };
const KEYS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];

const CAMERAS = {
  tv: { pos: [-2.5, 7, 13], target: [0, 0.6, 0] },
  blue: { pos: [-16, 4.5, 0], target: [2, 1, 0] },
  red: { pos: [16, 4.5, 0], target: [-2, 1, 0] },
  top: { pos: [0, 21, 0.01], target: [0, 0, 0] },
  corner: { pos: [-13, 7, 11], target: [0, 0.8, 0] },
};

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function numberTexture(num, color, round) {
  return canvasTexture(128, 128, (g, w, h) => {
    if (round) {
      g.fillStyle = '#' + color.toString(16).padStart(6, '0');
      g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
    }
    g.fillStyle = '#fff';
    g.font = `bold ${round ? 72 : 96}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), w / 2, h / 2 + 4);
  });
}

// ---------- Court ----------
function buildCourt(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 26), new THREE.MeshStandardMaterial({ color: 0x2f6f9f, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const court = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshStandardMaterial({ color: 0xe07b39, roughness: 0.75 }));
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.002;
  court.receiveShadow = true;
  scene.add(court);

  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const line = (x, z, lx, lz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(lx, 0.006, lz), lineMat);
    m.position.set(x, 0.004, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  const W = 0.05;
  line(0, -4.5, 18 + W, W); line(0, 4.5, 18 + W, W);           // sidelines
  line(-9, 0, W, 9 + W); line(9, 0, W, 9 + W);                   // end lines
  line(0, 0, W, 9);                                               // centre line
  line(-3, 0, W, 9); line(3, 0, W, 9);                            // attack lines
  for (let z = -6.25; z <= -4.75; z += 0.4) { line(-3, z, W, 0.15); line(3, z, W, 0.15); line(-3, -z, W, 0.15); line(3, -z, W, 0.15); }

  // Net
  const mesh = canvasTexture(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(20,20,20,0.85)'; g.lineWidth = 2;
    for (let x = 0; x <= w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
  mesh.wrapS = mesh.wrapT = THREE.RepeatWrapping;
  mesh.repeat.set(10, 1.3);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(10, 1), new THREE.MeshStandardMaterial({ map: mesh, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 }));
  net.rotation.y = Math.PI / 2;
  net.position.set(0, NET_H - 0.5, 0);
  scene.add(net);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  band.position.set(0, NET_H - 0.035, 0);
  band.castShadow = true;
  scene.add(band);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.4, roughness: 0.4 });
  for (const z of [-5.2, 5.2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, NET_H + 0.3, 16), postMat);
    post.position.set(0, (NET_H + 0.3) / 2, z);
    post.castShadow = true;
    scene.add(post);
  }
  const stripes = canvasTexture(16, 128, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e33'; g.fillRect(0, (i * h) / 8, w, h / 8); } });
  for (const z of [-4.5, 4.5]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.8, 8), new THREE.MeshStandardMaterial({ map: stripes }));
    ant.position.set(0, NET_H - 1 + 0.9, z);
    scene.add(ant);
  }
}

// ---------- Players ----------
// Articulated figures built in code: hips, knees, spine, shoulders, elbows and head all bend, so the motions
// below (ready stance, running, passes, overhand throws, spikes, rainbow lobs, catches) are made for catchball.
// Local axes: +Z is where the player faces, +Y is up.

const LOOKS = [
  { skin: 0xf1c7a3, hair: 0x2b1d14, style: 'pony' }, { skin: 0xd9a77f, hair: 0x111111, style: 'short' },
  { skin: 0x8d5a3b, hair: 0x0d0d0d, style: 'bun' }, { skin: 0xe8b98f, hair: 0x7a4a24, style: 'pony' },
  { skin: 0xc68b62, hair: 0x1a1a1a, style: 'short' }, { skin: 0xf3d2b5, hair: 0xb98a3e, style: 'bun' },
];

function capsule(r, len, mat) { return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 12), mat); }

function buildPlayer(key) {
  const color = TEAM[key[0]], num = key.slice(1);
  const look = LOOKS[(Number(num) + (key[0] === 'B' ? 3 : 0)) % LOOKS.length];
  const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.75 });
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.9 });
  const put = (mesh, parent, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };
  const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const root = new THREE.Group();
  const pelvis = joint(root, 0, 0.95, 0);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.24, 14), dark), pelvis, 0, -0.04, 0);   // shorts

  const hips = [], knees = [];
  for (const side of [-1, 1]) {
    const hip = joint(pelvis, 0.095 * side, -0.05, 0);
    put(capsule(0.07, 0.3, skin), hip, 0, -0.21, 0);                       // thigh
    const knee = joint(hip, 0, -0.43, 0);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.11, 12), dark), knee, 0, -0.02, 0.012); // knee pad
    put(capsule(0.055, 0.3, skin), knee, 0, -0.2, 0);                      // shin
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.12, 10), white), knee, 0, -0.36, 0); // sock
    const shoe = put(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.25), white), knee, 0, -0.45, 0.05);
    shoe.material = white;
    hips.push(hip); knees.push(knee);
  }

  const spine = joint(pelvis, 0, 0.06, 0);
  const torso = put(capsule(0.165, 0.3, shirt), spine, 0, 0.27, 0);
  torso.scale.set(1.15, 1, 0.72);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 10), skin), spine, 0, 0.6, 0); // neck
  const head = joint(spine, 0, 0.72, 0);
  const skull = put(new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), skin), head);
  skull.scale.set(0.95, 1.12, 1);
  const hair = put(new THREE.Mesh(new THREE.SphereGeometry(0.117, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat), head, 0, 0.012, -0.008);
  hair.scale.set(0.97, 1.12, 1.03);
  if (look.style === 'pony') { const t = put(capsule(0.035, 0.16, hairMat), head, 0, -0.03, -0.12); t.rotation.x = 0.35; }
  if (look.style === 'bun') put(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), hairMat), head, 0, 0.08, -0.1);
  for (const side of [-1, 1]) put(new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), dark), head, 0.038 * side, 0.02, 0.1); // eyes

  const shoulders = [], elbows = [], hands = [];
  for (const side of [-1, 1]) {
    const sh = joint(spine, 0.215 * side, 0.5, 0);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.13, 10), shirt), sh, 0, -0.05, 0); // sleeve
    put(capsule(0.046, 0.2, skin), sh, 0, -0.15, 0);                        // upper arm
    const el = joint(sh, 0, -0.29, 0);
    put(capsule(0.04, 0.19, skin), el, 0, -0.13, 0);                        // forearm
    put(new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), skin), el, 0, -0.27, 0.01); // hand
    const hand = joint(el, 0, -0.29, 0.03);
    shoulders.push(sh); elbows.push(el); hands.push(hand);
  }

  const jersey = numberTexture(num, color, false);
  for (const [z, ry] of [[0.125, 0], [-0.125, Math.PI]]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: jersey, transparent: true }));
    plate.position.set(0, 0.3, z);
    plate.rotation.y = ry;
    spine.add(plate);
  }
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(num, color, true), depthTest: false }));
  label.scale.set(0.42, 0.42, 1);
  label.position.y = 2.25;
  label.renderOrder = 10;
  root.add(label);

  return {
    group: root, pelvis, spine, head, hips, knees, shoulders, elbows, hands, label,
    // body = what jumps (kept for the camera code)
    body: pelvis,
    yaw: key[0] === 'A' ? Math.PI / 2 : -Math.PI / 2, phase: Math.random() * 6, last: null, speed: 0, pose: null,
  };
}

// A pose is a set of joint angles (radians) plus how far the hips drop (crouch) or rise (jump).
const POSE_KEYS = ['hipL', 'hipR', 'kneeL', 'kneeR', 'shL', 'shR', 'abL', 'abR', 'elL', 'elR', 'spine', 'neck', 'drop', 'lift'];
const pose = (o) => Object.assign(Object.fromEntries(POSE_KEYS.map((k) => [k, 0])), o);
const mix = (a, b, w) => { const o = {}; for (const k of POSE_KEYS) o[k] = a[k] + (b[k] - a[k]) * w; return o; };
const both = (o, sh, el, ab = 0.12) => Object.assign(o, { shL: sh, shR: sh, elL: el, elR: el, abL: ab, abR: ab });

function readyPose(t) {
  const b = Math.sin(t * 2.2) * 0.03;
  return pose({ hipL: -0.45, hipR: -0.4, kneeL: 0.8 + b, kneeR: 0.75 + b, spine: 0.3, neck: -0.25, drop: 0.13 + b * 0.2,
    shL: -1.45, shR: -1.45, elL: -1.25, elR: -1.25, abL: 0.3, abR: 0.3 });
}
function runPose(ph, k) {
  const s = Math.sin(ph), c = Math.cos(ph);
  return pose({
    hipL: -s * 0.8 * k - 0.15, hipR: s * 0.8 * k - 0.15,
    kneeL: (0.35 + Math.max(0, c) * 1.1) * k + 0.2, kneeR: (0.35 + Math.max(0, -c) * 1.1) * k + 0.2,
    shL: s * 0.7 * k, shR: -s * 0.7 * k, elL: -1.4, elR: -1.4, abL: 0.12, abR: 0.12,
    spine: 0.15 + 0.15 * k, neck: -0.1, drop: 0.05 + Math.abs(c) * 0.04 * k,
  });
}
const holdPose = (p) => both(Object.assign({}, p), -0.95, -1.35, 0.2);
const catchHigh = (p) => both(Object.assign({}, p, { neck: -0.45 }), -2.85, -0.25, 0.25);
const catchMid = (p) => both(Object.assign({}, p, { neck: -0.15 }), -1.35, -0.5, 0.22);
function overhandThrow(p, u) {          // right arm; u: 0 wind-up … 0.45 cocked … 0.6 release (arm straight up) … 1 follow-through
  const o = Object.assign({}, p);
  if (u < 0.45) { const w = smooth(u / 0.45); o.shR = -1.0 - 2.1 * w; o.elR = -0.6 - 1.3 * w; o.shL = -1.2 - 1.2 * w; o.elL = -0.3; o.spine = 0.1 - 0.35 * w; }
  else if (u < 0.6) { const w = smooth((u - 0.45) / 0.15); o.shR = -3.1 + 0.25 * w; o.elR = -1.9 + 1.9 * w; o.shL = -2.4 + 0.6 * w; o.elL = -0.3; o.spine = -0.25 + 0.15 * w; }
  else { const w = (u - 0.6) / 0.4; o.shR = -2.85 + 2.15 * w; o.elR = 0; o.shL = -1.8 + 1.0 * w; o.elL = -0.3; o.spine = -0.1 + 0.6 * w; }
  o.abL = 0.15; o.abR = 0.06;
  return o;
}
function chestPass(p, u) {               // two hands from the chest, pushed out
  const w = smooth(Math.min(1, u / 0.7));
  return both(Object.assign({}, p), -0.9 - 0.6 * w, -1.5 + 1.4 * w, 0.2);
}
function rainbowLob(p, u) {              // two hands swung from the hips up over the head, legs extending
  const w = smooth(Math.min(1, u / 0.75));
  const o = both(Object.assign({}, p), -0.4 - 2.4 * w, -0.5 + 0.4 * w, 0.18);
  o.kneeL = o.kneeR = 0.9 * (1 - w) + 0.1; o.hipL = o.hipR = -0.5 * (1 - w); o.drop = 0.18 * (1 - w); o.spine = 0.35 - 0.45 * w;
  return o;
}
const blockPose = (p) => both(Object.assign({}, p, { neck: -0.2, spine: 0.05 }), -2.95, -0.1, 0.12);
function jumpLegs(o, h) { o.kneeL = o.kneeR = 0.3 + h * 0.9; o.hipL = o.hipR = -0.2 - h * 0.6; o.lift = h * 0.6; o.drop = 0; return o; }

function applyPose(p, q, dt, exact) {
  // Ease towards the target pose so changes look natural (throws follow their timing exactly)
  p.pose = p.pose && !exact ? mix(p.pose, q, Math.min(1, dt * 16)) : q;
  const o = p.pose;
  p.hips[0].rotation.x = o.hipL; p.hips[1].rotation.x = o.hipR;
  p.knees[0].rotation.x = o.kneeL; p.knees[1].rotation.x = o.kneeR;
  p.shoulders[0].rotation.set(o.shL, 0, -o.abL); p.shoulders[1].rotation.set(o.shR, 0, o.abR);
  p.elbows[0].rotation.x = o.elL; p.elbows[1].rotation.x = o.elR;
  p.spine.rotation.x = o.spine; p.head.rotation.x = o.neck;
  p.pelvis.position.y = 0.95 - o.drop + o.lift;
}

const angleTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- Kits (uniforms) ----------
// The mannequin has no texture map, so the kit is painted in a shader from each point's rest-pose position:
// body part (from the skeleton) + height decide skin / jersey / shorts or leggings / shoes, and the jersey
// gets its colour gradient and a blocky skyline silhouette. Colours come from assets/kits.json.

const DEFAULT_KITS = {
  A: { jersey: ['#86d6d1', '#4fb2aa', '#1f6a61'], number: '#f3d35e', numberOutline: null, logo: { sp: '#f3d35e', ike: '#1f6a61', girls: '#1f6a61' }, label: '#1f8f86', legsColor: '#16171b', shoes: '#eeeeee', legs: {} },
  B: { jersey: ['#efd46c', '#f39945', '#e3412b'], number: '#ffffff', numberOutline: '#e3412b', logo: { sp: '#f8f2e0', ike: '#e2392a', girls: '#e2392a' }, label: '#e3412b', legsColor: '#16171b', shoes: '#eeeeee', legs: {} },
};
const SKIN_TONES = ['#f1c7a3', '#e0ac85', '#c68b62', '#8d5a3b', '#f5d6bd', '#d29a73'];
const HAIR = [
  { color: '#2b1d14', style: 'pony' }, { color: '#111111', style: 'bun' }, { color: '#7a4a24', style: 'pony' },
  { color: '#b98a3e', style: 'pony' }, { color: '#1a1a1a', style: 'short' }, { color: '#5a3518', style: 'bun' },
];
// Body parts by bone: 0 head/neck, 1 torso, 2 arm/hand, 3 thigh, 4 calf, 5 foot
function partOf(bone) {
  if (/^(Head|neck)/.test(bone)) return 0;
  if (/^(spine|clavicle|pelvis|root)/.test(bone)) return 1;
  if (/^(thigh)/.test(bone)) return 3;
  if (/^(calf)/.test(bone)) return 4;
  if (/^(foot|ball)/.test(bone)) return 5;
  return 2;
}
// Rest-pose heights on the model (metres, before scaling)
const Y = { jerseyTop: 1.52, jerseyBottom: 0.9, shortsCut: 0.8, ankle: 0.12 };

/** Adds an `aPart` attribute (body part per vertex) to each skinned geometry, once. */
function tagParts(gltf) {
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh || o.geometry.getAttribute('aPart')) return;
    const J = o.geometry.getAttribute('skinIndex'), W = o.geometry.getAttribute('skinWeight');
    const parts = new Float32Array(J.count);
    for (let i = 0; i < J.count; i++) {
      let best = 0, bw = -1;
      for (let c = 0; c < 4; c++) { const w = W.getComponent(i, c); if (w > bw) { bw = w; best = J.getComponent(i, c); } }
      parts[i] = partOf(o.skeleton.bones[best].name);
    }
    o.geometry.setAttribute('aPart', new THREE.BufferAttribute(parts, 1));
  });
}

function kitMaterial(kit, skin, leggings, seed) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  const C = (c) => ({ value: new THREE.Color(c) });
  const u = {
    uTop: C(kit.jersey[0]), uFar: C(kit.jersey[1]), uNear: C(kit.jersey[2]), uLegs: C(kit.legsColor || '#16171b'),
    uShoe: C(kit.shoes || '#eeeeee'), uSkin: C(skin), uLeggings: { value: leggings ? 1 : 0 }, uSeed: { value: seed },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nflat varying float vPart;\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = aPart;\nvRest = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uTop, uFar, uNear, uLegs, uShoe, uSkin; uniform float uLeggings, uSeed;
flat varying float vPart; varying vec3 vRest;
float h1(float n) { return fract(sin(n * 127.1 + uSeed * 31.7) * 43758.5453); }
vec3 jersey(vec3 p) {
  float t = clamp((${Y.jerseyTop.toFixed(2)} - p.y) / ${(Y.jerseyTop - Y.jerseyBottom).toFixed(2)}, 0.0, 1.0);   // 0 = shoulders, 1 = hem
  float a = atan(p.x, p.z) / 6.2832 + 0.5;                                             // 0..1 around the body
  vec3 c = mix(uTop, mix(uTop, uFar, 0.35), smoothstep(0.1, 0.6, t));
  float nf = floor(a * 26.0), nn = floor(a * 17.0 + 0.5);
  float far = 0.42 + 0.26 * h1(nf), near = 0.22 + 0.22 * h1(nn + 50.0);
  if (1.0 - t < far) c = uFar;
  if (1.0 - t < near) {
    c = uNear;
    // a few lit windows in the near buildings
    vec2 w = vec2(fract(a * 17.0 * 4.0), fract(p.y * 26.0));
    if (w.x > 0.3 && w.x < 0.62 && w.y > 0.35 && w.y < 0.75 && h1(floor(a * 68.0) + floor(p.y * 26.0) * 7.0) > 0.55 && 1.0 - t > 0.08) c = mix(uNear, uFar, 0.7);
  }
  if (1.0 - t < 0.06) c = uNear;
  return c;
}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
float part = floor(vPart + 0.5);
vec3 kc = uSkin;
if (part < 0.5) kc = uSkin;
else if (part < 1.5) kc = vRest.y > ${Y.jerseyBottom.toFixed(2)} ? jersey(vRest) : uLegs;
else if (part < 2.5) kc = uSkin;
else if (part < 3.5) kc = (uLeggings > 0.5 || vRest.y > ${Y.shortsCut.toFixed(2)}) ? uLegs : uSkin;
else if (part < 4.5) kc = uLeggings > 0.5 ? (vRest.y > ${Y.ankle.toFixed(2)} ? uLegs : uShoe) : uSkin;
else kc = uShoe;
vec4 diffuseColor = vec4( kc, opacity );`);
  };
  m.customProgramCacheKey = () => 'kit-v1';
  return m;
}

function numberTex(num, fill, outline) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'bold 200px system-ui, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (outline) { g.lineWidth = 14; g.strokeStyle = outline; g.lineJoin = 'round'; g.strokeText(num, w / 2, h / 2 + 10); }
    g.fillStyle = fill; g.fillText(num, w / 2, h / 2 + 10);
  });
}
function logoTex(logo) {
  return canvasTexture(512, 320, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textBaseline = 'alphabetic';
    g.font = '900 150px system-ui, Arial, sans-serif';
    const sp = 'Sp', ike = 'ike', wsp = g.measureText(sp).width, wike = g.measureText(ike).width;
    const x0 = (w - wsp - wike) / 2;
    g.fillStyle = logo.sp; g.fillText(sp, x0, 175);
    g.fillStyle = logo.ike; g.fillText(ike, x0 + wsp, 175);
    // Space Needle: a little tower over the "i"
    g.fillStyle = logo.sp;
    const nx = x0 + wsp + 18;
    g.fillRect(nx - 4, 20, 8, 80); g.beginPath(); g.ellipse(nx, 40, 34, 9, 0, 0, Math.PI * 2); g.fill();
    g.font = '800 92px system-ui, Arial, sans-serif';
    g.textAlign = 'center'; g.fillStyle = logo.girls; g.fillText('girls', w / 2 + 40, 285);
  });
}

function decal(tex, w, h) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2,
  }));
}

/** Put the kit, hair, numbers and logo on a freshly cloned mannequin (still in its rest pose). */
function dressRig(model, bones, key, kits, scale) {
  const team = key[0], num = key.slice(1), kit = kits[team] || DEFAULT_KITS[team];
  const idx = Number(num) - 1 + (team === 'B' ? 3 : 0);
  const leggings = (kit.legs && kit.legs[num]) ? kit.legs[num] === 'leggings' : idx % 2 === 1;
  const mat = kitMaterial(kit, SKIN_TONES[idx % SKIN_TONES.length], leggings, team === 'A' ? 1.3 : 4.7);
  model.traverse((o) => { if (o.isMesh) o.material = mat; });
  model.updateMatrixWorld(true);

  // Find the chest/back surfaces in the rest pose to place the number and logo
  let back = -0.15, front = 0.12;
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const P = o.geometry.getAttribute('position'), part = o.geometry.getAttribute('aPart');
    for (let i = 0; i < P.count; i++) {
      if (part.getX(i) !== 1) continue;
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      if (Math.abs(x) < 0.05 && y > 1.2 && y < 1.36) { back = Math.min(back, z); front = Math.max(front, z); }
    }
  });
  // (x, y, z) is a point on the rest-pose body, in the mesh's own coordinates
  let ref = null;
  model.traverse((o) => { if (!ref && o.isSkinnedMesh) ref = o; });
  const attachAt = (obj, bone, x, y, z, ry = 0, rx = 0) => {
    const wp = ref.localToWorld(new THREE.Vector3(x, y, z));
    model.add(obj);
    obj.position.copy(model.worldToLocal(wp));
    obj.rotation.set(rx, ry, 0);
    obj.updateMatrixWorld(true);
    bone.attach(obj);   // keep the placement, then follow the bone
  };
  const spine = bones.spine_03 || bones.spine_02;
  if (spine) {
    attachAt(decal(numberTex(num, kit.number, kit.numberOutline), 0.24 / scale, 0.24 / scale), spine, 0, 1.3, back - 0.012, Math.PI);
    attachAt(decal(logoTex(kit.logo || DEFAULT_KITS[team].logo), 0.23 / scale, 0.144 / scale), spine, 0.0, 1.3, front + 0.012, 0);
  }

  // Hair
  const hair = HAIR[idx % HAIR.length];
  const hm = new THREE.MeshStandardMaterial({ color: hair.color, roughness: 0.85 });
  const head = bones.Head;
  if (head) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hm);
    cap.castShadow = true;
    cap.scale.set(1.02, 1.12, 1.15);
    attachAt(cap, head, 0, 1.705, -0.012);
    if (hair.style === 'pony') {
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.17, 4, 10), hm);
      tail.castShadow = true;
      attachAt(tail, head, 0, 1.64, -0.14, 0, 0.35);
    } else if (hair.style === 'bun') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), hm);
      bun.castShadow = true;
      attachAt(bun, head, 0, 1.79, -0.085);
    }
  }
  return kit;
}

// ---------- Mannequin players ----------
// Character and motion-captured animations: Quaternius "Universal Animation Library" (CC0), assets/player.glb.
// Legs and body come from the clips (idle, jog, sprint, jump); the arms are aimed in code for holding,
// passing, throwing, spiking and catching, because the library has no ball-handling animations.

// Arm directions in the player's own space (+Z forward, +X = the player's left, +Y up), for the LEFT arm.
// The right arm mirrors X. `up` = upper arm (shoulder → elbow), `fore` = forearm (elbow → wrist).
const ARM = {
  hold: { up: [0.25, -0.75, 0.6], fore: [-0.45, 0.15, 0.88] },
  // Waiting stance: elbows in front at chest height, forearms up, hands in front of the face (ready to catch)
  ready: { up: [0.36, -0.12, 0.92], fore: [-0.28, 0.82, 0.5] },
  // Block: both arms straight up and slightly forward over the net
  block: { up: [0.16, 0.95, 0.27], fore: [0.04, 0.95, 0.32] },
  high: { up: [0.3, 0.9, 0.3], fore: [0.15, 0.95, 0.25] },
  mid: { up: [0.2, -0.25, 0.95], fore: [-0.15, 0.15, 1] },
  passEnd: { up: [0.12, -0.05, 1], fore: [0, 0, 1] },
  lobLow: { up: [0.15, -0.95, 0.3], fore: [-0.25, -0.6, 0.75] },
  lobUp: { up: [0.15, 0.97, 0.25], fore: [0.05, 1, 0.15] },
  cocked: { up: [0.5, 0.8, -0.15], fore: [0.1, 0.6, -0.8] },
  reach: { up: [0.1, 0.97, 0.2], fore: [0.05, 0.97, 0.25] },
  follow: { up: [0.1, -0.5, 0.85], fore: [0, -0.8, 0.6] },
  // Free arm during a one-handed throw: points forward at the target, then drops
  guideUp: { up: [0.32, 0.2, 0.93], fore: [0.08, 0.3, 0.95] },
  guideDown: { up: [0.25, -0.85, 0.45], fore: [0.05, -0.6, 0.8] },
  // Carrying the ball in one hand before a serve or spike (right arm), free arm relaxed in front
  carry: { up: [0.35, -0.55, 0.75], fore: [0.1, 0.6, 0.8] },
  relaxed: { up: [0.3, -0.75, 0.6], fore: [0.0, -0.2, 1] },
};
const nlerp = (a, b, t) => { const v = a.map((x, i) => x + (b[i] - x) * t); const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const armMix = (a, b, t) => ({ up: nlerp(a.up, b.up, t), fore: nlerp(a.fore, b.fore, t) });

/** Which way each arm should point for an action ({ hold, throwKind, a, catchHigh, catchW }). */
function armTargets(act) {
  if (act.throwKind === 'over') {
    const a = act.a;
    const R = a < 0.45 ? armMix(ARM.carry, ARM.cocked, smooth(a / 0.45))
      : a < 0.6 ? armMix(ARM.cocked, ARM.reach, smooth((a - 0.45) / 0.15)) : armMix(ARM.reach, ARM.follow, smooth((a - 0.6) / 0.4));
    const L = a < 0.6 ? armMix(ARM.relaxed, ARM.guideUp, smooth(a / 0.6)) : armMix(ARM.guideUp, ARM.guideDown, smooth((a - 0.6) / 0.4));
    return { L, R, w: 1 };
  }
  if (act.throwKind === 'lob') {
    const a = act.a;
    const arm = a < 0.2 ? armMix(ARM.hold, ARM.lobLow, smooth(a / 0.2)) : armMix(ARM.lobLow, ARM.lobUp, smooth(Math.min(1, (a - 0.2) / 0.55)));
    return { L: arm, R: arm, w: 1 };
  }
  if (act.throwKind === 'pass') { const arm = armMix(ARM.hold, ARM.passEnd, smooth(Math.min(1, act.a / 0.7))); return { L: arm, R: arm, w: 1 }; }
  if (act.blockW > 0.01) return { L: ARM.block, R: ARM.block, w: act.blockW };
  if (act.catchW > 0) { const arm = act.catchHigh ? ARM.high : ARM.mid; return { L: arm, R: arm, w: act.catchW }; }
  if (act.hold && act.oneHand) return { L: ARM.relaxed, R: ARM.carry, w: 1 };
  if (act.hold) return { L: ARM.hold, R: ARM.hold, w: 1 };
  if (act.readyW > 0.01) return { L: ARM.ready, R: ARM.ready, w: act.readyW };
  return null;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
/** Rotate `bone` so that the direction bone → child points along `dirWorld`, blended by w. */
function aimBone(bone, child, dirWorld, w) {
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  const cur = _b.sub(_a).normalize();
  _q1.setFromUnitVectors(cur, dirWorld);
  bone.getWorldQuaternion(_q2);
  const targetWorld = _q1.multiply(_q2);
  bone.parent.getWorldQuaternion(_q3);
  const local = _q3.invert().multiply(targetWorld);
  bone.quaternion.slerp(local, w);
  bone.updateMatrixWorld(true);
}

function numberLabelTexture(num, color) {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 72px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), w / 2, h / 2 + 4);
  });
}

const RIG_CLIPS = ['Idle_Loop', 'Crouch_Idle_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop'];

function buildRig(gltf, key, label, kits) {
  const model = SkeletonUtils.clone(gltf.scene);
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
  });
  model.scale.setScalar(0.96);
  const kit = dressRig(model, bones, key, kits, 0.96);
  // Number label above the head in the kit's colour
  label.material.map = numberLabelTexture(key.slice(1), kit.label || '#333');
  label.material.needsUpdate = true;
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(model);
  group.add(inner);
  // Make the model face +Z (its left hand on +X), whatever way it was exported
  model.updateMatrixWorld(true);
  if (bones.hand_l && bones.hand_l.getWorldPosition(new THREE.Vector3()).x < 0) model.rotation.y = Math.PI;
  group.add(label);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const name of RIG_CLIPS) {
    const clip = gltf.animations.find((c) => c.name === name);
    if (!clip) continue;
    const act = mixer.clipAction(clip);
    act.play();
    act.setEffectiveWeight(name === 'Idle_Loop' ? 1 : 0);
    act.time = Math.random() * clip.duration;   // players don't move in sync
    actions[name] = act;
  }
  return { group, inner, model, bones, mixer, actions, weights: {}, armW: 0 };
}

function updateRig(p, act, dt) {
  const r = p.rig;
  // Clip weights: athletic stance (idle + a little crouch) → jog → sprint, or in the air
  const s = p.speed;
  const run = smooth(Math.min(1, Math.max(0, (s - 0.5) / 1.5)));
  const sprint = smooth(Math.min(1, Math.max(0, (s - 4) / 1.5)));
  const air = act.jumpH > 0.05 ? 1 : 0;
  act.readyW = (1 - run) * (1 - air);   // arms up while standing, natural swing while running
  const target = {
    Idle_Loop: (1 - run) * 0.7 * (1 - air), Crouch_Idle_Loop: (1 - run) * 0.3 * (1 - air),
    Jog_Fwd_Loop: run * (1 - sprint) * (1 - air), Sprint_Loop: run * sprint * (1 - air), Jump_Loop: air,
  };
  for (const name in r.actions) {
    r.weights[name] = approach(r.weights[name] ?? (name === 'Idle_Loop' ? 1 : 0), target[name] || 0, 10, dt);
    r.actions[name].setEffectiveWeight(r.weights[name]);
  }
  if (r.actions.Jog_Fwd_Loop) r.actions.Jog_Fwd_Loop.timeScale = Math.max(0.6, s / 3.2);
  if (r.actions.Sprint_Loop) r.actions.Sprint_Loop.timeScale = Math.max(0.8, s / 5.5);
  r.mixer.update(dt);
  r.inner.position.y = act.jumpH * 0.6;
  p.group.updateMatrixWorld(true);

  // Arms on top of the animation
  const tgt = armTargets(act);
  r.armW = approach(r.armW, tgt ? tgt.w : 0, act.throwKind || act.blockW ? 40 : 12, dt);
  if (r.armW < 0.01 || !tgt) return;
  const B = r.bones;
  for (const [side, arm, up, low, hand] of [[1, tgt.L, B.upperarm_l, B.lowerarm_l, B.hand_l], [-1, tgt.R, B.upperarm_r, B.lowerarm_r, B.hand_r]]) {
    if (!arm || !up || !low || !hand) continue;
    _d.set(arm.up[0] * side, arm.up[1], arm.up[2]).applyQuaternion(p.group.quaternion).normalize();
    aimBone(up, low, _d.clone(), r.armW);
    _d.set(arm.fore[0] * side, arm.fore[1], arm.fore[2]).applyQuaternion(p.group.quaternion).normalize();
    aimBone(low, hand, _d.clone(), r.armW);
  }
}

// ---------- Public API ----------
export function create(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18212c);
  scene.fog = new THREE.Fog(0x18212c, 30, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-6, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  buildCourt(scene);

  const players = {};
  for (const k of KEYS) { players[k] = buildPlayer(k); scene.add(players[k].group); }

  // Swap in the mannequin players once their model has loaded (the simple figures stay if it fails)
  const modelUrl = new URL('../assets/player.glb' + new URL(import.meta.url).search, import.meta.url);
  const kitsUrl = new URL('../assets/kits.json' + new URL(import.meta.url).search, import.meta.url);
  const kitsReady = fetch(kitsUrl).then((r) => (r.ok ? r.json() : DEFAULT_KITS)).catch(() => DEFAULT_KITS);
  new GLTFLoader().load(modelUrl.href, async (gltf) => {
    const kits = await kitsReady;
    tagParts(gltf);
    for (const k of KEYS) {
      const old = players[k];
      const rig = buildRig(gltf, k, old.label, kits);
      rig.group.position.copy(old.group.position);
      scene.remove(old.group);
      scene.add(rig.group);
      Object.assign(old, { group: rig.group, rig });
      old.group.visible = !(camMode === 'p:' + k);
    }
  }, undefined, (err) => console.warn('3D players: using simple figures', err));

  const ballTex = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f3f8f';
    for (let i = 0; i < 3; i++) g.fillRect(0, (h / 3) * i + h / 9, w, h / 12);
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.5 }));
  ball.castShadow = true;
  scene.add(ball);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.y = 0.008;
  scene.add(ballShadow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.36, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  ring.visible = false;
  scene.add(ring);

  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 120);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 3;
  controls.maxDistance = 45;
  let camMode = 'tv', camAnim = null;

  function setCamera(name) {
    camMode = name;
    const isPlayer = name.startsWith('p:');
    controls.enabled = !isPlayer;
    for (const k of KEYS) { players[k].group.visible = true; players[k].label.visible = true; players[k].label.scale.set(0.42, 0.42, 1); }
    if (isPlayer) { players[name.slice(2)].group.visible = false; camAnim = null; return; } // hide your own body
    const c = CAMERAS[name] || CAMERAS.tv;
    camAnim = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: new THREE.Vector3(...c.pos), toTarget: new THREE.Vector3(...c.target) };
  }
  camera.position.set(...CAMERAS.tv.pos);
  controls.target.set(...CAMERAS.tv.target);

  // Latest frame from the app:
  // { pos, holder, step, flight: { from, to, t, arc, shot } | null, rest: [x,y] | null }
  let frame = null;
  let release = null;            // where the ball left the thrower's hand, per step

  const fwd = (p, d) => new THREE.Vector3(Math.sin(p.yaw) * d, 0, Math.cos(p.yaw) * d);
  const handsMid = (p) => {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    if (p.rig) { p.rig.bones.hand_l.getWorldPosition(a); p.rig.bones.hand_r.getWorldPosition(b); return a.add(b).multiplyScalar(0.5).add(fwd(p, 0.1)); }
    p.hands[0].getWorldPosition(a); p.hands[1].getWorldPosition(b);
    return a.add(b).multiplyScalar(0.5);
  };
  const rightHand = (p) => {
    const v = new THREE.Vector3();
    if (p.rig) { p.rig.bones.hand_r.getWorldPosition(v); return v.add(fwd(p, 0.06)).setY(v.y + 0.06); }
    p.hands[1].getWorldPosition(v); return v;
  };

  // What kind of throw a flight is, from the shot type and where the thrower is.
  function throwKind(f) {
    if (!f.from.holder) return null;
    const from = toWorld(frame.pos[f.from.holder]);
    const to = f.to.holder ? toWorld(frame.pos[f.to.holder]) : toWorld(f.to.point);
    const crosses = Math.sign(from.x) !== Math.sign(to.x);
    if (f.shot === 'rainbow') return { kind: 'lob', wind: 0.22, jump: false };
    if (f.shot === 'spike') {
      // A spike flies in a straight line. If that line would hit the net, the attacker jumps higher (up to 0.55 m more).
      let extra = 0;
      if (crosses) {
        const tc = from.x / (from.x - to.x), endY = f.to.holder ? 1.6 : BALL_R, contact = 2.8;
        const need = (NET_H + 0.12 - endY * tc) / Math.max(0.05, 1 - tc);
        extra = Math.max(0, Math.min(0.55, need - contact));
      }
      return { kind: 'over', wind: 0.4, jump: true, extra };
    }
    if (Math.abs(from.x) > 9) return { kind: 'over', wind: 0.25, jump: false };      // serve from behind the end line
    if (crosses) return { kind: 'over', wind: 0.22, jump: Math.abs(from.x) < 3.5 };
    return { kind: 'pass', wind: 0.16, jump: false };
  }

  function applyFrame(dt, now) {
    if (!frame) return;
    const f = frame.flight;
    const tk = f ? throwKind(f) : null;
    const wind = tk ? tk.wind : 0;
    const u = f ? (tk ? Math.max(0, (f.t - wind) / (1 - wind)) : f.t) : 0;   // ball's own progress after release
    if (!f || frame.step !== (release && release.step)) release = null;

    // Block: when an attack goes over the net (not a serve), opponents at the net jump with their arms up.
    // Up to three front-row players closest to where the ball crosses; the jump peaks just after the release.
    const blockers = new Map();   // key -> jump height 0..1
    if (f && tk && tk.kind === 'over' && f.from.holder) {
      const from = toWorld(frame.pos[f.from.holder]);
      const to = f.to.holder ? toWorld(frame.pos[f.to.holder]) : toWorld(f.to.point);
      if (Math.abs(from.x) <= 9 && Math.sign(from.x) !== Math.sign(to.x)) {
        const tc = from.x / (from.x - to.x), zc = from.z + (to.z - from.z) * tc;
        const defenders = KEYS.filter((k) => k[0] !== f.from.holder[0] && k !== f.to.holder)
          .map((k) => ({ k, w: toWorld(frame.pos[k]) }))
          .filter((d) => Math.abs(d.w.x) < 2.2 && Math.abs(d.w.z - zc) < 3)
          .sort((a, b) => Math.abs(a.w.z - zc) - Math.abs(b.w.z - zc)).slice(0, 3);
        const t0 = wind - 0.3, t1 = Math.min(1, wind + 0.45);     // take-off … landing (fraction of the step)
        for (const d of defenders) {
          const v = (f.t - t0) / (t1 - t0);
          blockers.set(d.k, v > 0 && v < 1 ? Math.sin(Math.PI * v) : 0);
          blockers.set(d.k + ':arms', v > -0.4 && v < 1.25 ? 1 : 0);
        }
      }
    }

    for (const k of KEYS) {
      const p = players[k];
      const w = toWorld(frame.pos[k]);
      if (!p.last) p.last = w.clone();
      const vel = w.clone().sub(p.last).divideScalar(Math.max(dt, 1e-3));
      p.last.copy(w);
      p.group.position.copy(w);
      p.speed = approach(p.speed, vel.length(), 10, dt);

      // Facing: thrower faces the target, others face where they run or the ball
      let target = p.yaw;
      if (f && f.from.holder === k && u === 0) target = angleTo(w, f.to.holder ? toWorld(frame.pos[f.to.holder]) : toWorld(f.to.point));
      else if (blockers.has(k)) target = angleTo(w, toWorld(frame.pos[f.from.holder]));
      else if (p.speed > 0.6) target = Math.atan2(vel.x, vel.z);
      else target = angleTo(w, ball.position);
      p.yaw += wrap(target - p.yaw) * Math.min(1, dt * 7);
      p.group.rotation.y = p.yaw;

      // What this player is doing right now
      const act = { hold: frame.holder === k, throwKind: null, a: 0, jumpH: 0, catchW: 0, catchHigh: false, blockW: 0 };
      if (blockers.has(k)) { act.jumpH = blockers.get(k) * 1.15; act.blockW = blockers.get(k + ':arms'); }
      if (act.hold && frame.next && frame.next.from.holder === k) { const nk = throwKind(frame.next); act.oneHand = !!nk && nk.kind === 'over'; }
      if (f && f.from.holder === k) {
        act.throwKind = tk.kind;
        act.a = f.t < wind ? 0.6 * (f.t / Math.max(0.01, wind)) : Math.min(1, 0.6 + 0.4 * (f.t - wind) / 0.15);
        if (tk.jump) act.jumpH = Math.max(0, Math.sin(Math.PI * Math.min(1, f.t / (2 * wind)))) * (f.shot === 'spike' ? 1.3 + (tk.extra || 0) / 0.6 : 1);
      }
      if (f && f.to.holder === k && u > 0.35) {
        const end = toWorld(frame.pos[k]);
        act.catchHigh = (f.shot === 'rainbow') || (tk && tk.kind !== 'pass' && Math.abs(end.x) < 9);
        act.catchW = smooth(Math.min(1, (u - 0.35) / 0.4));
      }
      if (p.rig) { updateRig(p, act, dt); continue; }

      // Base: ready stance blended into running
      p.phase += dt * (3 + p.speed * 2.4);
      const k1 = Math.min(1, p.speed / 3.5);
      let q = mix(readyPose(now / 1000 + p.phase * 0.1), runPose(p.phase, Math.max(0.35, k1)), smooth(Math.min(1, p.speed / 1.2)));

      // Actions on top
      if (frame.holder === k) q = act.oneHand ? overhandThrow(q, 0.05) : holdPose(q);
      if (act.blockW > 0) { q = blockPose(q); if (act.jumpH > 0) q = jumpLegs(q, act.jumpH); }
      if (f && f.from.holder === k) {
        // Pose progress: 0 → 0.6 during the wind-up (0.6 = arm at the top, ball leaves the hand), 0.6 → 1 follow-through
        const a = f.t < wind ? 0.6 * (f.t / Math.max(0.01, wind)) : Math.min(1, 0.6 + 0.4 * (f.t - wind) / 0.15);
        if (tk.kind === 'over') q = overhandThrow(q, a);
        else if (tk.kind === 'lob') q = rainbowLob(q, a);
        else q = chestPass(q, a);
        // Jump peaks exactly at the release; spikes jump higher
        if (tk.jump) {
          const h = Math.max(0, Math.sin(Math.PI * Math.min(1, f.t / (2 * wind))));
          q = jumpLegs(q, h * (f.shot === 'spike' ? 1.3 + (tk.extra || 0) / 0.6 : 1));
        }
      }
      if (f && f.to.holder === k && u > 0.35) {
        const end = toWorld(frame.pos[k]);
        const high = (f.shot === 'rainbow') || (tk && tk.kind !== 'pass' && Math.abs(end.x) < 9);
        const w2 = smooth(Math.min(1, (u - 0.35) / 0.4));
        q = mix(q, high ? catchHigh(q) : catchMid(q), w2);
      }
      applyPose(p, q, dt, !!(f && f.from.holder === k));
    }
    for (const k of KEYS) players[k].group.updateMatrixWorld(true);

    let ballPos = null;
    if (f) {
      const thrower = f.from.holder && players[f.from.holder];
      if (thrower && u === 0) {
        // Still winding up: ball in the hand (right hand for overhand throws)
        ballPos = tk.kind === 'over' ? rightHand(thrower) : handsMid(thrower);
      } else {
        if (!release) {
          const start = thrower ? (tk.kind === 'over' ? rightHand(thrower) : handsMid(thrower)) : toWorld(f.from.point).setY(BALL_R);
          release = { step: frame.step, start };
        }
        const start = release.start;
        const end = f.to.holder ? handsMid(players[f.to.holder]) : toWorld(f.to.point).setY(BALL_R);
        let peak;
        if (f.shot === 'spike') peak = 0;
        else if (f.shot === 'rainbow') peak = Math.max(3.2, ((f.arc || 90) / U) * 1.6);
        else peak = Math.max(0.25, ((f.arc || 30) / U) * 1.25);
        // A ball that crosses the net must clear it
        if (Math.sign(start.x) !== Math.sign(end.x) && start.x !== end.x) {
          const tc = start.x / (start.x - end.x);
          const need = NET_H + (f.shot === 'spike' ? 0.12 : 0.35) - (start.y + (end.y - start.y) * tc);
          const lift = 4 * tc * (1 - tc);
          if (lift > 0.05 && peak * lift < need) peak = need / lift;
        }
        const uu = u;
        ballPos = start.clone().lerp(end, uu);
        ballPos.y += 4 * peak * uu * (1 - uu);
        ball.rotation.x += dt * (f.shot === 'spike' ? 24 : 9);
        ball.rotation.z += dt * 4;
      }
      ring.visible = false;
    } else if (frame.holder) {
      const hp = players[frame.holder];
      const nk = frame.next && frame.next.from.holder === frame.holder ? throwKind(frame.next) : null;
      ballPos = nk && nk.kind === 'over' ? rightHand(hp) : handsMid(hp);
      ring.visible = false;
    } else if (frame.rest) {
      ballPos = toWorld(frame.rest).setY(BALL_R);
      ring.position.set(ballPos.x, 0.01, ballPos.z);
      ring.visible = true;
    }
    if (ballPos) {
      ball.position.copy(ballPos);
      ballShadow.position.set(ballPos.x, 0.008, ballPos.z);
      const sc = 1 / (1 + ballPos.y * 0.25);
      ballShadow.scale.set(sc, sc, sc);
    }
  }

  function updateCamera(dt) {
    if (camMode.startsWith('p:')) {
      const p = players[camMode.slice(2)];
      const eye = new THREE.Vector3(); (p.rig ? p.rig.bones.Head : p.head).getWorldPosition(eye); eye.y += p.rig ? 0.1 : 0.03;
      const look = ball.position.clone();
      if (look.distanceTo(eye) < 1.2) look.set(0, 1.4, eye.z * 0.5); // ball in own hands: look at the net
      // Turn the head smoothly instead of snapping to the ball
      if (!p.look) p.look = look.clone();
      p.look.lerp(look, Math.min(1, dt * 6));
      camera.position.copy(eye);
      camera.lookAt(p.look);
      // Labels of players right in front of you would fill the screen: shrink them with distance
      for (const k of KEYS) {
        const d = players[k].group.position.distanceTo(eye);
        players[k].label.visible = players[k].group.visible && d > 2;
        const sc = Math.min(0.42, 0.12 + d * 0.03);
        players[k].label.scale.set(sc, sc, 1);
      }
      return;
    }
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + dt / 0.7);
      const u = smooth(camAnim.t);
      camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, u);
      controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, u);
      if (camAnim.t >= 1) camAnim = null;
    }
    controls.update();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf = 0, last = 0, running = false;
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    applyFrame(dt, now);
    updateCamera(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }

  return {
    update(f) { frame = f; },
    setCamera,
    start() { if (running) return; running = true; last = 0; resize(); raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    snapPlayers() { for (const k of KEYS) players[k].last = null; },
    ballPosition() { return ball.position.toArray(); },
    bodyHeights(k) { const p = players[k]; if (!p.rig) return null; const v = new THREE.Vector3(); const o = {};
      for (const b of ['hand_l', 'hand_r', 'Head']) { p.rig.bones[b].getWorldPosition(v); o[b] = +v.y.toFixed(2); } return o; },
  };
}
