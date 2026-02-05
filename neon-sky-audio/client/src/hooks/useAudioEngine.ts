import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { parseBlob } from "music-metadata";
import { toast } from "sonner";
import {
  clearStoredPlaylist,
  loadStoredPlaylist,
  saveStoredPlaylist,
} from "@/lib/playlistStore";

export type Phase = "splash" | "boot" | "player";
export type VizMode = "spectrum" | "oscilloscope" | "vectorscope";
export type Band = "sub" | "low" | "mid" | "high" | "air";
export type PlaybackState =
  | "idle"
  | "initializing"
  | "ready"
  | "playing"
  | "paused"
  | "error";

type CompressorSettings = {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  makeup: number;
  bypass: boolean;
};

type LimiterSettings = {
  threshold: number;
  ceiling: number;
  release: number;
  softClip: boolean;
  bypass: boolean;
};

type SaturationSettings = {
  drive: number;
  mix: number;
  bypass: boolean;
};

type StereoSettings = {
  width: number;
  pan: number;
  mono: boolean;
  bypass: boolean;
};

type OutputSettings = {
  trim: number;
  bypass: boolean;
};

type MeterState = {
  peak: number;
  rms: number;
  lufsMomentary: number;
  lufsShort: number;
  lufsIntegrated: number;
  correlation: number;
};

export type MasteringPreset = {
  name: string;
  eq: Record<Band, number>;
  compressor: CompressorSettings;
  limiter: LimiterSettings;
  saturation: SaturationSettings;
  stereo: StereoSettings;
  output: OutputSettings;
  lufs?: number;
};

export type TrackState = {
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  duration: number;
  currentTime: number;
};

export type PlaylistItem = {
  id: string;
  file: File;
  url: string;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  artworkBlob?: Blob | null;
  duration: number;
  extension: string;
};

type AudioEngineOptions = {
  visualizerColor: string;
  visualizerActive: boolean;
  visualizerPulse?: boolean;
};

type ResumeState = {
  currentIndex: number;
  currentTime: number;
  volume: number;
  isMuted: boolean;
};

const RESUME_STATE_KEY = "neon-resume-state";
const DEFAULT_EQ: Record<Band, number> = {
  sub: 0,
  low: 0,
  mid: 0,
  high: 0,
  air: 0,
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
const dbToGain = (db: number) => Math.pow(10, db / 20);

const createSaturationCurve = (drive: number) => {
  const amount = clamp(drive, 0, 1);
  const k = 1 + amount * 20;
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x);
  }
  return curve;
};

const buildTrackState = (item: PlaylistItem): TrackState => ({
  title: item.title,
  artist: item.artist,
  album: item.album,
  artwork: item.artwork,
  duration: item.duration,
  currentTime: 0,
});

const createAudioContext = () => {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  return new Ctx();
};

const parseID3Tags = async (
  file: File
): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  artworkBlob?: Blob;
}> => {
  try {
    const metadata = await parseBlob(file);
    let artworkUrl: string | undefined;
    let artworkBlob: Blob | undefined;

    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      const blob = new Blob([picture.data], { type: picture.format });
      artworkUrl = URL.createObjectURL(blob);
      artworkBlob = blob;
    }

    return {
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album,
      artwork: artworkUrl,
      artworkBlob,
    };
  } catch (err) {
    console.warn("Failed to parse metadata:", err);
    return {};
  }
};

const hslToRgbMutable = (
  hue: number,
  saturation: number,
  lightness: number,
  target: { r: number; g: number; b: number }
) => {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  target.r = Math.round((r + m) * 255);
  target.g = Math.round((g + m) * 255);
  target.b = Math.round((b + m) * 255);
  return target;
};

const getAudioDuration = (url: string) =>
  new Promise<number>(resolve => {
    const audio = new Audio();
    const cleanup = () => {
      audio.removeAttribute("src");
      audio.load();
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(0);
    };
    audio.src = url;
  });

const audioBufferToWav = (buffer: AudioBuffer) => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * blockAlign;
  const bufferLength = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = buffer.getChannelData(channel)[i];
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true
      );
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
};

const calcIntegratedLufs = (buffer: AudioBuffer) => {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  if (!channels || !length) return -120;
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    let frame = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      const sample = buffer.getChannelData(ch)[i] || 0;
      frame += sample * sample;
    }
    sum += frame / channels;
  }
  const ms = sum / length;
  if (ms <= 0) return -120;
  return -0.691 + 10 * Math.log10(ms);
};

const applyGainToBuffer = (buffer: AudioBuffer, gain: number) => {
  const channels = buffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = clamp(data[i] * gain, -1, 1);
    }
  }
};

// Stable RAF loop utility
class StableVisualizerLoop {
  private rafId: number | null = null;
  private isRunning = false;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private analyser: AnalyserNode | null = null;
  private vizAnalyserL: AnalyserNode | null = null;
  private vizAnalyserR: AnalyserNode | null = null;
  private vizMode: VizMode = "spectrum";
  private visualizerColor: string;
  private visualizerPulse: boolean;
  private dpr: number;
  private frameCount = 0;
  private lastFrameTime = 0;
  private targetFps = 60;
  private frameInterval = 1000 / 60;
  private freqData: Uint8Array | null = null;
  private timeData: Uint8Array | null = null;
  private vectorDataL: Uint8Array | null = null;
  private vectorDataR: Uint8Array | null = null;
  private pulseRgb = { r: 255, g: 255, b: 255 };
  private fpsEma = 60;
  private renderEvery = 1;
  private lowFpsDuration = 0;
  private lowFpsThreshold = 32;
  private lowFpsWindow = 4000;
  private isMobile = false;
  private autoDisable: (() => void) | null = null;

  constructor(
    visualizerColor: string,
    visualizerPulse: boolean,
    autoDisable?: () => void
  ) {
    this.visualizerColor = visualizerColor;
    this.visualizerPulse = visualizerPulse;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.isMobile = window.matchMedia("(pointer: coarse)").matches;
    this.autoDisable = autoDisable ?? null;
  }

  setCanvas(canvas: HTMLCanvasElement | null) {
    if (this.canvas === canvas) return;
    this.canvas = canvas;
    if (canvas) {
      this.ctx =
        canvas.getContext("2d", {
          alpha: true,
          desynchronized: true,
          antialias: false,
        }) || null;
      this.resize();
    } else {
      this.ctx = null;
    }
  }

  setAnalysers(
    analyser: AnalyserNode | null,
    vizL: AnalyserNode | null,
    vizR: AnalyserNode | null
  ) {
    this.analyser = analyser;
    this.vizAnalyserL = vizL;
    this.vizAnalyserR = vizR;
    this.syncBuffers();
  }

  setVizMode(mode: VizMode) {
    this.vizMode = mode;
  }

  setColor(color: string) {
    this.visualizerColor = color;
  }

  getFps() {
    return this.fpsEma;
  }

