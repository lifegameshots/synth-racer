import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0016 },
    uVignette: { value: 1.15 },
    uGrain: { value: 0.035 },
    uScanline: { value: 0.018 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uScanline;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centred = uv - 0.5;
      float r2 = dot(centred, centred);

      // Radial chromatic aberration, stronger towards the edges.
      vec2 offset = centred * (uAberration + r2 * uAberration * 3.2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + offset).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - offset).b;

      // Vignette.
      float vig = smoothstep(0.95, 0.18, r2 * uVignette * 2.0);
      col *= mix(0.55, 1.0, vig);

      // Film grain.
      float grain = hash(uv * vec2(1024.0, 768.0) + fract(uTime) * 91.7) - 0.5;
      col += grain * uGrain;

      // Very faint CRT scanlines.
      float scan = sin(uv.y * 900.0) * 0.5 + 0.5;
      col *= 1.0 - scan * uScanline;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface PostHandles {
  composer: EffectComposer;
  bloomEnabled: boolean;
  setSize: (width: number, height: number) => void;
  render: (dt: number) => void;
  setBloomEnabled: (enabled: boolean) => void;
  setSpeedFx: (speedRatio: number, boosting: boolean) => void;
}

export function createPost(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
): PostHandles {
  const size = renderer.getSize(new Vector2());
  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.55, 0.5, 0.8);
  composer.addPass(bloom);

  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  const output = new OutputPass();
  composer.addPass(output);

  const handles: PostHandles = {
    composer,
    bloomEnabled: true,
    setSize(width, height) {
      composer.setSize(width, height);
      bloom.setSize(width, height);
    },
    render(dt) {
      finish.uniforms.uTime!.value += dt;
      composer.render(dt);
    },
    setBloomEnabled(enabled) {
      handles.bloomEnabled = enabled;
      bloom.enabled = enabled;
    },
    setSpeedFx(speedRatio, boosting) {
      const target = 0.0012 + speedRatio * 0.0035 + (boosting ? 0.004 : 0);
      const uniform = finish.uniforms.uAberration!;
      uniform.value += (target - uniform.value) * 0.12;
      finish.uniforms.uGrain!.value = 0.02 + speedRatio * 0.022;
    },
  };

  return handles;
}
