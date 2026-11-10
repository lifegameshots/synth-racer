import { Vector3 } from 'three';

/** Half width of the drivable ribbon, in world units. */
export const ROAD_HALF_WIDTH = 8.5;

const UP = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A closed, smooth racing loop built from a Fourier series.
 *
 * Because every harmonic is periodic in u with an integer frequency, the
 * curve closes exactly. The polyline is then re-sampled at uniform arc
 * length, which makes `pointAt` an O(1) lookup instead of a search and
 * keeps stripes and physics evenly spaced regardless of curvature.
 */
export class Track {
  readonly totalLength: number;
  readonly sampleCount: number;
  private readonly stepLength: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly tx: Float32Array;
  private readonly ty: Float32Array;
  private readonly tz: Float32Array;

  constructor(seed = 20261110) {
    const rand = mulberry32(seed);
    const radius = 460;
    const harmonicCount = 6;
    const harmonics: {
      k: number;
      ax: number;
      az: number;
      phx: number;
      phz: number;
      ay: number;
      phy: number;
    }[] = [];

    const frequencies = [2, 3, 5, 7, 11, 13];
    for (let i = 0; i < harmonicCount; i++) {
      const k = frequencies[i] ?? i + 2;
      const falloff = 1 / Math.sqrt(k);
      harmonics.push({
        k,
        ax: (rand() * 2 - 1) * radius * 0.052 * falloff,
        az: (rand() * 2 - 1) * radius * 0.052 * falloff,
        phx: rand() * TAU,
        phz: rand() * TAU,
        ay: (rand() * 2 - 1) * 3.4 * falloff,
        phy: rand() * TAU,
      });
    }

    // 1. Dense parametric samples of the closed curve.
    const density = 2048;
    const rawX = new Float64Array(density + 1);
    const rawY = new Float64Array(density + 1);
    const rawZ = new Float64Array(density + 1);

    for (let i = 0; i <= density; i++) {
      const u = (i % density) / density;
      let x = radius * Math.cos(TAU * u);
      let z = radius * Math.sin(TAU * u);
      let y = 0;
      for (const h of harmonics) {
        const phase = TAU * h.k * u;
        x += h.ax * Math.sin(phase + h.phx);
        z += h.az * Math.cos(phase + h.phz);
        y += h.ay * Math.sin(phase + h.phy);
      }
      rawX[i] = x;
      rawY[i] = y;
      rawZ[i] = z;
    }

    // 2. Cumulative chord length so we can re-sample uniformly.
    const cumulative = new Float64Array(density + 1);
    for (let i = 1; i <= density; i++) {
      const dx = rawX[i]! - rawX[i - 1]!;
      const dy = rawY[i]! - rawY[i - 1]!;
      const dz = rawZ[i]! - rawZ[i - 1]!;
      cumulative[i] = cumulative[i - 1]! + Math.hypot(dx, dy, dz);
    }
    this.totalLength = cumulative[density]!;

    // 3. Uniform arc-length re-sample.
    const count = 8192;
    this.sampleCount = count;
    this.stepLength = this.totalLength / count;
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.pz = new Float32Array(count);
    this.tx = new Float32Array(count);
    this.ty = new Float32Array(count);
    this.tz = new Float32Array(count);

    let cursor = 0;
    for (let i = 0; i < count; i++) {
      const target = i * this.stepLength;
      while (cursor < density - 1 && cumulative[cursor + 1]! < target) cursor++;
      const segStart = cumulative[cursor]!;
      const segLen = cumulative[cursor + 1]! - segStart;
      const t = segLen > 1e-9 ? (target - segStart) / segLen : 0;
      const x0 = rawX[cursor]!;
      const y0 = rawY[cursor]!;
      const z0 = rawZ[cursor]!;
      this.px[i] = x0 + (rawX[cursor + 1]! - x0) * t;
      this.py[i] = y0 + (rawY[cursor + 1]! - y0) * t;
      this.pz[i] = z0 + (rawZ[cursor + 1]! - z0) * t;
    }

    // 4. Central-difference tangents.
    for (let i = 0; i < count; i++) {
      const a = (i - 1 + count) % count;
      const b = (i + 1) % count;
      const dx = this.px[b]! - this.px[a]!;
      const dy = this.py[b]! - this.py[a]!;
      const dz = this.pz[b]! - this.pz[a]!;
      const len = Math.hypot(dx, dy, dz) || 1;
      this.tx[i] = dx / len;
      this.ty[i] = dy / len;
      this.tz[i] = dz / len;
    }
  }

  wrap(s: number): number {
    const l = this.totalLength;
    let v = s % l;
    if (v < 0) v += l;
    return v;
  }

  private index(s: number): { i: number; f: number } {
    const wrapped = this.wrap(s);
    const raw = wrapped / this.stepLength;
    const i = Math.floor(raw);
    return { i: i % this.sampleCount, f: raw - i };
  }

  pointAt(s: number, out = new Vector3()): Vector3 {
    const { i, f } = this.index(s);
    const j = (i + 1) % this.sampleCount;
    return out.set(
      this.px[i]! + (this.px[j]! - this.px[i]!) * f,
      this.py[i]! + (this.py[j]! - this.py[i]!) * f,
      this.pz[i]! + (this.pz[j]! - this.pz[i]!) * f,
    );
  }

  tangentAt(s: number, out = new Vector3()): Vector3 {
    const { i, f } = this.index(s);
    const j = (i + 1) % this.sampleCount;
    out.set(
      this.tx[i]! + (this.tx[j]! - this.tx[i]!) * f,
      this.ty[i]! + (this.ty[j]! - this.ty[i]!) * f,
      this.tz[i]! + (this.tz[j]! - this.tz[i]!) * f,
    );
    return out.normalize();
  }

  /** Signed curvature in radians per world unit, positive = turning left. */
  curvatureAt(s: number): number {
    const span = 5;
    const a = this.tangentAt(s - span);
    const b = this.tangentAt(s + span);
    const cross = a.x * b.z - a.z * b.x;
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z));
    return Math.atan2(cross, dot) / (span * 2);
  }

  /** Horizontal right-hand side vector of the road at `s`. */
  sideAt(s: number, out = new Vector3()): Vector3 {
    const t = this.tangentAt(s);
    out.crossVectors(t, UP);
    out.y = 0;
    return out.normalize();
  }
}
