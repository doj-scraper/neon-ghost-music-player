import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { parseBlob } from "music-metadata";

export type Phase = "splash" | "boot" | "player";
export type VizMode = "spectrum" | "oscilloscope" | "vectorscope";
export type Band = "low" | "mid" | "high";

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
};

type AudioEngineOptions = {
  visualizerColor: string;
  visualizerActive: boolean;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
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
  duration: 0,
  currentTime: 0,
});

const createAudioContext = () => {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new Ctx();
};

const parseID3Tags = async (file: File): Promise<{ title?: string; artist?: string; album?: string; artwork?: string }> => {
  try {
    const metadata = await parseBlob(file);
    let artworkUrl: string | undefined;

    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      const blob = new Blob([picture.data], { type: picture.format });
      artworkUrl = URL.createObjectURL(blob);
    }

    return {
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album,
      artwork: artworkUrl,
    };
  } catch (err) {
    console.warn("Failed to parse metadata:", err);
    return {};
  }
};

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
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
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

export const useAudioEngine = ({ visualizerColor, visualizerActive }: AudioEngineOptions) => {
  const [vizMode, setVizMode] = useState<VizMode>("spectrum");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeBand, setActiveBand] = useState<Band>("mid");
  const [eq, setEq] = useState<Record<Band, number>>({ low: 0, mid: 0, high: 0 });
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
  const filtersRef = useRef<Record<Band, BiquadFilterNode | null>>({ low: null, mid: null, high: null });
  const vizSplitRef = useRef<ChannelSplitterNode | null>(null);
  const vizAnalyserLRef = useRef<AnalyserNode | null>(null);
  const vizAnalyserRRef = useRef<AnalyserNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const rafRef = useRef<number | null>(null);

  const ensureAudioCtxResumed = useCallback(async () => {
    if (audioCtxRef.current?.state === "suspended") {
      try {
        await audioCtxRef.current.resume();
      } catch (err) {
        console.warn("Failed to resume AudioContext:", err);
      }
    }
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = vizCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }, []);

  const stopVisualizer = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startVisualizer = useCallback(() => {
    stopVisualizer();

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const analyser = analyserRef.current;
      const canvas = vizCanvasRef.current;
      if (!canvas) return;

      resizeCanvas();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);

      if (!analyser) return;
      const len = analyser.frequencyBinCount;
      const data = new Uint8Array(len);

      if (vizMode === "spectrum") {
        analyser.getByteFrequencyData(data);
        const barCount = Math.max(24, Math.floor(w / 10));
        const minFreq = 20;
        const maxFreq = (audioCtxRef.current?.sampleRate ?? 44100) / 2;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);

        const barWidth = w / barCount;
        for (let i = 0; i < barCount; i += 1) {
          const t = i / (barCount - 1);
          const freq = Math.pow(10, logMin + t * (logMax - logMin));
          const idx = Math.min(len - 1, Math.floor((freq / maxFreq) * len));
          const amp = data[idx] / 255;
          const barHeight = amp * h;
          const alpha = Math.max(0.2, amp);
          ctx.fillStyle = `rgba(${visualizerColor},${alpha})`;
          ctx.fillRect(i * barWidth + 1, h - barHeight, Math.max(1, barWidth - 2), barHeight);
        }
      } else if (vizMode === "oscilloscope") {
        analyser.getByteTimeDomainData(data);

        ctx.beginPath();
        ctx.strokeStyle = `rgba(${visualizerColor},0.95)`;
        ctx.lineWidth = Math.max(1, Math.floor(w / 450));

        const slice = w / len;
        let x = 0;
        for (let i = 0; i < len; i += 1) {
          const v = data[i] / 128 - 1;
          const y = h / 2 + v * (h * 0.35);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += slice;
        }
        ctx.stroke();
      } else {
        const analyserL = vizAnalyserLRef.current;
        const analyserR = vizAnalyserRRef.current;
        if (!analyserL || !analyserR) return;
        const dataL = new Uint8Array(analyserL.fftSize);
        const dataR = new Uint8Array(analyserR.fftSize);
        analyserL.getByteTimeDomainData(dataL);
        analyserR.getByteTimeDomainData(dataR);

        ctx.beginPath();
        ctx.strokeStyle = `rgba(${visualizerColor},0.95)`;
        ctx.lineWidth = Math.max(1, Math.floor(w / 500));

        for (let i = 0; i < dataL.length; i += 1) {
          const x = ((dataL[i] / 128 - 1) * 0.45 + 0.5) * w;
          const y = ((dataR[i] / 128 - 1) * 0.45 + 0.5) * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };

    loop();
  }, [resizeCanvas, stopVisualizer, visualizerColor, vizMode]);

  const applyBandGain = useCallback((band: Band, gainDb: number) => {
    const g = clamp(gainDb, -24, 24);
    setActiveBand(band);
    setEq((prev) => ({ ...prev, [band]: g }));
    const node = filtersRef.current[band];
    if (node) node.gain.value = g;
  }, []);

  useEffect(() => {
    const { low, mid, high } = filtersRef.current;
    if (low) low.gain.value = eq.low;
    if (mid) mid.gain.value = eq.mid;
    if (high) high.gain.value = eq.high;
  }, [eq.high, eq.low, eq.mid]);

  const resetEq = useCallback(() => {
    (['low', 'mid', 'high'] as Band[]).forEach((band) => applyBandGain(band, 0));
  }, [applyBandGain]);

  const handleGraphDrag = useCallback(
    (clientX: number, clientY: number) => {
      const surface = graphEqRef.current;
      if (!surface) return;

      const rect = surface.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;

      let band: Band = "mid";
      if (x < 0.33) band = "low";
      else if (x > 0.66) band = "high";

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
      setCurrentIndex(index);

      audioEl.src = item.url;
      audioEl.load();

      setTrack(buildTrackState(item));
      setIsPlaying(false);

      if (opts?.autoplay) {
        try {
          await ensureAudioCtxResumed();
          await audioEl.play();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Playback failed: ${message}`);
        }
      }
    },
    [ensureAudioCtxResumed, playlist]
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

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const audioEl = audioRef.current;
    if (files.length === 0 || !audioEl) return;

    setError(null);
    setIsLoading(true);

    setIsPlaying(false);
    setCurrentIndex(0);

    revokePlaylistUrls(playlist);

    const nextItems: PlaylistItem[] = [];
    for (const file of files) {
      const url = URL.createObjectURL(file);

      let title = file.name.replace(/\.[^/.]+$/, "");
      let artist = "Unknown Artist";
      let album = "";
      let artwork: string | null = null;

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
      } catch {
        // ignore
      }

      nextItems.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        url,
        title,
        artist,
        album,
        artwork,
      });
    }

    setPlaylist(nextItems);

    const first = nextItems[0];
    if (first) {
      audioEl.src = first.url;
      audioEl.load();
      setTrack(buildTrackState(first));
    }

    e.target.value = "";
  }, [playlist, revokePlaylistUrls]);

  const togglePlay = useCallback(async () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

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
      if (!track.duration) return;
      const pct = clamp(p, 0, 1);
      setDragProgress(pct * 100);
      if (!commit) return;
      if (!audioEl) return;
      const newTime = pct * track.duration;
      audioEl.currentTime = newTime;
      setTrack((prev) => ({ ...prev, currentTime: newTime }));
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
    node.gain.value = base * dbToGain(trim + gainMatch);
  }, [gainMatchEnabled, gainMatchOffset, gainRef, isMuted, output.bypass, output.trim, volume]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    const clampedVolume = clamp(newVolume, 0, 1);
    setVolume(clampedVolume);
    setIsMuted(clampedVolume === 0);
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      const restoreVolume = previousVolumeRef.current > 0 ? previousVolumeRef.current : 1;
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
      compressorMakeupRef.current.gain.value = dbToGain(compressor.bypass ? 0 : compressor.makeup);
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
    const width = stereo.bypass ? 1 : stereo.mono ? 0 : clamp(stereo.width, 0, 2);
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
    node.parameters.get("threshold")?.setValueAtTime(limiter.threshold, node.context.currentTime);
    node.parameters.get("ceiling")?.setValueAtTime(limiter.ceiling, node.context.currentTime);
    node.parameters.get("release")?.setValueAtTime(limiter.release, node.context.currentTime);
    node.parameters.get("softClip")?.setValueAtTime(limiter.softClip ? 1 : 0, node.context.currentTime);
    node.parameters.get("bypass")?.setValueAtTime(limiter.bypass ? 1 : 0, node.context.currentTime);
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
    setEq(preset.eq);
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
      localStorage.setItem(`neon-mastering-preset-${slot}`, JSON.stringify(preset));
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
    [activePresetSlot, applyPreset, gainMatchEnabled, meter.lufsIntegrated, presetA, presetB]
  );

  const exportPresetJson = useCallback(() => {
    const preset = buildPreset(`Preset ${activePresetSlot}`);
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
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
      if (!parsed.eq || !parsed.compressor || !parsed.limiter) throw new Error("Invalid preset file.");
      applyPreset(parsed);
      if (activePresetSlot === "A") setPresetA(parsed);
      else setPresetB(parsed);
      localStorage.setItem(`neon-mastering-preset-${activePresetSlot}`, JSON.stringify(parsed));
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

    const offlineContext = new OfflineAudioContext(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
    await offlineContext.audioWorklet.addModule("/worklets/limiter-processor.js");
    const source = offlineContext.createBufferSource();
    source.buffer = decoded;

    const low = offlineContext.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 250;
    low.gain.value = eq.low;

    const mid = offlineContext.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 1.0;
    mid.gain.value = eq.mid;

    const high = offlineContext.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 5000;
    high.gain.value = eq.high;

    const compressorNode = offlineContext.createDynamicsCompressor();
    compressorNode.threshold.value = compressor.bypass ? 0 : compressor.threshold;
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
    const width = stereo.bypass ? 1 : stereo.mono ? 0 : clamp(stereo.width, 0, 2);
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

    const limiterNode = new AudioWorkletNode(offlineContext, "limiter-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [decoded.numberOfChannels],
    });
    limiterNode.parameters.get("threshold")?.setValueAtTime(limiter.threshold, 0);
    limiterNode.parameters.get("ceiling")?.setValueAtTime(limiter.ceiling, 0);
    limiterNode.parameters.get("release")?.setValueAtTime(limiter.release, 0);
    limiterNode.parameters.get("softClip")?.setValueAtTime(limiter.softClip ? 1 : 0, 0);
    limiterNode.parameters.get("bypass")?.setValueAtTime(limiter.bypass ? 1 : 0, 0);

    const gain = offlineContext.createGain();
    const trim = output.bypass ? 0 : output.trim;
    gain.gain.value = volume * dbToGain(trim);

    source.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(compressorNode);
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
    eq.high,
    eq.low,
    eq.mid,
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
      audioEl.play().catch((err) => {
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
        const message = recErr instanceof Error ? recErr.message : String(recErr);
        setError(`Export failed: ${message}`);
      }
    } finally {
      setIsExporting(false);
    }
  }, [exportOfflineWav, exportViaRecorder]);

  const initAudio = useCallback(async () => {
    try {
      setError(null);

      const audioEl = audioRef.current;
      if (!audioEl) throw new Error("Audio element not ready.");

      if (!audioCtxRef.current) {
        audioCtxRef.current = createAudioContext();
        await ensureAudioCtxResumed();

        await audioCtxRef.current.audioWorklet.addModule("/worklets/meter-processor.js");
        await audioCtxRef.current.audioWorklet.addModule("/worklets/limiter-processor.js");

        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 1024;
        analyserRef.current.smoothingTimeConstant = 0.8;

        vizAnalyserLRef.current = audioCtxRef.current.createAnalyser();
        vizAnalyserRRef.current = audioCtxRef.current.createAnalyser();
        vizAnalyserLRef.current.fftSize = 512;
        vizAnalyserRRef.current.fftSize = 512;

        meterRef.current = new AudioWorkletNode(audioCtxRef.current, "meter-processor");
        meterRef.current.port.onmessage = (event) => {
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

        limiterRef.current = new AudioWorkletNode(audioCtxRef.current, "limiter-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });

        outputGainRef.current = audioCtxRef.current.createGain();

        const low = audioCtxRef.current.createBiquadFilter();
        low.type = "lowshelf";
        low.frequency.value = 250;

        const mid = audioCtxRef.current.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 1.0;

        const high = audioCtxRef.current.createBiquadFilter();
        high.type = "highshelf";
        high.frequency.value = 5000;

        filtersRef.current = { low, mid, high };

        sourceRef.current = audioCtxRef.current.createMediaElementSource(audioEl);
        sourceRef.current.connect(low);
        low.connect(mid);
        mid.connect(high);
        high.connect(compressorRef.current);
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
          recorderRef.current.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
          };
        }
      }

      await ensureAudioCtxResumed();
      if (visualizerActive) startVisualizer();
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to initialize audio: ${message}`);
      return false;
    }
  }, [ensureAudioCtxResumed, startVisualizer, visualizerActive, volume]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const onTime = () => {
      if (!isDragging) {
        setTrack((prev) => ({
          ...prev,
          currentTime: audioEl.currentTime || 0,
          duration: Number.isFinite(audioEl.duration) ? audioEl.duration : prev.duration,
        }));
      }
    };

    const onLoaded = () => {
      setIsLoading(false);
      onTime();
    };

    const onWaiting = () => setIsLoading(true);
    const onErr = () => setError(`Audio error: ${audioEl.error?.message || "Unknown error"}`);

    const onPlay = () => {
      setIsPlaying(true);
      ensureAudioCtxResumed();
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      if (playlist.length > 1 && currentIndex < playlist.length - 1) {
        void loadTrackAt(currentIndex + 1, { autoplay: true });
      }
    };

    audioEl.addEventListener("timeupdate", onTime);
    audioEl.addEventListener("loadedmetadata", onTime);
    audioEl.addEventListener("durationchange", onTime);
    audioEl.addEventListener("canplay", onLoaded);
    audioEl.addEventListener("waiting", onWaiting);
    audioEl.addEventListener("error", onErr);
    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);
    audioEl.addEventListener("ended", onEnded);

    return () => {
      audioEl.removeEventListener("timeupdate", onTime);
      audioEl.removeEventListener("loadedmetadata", onTime);
      audioEl.removeEventListener("durationchange", onTime);
      audioEl.removeEventListener("canplay", onLoaded);
      audioEl.removeEventListener("waiting", onWaiting);
      audioEl.removeEventListener("error", onErr);
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
      audioEl.removeEventListener("ended", onEnded);
    };
  }, [currentIndex, ensureAudioCtxResumed, isDragging, loadTrackAt, playlist.length]);

  useEffect(() => {
    const storedA = localStorage.getItem("neon-mastering-preset-A");
    const storedB = localStorage.getItem("neon-mastering-preset-B");
    if (storedA) setPresetA(JSON.parse(storedA) as MasteringPreset);
    if (storedB) setPresetB(JSON.parse(storedB) as MasteringPreset);
  }, []);

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
    if (!visualizerActive) {
      stopVisualizer();
      return;
    }

    if (audioCtxRef.current && analyserRef.current) {
      startVisualizer();
    }
  }, [startVisualizer, stopVisualizer, visualizerActive, vizMode]);

  useEffect(() => {
    const resumeOnInteraction = () => {
      void ensureAudioCtxResumed();
    };
    const onVisibility = () => {
      if (!document.hidden) resumeOnInteraction();
    };

    window.addEventListener("pointerdown", resumeOnInteraction);
    window.addEventListener("keydown", resumeOnInteraction);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pointerdown", resumeOnInteraction);
      window.removeEventListener("keydown", resumeOnInteraction);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ensureAudioCtxResumed]);

  useEffect(() => {
    return () => {
      stopVisualizer();
      revokePlaylistUrls(playlist);
    };
  }, [playlist, revokePlaylistUrls, stopVisualizer]);

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
