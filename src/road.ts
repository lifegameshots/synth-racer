import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { ROAD_HALF_WIDTH, Track } from './track';

const ROAD_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ROAD_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform vec3 uCamera;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  void main() {
    float across = vUv.y;
    float edge = min(across, 1.0 - across);

    // Asphalt base with a slow diagonal sheen.
    vec3 col = vec3(0.045, 0.022, 0.075);
    float sheen = sin(vWorld.x * 0.35 + vWorld.z * 0.55) * 0.5 + 0.5;
    col += vec3(0.018, 0.010, 0.032) * sheen;

    // Neon edge lines.
    float edgeLine = smoothstep(0.030, 0.016, edge);
    col = mix(col, vec3(1.15, 0.16, 0.62), edgeLine);

    // Dashed centre line.
    float dash = step(0.5, fract(vUv.x * 0.9));
    float centre = smoothstep(0.012, 0.004, abs(across - 0.5)) * dash;
    col = mix(col, vec3(0.20, 0.95, 1.1), centre);

    // Faint expansion joints across the road.
    float joint = smoothstep(0.035, 0.0, abs(fract(vUv.x) - 0.5));
    col += vec3(0.10, 0.06, 0.16) * joint * 0.25;

    float dist = length(vWorld - uCamera);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const RAIL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const RAIL_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform vec3 uCamera;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  void main() {
    float up = vUv.y;
    vec3 base = mix(vec3(1.35, 0.16, 0.66), vec3(0.45, 0.10, 0.95), up);
    float core = smoothstep(0.55, 0.0, up);
    vec3 col = base * (0.55 + core * 0.9);

    float dist = length(vWorld - uCamera);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

    float fade = 1.0 - clamp(fog, 0.0, 1.0);
    gl_FragColor = vec4(col * fade, 1.0);
    #include <colorspace_fragment>
  }
`;

const GRID_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GRID_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uCamera;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uTime;

  float lines(vec2 p, float scale, float width) {
    vec2 q = abs(fract(p / scale) - 0.5) * scale;
    float d = min(q.x, q.y);
    return 1.0 - smoothstep(0.0, width, d);
  }

  void main() {
    vec2 p = vWorld.xz;
    float fine = lines(p, 24.0, 0.6);
    float coarse = lines(p, 120.0, 1.1);

    float dist = length(vWorld - uCamera);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);

    vec3 cyan = vec3(0.10, 0.72, 0.98);
    vec3 magenta = vec3(0.95, 0.16, 0.62);
    vec3 col = mix(magenta * 0.55, cyan * 0.85, fine) * fine * 0.65;
    col += cyan * coarse * 0.85;

    // Slow horizontal pulse travelling outward.
    float pulse = 0.5 + 0.5 * sin(dist * 0.012 - uTime * 1.2);
    col *= 0.75 + 0.25 * pulse;

    float horizon = 1.0 - fog;
    gl_FragColor = vec4(col * horizon, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface RoadHandles {
  update: (startDistance: number, cameraPos: Vector3, dt: number) => void;
}

export function createRoad(scene: Scene, track: Track): RoadHandles {
  const stations = 260;
  const spacing = 7;
  const vertexCount = stations * 2;

  const roadPositions = new Float32Array(vertexCount * 3);
  const roadUvs = new Float32Array(vertexCount * 2);
  const roadIndices: number[] = [];
  for (let i = 0; i < stations - 1; i++) {
    const a = i * 2;
    roadIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const roadGeometry = new BufferGeometry();
  const roadPosAttr = new BufferAttribute(roadPositions, 3);
  const roadUvAttr = new BufferAttribute(roadUvs, 2);
  roadGeometry.setAttribute('position', roadPosAttr);
  roadGeometry.setAttribute('uv', roadUvAttr);
  roadGeometry.setIndex(roadIndices);

  const sharedFog = {
    uCamera: { value: new Vector3() },
    uFogColor: { value: new Color('#2a0a3f') },
    uFogDensity: { value: 0.0021 },
  };

  const roadMaterial = new ShaderMaterial({
    vertexShader: ROAD_VERT,
    fragmentShader: ROAD_FRAG,
    uniforms: {
      uCamera: sharedFog.uCamera,
      uFogColor: sharedFog.uFogColor,
      uFogDensity: sharedFog.uFogDensity,
    },
    side: DoubleSide,
  });

  const road = new Mesh(roadGeometry, roadMaterial);
  road.frustumCulled = false;
  road.renderOrder = 1;
  scene.add(road);

  // --- Rails -------------------------------------------------------------
  const railStride = 4;
  const railPositions = new Float32Array(stations * railStride * 3);
  const railUvs = new Float32Array(stations * railStride * 2);
  const railIndices: number[] = [];
  for (let i = 0; i < stations - 1; i++) {
    const base = i * railStride;
    const next = base + railStride;
    // left strip
    railIndices.push(base, base + 1, next, base + 1, next + 1, next);
    // right strip
    railIndices.push(base + 2, base + 3, next + 2, base + 3, next + 3, next + 2);
  }

  const railGeometry = new BufferGeometry();
  const railPosAttr = new BufferAttribute(railPositions, 3);
  const railUvAttr = new BufferAttribute(railUvs, 2);
  railGeometry.setAttribute('position', railPosAttr);
  railGeometry.setAttribute('uv', railUvAttr);
  railGeometry.setIndex(railIndices);

  const railMaterial = new ShaderMaterial({
    vertexShader: RAIL_VERT,
    fragmentShader: RAIL_FRAG,
    uniforms: {
      uCamera: sharedFog.uCamera,
      uFogColor: sharedFog.uFogColor,
      uFogDensity: sharedFog.uFogDensity,
    },
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  const rails = new Mesh(railGeometry, railMaterial);
  rails.frustumCulled = false;
  rails.renderOrder = 2;
  scene.add(rails);

  // --- Grid floor --------------------------------------------------------
  const gridMaterial = new ShaderMaterial({
    vertexShader: GRID_VERT,
    fragmentShader: GRID_FRAG,
    uniforms: {
      uCamera: sharedFog.uCamera,
      uFogColor: sharedFog.uFogColor,
      uFogDensity: sharedFog.uFogDensity,
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
  });

  const grid = new Mesh(new PlaneGeometry(9000, 9000), gridMaterial);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -14;
  grid.frustumCulled = false;
  grid.renderOrder = 0;
  scene.add(grid);

  const point = new Vector3();
  const tangent = new Vector3();
  const side = new Vector3();
  const up = new Vector3(0, 1, 0);

  const railHeight = 1.3;

  return {
    update(startDistance, cameraPos, dt) {
      sharedFog.uCamera.value.copy(cameraPos);
      (gridMaterial.uniforms.uTime!.value as number) += dt;

      const gridStep = 24;
      grid.position.set(
        Math.round(cameraPos.x / gridStep) * gridStep,
        -14,
        Math.round(cameraPos.z / gridStep) * gridStep,
      );

      for (let i = 0; i < stations; i++) {
        const s = startDistance + i * spacing;
        track.pointAt(s, point);
        track.tangentAt(s, tangent);
        side.crossVectors(tangent, up).normalize();

        const left = -ROAD_HALF_WIDTH;
        const right = ROAD_HALF_WIDTH;

        const i2 = i * 2;
        roadPositions[i2 * 3 + 0] = point.x + side.x * left;
        roadPositions[i2 * 3 + 1] = point.y + side.y * left;
        roadPositions[i2 * 3 + 2] = point.z + side.z * left;

        roadPositions[(i2 + 1) * 3 + 0] = point.x + side.x * right;
        roadPositions[(i2 + 1) * 3 + 1] = point.y + side.y * right;
        roadPositions[(i2 + 1) * 3 + 2] = point.z + side.z * right;

        roadUvs[i2 * 2 + 0] = s * 0.05;
        roadUvs[i2 * 2 + 1] = 0;
        roadUvs[(i2 + 1) * 2 + 0] = s * 0.05;
        roadUvs[(i2 + 1) * 2 + 1] = 1;

        const ri = i * railStride;
        const railPos = (v: number, off: number, h: number) => {
          railPositions[(ri + v) * 3 + 0] = point.x + side.x * off;
          railPositions[(ri + v) * 3 + 1] = point.y + h;
          railPositions[(ri + v) * 3 + 2] = point.z + side.z * off;
          railUvs[(ri + v) * 2 + 0] = s * 0.05;
          railUvs[(ri + v) * 2 + 1] = h / railHeight;
        };

        railPos(0, left - 0.35, 0);
        railPos(1, left - 0.35, railHeight);
        railPos(2, right + 0.35, 0);
        railPos(3, right + 0.35, railHeight);
      }

      roadPosAttr.needsUpdate = true;
      roadUvAttr.needsUpdate = true;
      railPosAttr.needsUpdate = true;
      railUvAttr.needsUpdate = true;
    },
  };
}
