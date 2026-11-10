import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import './style.css';
import { AudioEngine } from './audio';
import { createCar } from './car';
import { Hud } from './hud';
import { Input, type InputAction } from './input';
import { createPost } from './post';
import { createRoad } from './road';
import { createSky } from './sky';
import { ROAD_HALF_WIDTH, Track } from './track';

type Mode = 'title' | 'countdown' | 'playing' | 'paused';

const MAX_SPEED = 300;
const ACCEL = 105;
const BRAKE = 235;
const BOOST_ACCEL = 205;
const BOOST_MAX = 1.28;
const KMH_PER_UNIT = 1.55;

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) throw new Error('canvas #scene missing');

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = SRGBColorSpace;

const scene = new Scene();
scene.fog = new FogExp2(new Color('#2a0a3f'), 0.0018);

const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.4, 20000);
camera.position.set(0, 6, 20);

scene.environment = createEnvironment(renderer);

const hemi = new HemisphereLight(0xff5ab0, 0x120a2a, 1.15);
scene.add(hemi);

const sunLight = new DirectionalLight(0xffd9a0, 1.5);
sunLight.position.set(-180, 120, -420);
scene.add(sunLight);

const track = new Track();
// Put the synthwave sun straight ahead of the starting grid so the very first
// frame reads as a sunset highway.
const startTangent = track.tangentAt(0);
const sunDirection = new Vector3(startTangent.x, 0.17, startTangent.z).normalize();
const sky = createSky(scene, sunDirection);
const road = createRoad(scene, track);
const car = createCar();
scene.add(car.group);

const post = createPost(renderer, scene, camera);
const hud = new Hud();
const audio = new AudioEngine();

const bestKey = 'synth-racer-best';
const state = {
  mode: 'title' as Mode,
  distance: 0,
  travelled: 0,
  speed: 0,
  lateral: 0,
  steer: 0,
  time: 0,
  best: Number(window.localStorage.getItem(bestKey) ?? 0) || 0,
  countdown: 0,
  shake: 0,
  wallHit: false,
  lastMilestone: 0,
  clock: 0,
};

const input = new Input(handleAction);

const touch = document.getElementById('touch');
const title = document.getElementById('title');
const pauseScreen = document.getElementById('pause');
const muteIndicator = document.getElementById('mute-indicator');

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

/* ------------------------------------------------------------------ boot */

const quality = {
  bloom: window.devicePixelRatio < 2.5 && (navigator.hardwareConcurrency || 4) >= 4,
};
post.setBloomEnabled(quality.bloom);

hud.setVisible(false);
if (isTouch) {
  touch?.classList.remove('hidden');
  document.getElementById('hud')?.classList.add('touch-ui');
}

/* ------------------------------------------------------------------ loop */

let lastTime = performance.now();
let frameAccum = 0;
let frameCount = 0;
let qualityStep = 0;

