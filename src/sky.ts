import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

const SKY_VERT = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vWorldPosition;
  uniform vec3 uHorizon;
  uniform vec3 uMid;
  uniform vec3 uZenith;
  uniform vec3 uSunDir;

  void main() {
    vec3 dir = normalize(vWorldPosition);
    float h = clamp(dir.y, -1.0, 1.0);

    // Three-stop vertical gradient.
    vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.32, h));
    col = mix(col, uZenith, smoothstep(0.18, 0.85, h));

    // Warm bloom around the sun direction.
    float sunAmount = max(dot(dir, normalize(uSunDir)), 0.0);
    col += uHorizon * pow(sunAmount, 6.0) * 0.34;
    col += vec3(1.0, 0.72, 0.45) * pow(sunAmount, 42.0) * 0.5;

    // Faint horizontal haze bands near the horizon.
    float band = sin(h * 220.0) * 0.5 + 0.5;
    col += uHorizon * band * 0.035 * (1.0 - smoothstep(0.0, 0.16, h));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const SUN_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;

  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;

    // Vertical gradient: hot yellow core to magenta rim.
    vec3 inner = vec3(1.0, 0.92, 0.62);
    vec3 outer = vec3(1.0, 0.18, 0.55);
    vec3 col = mix(inner, outer, smoothstep(0.1, 0.95, d));

    // Classic synthwave cut stripes on the lower half.
    float y = vUv.y;
    float stripe = step(0.5, fract((0.5 - y) * 26.0));
    float gate = smoothstep(0.22, 0.5, 1.0 - y) * (1.0 - smoothstep(0.5, 0.62, 1.0 - y));
    float cut = mix(1.0, stripe, gate);

    float alpha = (1.0 - smoothstep(0.86, 1.0, d)) * cut;
    alpha *= 0.94 + 0.06 * sin(uTime * 1.7);

    gl_FragColor = vec4(col * (0.72 + (1.0 - d) * 0.35), alpha);
    #include <colorspace_fragment>
  }
`;

const SUN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export interface SkyHandles {
  group: Group;
  sunDir: Vector3;
  update(dt: number, cameraPos: Vector3): void;
}

/** Gradient dome, synthwave sun, stars and distant mountain silhouettes. */
export function createSky(
  scene: Object3D,
  sunDirection = new Vector3(-0.42, 0.16, -1),
): SkyHandles {
  const group = new Group();
  scene.add(group);

  const sunDir = sunDirection.clone().normalize();

  const skyMaterial = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uHorizon: { value: new Color('#ff2f7d') },
      uMid: { value: new Color('#46106e') },
      uZenith: { value: new Color('#06010f') },
      uSunDir: { value: sunDir.clone() },
    },
  });

  const dome = new Mesh(new SphereGeometry(9000, 32, 20), skyMaterial);
  dome.renderOrder = -100;
  group.add(dome);

  // --- Stars -------------------------------------------------------------
  const starCount = 900;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.92 + 0.02);
    const r = 8200;
    starPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    starPositions[i * 3 + 1] = Math.cos(phi) * r * 0.9 + 220;
    starPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  const stars = new Points(
    starGeometry,
    new PointsMaterial({
      color: 0xbfe9ff,
      size: 1.8,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      fog: false,
      blending: AdditiveBlending,
    }),
  );
  stars.renderOrder = -99;
  group.add(stars);

  // --- Sun ---------------------------------------------------------------
  const sunMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    fog: false,
    vertexShader: SUN_VERT,
    fragmentShader: SUN_FRAG,
    uniforms: { uTime: { value: 0 } },
  });
  const sun = new Mesh(new SphereGeometry(300, 32, 32), sunMaterial);
  sun.scale.z = 0.02;
  sun.renderOrder = -98;
  group.add(sun);

  // --- Mountains ---------------------------------------------------------
  scene.add(createRidge(5200, 620, 0x180a2e, 11, 0.55));
  scene.add(createRidge(6400, 900, 0x0d0419, 7, 0.42));

  const sunPosition = new Vector3();
  const lookTarget = new Vector3();

  return {
    group,
    sunDir,
    update(dt, cameraPos) {
      group.position.copy(cameraPos);
      sunMaterial.uniforms.uTime!.value += dt;

      sunPosition.copy(sunDir).multiplyScalar(5200).add(cameraPos);
      sun.position.copy(sunPosition);
      lookTarget.copy(cameraPos);
      sun.lookAt(lookTarget);

      stars.rotation.y += dt * 0.004;
    },
  };
}

/** A jagged mountain band forming a closed silhouette around the origin. */
function createRidge(
  radius: number,
  height: number,
  color: number,
  peaks: number,
  opacity: number,
): Mesh {
  const segments = peaks * 24;
  const positions: number[] = [];
  const indices: number[] = [];

  const heights: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const wave =
      Math.sin(t * Math.PI * 2 * peaks) * 0.42 +
      Math.sin(t * Math.PI * 2 * peaks * 2.7 + 1.3) * 0.24 +
      Math.sin(t * Math.PI * 2 * peaks * 5.3 + 2.1) * 0.12;
    heights.push(height * (0.42 + Math.abs(wave) * 0.95));
  }

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const h = heights[i]!;
    positions.push(x, -160, z);
    positions.push(x, h, z);
  }

  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      side: DoubleSide,
      fog: false,
      depthWrite: false,
    }),
  );
  mesh.renderOrder = -97;
  return mesh;
}
