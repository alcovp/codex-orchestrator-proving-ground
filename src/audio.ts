type SoundKey = "ambient" | "jump" | "burrow" | "pickup" | "explosion";
type GamePhase = "idle" | "playing" | "paused" | "exploding" | "transition";

type RenderCb = (ctx: OfflineAudioContext) => void;

function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(
    navigator.userAgent,
  );
}

async function renderBuffer(durationSeconds: number, fill: RenderCb): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const frameCount = Math.ceil(durationSeconds * sampleRate);
  const offline = new OfflineAudioContext(2, frameCount, sampleRate);
  fill(offline);
  return offline.startRendering();
}

async function renderAmbient(): Promise<AudioBuffer> {
  return renderBuffer(8, (ctx) => {
    const base = ctx.createOscillator();
    base.type = "sine";
    base.frequency.value = 96;
    base.detune.value = -8;

    const pad = ctx.createOscillator();
    pad.type = "triangle";
    pad.frequency.value = 194;
    pad.detune.value = 5;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.32;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    filter.Q.value = 0.9;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, 0);

    lfo.connect(lfoGain).connect(gain.gain);
    base.connect(filter);
    pad.connect(filter);
    filter.connect(gain).connect(ctx.destination);

    base.start(0);
    pad.start(0.25);
    lfo.start(0);

    base.stop(8);
    pad.stop(8);
    lfo.stop(8);
  });
}

async function renderJump(): Promise<AudioBuffer> {
  return renderBuffer(0.35, (ctx) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(260, 0);
    osc.frequency.exponentialRampToValueAtTime(760, 0.26);

    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 7.5;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 28;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.9, 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.35);

    vibrato.connect(vibratoGain).connect(osc.frequency);
    osc.connect(gain).connect(ctx.destination);

    vibrato.start(0);
    osc.start(0);
    osc.stop(0.35);
    vibrato.stop(0.35);
  });
}

async function renderBurrow(): Promise<AudioBuffer> {
  return renderBuffer(0.42, (ctx) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(180, 0);
    osc.frequency.exponentialRampToValueAtTime(62, 0.36);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 220;
    filter.Q.value = 6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.85, 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0008, 0.42);

    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(0);
    osc.stop(0.42);
  });
}

async function renderPickup(): Promise<AudioBuffer> {
  return renderBuffer(0.3, (ctx) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(620, 0);
    osc.frequency.exponentialRampToValueAtTime(920, 0.18);

    const osc2 = ctx.createOscillator();
    osc2.type = "square";
    osc2.frequency.setValueAtTime(420, 0);
    osc2.frequency.exponentialRampToValueAtTime(610, 0.2);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.8, 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.3);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc.start(0);
    osc2.start(0.04);
    osc.stop(0.3);
    osc2.stop(0.3);
  });
}

async function renderExplosion(): Promise<AudioBuffer> {
  return renderBuffer(0.72, (ctx) => {
    const noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.72), ctx.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) {
      const fade = 1 - i / channel.length;
      channel[i] = (Math.random() * 2 - 1) * Math.pow(fade, 1.4);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, 0);
    filter.frequency.exponentialRampToValueAtTime(180, 0.72);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.95, 0);
    gain.gain.exponentialRampToValueAtTime(0.0005, 0.72);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(0);
    noise.stop(0.72);
  });
}

const bufferFactory: Record<SoundKey, () => Promise<AudioBuffer>> = {
  ambient: renderAmbient,
  jump: renderJump,
  burrow: renderBurrow,
  pickup: renderPickup,
  explosion: renderExplosion,
};

function getAudioContextCtor(): typeof AudioContext | undefined {
  const candidate =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return candidate ?? undefined;
}

export class GameAudio {
  private context: AudioContext | null = null;

  private masterGain: GainNode | null = null;

  private musicGain: GainNode | null = null;

  private sfxGain: GainNode | null = null;

  private bufferCache = new Map<SoundKey, Promise<AudioBuffer>>();

  private ambientSource: AudioBufferSourceNode | null = null;

  private suspendedByPolicy = false;

  private mobileMode = isMobileDevice();

  private pendingUnlock = false;

  private lastState: GamePhase = "idle";

  constructor() {
    if (!getAudioContextCtor()) {
      this.suspendedByPolicy = true;
    }
  }

  async unlockFromUserGesture(): Promise<void> {
    if (this.suspendedByPolicy) {
      return;
    }
    const context = this.ensureContext();
    if (!context) {
      return;
    }
    if (context.state === "suspended") {
      this.pendingUnlock = true;
      try {
        await context.resume();
      } finally {
        this.pendingUnlock = false;
      }
    }
    await this.warmup();
    this.ensureAmbient();
  }

