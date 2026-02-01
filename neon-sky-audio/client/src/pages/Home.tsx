/**
 * NEON SKY Audio Mastering VM v3.5
 * Design: Liquid Neon Glassmorphism
 * - Frosted glass surfaces with deep blur effects
 * - Luminous neon cyan accents that appear to glow
 * - Animated tie-dye background with continuous hue rotation
 * - Monospace typography with wide tracking
 * - Mobile-first responsive design
 * 
 * Safari/iOS Compatibility Notes:
 * - AudioContext must be created/resumed on user gesture
 * - Visualizer uses requestAnimationFrame with fallback
 * - Touch events handled for mobile seek
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Disc,
  Download,
  ListMusic,
  Music,
  Pause,
  Play,
  Settings,
  SkipBack,
  SkipForward,
  Terminal,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { parseBlob } from "music-metadata";

type Phase = "splash" | "boot" | "player";
type VizMode = "bars" | "wave";
type Band = "low" | "mid" | "high";

type TrackState = {
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  duration: number;
  currentTime: number;
};

type PlaylistItem = {
  id: string;
  file: File;
  url: string;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
};

const NEON = {
  hex: "#bc13fe", // cyberpunk purple
  rgba: "188,19,254",
} as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const cx = (...parts: Array<string | false | undefined | null>) => parts.filter(Boolean).join(" ");

const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// Parse ID3 metadata using music-metadata
const parseID3Tags = async (file: File): Promise<{ title?: string; artist?: string; album?: string; artwork?: string }> => {
  try {
    const metadata = await parseBlob(file);
    let artworkUrl: string | undefined;

    // Extract artwork if present
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

export default function Home() {
  // -------- App/UI State --------
  const [phase, setPhase] = useState<Phase>("splash");
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [vizMode, setVizMode] = useState<VizMode>("bars");

  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [activeBand, setActiveBand] = useState<Band>("mid");
  const [eq, setEq] = useState<Record<Band, number>>({ low: 0, mid: 0, high: 0 });

  // Volume state
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const previousVolumeRef = useRef(1);

  // Seek dragging state (ring)
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);

  // Playlist
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);

  const [track, setTrack] = useState<TrackState>({
    title: "NO_TRACK_LOADED",
    artist: "NEON_SKY_OS",
    album: "",
    artwork: null,
    duration: 0,
    currentTime: 0,
  });

  // -------- DOM refs (PERSISTENT) --------
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphEqRef = useRef<HTMLDivElement | null>(null);
  const seekRingRef = useRef<HTMLDivElement | null>(null);

  // -------- WebAudio refs --------
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const filtersRef = useRef<Record<Band, BiquadFilterNode | null>>({ low: null, mid: null, high: null });

  // Export/Recorder
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);

  // Visualizer loop
  const rafRef = useRef<number | null>(null);

  // Object URL cleanup handled via playlist items

  // iOS/Safari detection
  const isIOSRef = useRef(false);
  useEffect(() => {
    isIOSRef.current = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }, []);

  // -------- Phase timing --------
  useEffect(() => {
    const t = window.setTimeout(() => setPhase("boot"), 2000);
    return () => window.clearTimeout(t);
  }, []);

  // -------- Canvas DPR sizing --------
  const resizeCanvas = useCallback(() => {
    const canvas = vizCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  // -------- Ensure AudioContext resumes on iOS/Safari --------
  const ensureAudioCtxResumed = useCallback(async () => {
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === "suspended") {
        try {
          await audioCtxRef.current.resume();
        } catch (err) {
          console.warn("Failed to resume AudioContext:", err);
        }
      }
    }
  }, []);

  // -------- Core init (creates graph ONCE, bound to persistent audio el) --------
  const initAudio = useCallback(async () => {
    try {
      setError(null);

      const audioEl = audioRef.current;
      if (!audioEl) throw new Error("Audio element not ready.");

      // For iOS/Safari: AudioContext must be created in response to user gesture
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctx();

        // Immediately try to resume for iOS
        if (audioCtxRef.current.state === "suspended") {
          await audioCtxRef.current.resume();
        }

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

        // Critical: this must be called only once for this exact audio element instance.
        sourceRef.current = audioCtxRef.current.createMediaElementSource(audioEl);

        sourceRef.current.connect(low);
        low.connect(mid);
        mid.connect(high);
        high.connect(gainRef.current);
        gainRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioCtxRef.current.destination);

        // Export tap post-chain
        destRef.current = audioCtxRef.current.createMediaStreamDestination();
        gainRef.current.connect(destRef.current);

        recorderRef.current = new MediaRecorder(destRef.current.stream);
        recorderRef.current.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        recorderRef.current.onstop = () => {
          const mime = recorderRef.current?.mimeType || "audio/webm";
          const blob = new Blob(recordedChunksRef.current, { type: mime });
          recordedChunksRef.current = [];

          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `Mastered_${track.title || "export"}.webm`;
          a.click();
          URL.revokeObjectURL(url);

          setIsExporting(false);
        };
      }

      await ensureAudioCtxResumed();

      setPhase("player");
      startVisualizer();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to initialize audio: ${message}`);
    }
  }, [ensureAudioCtxResumed, startVisualizer, track.title, volume]);

  // -------- Playlist helpers --------
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

      setTrack((prev) => ({
        ...prev,
        title: item.title,
        artist: item.artist,
        album: item.album,
        artwork: item.artwork,
        currentTime: 0,
        duration: 0,
      }));

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

  // -------- Audio event syncing --------
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
      // Ensure AudioContext is running when playback starts (iOS fix)
      ensureAudioCtxResumed();
    };
    const onPause = () => setIsPlaying(false);

    const onEnded = () => {
      setIsPlaying(false);
      if (isExporting && recorderRef.current?.state === "recording") recorderRef.current.stop();

      // Auto-advance playlist (non-looping)
      if (playlist.length > 1 && currentIndex < playlist.length - 1) {
        // Next track: autoplay
        void loadTrackAt(currentIndex + 1, { autoplay: true });
      }
    };

    audioEl.addEventListener("timeupdate", onTime);
    audioEl.addEventListener("loadedmetadata", onTime);
    audioEl.addEventListener("canplay", onLoaded);
    audioEl.addEventListener("waiting", onWaiting);
    audioEl.addEventListener("error", onErr);
    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);
    audioEl.addEventListener("ended", onEnded);

    return () => {
      audioEl.removeEventListener("timeupdate", onTime);
      audioEl.removeEventListener("loadedmetadata", onTime);
      audioEl.removeEventListener("canplay", onLoaded);
      audioEl.removeEventListener("waiting", onWaiting);
      audioEl.removeEventListener("error", onErr);
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
      audioEl.removeEventListener("ended", onEnded);
    };
  }, [isExporting, isDragging, ensureAudioCtxResumed, playlist.length, currentIndex, loadTrackAt]);

  // -------- Load file with ID3 metadata extraction --------
  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const audioEl = audioRef.current;
    if (files.length === 0 || !audioEl) return;

    setError(null);
    setIsLoading(true);

    // Replace playlist with new selection (simplest, predictable UX)
    setIsPlaying(false);
    setCurrentIndex(0);

    // Revoke previous playlist URLs
    revokePlaylistUrls(playlist);

    const nextItems: PlaylistItem[] = [];
    for (const file of files) {
      const url = URL.createObjectURL(file);

      // Default values from filename
      let title = file.name.replace(/\.[^/.]+$/, "");
      let artist = "Unknown Artist";
      let album = "";
      let artwork: string | null = null;

      // Check for "Artist - Title" format in filename
      const dashMatch = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (dashMatch) {
        artist = dashMatch[1].trim();
        title = dashMatch[2].trim();
      }

      // Try to extract ID3 metadata
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

    // Load first track (no autoplay)
    const first = nextItems[0];
    if (first) {
      audioEl.src = first.url;
      audioEl.load();
      setTrack((prev) => ({
        ...prev,
        title: first.title,
        artist: first.artist,
        album: first.album,
        artwork: first.artwork,
        currentTime: 0,
        duration: 0,
      }));
    }
    
    // Reset file input so same file can be loaded again
    e.target.value = "";
  }, [playlist, revokePlaylistUrls]);

  // -------- Play toggle with iOS fix --------
  const togglePlay = useCallback(async () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    try {
      // Always ensure AudioContext is resumed on user interaction (iOS requirement)
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

  // -------- Circular seek ring (touch + mouse via Pointer Events) --------
  const calcRingProgress = useCallback((clientX: number, clientY: number) => {
    const el = seekRingRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const cx0 = rect.left + rect.width / 2;
    const cy0 = rect.top + rect.height / 2;
    const dx = clientX - cx0;
    const dy = clientY - cy0;

    // Angle where 0 is at top, increasing clockwise.
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
      setIsDragging(false);
    },
    [calcRingProgress, isDragging, ringSeekTo]
  );

  // -------- Volume control --------
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

  // -------- Export bounce --------
  const startExport = useCallback(async () => {
    const audioEl = audioRef.current;
    const rec = recorderRef.current;

    if (!audioEl) return setError("Audio element missing.");
    if (!rec) return setError("Recorder not ready. Initialize Core first.");
    if (!audioEl.src) return setError("No audio loaded.");
    if (rec.state === "recording") return;

    try {
      await ensureAudioCtxResumed();
      setError(null);

      setIsExporting(true);
      recordedChunksRef.current = [];

      audioEl.currentTime = 0;
      rec.start();
      await audioEl.play();
    } catch (err: unknown) {
      setIsExporting(false);
      const message = err instanceof Error ? err.message : String(err);
      setError(`Export failed: ${message}`);
    }
  }, [ensureAudioCtxResumed]);

  // -------- EQ --------
  const applyBandGain = useCallback((band: Band, gainDb: number) => {
    const g = clamp(gainDb, -24, 24);
    setActiveBand(band);
    setEq((prev) => ({ ...prev, [band]: g }));
    const node = filtersRef.current[band];
    if (node) node.gain.value = g;
  }, []);

  const resetEq = useCallback(() => {
    (["low", "mid", "high"] as Band[]).forEach((b) => applyBandGain(b, 0));
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

  // -------- Visualizer with iOS compatibility --------
  const startVisualizer = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

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

      ctx.clearRect(0, 0, w, h);

      const len = analyser.frequencyBinCount;
      const data = new Uint8Array(len);

      if (vizMode === "bars") {
        analyser.getByteFrequencyData(data);

        const barWidth = Math.max(1, Math.floor((w / len) * 2.2));
        let x = 0;

        for (let i = 0; i < len; i++) {
          const amp = data[i] / 255;
          const barHeight = amp * h;
          const alpha = Math.max(0.18, amp);
          ctx.fillStyle = `rgba(${NEON.rgba},${alpha})`;
          ctx.fillRect(x, h - barHeight, barWidth, barHeight);
          x += barWidth + 1;
          if (x > w) break;
        }
      } else {
        analyser.getByteTimeDomainData(data);

        ctx.beginPath();
        ctx.strokeStyle = `rgba(${NEON.rgba},0.95)`;
        ctx.lineWidth = Math.max(1, Math.floor(w / 450));

        const slice = w / len;
        let x = 0;
        for (let i = 0; i < len; i++) {
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
  }, [resizeCanvas, vizMode]);

  useEffect(() => {
    if (phase === "player") startVisualizer();
  }, [phase, vizMode, startVisualizer]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      revokePlaylistUrls(playlist);
    };
  }, [playlist, revokePlaylistUrls]);

  // -------- Derived UI --------
  const progressPct = useMemo(() => {
    if (isDragging) return dragProgress;
    if (!track.duration || track.duration <= 0) return 0;
    return clamp((track.currentTime / track.duration) * 100, 0, 100);
  }, [track.currentTime, track.duration, isDragging, dragProgress]);

  const progressNowSeconds = useMemo(() => {
    if (!track.duration) return 0;
    if (!isDragging) return track.currentTime;
    return (dragProgress / 100) * track.duration;
  }, [dragProgress, isDragging, track.currentTime, track.duration]);

  const canPlay = Boolean(audioRef.current?.src);
  const canExport = canPlay && Boolean(recorderRef.current);

  // -------- Styles --------
  const bgStyle = useMemo(
    () => ({
      background: `radial-gradient(circle at 50% 50%, ${NEON.hex}, #6d28d9, #ff00ff, #050505)`,
      backgroundSize: "400% 400%",
    }),
    []
  );

  // -------- Render --------
  return (
    <div className="min-h-screen min-h-[100dvh] bg-black text-white font-mono selection:bg-cyan-500 selection:text-black relative overflow-hidden">
      {/* Persistent elements (never unmount) */}
      <audio ref={audioRef} className="hidden" playsInline crossOrigin="anonymous" />
      <input ref={fileInputRef} type="file" className="hidden" accept="audio/*" multiple onChange={handleFile} />

      <div className="fixed inset-0 pointer-events-none opacity-25 z-0">
        <div className="absolute inset-0 animate-tie-dye" style={bgStyle} />
        <div className="absolute inset-0 backdrop-blur-[110px]" />
      </div>

      {error && (
        <div className="fixed top-4 left-4 right-4 z-[60] max-w-2xl mx-auto rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-xl p-3 flex items-start justify-between gap-3">
          <div className="text-xs sm:text-sm text-red-200">{error}</div>
          <button onClick={() => setError(null)} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition flex-shrink-0" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}

      {/* SPLASH */}
      {phase === "splash" && (
        <div className="fixed inset-0 bg-black flex items-center justify-center z-50 overflow-hidden px-4">
          <div className="absolute inset-0 bg-gradient-to-tr from-purple-900/20 via-black to-fuchsia-900/20 animate-pulse" />
          <div className="relative flex flex-col items-center">
            <div className="w-24 h-24 sm:w-32 sm:h-32 mb-6 sm:mb-8 relative">
              <div className="absolute inset-0 border-4 border-cyan-500 rounded-full animate-ping opacity-25" />
              <div className="absolute inset-0 border-t-4 border-cyan-400 rounded-full animate-spin" />
              <Disc className="absolute inset-0 m-auto text-white" size={36} />
            </div>
            <h1 className="text-4xl sm:text-6xl font-black tracking-tighter text-white text-center">NEON SKY</h1>
            <p className="text-fuchsia-300/60 font-mono tracking-widest text-[10px] sm:text-xs mt-2 uppercase text-center">Audio Mastering VM v3.5</p>
          </div>
        </div>
      )}

      {/* BOOT */}
      {phase === "boot" && (
        <div className="fixed inset-0 bg-black text-green-500 font-mono p-4 sm:p-8 text-xs sm:text-base leading-relaxed flex flex-col z-40">
          <div className="flex-1 space-y-1 sm:space-y-2 overflow-hidden">
            {[
              "INITIALIZING_CORE_SERVICES... OK",
              "SCANNING_DSP_HARDWARE... [3-BAND_EQ_DETECTED]",
              "MOUNTING_ID3_METADATA_MODULE... OK",
              "CALIBRATING_WAVEFORM_ANALYSER... OK",
              "SYNCING_MASTER_CLOCK... OK",
              "---------------------------------------",
              "READY_FOR_OPERATOR_INPUT.",
            ].map((m, i) => (
              <div key={i} className="animate-in fade-in slide-in-from-left-4 duration-300 break-all sm:break-normal" style={{ animationDelay: `${i * 160}ms` }}>
                {">"} {m}
              </div>
            ))}
            <div className="animate-pulse mt-4 sm:mt-8">_ AWAITING_SYSTEM_INIT</div>
          </div>

          <button
            onClick={initAudio}
            className="w-full py-4 sm:py-6 border-2 border-green-500 text-green-500 font-bold hover:bg-green-500 hover:text-black transition-all uppercase tracking-[0.2em] sm:tracking-[0.3em] text-sm sm:text-base active:scale-[0.98]"
          >
            Initialize Core
          </button>
        </div>
      )}

      {/* PLAYER */}
      {phase === "player" && (
        <>
          <main className="relative z-10 flex flex-col items-center justify-center min-h-screen min-h-[100dvh] p-3 sm:p-6">
            <div className="w-full max-w-[340px] sm:max-w-sm bg-zinc-900/60 backdrop-blur-3xl border border-white/10 rounded-[2rem] sm:rounded-[3rem] p-5 sm:p-8 shadow-2xl flex flex-col items-center gap-4 sm:gap-5">
              
              {/* Artwork Display */}
              <div className="relative w-28 h-28 sm:w-36 sm:h-36 rounded-2xl overflow-hidden bg-zinc-800/50 border border-white/10 flex items-center justify-center flex-shrink-0">
                {track.artwork ? (
                  <img 
                    src={track.artwork} 
                    alt="Album artwork" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Music className="text-white/20" size={40} />
                )}
                {isPlaying && (
                  <div className="absolute inset-0 bg-cyan-500/10 animate-pulse" />
                )}
              </div>

              {/* Track Info */}
              <div className="text-center w-full px-2">
                <span className="text-[8px] sm:text-[10px] text-cyan-400 tracking-[0.4em] sm:tracking-[0.5em] uppercase font-bold">Now Playing</span>
                <h2 className="text-sm sm:text-lg font-bold truncate mt-1">{track.title}</h2>
                <p className="text-[10px] sm:text-xs text-zinc-400 truncate">{track.artist}</p>
                {track.album && (
                  <p className="text-[9px] sm:text-[10px] text-zinc-500 truncate mt-0.5">{track.album}</p>
                )}
              </div>

              {/* Visualizer */}
              <div className="relative w-full h-20 sm:h-28 flex items-center justify-center">
                <canvas ref={vizCanvasRef} className="absolute inset-0 w-full h-full rounded-xl opacity-80" />
                <div className={cx("absolute inset-0 rounded-xl border border-white/10", isPlaying && "animate-pulse")} />
              </div>

              {/* Transport + Circular progress (touch to seek) */}
              <div className="w-full flex items-center justify-center gap-4">
                <button
                  onClick={prevTrack}
                  disabled={playlist.length <= 1 || currentIndex === 0}
                  className={cx(
                    "w-10 h-10 rounded-xl flex items-center justify-center border transition-all active:scale-95",
                    playlist.length > 1 && currentIndex > 0
                      ? "border-white/10 bg-white/5 hover:bg-white/10 text-white"
                      : "border-white/5 bg-white/5 text-white/30 cursor-not-allowed"
                  )}
                  aria-label="Previous track"
                >
                  <SkipBack size={18} />
                </button>

                <div
                  ref={seekRingRef}
                  onPointerDown={onRingPointerDown}
                  onPointerMove={onRingPointerMove}
                  onPointerUp={onRingPointerUp}
                  className={cx(
                    "relative w-24 h-24 sm:w-28 sm:h-28 select-none touch-none",
                    track.duration ? "cursor-pointer" : "cursor-default"
                  )}
                  aria-label="Seek ring"
                >
                  <svg className="absolute inset-0" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.12)" strokeWidth="8" fill="none" />
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      stroke={`rgba(${NEON.rgba},0.9)`}
                      strokeWidth="8"
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray={`${Math.PI * 2 * 50}`}
                      strokeDashoffset={`${Math.PI * 2 * 50 * (1 - progressPct / 100)}`}
                      style={{ transition: isDragging ? "none" : "stroke-dashoffset 120ms linear" }}
                      transform="rotate(-90 60 60)"
                    />
                  </svg>

                  <button
                    onClick={togglePlay}
                    disabled={!canPlay}
                    className={cx(
                      "absolute inset-3 rounded-full flex items-center justify-center transition-all shadow-2xl active:scale-90",
                      canPlay ? "bg-white text-black hover:scale-105" : "bg-white/20 text-white/60 cursor-not-allowed"
                    )}
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause fill="black" size={24} /> : <Play fill="black" className="ml-1" size={24} />}
                  </button>
                </div>

                <button
                  onClick={nextTrack}
                  disabled={playlist.length <= 1 || currentIndex >= playlist.length - 1}
                  className={cx(
                    "w-10 h-10 rounded-xl flex items-center justify-center border transition-all active:scale-95",
                    playlist.length > 1 && currentIndex < playlist.length - 1
                      ? "border-white/10 bg-white/5 hover:bg-white/10 text-white"
                      : "border-white/5 bg-white/5 text-white/30 cursor-not-allowed"
                  )}
                  aria-label="Next track"
                >
                  <SkipForward size={18} />
                </button>
              </div>

              <div className="w-full -mt-1 flex items-center justify-between text-[9px] sm:text-[10px] text-white/40 tracking-[0.2em] sm:tracking-[0.25em] uppercase">
                <span>{formatTime(progressNowSeconds)}</span>
                <span>
                  {playlist.length > 1 ? `${currentIndex + 1}/${playlist.length}` : ""}
                </span>
                <span>{formatTime(track.duration)}</span>
              </div>

              {isLoading && (
                <div className="text-[9px] sm:text-[10px] text-white/50 tracking-[0.25em] uppercase">
                  Loading…
                </div>
              )}

              {/* Volume control */}
              <div className="w-full flex items-center gap-2 sm:gap-3">
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition text-white/60 hover:text-white active:scale-90"
                  aria-label={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
                <div className="flex-1 relative group">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500 
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                      [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_8px_#bc13fe]
                      [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-cyan-400 
                      [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-[0_0_8px_#bc13fe]"
                  />
                  <div 
                    className="absolute top-0 left-0 h-2 bg-cyan-500/50 rounded-full pointer-events-none"
                    style={{ width: `${volume * 100}%` }}
                  />
                </div>
                <span className="text-[9px] sm:text-[10px] text-white/40 tracking-[0.15em] sm:tracking-[0.25em] uppercase w-10 sm:w-12 text-right">
                  {Math.round(volume * 100)}%
                </span>
              </div>

              {/* Visualizer mode toggle */}
              <div className="flex items-center justify-center gap-2 w-full">
                <button
                  onClick={() => setVizMode("bars")}
                  className={cx(
                    "flex-1 py-2 sm:py-2 rounded-xl text-[9px] sm:text-[10px] font-bold border transition tracking-[0.2em] sm:tracking-[0.25em] uppercase active:scale-95",
                    vizMode === "bars" ? "border-cyan-500/50 text-cyan-300 bg-cyan-500/10" : "border-white/10 text-white/40 bg-white/5 hover:bg-white/10"
                  )}
                >
                  Bars
                </button>
                <button
                  onClick={() => setVizMode("wave")}
                  className={cx(
                    "flex-1 py-2 sm:py-2 rounded-xl text-[9px] sm:text-[10px] font-bold border transition tracking-[0.2em] sm:tracking-[0.25em] uppercase active:scale-95",
                    vizMode === "wave" ? "border-cyan-500/50 text-cyan-300 bg-cyan-500/10" : "border-white/10 text-white/40 bg-white/5 hover:bg-white/10"
                  )}
                >
                  Wave
                </button>
              </div>

              {/* Action buttons */}
              <div className="w-full">
                <div className="flex gap-3 sm:gap-4">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 bg-white/5 border border-white/10 py-3 sm:py-4 rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 text-[9px] sm:text-[10px] font-bold hover:bg-white/10 transition-all tracking-[0.2em] sm:tracking-[0.25em] uppercase active:scale-95"
                  >
                    <Upload size={12} /> Load
                  </button>
                  <button
                    onClick={() => setSuiteOpen(true)}
                    className="flex-1 bg-cyan-500 text-black py-3 sm:py-4 rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 text-[9px] sm:text-[10px] font-bold hover:bg-cyan-400 transition-all tracking-[0.2em] sm:tracking-[0.25em] uppercase active:scale-95"
                  >
                    <Settings size={12} /> Suite
                  </button>
                  <button
                    onClick={() => setQueueOpen(true)}
                    disabled={playlist.length === 0}
                    className={cx(
                      "w-12 sm:w-14 bg-white/5 border border-white/10 py-3 sm:py-4 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all active:scale-95",
                      playlist.length ? "hover:bg-white/10 text-white" : "text-white/30 cursor-not-allowed"
                    )}
                    aria-label="Queue"
                  >
                    <ListMusic size={14} />
                  </button>
                </div>
              </div>
            </div>
          </main>

          {/* Queue (playlist) */}
          {queueOpen && (
            <div className="fixed inset-0 z-[55] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
              <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950/80 shadow-2xl overflow-hidden">
                <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <ListMusic className="text-cyan-400" size={18} />
                    <div className="text-xs font-bold tracking-[0.35em] uppercase text-white/70">Queue</div>
                  </div>
                  <button
                    onClick={() => setQueueOpen(false)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition active:scale-95"
                    aria-label="Close queue"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="max-h-[60vh] overflow-y-auto">
                  {playlist.length === 0 ? (
                    <div className="p-6 text-xs text-white/50">No tracks loaded.</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {playlist.map((it, i) => (
                        <button
                          key={it.id}
                          onClick={() => {
                            setQueueOpen(false);
                            void loadTrackAt(i, { autoplay: true });
                          }}
                          className={cx(
                            "w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-white/5 transition",
                            i === currentIndex && "bg-white/5"
                          )}
                        >
                          <div className={cx("w-2 h-2 rounded-full", i === currentIndex ? "bg-cyan-400" : "bg-white/15")} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold truncate">{it.title}</div>
                            <div className="text-[10px] text-white/40 tracking-[0.2em] uppercase truncate">{it.artist || "Unknown"}</div>
                          </div>
                          <div className="text-[10px] text-white/30 tracking-[0.25em] uppercase">
                            {i + 1}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SUITE */}
          <div className={cx(
            "fixed inset-0 z-50 bg-[#050505] transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] flex flex-col",
            suiteOpen ? "translate-y-0" : "translate-y-full"
          )}>
            <header className="px-4 sm:px-8 py-4 sm:py-6 flex justify-between items-center border-b border-white/5 bg-black">
              <div className="flex items-center gap-2 sm:gap-3">
                <Zap className="text-cyan-400" size={18} />
                <h2 className="text-base sm:text-xl font-black tracking-[0.15em] sm:tracking-[0.2em] uppercase">NEON_SKY.ENGINE</h2>
              </div>
              <button onClick={() => setSuiteOpen(false)} className="p-2 sm:p-3 bg-white/5 hover:bg-white/10 rounded-full transition-all active:scale-90">
                <X size={18} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-12 space-y-6 sm:space-y-12">
              <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-12">
                <div className="lg:col-span-4 flex flex-col gap-6 sm:gap-10">
                  <div className="bg-white/5 rounded-2xl sm:rounded-3xl p-5 sm:p-8 border border-white/10 space-y-4 sm:space-y-6">
                    <label className="text-[9px] sm:text-[10px] text-cyan-400 uppercase tracking-[0.3em] sm:tracking-[0.35em] font-bold">Export</label>
                    <button
                      disabled={!canExport || isExporting}
                      onClick={startExport}
                      className={cx(
                        "w-full py-4 sm:py-5 rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 sm:gap-3 font-bold transition-all tracking-[0.2em] sm:tracking-[0.25em] uppercase text-sm active:scale-95",
                        !canExport || isExporting ? "bg-white/10 text-white/40 cursor-not-allowed" : "bg-white text-black hover:bg-zinc-200"
                      )}
                    >
                      {isExporting ? "Exporting…" : (<><Download size={16} /> Bounce</>)}
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-8 flex flex-col gap-6 sm:gap-8">
                  <div className="relative bg-black rounded-2xl sm:rounded-[3rem] border border-white/10 p-5 sm:p-10 shadow-2xl overflow-hidden min-h-[300px] sm:min-h-[350px]">
                    <div className="flex justify-between items-center mb-4 sm:mb-8">
                      <span className="text-[9px] sm:text-[10px] font-black tracking-[0.3em] sm:tracking-[0.4em] text-white/30 uppercase">Graph EQ</span>
                      <button
                        onClick={resetEq}
                        className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition text-[9px] sm:text-[10px] font-bold tracking-[0.2em] sm:tracking-[0.25em] uppercase active:scale-95"
                      >
                        Reset
                      </button>
                    </div>

                    <div
                      ref={graphEqRef}
                      onMouseDown={onGraphMouseDown}
                      onTouchStart={onGraphTouchStart}
                      onTouchMove={onGraphTouchMove}
                      className="relative h-36 sm:h-48 w-full border border-white/5 bg-zinc-950/50 rounded-xl sm:rounded-2xl cursor-crosshair overflow-hidden touch-none"
                    >
                      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-70">
                        <path
                          d={`M 0 ${72} Q 25% ${72 - eq.low * 2.5}, 50% ${72 - eq.mid * 2.5} T 100% ${72 - eq.high * 2.5}`}
                          stroke={NEON.hex}
                          strokeWidth="3"
                          fill="none"
                          className="transition-all duration-300 sm:hidden"
                        />
                        <path
                          d={`M 0 96 Q 25% ${96 - eq.low * 3.5}, 50% ${96 - eq.mid * 3.5} T 100% ${96 - eq.high * 3.5}`}
                          stroke={NEON.hex}
                          strokeWidth="3"
                          fill="none"
                          className="transition-all duration-300 hidden sm:block"
                        />
                      </svg>

                      <div className="absolute inset-0 flex items-center justify-around px-6 sm:px-12">
                        {(["low", "mid", "high"] as Band[]).map((band) => (
                          <div
                            key={band}
                            className={cx(
                              "w-3 h-3 sm:w-4 sm:h-4 rounded-full border-2 transition-all",
                              activeBand === band ? "bg-cyan-500 border-white scale-125 sm:scale-150 shadow-[0_0_15px_#bc13fe]" : "bg-transparent border-white/40"
                            )}
                            style={{ transform: `translateY(${-eq[band] * 1.5}px)` }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 sm:mt-8 grid grid-cols-3 gap-2 sm:gap-6">
                      {(["low", "mid", "high"] as Band[]).map((band) => (
                        <div key={band} className={cx("p-3 sm:p-6 rounded-xl sm:rounded-3xl border", activeBand === band ? "bg-zinc-900 border-cyan-500/50" : "bg-zinc-950 border-white/5")}>
                          <div className="flex flex-col sm:flex-row justify-between items-center sm:items-center mb-2 sm:mb-4 gap-1">
                            <span className="text-[8px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.35em]">{band}</span>
                            <span className="text-sm sm:text-xl font-black text-cyan-400">{eq[band]}dB</span>
                          </div>

                          <input
                            type="range"
                            min={-24}
                            max={24}
                            step={1}
                            value={eq[band]}
                            onChange={(e) => applyBandGain(band, parseInt(e.target.value, 10))}
                            onFocus={() => setActiveBand(band)}
                            className="w-full accent-cyan-500 h-2"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <footer className="px-4 sm:px-8 py-3 sm:py-4 bg-black border-t border-white/5 flex flex-col sm:flex-row gap-2 sm:gap-4 justify-between items-center text-[8px] sm:text-[10px] text-white/30 uppercase tracking-[0.15em] sm:tracking-[0.25em] font-bold">
              <div className="flex gap-3 sm:gap-6 items-center flex-wrap justify-center">
                <span className="flex items-center gap-1 sm:gap-2 text-cyan-400">
                  <Terminal size={10} /> System_Stable
                </span>
                <span>BPM: 128</span>
                <span>Latency: 2ms</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-center">
                <span className="text-zinc-600 italic hidden sm:inline">"Sound is survival"</span>
                <span>Core v3.5</span>
              </div>
            </footer>
          </div>
        </>
      )}
    </div>
  );
}
