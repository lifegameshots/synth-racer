/**
 * Everything you hear is synthesized at runtime. No samples, no files.
 *
 * Music: a 4-bar synthwave loop (Am - F - C - G) with a driving eighth-note
 * bass, four-on-the-floor kick, off-beat hats, a 16th arpeggio and a pad.
 * Engine: two detuned oscillators through a velocity-driven low-pass filter.
 */

interface Chord {
  root: number;
  notes: number[];
}

const PROGRESSION: Chord[] = [
  { root: 55.0, notes: [220.0, 261.63, 329.63] }, // Am
  { root: 43.65, notes: [174.61, 220.0, 261.63] }, // F
  { root: 65.41, notes: [196.0, 261.63, 329.63] }, // C
  { root: 49.0, notes: [196.0, 246.94, 293.66] }, // G
];

const BPM = 100;
const STEP_DURATION = 60 / BPM / 4;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private timer: number | null = null;
  private nextNoteTime = 0;
  private stepIndex = 0;
  private playing = false;
  private muted = false;
  private intensity = 0;

  get ready(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    this.buildEngine();
    this.playing = true;
    this.nextNoteTime = ctx.currentTime + 0.08;
    this.stepIndex = 0;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = window.setInterval(this.scheduler, 25);
    this.musicBus!.gain.setTargetAtTime(0.0, ctx.currentTime, 0.3);
    this.musicBus!.gain.setTargetAtTime(0.55, ctx.currentTime + 0.35, 0.8);
  }

  /** Fades the music out without tearing the graph down (pause). */
  pauseMusic(): void {
    if (!this.ctx || !this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.12);
  }

  resumeMusic(): void {
    if (!this.ctx || !this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.2);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.playing = false;
  }

  setIntensity(normalized: number): void {
    this.intensity = Math.max(0, Math.min(1, normalized));
    if (!this.ctx || !this.engineFilter || !this.engineOscA || !this.engineOscB) return;
    const now = this.ctx.currentTime;
    const freq = 42 + this.intensity * 118;
    this.engineOscA.frequency.setTargetAtTime(freq, now, 0.08);
    this.engineOscB.frequency.setTargetAtTime(freq * 0.5, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(
      260 + this.intensity * 2400,
      now,
      0.12,
    );
    this.engineGain?.gain.setTargetAtTime(
      0.016 + this.intensity * 0.03,
      now,
      0.15,
    );
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  // ---------------------------------------------------------------- setup

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;

    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.6;
    master.connect(ctx.destination);
    this.master = master;

    const music = ctx.createGain();
    music.gain.value = 0.55;
    music.connect(master);
    this.musicBus = music;

    const engine = ctx.createGain();
    engine.gain.value = 0.0;
    engine.connect(master);
    this.engineBus = engine;

    // One second of white noise, reused by hats and snares.
    const length = Math.floor(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    return ctx;
  }

  private buildEngine(): void {
    if (!this.ctx || this.engineOscA || !this.engineBus) return;
    const ctx = this.ctx;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 7;

    const gain = ctx.createGain();
    gain.gain.value = 0.016;

    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 42;

    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    oscB.frequency.value = 21;

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(this.engineBus);

    oscA.start();
    oscB.start();

    this.engineOscA = oscA;
    this.engineOscB = oscB;
    this.engineFilter = filter;
    this.engineGain = gain;
  }

  // ------------------------------------------------------------ sequencer

  private scheduler = (): void => {
    if (!this.ctx || !this.playing) return;
    const horizon = this.ctx.currentTime + 0.12;
    while (this.nextNoteTime < horizon) {
      this.scheduleStep(this.stepIndex, this.nextNoteTime);
      this.stepIndex++;
      this.nextNoteTime += STEP_DURATION;
    }
  };

  private scheduleStep(step: number, time: number): void {
    const chord = PROGRESSION[Math.floor(step / 16) % PROGRESSION.length]!;
    const inBar = step % 16;

    if (inBar % 4 === 0) this.kick(time);
    if (inBar === 4 || inBar === 12) this.snare(time);
    this.hat(time, inBar % 2 === 1 ? 0.07 : 0.028);

    if (inBar % 2 === 0) {
      const octave = inBar % 8 === 6 ? 2 : 1;
      this.bass(chord.root * octave, time);
    }

    const arpNote = chord.notes[step % chord.notes.length]!;
    this.arp(arpNote * 2, time);

    if (inBar === 0) this.pad(chord.notes, time);
  }

  private kick(time: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.13);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc.connect(gain).connect(this.musicBus!);
    osc.start(time);
    osc.stop(time + 0.32);
  }

  private snare(time: number): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.32, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    source.connect(filter).connect(gain).connect(this.musicBus!);
    source.start(time);
    source.stop(time + 0.2);
  }

  private hat(time: number, level: number): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    source.connect(filter).connect(gain).connect(this.musicBus!);
    source.start(time);
    source.stop(time + 0.06);
  }

  private bass(freq: number, time: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(680, time);
    filter.frequency.exponentialRampToValueAtTime(220, time + 0.18);
    filter.Q.value = 8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.26, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + 0.2);
    osc.connect(filter).connect(gain).connect(this.musicBus!);
    osc.start(time);
    osc.stop(time + 0.22);
  }

  private arp(freq: number, time: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.055, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0005, time + 0.11);
    osc.connect(filter).connect(gain).connect(this.musicBus!);
    osc.start(time);
    osc.stop(time + 0.13);
  }

  private pad(notes: number[], time: number): void {
    const ctx = this.ctx!;
    const barLength = STEP_DURATION * 16;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.045, time + 0.5);
    gain.gain.linearRampToValueAtTime(0.0001, time + barLength);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;

    gain.connect(filter).connect(this.musicBus!);

    for (const note of notes) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = note;
        osc.detune.value = detune;
        osc.connect(gain);
        osc.start(time);
        osc.stop(time + barLength + 0.1);
      }
    }
  }
}
