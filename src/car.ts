import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  TorusGeometry,
} from 'three';

export interface CarHandles {
  group: Group;
  update: (dt: number, speed: number, steer: number, boosting: boolean, braking: boolean) => void;
}

const WHEEL_RADIUS = 0.37;

/**
 * Low-poly wedge built entirely from primitives. No external model, so the
 * whole demo ships as code. Emissive parts are tuned for the bloom pass.
 */
export function createCar(): CarHandles {
  const group = new Group();
  const chassis = new Group();
  group.add(chassis);
  group.scale.setScalar(1.12);

  const paint = new MeshStandardMaterial({ color: 0x2a0d4d, metalness: 0.92, roughness: 0.22 });
  const dark = new MeshStandardMaterial({ color: 0x0a0a12, metalness: 0.55, roughness: 0.75 });
  const glass = new MeshStandardMaterial({ color: 0x05050d, metalness: 1.0, roughness: 0.06 });
  const neonPink = new MeshStandardMaterial({
    color: 0x1a0016,
    emissive: 0xff2d95,
    emissiveIntensity: 1.15,
    roughness: 0.4,
  });
  const neonCyan = new MeshStandardMaterial({
    color: 0x001016,
    emissive: 0x22e6ff,
    emissiveIntensity: 1.2,
    roughness: 0.4,
  });
  const tire = new MeshStandardMaterial({ color: 0x101017, roughness: 0.9 });
  const rim = new MeshStandardMaterial({
    color: 0x0b0b12,
    emissive: 0x22e6ff,
    emissiveIntensity: 0.85,
    roughness: 0.5,
  });

  const box = (
    w: number,
    h: number,
    d: number,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
  ): Mesh => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    chassis.add(mesh);
    return mesh;
  };

  // Body shell -----------------------------------------------------------
  box(1.8, 0.42, 4.2, paint, 0, 0.58, 0);
  box(1.66, 0.2, 1.35, paint, 0, 0.76, 1.42);
  box(1.86, 0.16, 4.05, dark, 0, 0.38, 0);
  box(1.84, 0.24, 0.46, dark, 0, 0.5, 2.02);
  box(1.66, 0.24, 0.4, dark, 0, 0.32, -2.0);

  // Cabin + roof --------------------------------------------------------
  box(1.4, 0.34, 1.85, glass, 0, 0.96, -0.3);
  box(1.22, 0.05, 1.05, paint, 0, 1.14, -0.5);

  // Low ducktail spoiler instead of a tall wing: keeps the roofline clean.
  box(1.5, 0.05, 0.18, paint, 0, 0.86, -2.12);
  box(0.05, 0.14, 0.18, dark, 0.74, 0.85, -2.12);
  box(0.05, 0.14, 0.18, dark, -0.74, 0.85, -2.12);

  // Lights --------------------------------------------------------------
  const headlightL = box(0.34, 0.1, 0.09, neonCyan, 0.58, 0.7, 2.1);
  const headlightR = box(0.34, 0.1, 0.09, neonCyan, -0.58, 0.7, 2.1);
  headlightL.rotation.x = -0.12;
  headlightR.rotation.x = -0.12;
  const brakeBar = box(1.34, 0.1, 0.07, neonPink, 0, 0.74, -2.14);
  box(0.16, 0.16, 0.05, neonPink, 0.72, 0.74, -2.14);
  box(0.16, 0.16, 0.05, neonPink, -0.72, 0.74, -2.14);
  box(1.34, 0.04, 0.05, neonCyan, 0, 0.34, -2.12);

  // Side neon strips ----------------------------------------------------
  box(0.05, 0.05, 3.1, neonCyan, 0.97, 0.5, 0.05);
  box(0.05, 0.05, 3.1, neonCyan, -0.97, 0.5, 0.05);

  // Underglow -----------------------------------------------------------
  const glow = new PointLight(0xff2d95, 2.4, 10, 2);
  glow.position.set(0, 0.12, 0);
  chassis.add(glow);

  // Contact shadow so the car does not look like it is floating.
  const shadowMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uOpacity: { value: 0.34 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uOpacity;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float d = length(vec2(p.x * 1.25, p.y));
        float a = smoothstep(1.0, 0.2, d) * uOpacity;
        gl_FragColor = vec4(0.015, 0.0, 0.035, a);
      }
    `,
  });
  const shadow = new Mesh(new PlaneGeometry(2.9, 5.4), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  // Wheels --------------------------------------------------------------
  const tireGeometry = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.32, 20);
  tireGeometry.rotateZ(Math.PI / 2);
  const rimGeometry = new CylinderGeometry(0.19, 0.19, 0.33, 16);
  rimGeometry.rotateZ(Math.PI / 2);

  const wheels: { pivot: Object3D; mesh: Mesh }[] = [];
  const wheelPositions: [number, number][] = [
    [1.06, 1.3],
    [-1.06, 1.3],
    [1.06, -1.4],
    [-1.06, -1.4],
  ];

  // Glowing rim rings make the wheels readable from behind.
  const ringGeometry = new TorusGeometry(0.24, 0.022, 8, 24);
  ringGeometry.rotateY(Math.PI / 2);
  const ringMaterial = new MeshStandardMaterial({
    color: 0x001018,
    emissive: 0x22e6ff,
    emissiveIntensity: 1.7,
    roughness: 0.5,
  });

  for (const [x, z] of wheelPositions) {
    const pivot = new Object3D();
    pivot.position.set(x, WHEEL_RADIUS, z);
    const mesh = new Mesh(tireGeometry, tire);
    mesh.add(new Mesh(rimGeometry, rim));
    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.position.x = Math.sign(x) * 0.17;
    mesh.add(ring);
    pivot.add(mesh);
    chassis.add(pivot);
    wheels.push({ pivot, mesh });
  }

  // Twin exhaust tips ---------------------------------------------------
  const exhaustGeometry = new CylinderGeometry(0.075, 0.075, 0.22, 12);
  exhaustGeometry.rotateX(Math.PI / 2);
  const exhaustMaterial = new MeshStandardMaterial({
    color: 0x0b0b12,
    metalness: 0.9,
    roughness: 0.35,
  });
  for (const x of [-0.42, 0.42]) {
    const exhaust = new Mesh(exhaustGeometry, exhaustMaterial);
    exhaust.position.set(x, 0.44, -2.2);
    chassis.add(exhaust);
  }

  // Boost flames --------------------------------------------------------
  const flameGeometry = new ConeGeometry(0.13, 0.9, 10);
  flameGeometry.rotateX(-Math.PI / 2);
  flameGeometry.translate(0, 0, -0.45);
  const flameMaterial = new MeshBasicMaterial({
    color: 0xffa24a,
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const flames: Mesh[] = [];
  for (const x of [-0.42, 0.42]) {
    const flame = new Mesh(flameGeometry, flameMaterial);
    flame.position.set(x, 0.44, -2.26);
    flame.visible = false;
    chassis.add(flame);
    flames.push(flame);
  }

  let spin = 0;
  let speedDelta = 0;
  let lastSpeed = 0;
  let roll = 0;
  let pitch = 0;

  return {
    group,
    update(dt, speed, steer, boosting, braking) {
      speedDelta = (speed - lastSpeed) / Math.max(dt, 1e-4);
      lastSpeed = speed;

      spin += (speed * dt) / WHEEL_RADIUS;
      for (let i = 0; i < wheels.length; i++) {
        const wheel = wheels[i]!;
        wheel.mesh.rotation.x = spin;
        if (i < 2) wheel.pivot.rotation.y = steer * 0.42;
      }

      const targetRoll = -steer * (0.035 + Math.min(0.05, speed / 4000));
      roll += (targetRoll - roll) * Math.min(1, dt * 8);
      const targetPitch = Math.max(-0.035, Math.min(0.035, -speedDelta * 0.00035));
      pitch += (targetPitch - pitch) * Math.min(1, dt * 6);

      chassis.rotation.z = roll;
      chassis.rotation.x = pitch;

      for (const flame of flames) {
        flame.visible = boosting;
        if (boosting) {
          const flicker = 0.75 + Math.random() * 0.7;
          flame.scale.set(1, 1, flicker);
        }
      }

      (brakeBar.material as MeshStandardMaterial).emissiveIntensity = braking ? 5.2 : 2.8;
    },
  };
}