function applyQualityStep(): void {
  const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
  if (qualityStep === 1) {
    renderer.setPixelRatio(Math.min(baseDpr, 1.25));
  } else if (qualityStep === 2) {
    renderer.setPixelRatio(Math.min(baseDpr, 1));
    post.setBloomEnabled(false);
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000) || 0.016;
  lastTime = now;
  state.clock += dt;

  update(dt);
  post.render(dt);

  // One-way quality downgrade if the device cannot hold ~35fps.
  frameAccum += dt;
  frameCount++;
  if (frameCount >= 90) {
    const average = frameAccum / frameCount;
    if (average > 0.028 && qualityStep < 2) {
      qualityStep++;
      applyQualityStep();
    }
    frameAccum = 0;
    frameCount = 0;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

/* -------------------------------------------------------------- gameplay */

function update(dt: number): void {
  switch (state.mode) {
    case 'title':
      updateTitle(dt);
      break;
    case 'countdown':
      updateCountdown(dt);
      break;
    case 'playing':
      updatePlaying(dt);
      break;
    case 'paused':
      break;
  }

  updateCarVisual(dt);
  updateCamera(dt);
  const startDistance = state.distance - 130;
  road.update(startDistance, camera.position, dt);
  sky.update(dt, camera.position);
  post.setSpeedFx(Math.min(1, state.speed / MAX_SPEED), state.speed > MAX_SPEED * 0.9 && input.state.boost);

  const speedKmh = state.speed * KMH_PER_UNIT;
  hud.update({
    distance: state.travelled,
    speed: speedKmh,
    time: state.time,
    best: state.best,
    offroad: state.wallHit,
  });

  audio.setIntensity(Math.min(1, state.speed / MAX_SPEED));
  state.shake = Math.max(0, state.shake - dt * 1.6);
  state.wallHit = false;
}

function updateTitle(dt: number): void {
  state.speed = 58;
  state.distance = track.wrap(state.distance + state.speed * dt);
  state.lateral = Math.sin(state.clock * 0.45) * 3.2;
  state.steer = Math.cos(state.clock * 0.45) * 0.25;
}

function updateCountdown(dt: number): void {
  const before = Math.ceil(state.countdown);
  state.countdown -= dt;
  const after = Math.ceil(state.countdown);
  if (after !== before) {
    if (after > 0) hud.showCombo(String(after), 700);
    else hud.showCombo('GO!', 700);
  }
  if (state.countdown <= 0) {
    state.mode = 'playing';
    hud.reset();
  }
}

function updatePlaying(dt: number): void {
  const boosting = input.state.boost && state.speed > 55;
  const braking = input.state.brake;

  // Auto-throttle keeps the arcade feel; only the brake cuts power, so the
  // player can focus on steering and boosting.
  const throttle = !braking;

  const steerInput = (input.state.right ? 1 : 0) - (input.state.left ? 1 : 0);
  state.steer += (steerInput - state.steer) * Math.min(1, dt * 9);

  const speedRatio = Math.min(1, state.speed / MAX_SPEED);

  // Longitudinal.
  if (throttle) state.speed += ACCEL * dt;
  if (boosting) state.speed += BOOST_ACCEL * dt;
  if (braking) state.speed -= BRAKE * dt;
  if (!throttle && !boosting && !braking) state.speed -= 26 * dt;

  const drag = 0.55 + speedRatio * speedRatio * 1.05;
  state.speed -= state.speed * drag * dt * 0.42;
  state.speed = MathUtils.clamp(state.speed, 0, MAX_SPEED * (boosting ? BOOST_MAX : 1));

  // Lateral: steering plus centrifugal push out of the corner.
  const authority = 24 * (0.32 + 0.68 * speedRatio);
  state.lateral += state.steer * authority * dt;
  const curvature = track.curvatureAt(state.distance);
  const centrifugal = curvature * state.speed * state.speed * 0.115;
  // Arcade assist: with no steering input most of the curve force is
  // cancelled and the car eases back towards the centre line. Without this
  // the demo parks itself against a rail whenever nobody is steering.
  const assist = 1 - Math.min(1, Math.abs(state.steer) * 1.7);
  state.lateral -= centrifugal * (1 - assist * 0.85) * dt;
  state.lateral -= state.lateral * assist * 2.2 * dt;

  const limit = ROAD_HALF_WIDTH - 0.85;
  if (Math.abs(state.lateral) > limit) {
    state.lateral = Math.sign(state.lateral) * limit;
    state.speed *= 0.975;
    state.shake = 1;
    state.wallHit = true;
  }

  state.distance = track.wrap(state.distance + state.speed * dt);
  state.travelled += state.speed * dt;
  state.time += dt;

  if (state.travelled > state.best) {
    state.best = state.travelled;
  }

  const milestone = Math.floor(state.travelled / 500);
  if (milestone > state.lastMilestone) {
    state.lastMilestone = milestone;
    hud.showCombo(`${milestone * 500} m`, 800);
  }
}

const UP = new Vector3(0, 1, 0);
const carPoint = new Vector3();
const carTangent = new Vector3();
const carSide = new Vector3();
const carLook = new Vector3();

function updateCarVisual(dt: number): void {
  const point = track.pointAt(state.distance, carPoint);
  const tangent = track.tangentAt(state.distance, carTangent);
  carSide.crossVectors(tangent, UP).normalize();

  car.group.position.set(
    point.x + carSide.x * state.lateral,
    point.y + 0.02,
    point.z + carSide.z * state.lateral,
  );

  carLook.set(
    car.group.position.x + tangent.x,
    car.group.position.y + tangent.y,
    car.group.position.z + tangent.z,
  );
  car.group.lookAt(carLook);
  car.group.rotateY(state.steer * 0.08);

  const boosting = input.state.boost && state.speed > 55 && state.mode === 'playing';
  car.update(dt, state.speed, state.steer, boosting, input.state.brake);
}

const cameraAnchor = new Vector3();
const cameraSide = new Vector3();
const cameraLookPoint = new Vector3();

function updateCamera(dt: number): void {
  const speedRatio = Math.min(1, state.speed / MAX_SPEED);
  // Portrait screens have a very narrow horizontal field of view, so pull the
  // camera back to keep the car and the road readable.
  const portrait = camera.aspect < 0.85;
  const back = (11.2 + speedRatio * 2.8) * (portrait ? 1.45 : 1);
  const height = (4.0 + speedRatio * 0.5) * (portrait ? 1.2 : 1);

  // Position is derived directly from the track. An exponential follow would
  // lag behind by (speed / smoothing), which at 300 units/s parks the car
  // hundreds of units down the road, so only the shake is smoothed here.
  const anchor = track.pointAt(state.distance - back, cameraAnchor);
  const side = track.sideAt(state.distance - back, cameraSide);
  const tangent = track.tangentAt(state.distance);

  camera.position.set(
    anchor.x + side.x * state.lateral * 0.92,
    anchor.y + height,
    anchor.z + side.z * state.lateral * 0.92,
  );

  const ahead = track.pointAt(state.distance + 30, cameraLookPoint);
  ahead.x += side.x * state.lateral * 0.55;
  ahead.y += 2.1;
  ahead.z += side.z * state.lateral * 0.55;

  const shake = state.shake;
  if (shake > 0.01) {
    const s = shake * 0.32;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
  }

  camera.lookAt(ahead);

  // Banking into the corner, plus a subtle speed wobble.
  const roll = -state.steer * 0.045 - (tangent.x * Math.cos(state.clock) * 0.002);
  camera.rotateZ(roll);

  const targetFov = 68 + speedRatio * 13 + (state.mode === 'playing' && input.state.boost ? 5 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}

/* --------------------------------------------------------------- actions */

function handleAction(action: InputAction): void {
  switch (action) {
    case 'start':
      if (state.mode === 'title') beginRun();
      else if (state.mode === 'paused') resume();
      break;
    case 'any':
      if (state.mode === 'title') beginRun();
      break;
    case 'pause':
      if (state.mode === 'playing') pause();
      else if (state.mode === 'paused') resume();
      break;
    case 'restart':
      if (state.mode === 'playing' || state.mode === 'paused' || state.mode === 'countdown') beginRun();
      break;
    case 'mute': {
      const muted = audio.toggleMute();
      muteIndicator?.classList.toggle('hidden', !muted);
      break;
    }
  }
}

function beginRun(): void {
  window.localStorage.setItem(bestKey, String(Math.round(state.best)));
  void audio.start();
  state.mode = 'countdown';
  state.countdown = 3.0;
  state.distance = 0;
  state.travelled = 0;
  state.speed = 0;
  state.lateral = 0;
  state.steer = 0;
  state.time = 0;
  state.shake = 0;
  state.lastMilestone = 0;

  title?.classList.add('hidden');
  pauseScreen?.classList.add('hidden');
  hud.setVisible(true);
  hud.showCombo('3', 700);
}

function pause(): void {
  state.mode = 'paused';
  audio.pauseMusic();
  pauseScreen?.classList.remove('hidden');
  window.localStorage.setItem(bestKey, String(Math.round(state.best)));
}

function resume(): void {
  state.mode = 'playing';
  audio.resumeMusic();
  pauseScreen?.classList.add('hidden');
}

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  post.setSize(width, height);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'playing') pause();
});

