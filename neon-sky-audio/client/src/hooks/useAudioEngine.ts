import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { parseBlob } from "music-metadata";

export type Phase = "splash" | "boot" | "player";
export type VizMode = "bars" | "wave";
export type Band = "low" | "mid" | "high";

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

export const useAudioEngine = ({ visualizerColor, visualizerActive }: AudioEngineOptions) => {
  const [vizMode, setVizMode] = useState<VizMode>("bars");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeBand, setActiveBand] = useState<Band>("mid");
  const [eq, setEq] = useState<Record<Band, number>>({ low: 0, mid: 0, high: 0 });
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

  const previousVolumeRef = useRef(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphEqRef = useRef<HTMLDivElement | null>(null);
  const seekRingRef = useRef<HTMLDivElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const filtersRef = useRef<Record<Band, BiquadFilterNode | null>>({ low: null, mid: null, high: null });
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
      if (!analyser || !canvas) return;

      resizeCanvas();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);

      const len = analyser.frequencyBinCount;
      const data = new Uint8Array(len);

      if (vizMode === "bars") {
        analyser.getByteFrequencyData(data);

        const barWidth = Math.max(1, Math.floor((w / len) * 2.2));
        let x = 0;

        for (let i = 0; i < len; i += 1) {
          const amp = data[i] / 255;
          const barHeight = amp * h;
          const alpha = Math.max(0.18, amp);
          ctx.fillStyle = `rgba(${visualizerColor},${alpha})`;
          ctx.fillRect(x, h - barHeight, barWidth, barHeight);
          x += barWidth + 1;
          if (x > w) break;
        }
      } else {
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

  const handleVolumeChange = useCallback((newVolume: number) => {
    const clampedVolume = clamp(newVolume, 0, 1);
    setVolume(clampedVolume);
    setIsMuted(clampedVolume === 0);

    if (gainRef.current) {
      gainRef.current.gain.value = clampedVolume;
    }
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

  const exportOfflineWav = useCallback(async () => {
    const item = playlist[currentIndex];
    if (!item) throw new Error("No track selected for export.");

    const arrayBuffer = await item.file.arrayBuffer();
    const decodeContext = createAudioContext();
    const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
    await decodeContext.close();

    const offlineContext = new OfflineAudioContext(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
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

    const gain = offlineContext.createGain();
    gain.gain.value = volume;

    source.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(gain);
    gain.connect(offlineContext.destination);

    source.start(0);
    const rendered = await offlineContext.startRendering();
    const wavBlob = audioBufferToWav(rendered);

    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mastered_${track.title || "export"}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentIndex, eq.high, eq.low, eq.mid, playlist, track.title, volume]);

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

        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 512;
        analyserRef.current.smoothingTimeConstant = 0.8;

        gainRef.current = audioCtxRef.current.createGain();
        gainRef.current.gain.value = volume;

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
        high.connect(gainRef.current);
        gainRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioCtxRef.current.destination);

        destRef.current = audioCtxRef.current.createMediaStreamDestination();
        gainRef.current.connect(destRef.current);

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
  };
};