  onStateChange(next: GamePhase): void {
    this.lastState = next;
    if (this.suspendedByPolicy) {
      return;
    }
    const context = this.ensureContext();
    if (!context || !this.masterGain || !this.musicGain || !this.sfxGain) {
      return;
    }
    const now = context.currentTime;
    const isPaused = next === "paused";
    const isExploding = next === "exploding";

    const masterTarget = this.mobileMode ? 0.75 : 1;
    const duckedMaster = masterTarget * (isPaused ? 0.35 : isExploding ? 0.65 : 1);
    this.rampGain(this.masterGain, duckedMaster, now, 0.15);

    const musicTarget = next === "playing" ? 0.36 : next === "idle" ? 0.22 : 0.28;
    this.rampGain(this.musicGain, musicTarget, now, 0.3);

    const sfxTarget = this.mobileMode ? 0.8 : 1;
    this.rampGain(this.sfxGain, sfxTarget, now, 0.05);

    if (next === "idle") {
      this.fadeOutAmbient(0.6);
    } else {
      this.ensureAmbient();
    }
  }

  onLevelTransition(): void {
    if (this.suspendedByPolicy) {
      return;
    }
    const context = this.ensureContext();
    if (!context || !this.musicGain) {
      return;
    }
    const now = context.currentTime;
    this.rampGain(this.musicGain, 0.05, now, 0.2);
    window.setTimeout(() => {
      if (this.lastState !== "idle") {
        this.ensureAmbient();
        if (this.musicGain) {
          const resumeTime = this.context?.currentTime ?? 0;
          this.rampGain(this.musicGain, 0.34, resumeTime, 0.4);
        }
      }
    }, 320);
  }

  async playJump(): Promise<void> {
    await this.playSfx("jump", 0.85);
  }

  async playBurrow(): Promise<void> {
    await this.playSfx("burrow", 0.9);
  }

  async playPickup(): Promise<void> {
    await this.playSfx("pickup", 0.9);
  }

  async playExplosion(): Promise<void> {
    await this.playSfx("explosion", 1);
  }

  async playSfx(key: Exclude<SoundKey, "ambient">, gainScale = 1): Promise<void> {
    if (this.suspendedByPolicy || this.pendingUnlock) {
      return;
    }
    const context = this.ensureContext();
    if (!context || !this.sfxGain) {
      return;
    }
    if (context.state === "suspended") {
      return;
    }
    const buffer = await this.getBuffer(key);
    const source = context.createBufferSource();
    source.buffer = buffer;

    const gainNode = context.createGain();
    const clampedGain = this.mobileMode ? Math.min(gainScale, 0.8) : gainScale;
    gainNode.gain.value = clampedGain;

    source.connect(gainNode).connect(this.sfxGain);
    source.start();
  }

  private async warmup(): Promise<void> {
    await Promise.all([
      this.getBuffer("ambient"),
      this.getBuffer("jump"),
      this.getBuffer("burrow"),
      this.getBuffer("pickup"),
      this.getBuffer("explosion"),
    ]);
  }

  private ensureAmbient(): void {
    if (this.suspendedByPolicy) {
      return;
    }
    const context = this.ensureContext();
    if (!context || !this.musicGain) {
      return;
    }
    if (context.state === "suspended") {
      return;
    }
    if (this.ambientSource) {
      return;
    }
    this.getBuffer("ambient").then((buffer) => {
      if (this.ambientSource || this.suspendedByPolicy) {
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.musicGain!);
      source.start();
      this.ambientSource = source;
      source.onended = () => {
        if (this.ambientSource === source) {
          this.ambientSource = null;
        }
      };
    });
  }

  private fadeOutAmbient(durationSeconds: number): void {
    const context = this.context;
    if (!context || !this.ambientSource || !this.musicGain) {
      return;
    }
    const now = context.currentTime;
    this.rampGain(this.musicGain, 0.08, now, durationSeconds / 2);
    window.setTimeout(() => {
      this.stopAmbient();
    }, durationSeconds * 1000);
  }

  private stopAmbient(): void {
    if (this.ambientSource) {
      try {
        this.ambientSource.stop();
      } catch {
        // ignore
      }
    }
    this.ambientSource = null;
  }

  private rampGain(node: GainNode, value: number, now: number, time: number): void {
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(value, now, Math.max(0.01, time));
  }

  private async getBuffer(key: SoundKey): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(key);
    if (cached) {
      return cached;
    }
    const factory = bufferFactory[key];
    const promise = factory();
    this.bufferCache.set(key, promise);
    return promise;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }
    const Ctor = getAudioContextCtor();
    if (!Ctor) {
      this.suspendedByPolicy = true;
      return null;
    }
    const ctx = new Ctor({
      latencyHint: this.mobileMode ? "playback" : "interactive",
    });
    const master = ctx.createGain();
    master.gain.value = this.mobileMode ? 0.75 : 1;

    const music = ctx.createGain();
    music.gain.value = 0.34;
    const sfx = ctx.createGain();
    sfx.gain.value = this.mobileMode ? 0.85 : 1;

    music.connect(master);
    sfx.connect(master);
    master.connect(ctx.destination);

    this.context = ctx;
    this.masterGain = master;
    this.musicGain = music;
    this.sfxGain = sfx;
    return this.context;
  }
}
