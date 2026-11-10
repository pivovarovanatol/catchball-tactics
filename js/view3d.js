// 3D replay of a play: same play data as the 2D board, drawn with Three.js.
// Loaded only when someone presses "3D", so the 2D board stays fast.
//
// World units are metres. The court is centred on the origin: x along the court (Blue end −9 … Red end +9),
// z across it (−4.5 … +4.5), y up. 2D board units are 30 per metre with (0,0) at Blue's end-line corner.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
function buildPlayer(key) {
  const color = TEAM[key[0]], num = key.slice(1);
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77f, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.8 });
  const add = (mesh, parent = g) => { mesh.castShadow = true; parent.add(mesh); return mesh; };

  const body = new THREE.Group();       // lifted when jumping
  g.add(body);
  const limb = (r1, r2, len, mat) => { const geo = new THREE.CylinderGeometry(r1, r2, len, 10); geo.translate(0, -len / 2, 0); return new THREE.Mesh(geo, mat); };

  const hips = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.1 * side, 0.9, 0);
    add(limb(0.075, 0.055, 0.86, skin), hip);
    const shoe = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.22), dark), hip);
    shoe.position.set(0, -0.86, 0.05);
    body.add(hip);
    hips.push(hip);
  }
  const shorts = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.24, 14), dark), body);
  shorts.position.y = 0.92;
  const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.4, 6, 14), shirt), body);
  torso.position.y = 1.27;
  torso.scale.z = 0.75;
  const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin), body);
  head.position.y = 1.7;
  const hair = add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark), body);
  hair.position.y = 1.715;

  const arms = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(0.25 * side, 1.47, 0);
    sh.rotation.z = 0.12 * side;
    const upper = add(limb(0.055, 0.045, 0.62, shirt), sh);
    upper.material = skin;
    body.add(sh);
    arms.push(sh);
  }
  // Jersey numbers, front and back
  const jersey = numberTexture(num, color, false);
  for (const [z, ry] of [[0.15, 0], [-0.15, Math.PI]]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), new THREE.MeshBasicMaterial({ map: jersey, transparent: true }));
    plate.position.set(0, 1.3, z);
    plate.rotation.y = ry;
    body.add(plate);
  }
  // Floating label, always facing the camera
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(num, color, true), depthTest: false }));
  label.scale.set(0.42, 0.42, 1);
  label.position.y = 2.2;
  label.renderOrder = 10;
  body.add(label);

  return { group: g, body, hips, arms, label, yaw: key[0] === 'A' ? Math.PI / 2 : -Math.PI / 2, phase: 0, last: null, speed: 0, armL: 0, armR: 0 };
}

const angleTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);
const smooth = (t) => t * t * (3 - 2 * t);

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

  // Latest frame from the app: { pos, holder, flight: { from, to, t, arc } | null, rest: [x,y] | null }
  let frame = null;
  const handPos = (k, up) => {
    const p = players[k];
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    return p.group.position.clone().add(fwd.multiplyScalar(0.3)).setY(p.body.position.y + (up ? 2.05 : HAND_Y));
  };

  function applyFrame(dt) {
    if (!frame) return;
    const f = frame.flight;
    let ballPos = null;

    // Who jumps: an attacker at the net throwing over it, or a server.
    let jumper = null, jumpT = 0;
    if (f && f.from.holder) {
      const from = toWorld(frame.pos[f.from.holder]);
      const toP = f.to.holder ? toWorld(frame.pos[f.to.holder]) : toWorld(f.to.point);
      const crosses = Math.sign(from.x) !== Math.sign(toP.x);
      if (crosses && Math.abs(from.x) < 3.5 && f.t < 0.4) { jumper = f.from.holder; jumpT = f.t / 0.4; }
    }

    for (const k of KEYS) {
      const p = players[k];
      const w = toWorld(frame.pos[k]);
      if (!p.last) p.last = w.clone();
      const vel = w.clone().sub(p.last).divideScalar(Math.max(dt, 1e-3));
      p.last.copy(w);
      p.group.position.copy(w);
      p.speed = approach(p.speed, vel.length(), 10, dt);

      // Facing: where they run, otherwise towards the ball
      let target = p.yaw;
      if (p.speed > 0.6) target = Math.atan2(vel.x, vel.z);
      else if (ball.position.lengthSq() > 0) target = angleTo(w, ball.position);
      p.yaw += wrap(target - p.yaw) * Math.min(1, dt * 7);
      p.group.rotation.y = p.yaw;

      // Running legs and arms
      const stride = Math.min(1, p.speed / 4);
      p.phase += dt * (4 + p.speed * 2.2);
      const swing = Math.sin(p.phase) * 0.75 * stride;
      p.hips[0].rotation.x = swing;
      p.hips[1].rotation.x = -swing;

      // Arm poses: holding, catching, throwing, running
      let armL = -swing * 0.8, armR = swing * 0.8;
      if (frame.holder === k) { armL = armR = -1.15; }
      if (f && f.to.holder === k && f.t > 0.45) { const u = smooth(Math.min(1, (f.t - 0.45) / 0.4)); armL = armR = -1.15 - 1.5 * u; }
      if (f && f.from.holder === k && f.t < 0.3) { const u = 1 - f.t / 0.3; armL = armR = -2.6 * u - 0.3; }
      p.armL = approach(p.armL, armL, 14, dt);
      p.armR = approach(p.armR, armR, 14, dt);
      p.arms[0].rotation.x = p.armL;
      p.arms[1].rotation.x = p.armR;

      p.body.position.y = k === jumper ? Math.sin(Math.PI * jumpT) * 0.55 : approach(p.body.position.y, 0, 12, dt);
    }

    if (f) {
      const start = f.from.holder ? handPos(f.from.holder, f.from.holder === jumper) : toWorld(f.from.point).setY(BALL_R);
      const end = f.to.holder ? handPos(f.to.holder, true) : toWorld(f.to.point).setY(BALL_R);
      let peak = Math.max(0.25, ((f.arc || 30) / U) * 1.25);
      // Make sure a ball that crosses the net clears it
      if (Math.sign(start.x) !== Math.sign(end.x) && start.x !== end.x) {
        const tc = start.x / (start.x - end.x);
        const need = NET_H + 0.45 - (start.y + (end.y - start.y) * tc);
        const lift = 4 * tc * (1 - tc);
        if (lift > 0.05 && peak * lift < need) peak = need / lift;
      }
      ballPos = start.clone().lerp(end, f.t);
      ballPos.y += 4 * peak * f.t * (1 - f.t);
      ball.rotation.x += dt * 9;
      ball.rotation.z += dt * 4;
      ring.visible = false;
    } else if (frame.holder) {
      ballPos = handPos(frame.holder, false);
      ring.visible = false;
    } else if (frame.rest) {
      ballPos = toWorld(frame.rest).setY(BALL_R);
      ring.position.set(ballPos.x, 0.01, ballPos.z);
      ring.visible = true;
    }
    if (ballPos) {
      ball.position.copy(ballPos);
      ballShadow.position.set(ballPos.x, 0.008, ballPos.z);
      const s = 1 / (1 + ballPos.y * 0.25);
      ballShadow.scale.set(s, s, s);
    }
  }

  function updateCamera(dt) {
    if (camMode.startsWith('p:')) {
      const p = players[camMode.slice(2)];
      const eye = p.group.position.clone().setY(p.body.position.y + 1.65);
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
    applyFrame(dt);
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
  };
}