  resize() {
    if (!this.canvas) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * this.dpr));
    const height = Math.max(1, Math.floor(rect.height * this.dpr));

    // Only resize if dimensions changed significantly
    if (
      Math.abs(this.canvas.width - width) > 1 ||
      Math.abs(this.canvas.height - height) > 1
    ) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private syncBuffers() {
    if (this.analyser) {
      const freqLen = this.analyser.frequencyBinCount;
      const timeLen = this.analyser.fftSize;
      if (!this.freqData || this.freqData.length !== freqLen) {
        this.freqData = new Uint8Array(freqLen);
      }
      if (!this.timeData || this.timeData.length !== timeLen) {
        this.timeData = new Uint8Array(timeLen);
      }
    }
    if (this.vizAnalyserL) {
      const len = this.vizAnalyserL.fftSize;
      if (!this.vectorDataL || this.vectorDataL.length !== len) {
        this.vectorDataL = new Uint8Array(len);
      }
    }
    if (this.vizAnalyserR) {
      const len = this.vizAnalyserR.fftSize;
      if (!this.vectorDataR || this.vectorDataR.length !== len) {
        this.vectorDataR = new Uint8Array(len);
      }
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.lowFpsDuration = 0;
    this.loop();
  }

  stop() {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private loop = () => {
    if (!this.isRunning) return;

    const now = performance.now();
    const elapsed = now - this.lastFrameTime;

    // Frame rate limiting for stability
    if (elapsed < this.frameInterval) {
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    this.lastFrameTime = now - (elapsed % this.frameInterval);
    this.frameCount++;

    const instantFps = elapsed > 0 ? 1000 / elapsed : 60;
    this.fpsEma = this.fpsEma * 0.9 + instantFps * 0.1;
    if (this.fpsEma < this.lowFpsThreshold) {
      this.lowFpsDuration += elapsed;
    } else {
      this.lowFpsDuration = 0;
    }

    if (this.lowFpsDuration > this.lowFpsWindow) {
      this.stop();
      this.autoDisable?.();
      return;
    }

    this.renderEvery = this.fpsEma < 30 ? 3 : this.fpsEma < 45 ? 2 : 1;

    this.renderCritical();
    if (this.frameCount % this.renderEvery === 0) {
      this.renderBackground();
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private renderCritical() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;
    this.ctx.clearRect(0, 0, w, h);
  }

  private renderBackground() {
    if (!this.ctx || !this.canvas) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    const ctx = this.ctx;
    if (!this.analyser) return;

    const len = this.analyser.frequencyBinCount;
    const data = this.freqData;
    if (!data || data.length !== len) {
      this.syncBuffers();
    }
    if (!this.freqData) return;

    const now = performance.now() / 1000;
    let fillColor = "";
    if (this.visualizerPulse) {
      const pulse = hslToRgbMutable(
        now * 40,
        0.85,
        0.55 + 0.08 * Math.sin(now * 2.1),
        this.pulseRgb
      );
      fillColor = `rgba(${pulse.r},${pulse.g},${pulse.b},`;
    } else {
      fillColor = `rgba(${this.visualizerColor},`;
    }

    try {
      if (this.vizMode === "spectrum") {
        this.analyser.getByteFrequencyData(this.freqData);
        const mobileFactor = this.isMobile ? 0.7 : 1;
        const perfFactor = this.renderEvery > 1 ? 0.7 : 1;
        const barCount = Math.max(
          18,
          Math.floor((w / (12 * this.dpr)) * mobileFactor * perfFactor)
        );
        const minFreq = 20;
        const maxFreq = 20000;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);

        const barWidth = w / barCount;
        for (let i = 0; i < barCount; i += 1) {
          const t = i / (barCount - 1);
          const freq = Math.pow(10, logMin + t * (logMax - logMin));
          const idx = Math.min(len - 1, Math.floor((freq / maxFreq) * len));
          const amp = this.freqData[idx] / 255;
          const barHeight = amp * h * 0.9;
          const alpha = Math.max(0.2, amp);
          ctx.fillStyle = `${fillColor}${alpha})`;
          const x = i * barWidth + 1;
          const y = h - barHeight;
          const bw = Math.max(1, barWidth - 2);
          ctx.fillRect(x, y, bw, barHeight);
        }
      } else if (this.vizMode === "oscilloscope") {
        if (!this.timeData) return;
        this.analyser.getByteTimeDomainData(this.timeData);

        ctx.beginPath();
        ctx.strokeStyle = `${fillColor}0.95)`;
        ctx.lineWidth = Math.max(1, Math.floor(w / 450));

        const slice = w / this.timeData.length;
        let x = 0;
        for (let i = 0; i < this.timeData.length; i += 1) {
          const v = this.timeData[i] / 128 - 1;
          const y = h / 2 + v * (h * 0.35);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += slice;
        }
        ctx.stroke();
      } else if (this.vizMode === "vectorscope") {
        const analyserL = this.vizAnalyserL;
        const analyserR = this.vizAnalyserR;
        if (!analyserL || !analyserR) return;
        if (!this.vectorDataL || !this.vectorDataR) return;
        analyserL.getByteTimeDomainData(this.vectorDataL);
        analyserR.getByteTimeDomainData(this.vectorDataR);

        ctx.beginPath();
        ctx.strokeStyle = `${fillColor}0.95)`;
        ctx.lineWidth = Math.max(1, Math.floor(w / 500));

        const lenVec = Math.min(
          this.vectorDataL.length,
          this.vectorDataR.length
        );
        for (let i = 0; i < lenVec; i += 1) {
          const x = ((this.vectorDataL[i] / 128 - 1) * 0.45 + 0.5) * w;
          const y = ((this.vectorDataR[i] / 128 - 1) * 0.45 + 0.5) * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } catch (err) {
      // Silently handle render errors to prevent crash loops
      console.warn("Visualizer render error:", err);
    }
  }

  destroy() {
    this.stop();
    this.canvas = null;
    this.ctx = null;
    this.analyser = null;
    this.vizAnalyserL = null;
    this.vizAnalyserR = null;
    this.freqData = null;
    this.timeData = null;
    this.vectorDataL = null;
    this.vectorDataR = null;
  }
}

export const useAudioEngine = ({
  visualizerColor,
  visualizerActive,
  visualizerPulse = false,
}: AudioEngineOptions) => {
  const [vizMode, setVizMode] = useState<VizMode>("spectrum");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [visualizerFps, setVisualizerFps] = useState(60);
  const [visualizerBlocked, setVisualizerBlocked] = useState(false);
  const [activeBand, setActiveBand] = useState<Band>("mid");
  const [eq, setEq] = useState<Record<Band, number>>(DEFAULT_EQ);
  const [compressor, setCompressor] = useState<CompressorSettings>({
    threshold: -18,
    ratio: 2,
    attack: 0.01,
    release: 0.25,
    makeup: 0,
    bypass: false,
  });
  const [limiter, setLimiter] = useState<LimiterSettings>({
    threshold: -6,
    ceiling: -0.3,
    release: 120,
    softClip: true,
    bypass: false,
  });
  const [saturation, setSaturation] = useState<SaturationSettings>({
    drive: 0.2,
    mix: 0.4,
    bypass: false,
  });
  const [stereo, setStereo] = useState<StereoSettings>({
    width: 1,
    pan: 0,
    mono: false,
    bypass: false,
  });
  const [output, setOutput] = useState<OutputSettings>({
    trim: 0,
    bypass: false,
  });
  const [meter, setMeter] = useState<MeterState>({
    peak: 0,
    rms: 0,
    lufsMomentary: -120,
    lufsShort: -120,
    lufsIntegrated: -120,
    correlation: 0,
  });
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [track, setTrack] = useState<TrackState>({
    title: "NO_TRACK_LOADED",
    artist: "NEON_SKY_OS",
    album: "",
    artwork: null,
    duration: 0,
    currentTime: 0,
  });

  const [presetA, setPresetA] = useState<MasteringPreset | null>(null);
  const [presetB, setPresetB] = useState<MasteringPreset | null>(null);
  const [activePresetSlot, setActivePresetSlot] = useState<"A" | "B">("A");
  const [gainMatchEnabled, setGainMatchEnabled] = useState(false);
  const [gainMatchOffset, setGainMatchOffset] = useState(0);
  const [normalizeLoudness, setNormalizeLoudness] = useState(false);
  const [targetLufs, setTargetLufs] = useState(-14);

  const previousVolumeRef = useRef(1);
  const isInitializedRef = useRef(false);
  const playbackStateRef = useRef<PlaybackState>("idle");
  const setPlayback = useCallback((next: PlaybackState) => {
    playbackStateRef.current = next;
    setPlaybackState(next);
  }, []);
  const lastWasPlayingRef = useRef(false);
  const visualizerToastRef = useRef(false);
  const resumeStateRef = useRef<ResumeState | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(RESUME_STATE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as ResumeState;
      resumeStateRef.current = parsed;
      setVolume(clamp(parsed.volume, 0, 1));
      setIsMuted(parsed.isMuted);
      previousVolumeRef.current = parsed.volume;
    } catch (err) {
      console.warn("Failed to read resume state:", err);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    loadStoredPlaylist()
      .then(({ items, currentIndex: storedIndex }) => {
        if (!isMounted || items.length === 0) return;
        const restored = items.map(item => {
          const file = new File([item.file], item.fileName, {
            type: item.fileType,
            lastModified: item.lastModified,
          });
          const url = URL.createObjectURL(file);
          const artwork = item.artworkBlob
            ? URL.createObjectURL(item.artworkBlob)
            : null;
          return {
            id: item.id,
            file,
            url,
            title: item.title,
            artist: item.artist,
            album: item.album,
            artwork,
            artworkBlob: item.artworkBlob ?? null,
            duration: item.duration,
            extension: item.extension,
          } as PlaylistItem;
        });
        setPlaylist(restored);
        const nextIndex = clamp(
          storedIndex,
          0,
          Math.max(restored.length - 1, 0)
        );
        setCurrentIndex(nextIndex);
        const current = restored[nextIndex];
        if (current && audioRef.current) {
          audioRef.current.src = current.url;
          audioRef.current.load();
          setTrack(buildTrackState(current));
          setPlayback("ready");
        }
      })
      .catch(err => {
        console.warn("Failed to restore playlist:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [setPlayback]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphEqRef = useRef<HTMLDivElement | null>(null);
  const seekRingRef = useRef<HTMLDivElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRef = useRef<AudioWorkletNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const compressorMakeupRef = useRef<GainNode | null>(null);
  const saturationShaperRef = useRef<WaveShaperNode | null>(null);
  const saturationDryGainRef = useRef<GainNode | null>(null);
  const saturationWetGainRef = useRef<GainNode | null>(null);
  const saturationSumRef = useRef<GainNode | null>(null);
  const stereoSplitRef = useRef<ChannelSplitterNode | null>(null);
  const stereoMergeRef = useRef<ChannelMergerNode | null>(null);
  const stereoGainLLRef = useRef<GainNode | null>(null);
  const stereoGainRRRef = useRef<GainNode | null>(null);
  const stereoGainLRRef = useRef<GainNode | null>(null);
  const stereoGainRLRef = useRef<GainNode | null>(null);
  const stereoPanRef = useRef<StereoPannerNode | null>(null);
  const limiterRef = useRef<AudioWorkletNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const gainRef = outputGainRef;
  const filtersRef = useRef<Record<Band, BiquadFilterNode | null>>({
    sub: null,
    low: null,
    mid: null,
    high: null,
    air: null,
  });
  const vizSplitRef = useRef<ChannelSplitterNode | null>(null);
  const vizAnalyserLRef = useRef<AnalyserNode | null>(null);
  const vizAnalyserRRef = useRef<AnalyserNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);

  // Stable visualizer instance
  const visualizerRef = useRef<StableVisualizerLoop | null>(null);

  const handleVisualizerAutoDisable = useCallback(() => {
    setVisualizerBlocked(true);
    if (!visualizerToastRef.current) {
      visualizerToastRef.current = true;
      toast.warning("Visualizer paused to keep playback stable.");
    }
  }, []);

  const ensureAudioCtxResumed = useCallback(async () => {
    if (audioCtxRef.current?.state === "suspended") {
      try {
        await audioCtxRef.current.resume();
      } catch (err) {
        console.warn("Failed to resume AudioContext:", err);
      }
    }
  }, []);

  // Initialize visualizer loop once
  useEffect(() => {
    visualizerRef.current = new StableVisualizerLoop(
      visualizerColor,
      visualizerPulse,
      handleVisualizerAutoDisable
    );
    return () => {
      visualizerRef.current?.destroy();
      visualizerRef.current = null;
    };
  }, [handleVisualizerAutoDisable, visualizerColor, visualizerPulse]);

  // Update visualizer refs when they change
  useEffect(() => {
    visualizerRef.current?.setCanvas(vizCanvasRef.current);
  }, []);

  useEffect(() => {
    visualizerRef.current?.setAnalysers(
      analyserRef.current,
      vizAnalyserLRef.current,
      vizAnalyserRRef.current
    );
  }, []);

  useEffect(() => {
    visualizerRef.current?.setVizMode(vizMode);
  }, [vizMode]);

  const resizeCanvas = useCallback(() => {
    visualizerRef.current?.resize();
  }, []);

  useEffect(() => {
    if (!visualizerActive || visualizerBlocked) return;
    const id = window.setInterval(() => {
      const fps = visualizerRef.current?.getFps();
      if (fps) setVisualizerFps(fps);
    }, 500);
    return () => window.clearInterval(id);
  }, [visualizerActive, visualizerBlocked]);

  const stopVisualizer = useCallback(() => {
    visualizerRef.current?.stop();
  }, []);

  const startVisualizer = useCallback(() => {
    if (visualizerBlocked) return;
    visualizerRef.current?.start();
  }, [visualizerBlocked]);

  const applyBandGain = useCallback((band: Band, gainDb: number) => {
    const g = clamp(gainDb, -24, 24);
    setActiveBand(band);
    setEq(prev => ({ ...prev, [band]: g }));
    const node = filtersRef.current[band];
    if (node) node.gain.value = g;
  }, []);

  useEffect(() => {
    const { sub, low, mid, high, air } = filtersRef.current;
    if (sub) sub.gain.value = eq.sub;
    if (low) low.gain.value = eq.low;
    if (mid) mid.gain.value = eq.mid;
    if (high) high.gain.value = eq.high;
    if (air) air.gain.value = eq.air;
  }, [eq.air, eq.high, eq.low, eq.mid, eq.sub]);

  const resetEq = useCallback(() => {
    (["sub", "low", "mid", "high", "air"] as Band[]).forEach(band =>
      applyBandGain(band, 0)
    );
  }, [applyBandGain]);

  const handleGraphDrag = useCallback(
    (clientX: number, clientY: number) => {
      const surface = graphEqRef.current;
      if (!surface) return;

      const rect = surface.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;

      let band: Band = "mid";
      if (x < 0.2) band = "sub";
      else if (x < 0.4) band = "low";
      else if (x > 0.8) band = "air";
      else if (x > 0.6) band = "high";

      const gainDb = Math.round((0.5 - y) * 48);
      applyBandGain(band, gainDb);
    },
    [applyBandGain]
  );

  const onGraphMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      handleGraphDrag(e.clientX, e.clientY);

      const move = (ev: MouseEvent) => handleGraphDrag(ev.clientX, ev.clientY);
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [handleGraphDrag]
  );

  const onGraphTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (t) handleGraphDrag(t.clientX, t.clientY);
    },
    [handleGraphDrag]
  );

  const onGraphTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (t) handleGraphDrag(t.clientX, t.clientY);
    },
    [handleGraphDrag]
  );

  const revokePlaylistUrls = useCallback((items: PlaylistItem[]) => {
    for (const it of items) {
      try {
        if (it.url) URL.revokeObjectURL(it.url);
      } catch {
        // ignore
      }
      try {
        if (it.artwork) URL.revokeObjectURL(it.artwork);
      } catch {
        // ignore
      }
    }
  }, []);

  const loadTrackAt = useCallback(
    async (index: number, opts?: { autoplay?: boolean }) => {
      const audioEl = audioRef.current;
      if (!audioEl) return;
      const item = playlist[index];
      if (!item) return;

      setError(null);
      setIsLoading(true);
      setPlayback("initializing");
      setCurrentIndex(index);

      audioEl.src = item.url;
      audioEl.load();

      setTrack(buildTrackState(item));
      setIsPlaying(false);
      setPlayback("ready");

      if (opts?.autoplay) {
        try {
          await ensureAudioCtxResumed();
          await audioEl.play();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Playback failed: ${message}`);
          setPlayback("error");
        }
      }
    },
    [ensureAudioCtxResumed, playlist, setPlayback]
  );

  const playNext = useCallback(
    async (opts?: { autoplay?: boolean }) => {
      if (playlist.length === 0) return;
      const next = clamp(currentIndex + 1, 0, playlist.length - 1);
      if (next === currentIndex) return;
      await loadTrackAt(next, opts);
    },
    [currentIndex, loadTrackAt, playlist.length]
  );

  const playPrev = useCallback(
    async (opts?: { autoplay?: boolean }) => {
      if (playlist.length === 0) return;
      const prev = clamp(currentIndex - 1, 0, playlist.length - 1);
      if (prev === currentIndex) return;
      await loadTrackAt(prev, opts);
    },
    [currentIndex, loadTrackAt, playlist.length]
  );

  const prevTrack = useCallback(() => {
    void playPrev({ autoplay: true });
  }, [playPrev]);

  const nextTrack = useCallback(() => {
    void playNext({ autoplay: true });
  }, [playNext]);

  const addFilesToPlaylist = useCallback(
    async (incomingFiles: File[], mode: "replace" | "append" = "replace") => {
      const files = incomingFiles;
      const audioEl = audioRef.current;
      if (files.length === 0 || !audioEl) return;

      setError(null);
      setIsLoading(true);

      const shouldReplace = mode === "replace";
      if (shouldReplace) {
        setIsPlaying(false);
        setCurrentIndex(0);
        revokePlaylistUrls(playlist);
      }

      const nextItems = await Promise.all(
        files.map(async file => {
          const url = URL.createObjectURL(file);

          let title = file.name.replace(/\.[^/.]+$/, "");
          let artist = "Unknown Artist";
          let album = "";
          let artwork: string | null = null;
          let artworkBlob: Blob | null = null;

          const dashMatch = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
          if (dashMatch) {
            artist = dashMatch[1].trim();
            title = dashMatch[2].trim();
          }

          try {
            const metadata = await parseID3Tags(file);
            if (metadata.title) title = metadata.title;
            if (metadata.artist) artist = metadata.artist;
            if (metadata.album) album = metadata.album;
            if (metadata.artwork) artwork = metadata.artwork;
            if (metadata.artworkBlob) artworkBlob = metadata.artworkBlob;
          } catch {
            // ignore
          }

          const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
          const duration = await getAudioDuration(url);

          return {
            id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
            file,
            url,
            title,
            artist,
            album,
            artwork,
            artworkBlob,
            duration,
            extension,
          };
        })
      );

      setPlaylist(prev => {
        const base = shouldReplace ? [] : prev;
        return [...base, ...nextItems];
      });

      const shouldLoadFirst = shouldReplace || playlist.length === 0;
      if (shouldLoadFirst) {
        const first = nextItems[0];
        if (first) {
          audioEl.src = first.url;
          audioEl.load();
          setTrack(buildTrackState(first));
          setPlayback("ready");
        }
      } else {
        setIsLoading(false);
      }
    },
    [playlist, revokePlaylistUrls]
  );

  const handleFile = useCallback(
    async (
      e: React.ChangeEvent<HTMLInputElement>,
      mode: "replace" | "append" = "replace"
    ) => {
      const files = Array.from(e.target.files ?? []);
      await addFilesToPlaylist(files, mode);
      e.target.value = "";
    },
    [addFilesToPlaylist]
  );

  const togglePlay = useCallback(async () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    if (!audioEl.src) return;
    if (playbackStateRef.current === "initializing") return;

    try {
      await ensureAudioCtxResumed();
      if (audioEl.paused) {
        await audioEl.play();
      } else {
        audioEl.pause();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Playback failed: ${message}`);
    }
  }, [ensureAudioCtxResumed]);

  const updatePlaylistItem = useCallback(
    (id: string, updates: Partial<PlaylistItem>) => {
      setPlaylist(prev => {
        let updated: PlaylistItem | null = null;
        const next = prev.map(item => {
          if (item.id !== id) return item;
          updated = { ...item, ...updates };
          return updated;
        });
        if (updated && prev[currentIndex]?.id === id) {
          setTrack(prevTrack => ({
            ...prevTrack,
            title: updated?.title ?? prevTrack.title,
            artist: updated?.artist ?? prevTrack.artist,
            album: updated?.album ?? prevTrack.album,
            artwork: updated?.artwork ?? prevTrack.artwork,
            duration: updated?.duration ?? prevTrack.duration,
          }));
        }
        return next;
      });
    },
    [currentIndex]
  );

  const movePlaylistItem = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setPlaylist(prev => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
    setCurrentIndex(prev => {
      if (prev === fromIndex) return toIndex;
      if (fromIndex < prev && toIndex >= prev) return prev - 1;
      if (fromIndex > prev && toIndex <= prev) return prev + 1;
      return prev;
    });
  }, []);

  const updatePlaylistArtwork = useCallback(
    (id: string, file: File) => {
      const artworkUrl = URL.createObjectURL(file);
      const artworkBlob = file.slice(0, file.size, file.type);
      setPlaylist(prev => {
        let oldArtwork: string | null = null;
        const next = prev.map((item, index) => {
          if (item.id !== id) return item;
          oldArtwork = item.artwork;
          if (index === currentIndex) {
            setTrack(prevTrack => ({ ...prevTrack, artwork: artworkUrl }));
          }
          return { ...item, artwork: artworkUrl, artworkBlob };
        });
        if (oldArtwork) {
          try {
            URL.revokeObjectURL(oldArtwork);
          } catch {
            // ignore
          }
        }
        return next;
      });
    },
    [currentIndex]
  );

  const removePlaylistItems = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const audioEl = audioRef.current;
      setPlaylist(prev => {
        const next = prev.filter(item => !ids.includes(item.id));
        revokePlaylistUrls(prev.filter(item => ids.includes(item.id)));
        if (!next.length) {
          if (audioEl) {
            audioEl.pause();
            audioEl.removeAttribute("src");
            audioEl.load();
          }
          setIsPlaying(false);
          setPlayback("idle");
          setCurrentIndex(0);
          setTrack({
            title: "NO_TRACK_LOADED",
            artist: "NEON_SKY_OS",
            album: "",
            artwork: null,
            duration: 0,
            currentTime: 0,
          });
          return next;
        }

        const removedBefore = prev
          .slice(0, currentIndex)
          .filter(item => ids.includes(item.id)).length;
        let nextIndex = currentIndex - removedBefore;
        nextIndex = clamp(nextIndex, 0, next.length - 1);
        setCurrentIndex(nextIndex);

        const nextItem = next[nextIndex];
        if (nextItem && ids.includes(prev[currentIndex]?.id ?? "")) {
          if (audioEl) {
            audioEl.pause();
            audioEl.src = nextItem.url;
            audioEl.load();
          }
          setIsPlaying(false);
          setPlayback("ready");
          setTrack(buildTrackState(nextItem));
        }
        return next;
      });
    },
    [currentIndex, revokePlaylistUrls]
  );

  const calcRingProgress = useCallback((clientX: number, clientY: number) => {
    const el = seekRingRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const cx0 = rect.left + rect.width / 2;
    const cy0 = rect.top + rect.height / 2;
    const dx = clientX - cx0;
    const dy = clientY - cy0;

    const angle = Math.atan2(dy, dx);
    let a = angle + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    return clamp(a / (Math.PI * 2), 0, 1);
  }, []);

  const ringSeekTo = useCallback(
    (p: number, commit: boolean) => {
      const audioEl = audioRef.current;
      if (!Number.isFinite(track.duration) || track.duration <= 0) return;
      const pct = clamp(p, 0, 1);
      setDragProgress(pct * 100);
      if (!commit) return;
      if (!audioEl) return;
      if (audioEl.readyState < 1) {
        setIsLoading(true);
        return;
      }
      const newTime = pct * track.duration;
      audioEl.currentTime = newTime;
      setTrack(prev => ({ ...prev, currentTime: newTime }));
    },
    [track.duration]
  );

  const onRingPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!track.duration) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setIsDragging(true);
      const p = calcRingProgress(e.clientX, e.clientY);
      ringSeekTo(p, false);
    },
    [calcRingProgress, ringSeekTo, track.duration]
  );

  const onRingPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const p = calcRingProgress(e.clientX, e.clientY);
      ringSeekTo(p, false);
    },
    [calcRingProgress, isDragging, ringSeekTo]
  );

  const onRingPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const p = calcRingProgress(e.clientX, e.clientY);
      ringSeekTo(p, true);
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      setIsDragging(false);
    },
    [calcRingProgress, isDragging, ringSeekTo]
  );

  const onRingPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      setIsDragging(false);
    },
    [isDragging]
  );

  useEffect(() => {
    const node = gainRef.current;
    if (!node) return;
    const trim = output.bypass ? 0 : output.trim;
    const gainMatch = gainMatchEnabled ? gainMatchOffset : 0;
    const base = isMuted ? 0 : volume;
    const target = base * dbToGain(trim + gainMatch);
    const ctx = audioCtxRef.current;
    if (ctx) {
      node.gain.setTargetAtTime(target, ctx.currentTime, 0.015);
    } else {
      node.gain.value = target;
    }
  }, [
    gainMatchEnabled,
    gainMatchOffset,
    gainRef,
    isMuted,
    output.bypass,
    output.trim,
    volume,
  ]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    const clampedVolume = clamp(newVolume, 0, 1);
    setVolume(clampedVolume);
    setIsMuted(clampedVolume === 0);
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      const restoreVolume =
        previousVolumeRef.current > 0 ? previousVolumeRef.current : 1;
      handleVolumeChange(restoreVolume);
    } else {
      previousVolumeRef.current = volume;
      handleVolumeChange(0);
    }
  }, [isMuted, volume, handleVolumeChange]);

  useEffect(() => {
    const node = compressorRef.current;
    if (!node) return;
    if (compressor.bypass) {
      node.threshold.value = 0;
      node.ratio.value = 1;
      node.attack.value = 0.003;
      node.release.value = 0.25;
    } else {
      node.threshold.value = compressor.threshold;
      node.ratio.value = compressor.ratio;
      node.attack.value = compressor.attack;
      node.release.value = compressor.release;
    }
    if (compressorMakeupRef.current) {
      compressorMakeupRef.current.gain.value = dbToGain(
        compressor.bypass ? 0 : compressor.makeup
      );
    }
  }, [compressor]);

  useEffect(() => {
    const shaper = saturationShaperRef.current;
    const dry = saturationDryGainRef.current;
    const wet = saturationWetGainRef.current;
    if (!shaper || !dry || !wet) return;
    const mix = saturation.bypass ? 0 : clamp(saturation.mix, 0, 1);
    shaper.curve = createSaturationCurve(saturation.drive);
    shaper.oversample = "4x";
    dry.gain.value = 1 - mix;
    wet.gain.value = mix;
  }, [saturation]);

  useEffect(() => {
    const ll = stereoGainLLRef.current;
    const rr = stereoGainRRRef.current;
    const lr = stereoGainLRRef.current;
    const rl = stereoGainRLRef.current;
    const pan = stereoPanRef.current;
    if (!ll || !rr || !lr || !rl || !pan) return;
    const width = stereo.bypass
      ? 1
      : stereo.mono
        ? 0
        : clamp(stereo.width, 0, 2);
    const a = (1 + width) / 2;
    const b = (1 - width) / 2;
    ll.gain.value = a;
    rr.gain.value = a;
    lr.gain.value = b;
    rl.gain.value = b;
    pan.pan.value = stereo.bypass ? 0 : clamp(stereo.pan, -1, 1);
  }, [stereo]);

  useEffect(() => {
    const node = limiterRef.current;
    if (!node) return;
    node.parameters
      .get("threshold")
      ?.setValueAtTime(limiter.threshold, node.context.currentTime);
    node.parameters
      .get("ceiling")
      ?.setValueAtTime(limiter.ceiling, node.context.currentTime);
    node.parameters
      .get("release")
      ?.setValueAtTime(limiter.release, node.context.currentTime);
    node.parameters
      .get("softClip")
      ?.setValueAtTime(limiter.softClip ? 1 : 0, node.context.currentTime);
    node.parameters
      .get("bypass")
      ?.setValueAtTime(limiter.bypass ? 1 : 0, node.context.currentTime);
  }, [limiter]);

  useEffect(() => {
    if (!gainMatchEnabled) setGainMatchOffset(0);
  }, [gainMatchEnabled]);

  const buildPreset = useCallback(
    (name: string): MasteringPreset => ({
      name,
      eq,
      compressor,
      limiter,
      saturation,
      stereo,
      output,
      lufs: meter.lufsIntegrated,
    }),
    [compressor, eq, limiter, meter.lufsIntegrated, output, saturation, stereo]
  );

  const applyPreset = useCallback((preset: MasteringPreset) => {
    setEq({ ...DEFAULT_EQ, ...preset.eq });
    setCompressor(preset.compressor);
    setLimiter(preset.limiter);
    setSaturation(preset.saturation);
    setStereo(preset.stereo);
    setOutput(preset.output);
  }, []);

  const storePresetSlot = useCallback(
    (slot: "A" | "B") => {
      const preset = buildPreset(`Preset ${slot}`);
      if (slot === "A") setPresetA(preset);
      else setPresetB(preset);
      localStorage.setItem(
        `neon-mastering-preset-${slot}`,
        JSON.stringify(preset)
      );
    },
    [buildPreset]
  );

  const recallPresetSlot = useCallback(
    (slot: "A" | "B") => {
      const preset = slot === "A" ? presetA : presetB;
      if (!preset) return;
      const currentPreset = activePresetSlot === "A" ? presetA : presetB;
      const currentLufs = currentPreset?.lufs ?? meter.lufsIntegrated;
      const nextLufs = preset.lufs ?? meter.lufsIntegrated;
      if (gainMatchEnabled) {
        setGainMatchOffset(clamp(currentLufs - nextLufs, -12, 12));
      } else {
        setGainMatchOffset(0);
      }
      setActivePresetSlot(slot);
      applyPreset(preset);
    },
    [
      activePresetSlot,
      applyPreset,
      gainMatchEnabled,
      meter.lufsIntegrated,
      presetA,
      presetB,
    ]
  );

  const exportPresetJson = useCallback(() => {
    const preset = buildPreset(`Preset ${activePresetSlot}`);
    const blob = new Blob([JSON.stringify(preset, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neon-mastering-${activePresetSlot.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activePresetSlot, buildPreset]);

  const importPresetJson = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = JSON.parse(text) as MasteringPreset;
      if (!parsed.eq || !parsed.compressor || !parsed.limiter)
        throw new Error("Invalid preset file.");
      applyPreset(parsed);
      if (activePresetSlot === "A") setPresetA(parsed);
      else setPresetB(parsed);
      localStorage.setItem(
        `neon-mastering-preset-${activePresetSlot}`,
        JSON.stringify(parsed)
      );
    },
    [activePresetSlot, applyPreset]
  );

  const exportOfflineWav = useCallback(async () => {
    const item = playlist[currentIndex];
    if (!item) throw new Error("No track selected for export.");

    const arrayBuffer = await item.file.arrayBuffer();
    const decodeContext = createAudioContext();
    const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
    await decodeContext.close();

    const offlineContext = new OfflineAudioContext(
      decoded.numberOfChannels,
      decoded.length,
      decoded.sampleRate
    );
    await offlineContext.audioWorklet.addModule(
      "/worklets/limiter-processor.js"
    );
    const source = offlineContext.createBufferSource();
    source.buffer = decoded;

    const sub = offlineContext.createBiquadFilter();
    sub.type = "lowshelf";
    sub.frequency.value = 80;
    sub.gain.value = eq.sub;

    const low = offlineContext.createBiquadFilter();
    low.type = "peaking";
    low.frequency.value = 250;
    low.Q.value = 0.9;
    low.gain.value = eq.low;

    const mid = offlineContext.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 1.0;
    mid.gain.value = eq.mid;

    const high = offlineContext.createBiquadFilter();
    high.type = "peaking";
    high.frequency.value = 4000;
    high.Q.value = 1.1;
    high.gain.value = eq.high;

    const air = offlineContext.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 12000;
    air.gain.value = eq.air;

    const compressorNode = offlineContext.createDynamicsCompressor();
    compressorNode.threshold.value = compressor.bypass
      ? 0
      : compressor.threshold;
    compressorNode.ratio.value = compressor.bypass ? 1 : compressor.ratio;
    compressorNode.attack.value = compressor.attack;
    compressorNode.release.value = compressor.release;

    const makeup = offlineContext.createGain();
    makeup.gain.value = dbToGain(compressor.bypass ? 0 : compressor.makeup);

    const shaper = offlineContext.createWaveShaper();
    shaper.curve = createSaturationCurve(saturation.drive);
    shaper.oversample = "4x";
    const satDry = offlineContext.createGain();
    const satWet = offlineContext.createGain();
    const satSum = offlineContext.createGain();
    const satMix = saturation.bypass ? 0 : clamp(saturation.mix, 0, 1);
    satDry.gain.value = 1 - satMix;
    satWet.gain.value = satMix;

    const stereoSplit = offlineContext.createChannelSplitter(2);
    const stereoMerge = offlineContext.createChannelMerger(2);
    const width = stereo.bypass
      ? 1
      : stereo.mono
        ? 0
        : clamp(stereo.width, 0, 2);
    const widthA = (1 + width) / 2;
    const widthB = (1 - width) / 2;
    const gainLL = offlineContext.createGain();
    const gainRR = offlineContext.createGain();
    const gainLR = offlineContext.createGain();
    const gainRL = offlineContext.createGain();
    gainLL.gain.value = widthA;
    gainRR.gain.value = widthA;
    gainLR.gain.value = widthB;
    gainRL.gain.value = widthB;
    const pan = offlineContext.createStereoPanner();
    pan.pan.value = stereo.bypass ? 0 : clamp(stereo.pan, -1, 1);

    const limiterNode = new AudioWorkletNode(
      offlineContext,
      "limiter-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [decoded.numberOfChannels],
      }
    );
    limiterNode.parameters
      .get("threshold")
      ?.setValueAtTime(limiter.threshold, 0);
    limiterNode.parameters.get("ceiling")?.setValueAtTime(limiter.ceiling, 0);
    limiterNode.parameters.get("release")?.setValueAtTime(limiter.release, 0);
    limiterNode.parameters
      .get("softClip")
      ?.setValueAtTime(limiter.softClip ? 1 : 0, 0);
    limiterNode.parameters
      .get("bypass")
      ?.setValueAtTime(limiter.bypass ? 1 : 0, 0);

    const gain = offlineContext.createGain();
    const trim = output.bypass ? 0 : output.trim;
    gain.gain.value = volume * dbToGain(trim);

    source.connect(sub);
    sub.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(air);
    air.connect(compressorNode);
    compressorNode.connect(makeup);
    makeup.connect(satDry);
    makeup.connect(shaper);
    shaper.connect(satWet);
    satDry.connect(satSum);
    satWet.connect(satSum);
    satSum.connect(stereoSplit);
    stereoSplit.connect(gainLL, 0);
    stereoSplit.connect(gainLR, 0);
    stereoSplit.connect(gainRR, 1);
    stereoSplit.connect(gainRL, 1);
    gainLL.connect(stereoMerge, 0, 0);
    gainRL.connect(stereoMerge, 0, 0);
    gainRR.connect(stereoMerge, 0, 1);
    gainLR.connect(stereoMerge, 0, 1);
    stereoMerge.connect(pan);
    pan.connect(limiterNode);
    limiterNode.connect(gain);
    gain.connect(offlineContext.destination);

    source.start(0);
    const rendered = await offlineContext.startRendering();
    if (normalizeLoudness) {
      const lufs = calcIntegratedLufs(rendered);
      const delta = targetLufs - lufs;
      const normGain = dbToGain(delta);
      applyGainToBuffer(rendered, normGain);
    }
    const wavBlob = audioBufferToWav(rendered);

    const url = URL.createObjectURL(wavBlob);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = url;
    downloadAnchor.download = `Mastered_${track.title || "export"}.wav`;
    downloadAnchor.click();
    URL.revokeObjectURL(url);
  }, [
    compressor,
    currentIndex,
    eq.air,
    eq.high,
    eq.low,
    eq.mid,
    eq.sub,
    limiter,
    normalizeLoudness,
    output,
    playlist,
    saturation,
    stereo,
    targetLufs,
    track.title,
    volume,
  ]);

  const exportViaRecorder = useCallback(async () => {
    const audioEl = audioRef.current;
    const rec = recorderRef.current;
    if (!audioEl || !rec) throw new Error("Recorder not ready.");
    if (!audioEl.src) throw new Error("No audio loaded.");
    if (rec.state === "recording") return;

    await ensureAudioCtxResumed();
    recordedChunksRef.current = [];

    await new Promise<void>((resolve, reject) => {
      if (!rec) return reject(new Error("Recorder unavailable."));
      const prevOnStop = rec.onstop;
      const prevOnError = rec.onerror;

      const cleanup = () => {
        audioEl.removeEventListener("ended", handleEnded);
        rec.onstop = prevOnStop ?? null;
        rec.onerror = prevOnError ?? null;
      };

      const handleEnded = () => {
        if (rec.state === "recording") rec.stop();
      };

      rec.onstop = () => {
        cleanup();
        const mime = rec.mimeType || "audio/webm";
        const blob = new Blob(recordedChunksRef.current, { type: mime });
        recordedChunksRef.current = [];

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Mastered_${track.title || "export"}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        resolve();
        if (prevOnStop) prevOnStop.call(rec, new Event("stop"));
      };

      rec.onerror = () => {
        cleanup();
        reject(new Error("Recorder failed."));
      };

      audioEl.currentTime = 0;
      audioEl.addEventListener("ended", handleEnded, { once: true });
      rec.start();
      audioEl.play().catch(err => {
        cleanup();
        reject(err);
      });
    });
  }, [ensureAudioCtxResumed, track.title]);

  const startExport = useCallback(async () => {
    const audioEl = audioRef.current;
    if (!audioEl) return setError("Audio element missing.");
    if (!audioEl.src) return setError("No audio loaded.");

    setIsExporting(true);
    setError(null);

    try {
      await exportOfflineWav();
    } catch (err) {
      console.warn("Offline export failed, trying recorder fallback:", err);
      try {
        await exportViaRecorder();
      } catch (recErr: unknown) {
        const message =
          recErr instanceof Error ? recErr.message : String(recErr);
        setError(`Export failed: ${message}`);
      }
    } finally {
      setIsExporting(false);
    }
  }, [exportOfflineWav, exportViaRecorder]);

  const teardownAudio = useCallback(() => {
    stopVisualizer();
    const audioEl = audioRef.current;
    if (audioEl) audioEl.pause();

    const disconnect = (node?: AudioNode | null) => {
      if (!node) return;
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    };

    disconnect(sourceRef.current);
    disconnect(analyserRef.current);
    disconnect(vizAnalyserLRef.current);
    disconnect(vizAnalyserRRef.current);
    disconnect(meterRef.current);
    disconnect(compressorRef.current);
    disconnect(compressorMakeupRef.current);
    disconnect(saturationShaperRef.current);
    disconnect(saturationDryGainRef.current);
    disconnect(saturationWetGainRef.current);
    disconnect(saturationSumRef.current);
    disconnect(stereoSplitRef.current);
    disconnect(stereoMergeRef.current);
    disconnect(stereoGainLLRef.current);
    disconnect(stereoGainRRRef.current);
    disconnect(stereoGainLRRef.current);
    disconnect(stereoGainRLRef.current);
    disconnect(stereoPanRef.current);
    disconnect(limiterRef.current);
    disconnect(outputGainRef.current);
    disconnect(vizSplitRef.current);
    disconnect(destRef.current);

    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(err => {
        console.warn("Failed to close AudioContext:", err);
      });
    }

    audioCtxRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    meterRef.current = null;
    compressorRef.current = null;
    compressorMakeupRef.current = null;
    saturationShaperRef.current = null;
    saturationDryGainRef.current = null;
    saturationWetGainRef.current = null;
    saturationSumRef.current = null;
    stereoSplitRef.current = null;
    stereoMergeRef.current = null;
    stereoGainLLRef.current = null;
    stereoGainRRRef.current = null;
    stereoGainLRRef.current = null;
    stereoGainRLRef.current = null;
    stereoPanRef.current = null;
    limiterRef.current = null;
    outputGainRef.current = null;
    vizSplitRef.current = null;
    vizAnalyserLRef.current = null;
    vizAnalyserRRef.current = null;
    destRef.current = null;
    recorderRef.current = null;
    isInitializedRef.current = false;
  }, [stopVisualizer]);

  const initAudio = useCallback(async () => {
    try {
      if (isInitializedRef.current) {
        await ensureAudioCtxResumed();
        if (visualizerActive && !visualizerBlocked) startVisualizer();
        setPlayback(audioRef.current?.paused ? "ready" : "playing");
        return true;
      }

      setPlayback("initializing");
      setError(null);

      const audioEl = audioRef.current;
      if (!audioEl) throw new Error("Audio element not ready.");

      if (!audioCtxRef.current) {
        audioCtxRef.current = createAudioContext();
        await ensureAudioCtxResumed();

        await audioCtxRef.current.audioWorklet.addModule(
          "/worklets/meter-processor.js"
        );
        await audioCtxRef.current.audioWorklet.addModule(
          "/worklets/limiter-processor.js"
        );

        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 1024;
        analyserRef.current.smoothingTimeConstant = 0.8;

        vizAnalyserLRef.current = audioCtxRef.current.createAnalyser();
        vizAnalyserRRef.current = audioCtxRef.current.createAnalyser();
        vizAnalyserLRef.current.fftSize = 512;
        vizAnalyserRRef.current.fftSize = 512;

        meterRef.current = new AudioWorkletNode(
          audioCtxRef.current,
          "meter-processor"
        );
        meterRef.current.port.onmessage = event => {
          if (event.data) setMeter(event.data as MeterState);
        };

        compressorRef.current = audioCtxRef.current.createDynamicsCompressor();
        compressorMakeupRef.current = audioCtxRef.current.createGain();

        saturationShaperRef.current = audioCtxRef.current.createWaveShaper();
        saturationDryGainRef.current = audioCtxRef.current.createGain();
        saturationWetGainRef.current = audioCtxRef.current.createGain();
        saturationSumRef.current = audioCtxRef.current.createGain();

        stereoSplitRef.current = audioCtxRef.current.createChannelSplitter(2);
        stereoMergeRef.current = audioCtxRef.current.createChannelMerger(2);
        stereoGainLLRef.current = audioCtxRef.current.createGain();
        stereoGainRRRef.current = audioCtxRef.current.createGain();
        stereoGainLRRef.current = audioCtxRef.current.createGain();
        stereoGainRLRef.current = audioCtxRef.current.createGain();
        stereoPanRef.current = audioCtxRef.current.createStereoPanner();

        limiterRef.current = new AudioWorkletNode(
          audioCtxRef.current,
          "limiter-processor",
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          }
        );

        outputGainRef.current = audioCtxRef.current.createGain();

        const sub = audioCtxRef.current.createBiquadFilter();
        sub.type = "lowshelf";
        sub.frequency.value = 80;
        sub.gain.value = eq.sub;

        const low = audioCtxRef.current.createBiquadFilter();
        low.type = "peaking";
        low.frequency.value = 250;
        low.Q.value = 0.9;
        low.gain.value = eq.low;

        const mid = audioCtxRef.current.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 1.0;
        mid.gain.value = eq.mid;

        const high = audioCtxRef.current.createBiquadFilter();
        high.type = "peaking";
        high.frequency.value = 4000;
        high.Q.value = 1.1;
        high.gain.value = eq.high;

        const air = audioCtxRef.current.createBiquadFilter();
        air.type = "highshelf";
        air.frequency.value = 12000;
        air.gain.value = eq.air;

        filtersRef.current = { sub, low, mid, high, air };

        sourceRef.current =
          audioCtxRef.current.createMediaElementSource(audioEl);
        sourceRef.current.connect(sub);
        sub.connect(low);
        low.connect(mid);
        mid.connect(high);
        high.connect(air);
        air.connect(compressorRef.current);
        compressorRef.current.connect(compressorMakeupRef.current);
        compressorMakeupRef.current.connect(saturationDryGainRef.current);
        compressorMakeupRef.current.connect(saturationShaperRef.current);
        saturationShaperRef.current.connect(saturationWetGainRef.current);
        saturationDryGainRef.current.connect(saturationSumRef.current);
        saturationWetGainRef.current.connect(saturationSumRef.current);
        saturationSumRef.current.connect(stereoSplitRef.current);

        stereoSplitRef.current.connect(stereoGainLLRef.current, 0);
        stereoSplitRef.current.connect(stereoGainLRRef.current, 0);
        stereoSplitRef.current.connect(stereoGainRRRef.current, 1);
        stereoSplitRef.current.connect(stereoGainRLRef.current, 1);
        stereoGainLLRef.current.connect(stereoMergeRef.current, 0, 0);
        stereoGainRLRef.current.connect(stereoMergeRef.current, 0, 0);
        stereoGainRRRef.current.connect(stereoMergeRef.current, 0, 1);
        stereoGainLRRef.current.connect(stereoMergeRef.current, 0, 1);

        stereoMergeRef.current.connect(stereoPanRef.current);
        stereoPanRef.current.connect(limiterRef.current);
        limiterRef.current.connect(meterRef.current);
        meterRef.current.connect(outputGainRef.current);
        outputGainRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioCtxRef.current.destination);

        vizSplitRef.current = audioCtxRef.current.createChannelSplitter(2);
        outputGainRef.current.connect(vizSplitRef.current);
        vizSplitRef.current.connect(vizAnalyserLRef.current, 0);
        vizSplitRef.current.connect(vizAnalyserRRef.current, 1);

        destRef.current = audioCtxRef.current.createMediaStreamDestination();
        outputGainRef.current.connect(destRef.current);

        if (window.MediaRecorder) {
          recorderRef.current = new MediaRecorder(destRef.current.stream);
          recorderRef.current.ondataavailable = e => {
            if (e.data && e.data.size > 0)
              recordedChunksRef.current.push(e.data);
          };
        }

        // Update visualizer with new analysers
        visualizerRef.current?.setAnalysers(
          analyserRef.current,
          vizAnalyserLRef.current,
          vizAnalyserRRef.current
        );

        isInitializedRef.current = true;
      }

      await ensureAudioCtxResumed();
      if (visualizerActive && !visualizerBlocked) startVisualizer();
      setPlayback(audioEl.paused ? "ready" : "playing");
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to initialize audio: ${message}`);
      setPlayback("error");
      return false;
    }
  }, [
    ensureAudioCtxResumed,
    setPlayback,
    startVisualizer,
    visualizerActive,
    visualizerBlocked,
  ]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const onTime = () => {
      if (!isDragging) {
        setTrack(prev => ({
          ...prev,
          currentTime: audioEl.currentTime || 0,
          duration: Number.isFinite(audioEl.duration)
            ? audioEl.duration
            : prev.duration,
        }));
      }
    };

    const onLoaded = () => {
      setIsLoading(false);
      onTime();
      setPlayback(audioEl.paused ? "ready" : "playing");
      const resumeState = resumeStateRef.current;
      if (
        resumeState &&
        resumeState.currentIndex === currentIndex &&
        Number.isFinite(audioEl.duration)
      ) {
        const safeTime = clamp(resumeState.currentTime, 0, audioEl.duration);
        audioEl.currentTime = safeTime;
        setTrack(prev => ({ ...prev, currentTime: safeTime }));
        resumeStateRef.current = null;
      }
      const item = playlist[currentIndex];
      if (item && Number.isFinite(audioEl.duration)) {
        updatePlaylistItem(item.id, { duration: audioEl.duration });
      }
    };

    const onWaiting = () => setIsLoading(true);
    const onStalled = () => setIsLoading(true);
    const onSeeking = () => setIsLoading(true);
    const onSeeked = () => setIsLoading(false);
    const onErr = () => {
      setError(`Audio error: ${audioEl.error?.message || "Unknown error"}`);
      setPlayback("error");
    };

    const onPlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
      setPlayback("playing");
      ensureAudioCtxResumed();
    };
    const onPause = () => {
      setIsPlaying(false);
      setPlayback("paused");
    };
    const onEnded = () => {
      setIsPlaying(false);
      setPlayback("paused");
      if (playlist.length > 1 && currentIndex < playlist.length - 1) {
        void loadTrackAt(currentIndex + 1, { autoplay: true });
      }
    };

    audioEl.addEventListener("timeupdate", onTime);
    audioEl.addEventListener("loadedmetadata", onTime);
    audioEl.addEventListener("durationchange", onTime);
    audioEl.addEventListener("canplay", onLoaded);
    audioEl.addEventListener("waiting", onWaiting);
    audioEl.addEventListener("stalled", onStalled);
    audioEl.addEventListener("error", onErr);
    audioEl.addEventListener("seeking", onSeeking);
    audioEl.addEventListener("seeked", onSeeked);
    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);
    audioEl.addEventListener("ended", onEnded);

    return () => {
      audioEl.removeEventListener("timeupdate", onTime);
      audioEl.removeEventListener("loadedmetadata", onTime);
      audioEl.removeEventListener("durationchange", onTime);
      audioEl.removeEventListener("canplay", onLoaded);
      audioEl.removeEventListener("waiting", onWaiting);
      audioEl.removeEventListener("stalled", onStalled);
      audioEl.removeEventListener("error", onErr);
      audioEl.removeEventListener("seeking", onSeeking);
      audioEl.removeEventListener("seeked", onSeeked);
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
      audioEl.removeEventListener("ended", onEnded);
    };
  }, [
    currentIndex,
    ensureAudioCtxResumed,
    isDragging,
    loadTrackAt,
    playlist,
    setPlayback,
    updatePlaylistItem,
  ]);

  useEffect(() => {
    const storedA = localStorage.getItem("neon-mastering-preset-A");
    const storedB = localStorage.getItem("neon-mastering-preset-B");
    if (storedA) setPresetA(JSON.parse(storedA) as MasteringPreset);
    if (storedB) setPresetB(JSON.parse(storedB) as MasteringPreset);
  }, []);

  useEffect(() => {
    if (playlist.length === 0) {
      clearStoredPlaylist().catch(err => {
        console.warn("Failed to clear stored playlist:", err);
      });
      return;
    }
    const id = window.setTimeout(() => {
      saveStoredPlaylist(playlist, currentIndex).catch(err => {
        console.warn("Failed to persist playlist:", err);
      });
    }, 800);
    return () => window.clearTimeout(id);
  }, [currentIndex, playlist]);

  useEffect(() => {
    const nextState: ResumeState = {
      currentIndex,
      currentTime: track.currentTime,
      volume,
      isMuted,
    };
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(RESUME_STATE_KEY, JSON.stringify(nextState));
      } catch (err) {
        console.warn("Failed to persist resume state:", err);
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [currentIndex, isMuted, track.currentTime, volume]);

  useEffect(() => {
    const handleResize = () => resizeCanvas();
    window.addEventListener("resize", handleResize);
    resizeCanvas();

    const canvas = vizCanvasRef.current;
    let observer: ResizeObserver | null = null;
    if (canvas && "ResizeObserver" in window) {
      observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(canvas);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, [resizeCanvas]);

  useEffect(() => {
    if (!visualizerActive || visualizerBlocked) {
      stopVisualizer();
      return;
    }

    if (audioCtxRef.current && analyserRef.current) {
      startVisualizer();
    }
  }, [
    startVisualizer,
    stopVisualizer,
    visualizerActive,
    visualizerBlocked,
    vizMode,
  ]);

  useEffect(() => {
    if (!visualizerActive || visualizerBlocked) return;
    if (!isLoading || !isPlaying) return;
    const id = window.setTimeout(() => {
      handleVisualizerAutoDisable();
    }, 4000);
    return () => window.clearTimeout(id);
  }, [
    handleVisualizerAutoDisable,
    isLoading,
    isPlaying,
    visualizerActive,
    visualizerBlocked,
  ]);

  useEffect(() => {
    if (!visualizerActive) {
      setVisualizerBlocked(false);
      visualizerToastRef.current = false;
    }
  }, [visualizerActive]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const resumeOnInteraction = () => {
      void ensureAudioCtxResumed();
    };

    const pauseForBackground = () => {
      if (!audioEl.paused) {
        lastWasPlayingRef.current = true;
        audioEl.pause();
      }
      audioCtxRef.current?.suspend().catch(err => {
        console.warn("Failed to suspend AudioContext:", err);
      });
    };

    const resumeFromBackground = () => {
      void ensureAudioCtxResumed();
      if (lastWasPlayingRef.current) {
        lastWasPlayingRef.current = false;
        audioEl.play().catch(err => {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Playback resume failed: ${message}`);
        });
      }
    };

    const onVisibility = () => {
      if (document.hidden) pauseForBackground();
      else resumeFromBackground();
    };

    window.addEventListener("pointerdown", resumeOnInteraction);
    window.addEventListener("keydown", resumeOnInteraction);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", pauseForBackground);
    window.addEventListener("pageshow", resumeFromBackground);
    window.addEventListener("focus", resumeFromBackground);

    return () => {
      window.removeEventListener("pointerdown", resumeOnInteraction);
      window.removeEventListener("keydown", resumeOnInteraction);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pauseForBackground);
      window.removeEventListener("pageshow", resumeFromBackground);
      window.removeEventListener("focus", resumeFromBackground);
    };
  }, [ensureAudioCtxResumed]);

  useEffect(() => {
    return () => {
      teardownAudio();
      revokePlaylistUrls(playlist);
    };
  }, [playlist, revokePlaylistUrls, teardownAudio]);

  const progressPct = useMemo(() => {
    if (isDragging) return dragProgress;
    if (!track.duration || track.duration <= 0) return 0;
    return clamp((track.currentTime / track.duration) * 100, 0, 100);
  }, [dragProgress, isDragging, track.currentTime, track.duration]);

  const progressNowSeconds = useMemo(() => {
    if (!track.duration) return 0;
    if (!isDragging) return track.currentTime;
    return (dragProgress / 100) * track.duration;
  }, [dragProgress, isDragging, track.currentTime, track.duration]);

  const canPlay = Boolean(audioRef.current?.src);
  const canExport = canPlay && playlist.length > 0 && !isExporting;

  return {
    vizMode,
    setVizMode,
    isLoading,
    isExporting,
    error,
    clearError: () => setError(null),
    isPlaying,
    playbackState,
    visualizerFps,
    activeBand,
    setActiveBand,
    eq,
    compressor,
    limiter,
    saturation,
    stereo,
    output,
    meter,
    volume,
    isMuted,
    track,
    playlist,
    currentIndex,
    isDragging,
    progressPct,
    progressNowSeconds,
    canPlay,
    canExport,
    presetA,
    presetB,
    activePresetSlot,
    gainMatchEnabled,
    normalizeLoudness,
    targetLufs,
    audioRef,
    fileInputRef,
    vizCanvasRef,
    graphEqRef,
    seekRingRef,
    initAudio,
    addFilesToPlaylist,
    handleFile,
    togglePlay,
    prevTrack,
    nextTrack,
    loadTrackAt,
    onRingPointerDown,
    onRingPointerMove,
    onRingPointerUp,
    onRingPointerCancel,
    handleVolumeChange,
    toggleMute,
    startExport,
    applyBandGain,
    resetEq,
    onGraphMouseDown,
    onGraphTouchStart,
    onGraphTouchMove,
    updatePlaylistItem,
    updatePlaylistArtwork,
    movePlaylistItem,
    removePlaylistItems,
    setCompressor,
    setLimiter,
    setSaturation,
    setStereo,
    setOutput,
    setActivePresetSlot,
    setGainMatchEnabled,
    setNormalizeLoudness,
    setTargetLufs,
    storePresetSlot,
    recallPresetSlot,
    exportPresetJson,
    importPresetJson,
  };
};