/* ------------------------------------------------------------- utilities */

function createEnvironment(rendererInstance: WebGLRenderer): Texture {
  const envScene = new Scene();
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 horizon = vec3(1.0, 0.16, 0.55);
        vec3 mid = vec3(0.35, 0.08, 0.65);
        vec3 top = vec3(0.02, 0.01, 0.08);
        vec3 col = mix(horizon, mid, smoothstep(-0.05, 0.35, h));
        col = mix(col, top, smoothstep(0.2, 0.9, h));
        col += vec3(1.0, 0.7, 0.35) * pow(max(h, 0.0), 3.0) * 0.9;
        gl_FragColor = vec4(col * 1.6, 1.0);
      }
    `,
  });
  const geometry = new SphereGeometry(12, 24, 12);
  envScene.add(new Mesh(geometry, material));

  const pmrem = new PMREMGenerator(rendererInstance);
  const target = pmrem.fromScene(envScene, 0.06);
  pmrem.dispose();
  geometry.dispose();
  material.dispose();

  return target.texture;
}

/* ------------------------------------------------------------------ boot */

// Surface uncaught errors on screen so the demo never fails silently.
window.addEventListener('error', (event) => {
  const panel = document.createElement('pre');
  panel.style.cssText =
    'position:fixed;left:12px;right:12px;bottom:12px;z-index:99;margin:0;padding:10px 12px;' +
    'color:#ff9ac0;background:rgba(8,0,16,0.86);border:1px solid rgba(255,45,149,0.55);' +
    'font:12px/1.5 Consolas,monospace;white-space:pre-wrap;border-radius:3px;';
  panel.textContent = `Error: ${event.message}\n${event.filename}:${event.lineno}`;
  document.body.appendChild(panel);
});

// Dev/QA affordance: skip the title screen and countdown when the URL asks.
if (new URLSearchParams(window.location.search).has('autostart')) {
  beginRun();
}
