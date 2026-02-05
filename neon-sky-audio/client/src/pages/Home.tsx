/**
 * NEON SKY Audio Mastering Suite v4.5
 * Design: Liquid Neon Glassmorphism
 * - Enhanced frosted glass surfaces with deep blur effects
 * - Luminous neon cyan accents that appear to glow
 * - Three.js animated background scenes with pulsing color waves
 * - Monospace typography with wide tracking
 * - Mobile-first responsive design
 * 
 * Stability Enhancements:
 * - Stable visualizer loop with frame rate limiting
 * - Proper resource cleanup
 * - Audio context state management
 * - Error boundary protection
 * 
 * Safari/iOS Compatibility Notes:
 * - AudioContext must be created/resumed on user gesture
 * - Visualizer uses requestAnimationFrame with fallback
 * - Touch events handled for mobile seek
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Disc,
  Download,
  ImagePlus,
  ListMusic,
  Music,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Terminal,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
  Activity,
  Radio,
} from "lucide-react";
import { useAudioEngine, type Band, type Phase, type VizMode } from "../hooks/useAudioEngine";
import { ThreeBackground, type BackgroundType } from "../components/ThreeBackground";
import { useIsMobile } from "../hooks/useMobile";

const NEON = {
  hex: "#D4AF37",
  rgba: "212,175,55",
} as const;

const cx = (...parts: Array<string | false | undefined | null>) => parts.filter(Boolean).join(" ");

const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const formatDuration = (s: number) => {
  if (!Number.isFinite(s) || s <= 0) return "0:00";
  const total = Math.floor(s);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${sec.toString().padStart(2, "0")}`;
};

const formatDb = (value: number, digits = 1) => {
  if (!Number.isFinite(value) || value <= -120) return "--";
  return value.toFixed(digits);
};

const toDb = (gain: number) => 20 * Math.log10(Math.max(gain, 0.000001));
const clampValue = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Visualizer mode icons
const vizModeIcons: Record<VizMode, React.ReactNode> = {
  spectrum: <Activity size={12} />,
  oscilloscope: <Radio size={12} />,
  vectorscope: <Disc size={12} />,
};

export default function Home() {
  // -------- App/UI State --------
  const [phase, setPhase] = useState<Phase>("splash");
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFps, setShowFps] = useState(false);
  const [disableVisualizer, setDisableVisualizer] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [backgroundSettingsOpen, setBackgroundSettingsOpen] = useState(false);
  const [cycleBackgrounds, setCycleBackgrounds] = useState(true);
  const [multiColorPulse, setMultiColorPulse] = useState(true);
  const [backgroundChoice, setBackgroundChoice] = useState<BackgroundType>("stars");
  const [backgroundColor, setBackgroundColor] = useState("#d4af37");
  const [backgroundIndex, setBackgroundIndex] = useState(0);
  const [compactMode, setCompactMode] = useState(false);
  const presetInputRef = useRef<HTMLInputElement | null>(null);
  const addFileInputRef = useRef<HTMLInputElement | null>(null);
  const isDev = import.meta.env.DEV;
  const isMobile = useIsMobile();

  const {
    vizMode,
    setVizMode,
    isLoading,
    isExporting,
    error,
    clearError,
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
    updatePlaylistItem,
    updatePlaylistArtwork,
    movePlaylistItem,
    removePlaylistItems,
    presetA,
    presetB,
    activePresetSlot,
    gainMatchEnabled,
    normalizeLoudness,
    targetLufs,
    setCompressor,
    setLimiter,
    setSaturation,
    setStereo,
    setOutput,
    setGainMatchEnabled,
    setNormalizeLoudness,
    setTargetLufs,
    storePresetSlot,
    recallPresetSlot,
    exportPresetJson,
    importPresetJson,
  } = useAudioEngine({
    visualizerColor: NEON.rgba,
    visualizerActive: phase === "player" && !disableVisualizer,
    visualizerPulse: true,
  });

  // -------- Phase timing --------
  useEffect(() => {
    const t = window.setTimeout(() => setPhase("boot"), 2000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlay();
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        const audioEl = audioRef.current;
        if (!audioEl || !Number.isFinite(audioEl.duration)) return;
        audioEl.currentTime = clampValue(audioEl.currentTime + 5, 0, audioEl.duration);
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        const audioEl = audioRef.current;
        if (!audioEl || !Number.isFinite(audioEl.duration)) return;
        audioEl.currentTime = clampValue(audioEl.currentTime - 5, 0, audioEl.duration);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [audioRef, togglePlay]);

  const handleInit = async () => {
    const ok = await initAudio();
    if (ok) setPhase("player");
  };

  const handlePresetImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await importPresetJson(file);
    } catch (err) {
      console.warn("Failed to import preset:", err);
    } finally {
      event.target.value = "";
    }
  };

  useEffect(() => {
    setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => playlist.some((item) => item.id === id))));
  }, [playlist]);

  const backgroundOptions = useMemo(
    () => [
      { id: "stars", label: "Falling Stars" },
      { id: "snow", label: "Snowfall" },
      { id: "grid", label: "Engineering Grid" },
      { id: "orbs", label: "Pulse Orbs" },
      { id: "circuit", label: "Circuit Bloom" },
    ],
    []
  );
  const backgroundType = cycleBackgrounds
    ? backgroundOptions[backgroundIndex % backgroundOptions.length]?.id ?? "stars"
    : backgroundChoice;
  const shouldMultiPulse = multiColorPulse || backgroundType === "grid";

  const vizModes: VizMode[] = ["spectrum", "oscilloscope", "vectorscope"];
  const vizIndex = Math.max(0, vizModes.indexOf(vizMode));
  const handleVizPrev = () => setVizMode(vizModes[(vizIndex - 1 + vizModes.length) % vizModes.length]);
  const handleVizNext = () => setVizMode(vizModes[(vizIndex + 1) % vizModes.length]);

  const filteredPlaylist = useMemo(() => {
    const query = queueSearch.trim().toLowerCase();
    if (!query) return playlist;
    return playlist.filter((item) => {
      const haystack = `${item.title} ${item.artist} ${item.album} ${item.extension}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [playlist, queueSearch]);

  const totalDuration = useMemo(() => playlist.reduce((sum, item) => sum + (item.duration || 0), 0), [playlist]);

  const scrubHandle = useMemo(() => {
    const angle = (progressPct / 100) * Math.PI * 2 - Math.PI / 2;
    const radius = 50;
    return {
      cx: 60 + Math.cos(angle) * radius,
      cy: 60 + Math.sin(angle) * radius,
    };
  }, [progressPct]);

  const eqBands = useMemo<Band[]>(() => ["sub", "low", "mid", "high", "air"], []);
  const eqBandPositions = useMemo<Record<Band, number>>(
    () => ({
      sub: 0.08,
      low: 0.26,
      mid: 0.5,
      high: 0.74,
      air: 0.92,
    }),
    []
  );
  const eqBaseLine = 80;
  const eqScale = 2.4;
  const eqActivePath = useMemo(() => {
    const points = eqBands.map((band) => {
      const x = eqBandPositions[band] * 100;
      const y = eqBaseLine - eq[band] * eqScale;
      return `${x} ${y}`;
    });
    return `M 0 ${eqBaseLine} L ${points.join(" L ")} L 100 ${eqBaseLine}`;
  }, [eq, eqBands, eqBandPositions]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allSelected = playlist.length > 0 && selectedIds.size === playlist.length;

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(playlist.map((item) => item.id)));
  };

  const handleRemoveSelected = () => {
    removePlaylistItems(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const didSetCompactRef = useRef(false);
  useEffect(() => {
    if (isMobile && !didSetCompactRef.current) {
      setCompactMode(true);
      didSetCompactRef.current = true;
    }
  }, [isMobile]);

  const trackChangeRef = useRef<number | null>(null);
  useEffect(() => {
    if (!cycleBackgrounds || playlist.length === 0) return;
    if (trackChangeRef.current === null) {
      trackChangeRef.current = currentIndex;
      return;
    }
    if (trackChangeRef.current !== currentIndex) {
      setBackgroundIndex((prev) => (prev + 1) % backgroundOptions.length);
      trackChangeRef.current = currentIndex;
    }
  }, [backgroundOptions.length, currentIndex, cycleBackgrounds, playlist.length]);

  useEffect(() => {
    if (!cycleBackgrounds) return;
    const selectedIndex = backgroundOptions.findIndex((option) => option.id === backgroundChoice);
    if (selectedIndex >= 0) setBackgroundIndex(selectedIndex);
  }, [backgroundChoice, backgroundOptions, cycleBackgrounds]);

  // -------- Render --------
  return (
    <div className="min-h-screen min-h-[100dvh] bg-black text-white font-mono selection:bg-[#D4AF37] selection:text-black relative overflow-hidden">
      {/* Persistent elements (never unmount) */}
      <audio ref={audioRef} className="hidden" playsInline crossOrigin="anonymous" />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="audio/*"
        onChange={(e) => handleFile(e, "replace")}
      />
      <input
        ref={addFileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="audio/*"
        onChange={(e) => handleFile(e, "append")}
      />
      <input ref={presetInputRef} type="file" className="hidden" accept="application/json" onChange={handlePresetImport} />

      {/* Animated Background */}
      <ThreeBackground type={backgroundType} color={backgroundColor} multiColorPulse={shouldMultiPulse} />

      {isDev && showFps && (
        <div className="fixed top-4 right-4 z-[70] rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/70">
          FPS {Math.round(visualizerFps)}
        </div>
      )}

      {phase === "player" && (
        <div className="fixed top-4 right-4 z-[65] flex flex-col items-end gap-2">
          <button
            onClick={() => setBackgroundSettingsOpen((prev) => !prev)}
            className="h-10 w-10 rounded-none border border-white/10 bg-black/60 text-white/70 hover:text-white hover:bg-white/10 transition-all active:scale-95 flex items-center justify-center"
            aria-label="Background settings"
          >
            <Settings size={18} />
          </button>
          {backgroundSettingsOpen && (
            <div className="w-64 border border-white/10 bg-black/70 backdrop-blur-md p-4 text-[10px] uppercase tracking-[0.2em] text-white/70 rounded-none">
              <div className="flex items-center justify-between mb-3">
                <span className="text-white/80">Background</span>
                <button
                  onClick={() => setBackgroundSettingsOpen(false)}
                  className="text-white/40 hover:text-white transition"
                  aria-label="Close background settings"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="space-y-3">
                <label className="flex items-center justify-between gap-3">
                  <span>Cycle Tracks</span>
                  <input
                    type="checkbox"
                    checked={cycleBackgrounds}
                    onChange={(e) => setCycleBackgrounds(e.target.checked)}
                    className="h-4 w-4 accent-cyan-400"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span>Multi-Color Pulse</span>
                  <input
                    type="checkbox"
                    checked={multiColorPulse}
                    onChange={(e) => setMultiColorPulse(e.target.checked)}
                    className="h-4 w-4 accent-cyan-400"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span>Background</span>
                  <select
                    value={backgroundChoice}
                    onChange={(e) => setBackgroundChoice(e.target.value as BackgroundType)}
                    disabled={cycleBackgrounds}
                    className="bg-black/60 border border-white/10 text-[9px] uppercase tracking-[0.15em] px-2 py-1 text-white/70 disabled:opacity-40"
                  >
                    {backgroundOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span>Pulse Color</span>
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    className="h-6 w-10 border border-white/20 bg-transparent"
                  />
                </label>
                <p className="text-[9px] text-white/40 tracking-[0.15em]">
                  Engineering grid runs in multicolor mode.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Grid Overlay */}
      <div 
        className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* Error Toast */}
      {error && (
        <div className="fixed top-4 left-4 right-4 z-[60] max-w-2xl mx-auto animate-slide-up">
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-xl p-4 flex items-start justify-between gap-3 shadow-lg">
            <div className="text-xs sm:text-sm text-red-200">{error}</div>
            <button 
              onClick={clearError} 
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition flex-shrink-0 hover:scale-105 active:scale-95"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* SPLASH */}
      {phase === "splash" && (
        <div className="fixed inset-0 bg-black flex items-center justify-center z-50 overflow-hidden px-4">
          <div className="absolute inset-0 bg-gradient-to-tr from-[#1b1b1f]/70 via-black to-[#3a2e10]/40" />
          <div className="relative flex flex-col items-center animate-scale-in">
            <div className="w-28 h-28 sm:w-36 sm:h-36 mb-8 relative">
              <div className="absolute inset-0 rounded-full animate-pulse-glow" />
              <div className="absolute inset-0 border-4 border-cyan-500/30 rounded-full animate-ping opacity-20" />
              <div className="absolute inset-0 border-t-4 border-r-4 border-cyan-400 rounded-full animate-spin" />
              <div className="absolute inset-2 border-b-4 border-l-4 border-[#8a6f1f]/50 rounded-full animate-spin-slow" />
              <Disc className="absolute inset-0 m-auto text-white animate-pulse-glow" size={44} />
            </div>
            <h1 className="text-5xl sm:text-7xl font-black tracking-tighter text-white text-center neon-text">NEON SKY</h1>
            <p className="text-[#f5d76e]/70 font-mono tracking-[0.3em] sm:tracking-[0.4em] text-[10px] sm:text-xs mt-3 uppercase text-center">
              Mastering Suite v4.5
            </p>
            <div className="mt-8 flex gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: '200ms' }} />
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        </div>
      )}

      {/* BOOT */}
      {phase === "boot" && (
        <div className="fixed inset-0 bg-black text-white font-mono p-4 sm:p-8 flex flex-col items-center justify-center z-40">
          <div className="absolute inset-0 bg-gradient-to-br from-black via-[#0c0c12] to-[#332610]/70" />
          <div className="relative w-full max-w-2xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 sm:p-10 shadow-[0_0_40px_rgba(212,175,55,0.15)]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-[10px] tracking-[0.4em] text-cyan-400 uppercase">NEXUS BOOT SEQUENCE</p>
                <h2 className="text-3xl sm:text-4xl font-black tracking-tight mt-2">Neon Sky Nexus</h2>
                <p className="text-[11px] text-white/50 uppercase tracking-[0.25em] mt-2">Synth Core Initialization</p>
              </div>
              <div className="h-12 w-12 border border-cyan-500/40 grid place-items-center">
                <Terminal className="text-cyan-300" size={22} />
              </div>
            </div>
            <div className="space-y-4 text-[11px] sm:text-xs tracking-[0.18em] uppercase">
              {[
                "Core Matrix Online",
                "DSP Suite Calibrated (5-BAND_EQ)",
                "Visualizer Channel Sync",
                "Limiter + Meter Worklets Ready",
                "Playlist Memory Linked",
              ].map((m, i) => (
                <div key={m} className="space-y-2 animate-fade-in" style={{ animationDelay: `${i * 120}ms` }}>
                  <div className="flex items-center justify-between text-white/70">
                    <span>{m}</span>
                    <span className="text-cyan-400">OK</span>
                  </div>
                  <div className="h-1.5 bg-white/10">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-[#d4af37] animate-pulse"
                      style={{ width: `${70 + i * 6}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 flex items-center justify-between text-[10px] text-white/50 uppercase tracking-[0.3em]">
              <span>Awaiting Operator Input</span>
              <div className="h-2 w-2 bg-cyan-400 animate-pulse" />
            </div>
            <button
              onClick={handleInit}
              className="mt-6 w-full py-4 border border-cyan-500/60 text-cyan-200 font-bold hover:bg-cyan-500 hover:text-black transition-all uppercase tracking-[0.25em] text-sm active:scale-[0.98] rounded-none"
            >
              Initialize Core
            </button>
          </div>
        </div>
      )}

      {/* PLAYER */}
      {phase === "player" && (
        <>
          {isMobile && compactMode && (
            <div className="fixed bottom-4 left-3 right-3 z-40 glass-card rounded-none p-3 flex flex-col gap-3 shadow-2xl">
              <div className="border border-white/10 bg-black/40 px-3 py-2 overflow-hidden">
                <div className="marquee text-[10px] uppercase tracking-[0.3em] text-white/60">
                  <span>{track.artist || "Unknown Artist"}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="h-10 w-10 border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all active:scale-95"
                  aria-label="Load track"
                >
                  <Upload size={16} className="mx-auto" />
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={prevTrack}
                    disabled={playlist.length <= 1 || currentIndex === 0}
                    className={cx(
                      "h-10 w-10 border transition-all active:scale-95",
                      playlist.length > 1 && currentIndex > 0
                        ? "border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                        : "border-white/5 bg-white/5 text-white/20 cursor-not-allowed"
                    )}
                    aria-label="Previous track"
                  >
                    <SkipBack size={16} className="mx-auto" />
                  </button>
                  <button
                    onClick={() => void togglePlay()}
                    className="h-12 w-12 border border-cyan-500/60 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/40 transition-all active:scale-95"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause size={18} className="mx-auto" /> : <Play size={18} className="mx-auto" />}
                  </button>
                  <button
                    onClick={nextTrack}
                    disabled={playlist.length <= 1 || currentIndex >= playlist.length - 1}
                    className={cx(
                      "h-10 w-10 border transition-all active:scale-95",
                      playlist.length > 1 && currentIndex < playlist.length - 1
                        ? "border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                        : "border-white/5 bg-white/5 text-white/20 cursor-not-allowed"
                    )}
                    aria-label="Next track"
                  >
                    <SkipForward size={16} className="mx-auto" />
                  </button>
                </div>
                <button
                  onClick={() => setCompactMode(false)}
                  className="h-10 w-10 border border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-95"
                  aria-label="Expand player"
                >
                  <ChevronUp size={16} className="mx-auto" />
                </button>
              </div>
            </div>
          )}

          {(!isMobile || !compactMode) && (
            <main className="relative z-10 flex flex-col items-center justify-center min-h-screen min-h-[100dvh] p-3 sm:p-6">
              <div className="w-full max-w-[360px] sm:max-w-md glass-card rounded-none p-6 sm:p-10 shadow-2xl flex flex-col items-center gap-5 sm:gap-6 animate-scale-in">
              
              {/* Header */}
              <div className="w-full flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="text-cyan-400" size={16} />
                  <span className="text-[10px] tracking-[0.3em] text-white/50 uppercase">NEON_SKY</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-green-400 animate-pulse' : 'bg-white/20'}`} />
                  <span className="text-[9px] tracking-[0.2em] text-white/40 uppercase">
                    {isPlaying ? 'PLAYING' : 'READY'}
                  </span>
                  {isMobile && (
                    <button
                      onClick={() => setCompactMode(true)}
                      className="ml-2 h-6 w-6 border border-white/10 bg-white/5 text-white/60 hover:text-white transition-all"
                      aria-label="Collapse player"
                    >
                      <ChevronDown size={12} className="mx-auto" />
                    </button>
                  )}
                </div>
              </div>

              {/* Artwork Display */}
              <div className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-3xl overflow-hidden bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 border border-white/10 flex items-center justify-center flex-shrink-0 shadow-xl">
                {track.artwork ? (
                  <img 
                    src={track.artwork} 
                    alt="Album artwork" 
                    className="w-full h-full object-cover transition-transform duration-700 hover:scale-110"
                  />
                ) : (
                  <Music className="text-white/20" size={48} />
                )}
                {isPlaying && (
                  <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/20 to-transparent animate-pulse" />
                )}
                <div className="absolute inset-0 shadow-[inset_0_0_30px_rgba(0,0,0,0.3)]" />
              </div>

              {/* Track Info */}
              <div className="text-center w-full px-2">
                <span className="text-[9px] sm:text-[10px] text-cyan-400 tracking-[0.4em] sm:tracking-[0.5em] uppercase font-bold">Now Playing</span>
                <h2 className="text-base sm:text-lg font-bold truncate mt-1.5 text-white/90">{track.title}</h2>
                <p className="text-[11px] sm:text-xs text-white/50 truncate">{track.artist}</p>
                {track.album && (
                  <p className="text-[10px] sm:text-[11px] text-white/30 truncate mt-0.5">{track.album}</p>
                )}
              </div>

              {/* Visualizer */}
              <div className="relative w-full h-24 sm:h-32 flex items-center justify-center rounded-2xl overflow-hidden bg-black/40 border border-white/5">
                <canvas ref={vizCanvasRef} className="absolute inset-0 w-full h-full opacity-90" />
                <div className={cx("absolute inset-0 rounded-2xl", isPlaying && "animate-pulse")} />
                
                {/* Visualizer Controls */}
                <div className="absolute right-2 top-2 flex items-center gap-1 bg-black/60 border border-white/10 rounded-full px-1.5 py-1 backdrop-blur-md">
                  <button
                    onClick={handleVizPrev}
                    className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white transition-all active:scale-90"
                    aria-label="Previous visualizer mode"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={handleVizNext}
                    className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white transition-all active:scale-90"
                    aria-label="Next visualizer mode"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
                
                {/* Mode Indicator */}
                <div className="absolute left-3 bottom-2 flex items-center gap-1.5 text-[9px] text-white/50 uppercase tracking-[0.2em] bg-black/40 px-2 py-1 rounded-full backdrop-blur-sm">
                  {vizModeIcons[vizMode]}
                  <span>{vizMode}</span>
                </div>
              </div>

              {/* Transport + Circular progress (touch to seek) */}
              <div className="w-full flex items-center justify-center gap-5">
                <button
                  onClick={prevTrack}
                  disabled={playlist.length <= 1 || currentIndex === 0}
                  className={cx(
                    "w-11 h-11 rounded-2xl flex items-center justify-center border transition-all active:scale-95",
                    playlist.length > 1 && currentIndex > 0
                      ? "btn-glass text-white"
                      : "border-white/5 bg-white/5 text-white/20 cursor-not-allowed"
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
                  onPointerCancel={onRingPointerCancel}
                  className={cx(
                    "relative w-28 h-28 sm:w-32 sm:h-32 select-none touch-none",
                    track.duration ? "cursor-pointer" : "cursor-default"
                  )}
                  aria-label="Seek ring"
                >
                  {/* Glow effect */}
                  <div className="absolute inset-1 rounded-full bg-gradient-to-br from-amber-200/10 via-amber-500/5 to-amber-900/20 shadow-[inset_0_2px_10px_rgba(255,255,255,0.2),inset_0_-8px_14px_rgba(0,0,0,0.5),0_10px_25px_rgba(0,0,0,0.4)]" />
                  
                  <svg className="absolute inset-0" viewBox="0 0 120 120">
                    <defs>
                      <linearGradient id="scrub-track" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(255,214,170,0.15)" />
                        <stop offset="100%" stopColor="rgba(255,120,90,0.35)" />
                      </linearGradient>
                      <linearGradient id="scrub-progress" x1="0" x2="1" y1="1" y2="0">
                        <stop offset="0%" stopColor="rgba(255,159,67,0.95)" />
                        <stop offset="100%" stopColor="rgba(255,204,102,0.95)" />
                      </linearGradient>
                      <radialGradient id="scrub-handle" cx="30%" cy="30%" r="70%">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.98)" />
                        <stop offset="60%" stopColor="rgba(255,191,115,0.95)" />
                        <stop offset="100%" stopColor="rgba(178,88,20,0.95)" />
                      </radialGradient>
                      <filter id="scrub-shadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.6)" />
                      </filter>
                    </defs>
                    <circle cx="60" cy="60" r="50" stroke="url(#scrub-track)" strokeWidth="8" fill="none" />
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      stroke="url(#scrub-progress)"
                      strokeWidth="8"
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray={`${Math.PI * 2 * 50}`}
                      strokeDashoffset={`${Math.PI * 2 * 50 * (1 - progressPct / 100)}`}
                      style={{ transition: isDragging ? "none" : "stroke-dashoffset 120ms linear" }}
                      transform="rotate(-90 60 60)"
                    />
                    {track.duration > 0 && (
                      <circle
                        cx={scrubHandle.cx}
                        cy={scrubHandle.cy}
                        r="6"
                        fill="url(#scrub-handle)"
                        stroke="rgba(255,255,255,0.7)"
                        strokeWidth="1"
                        filter="url(#scrub-shadow)"
                      />
                    )}
                  </svg>

                  <button
                    onClick={togglePlay}
                    disabled={!canPlay}
                    className={cx(
                      "absolute inset-3 rounded-full flex items-center justify-center transition-all shadow-2xl active:scale-90",
                      canPlay
                        ? "bg-gradient-to-br from-white via-amber-50 to-amber-200 text-black hover:scale-105 shadow-[0_6px_20px_rgba(255,200,120,0.4)]"
                        : "bg-white/20 text-white/60 cursor-not-allowed"
                    )}
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause fill="black" size={26} /> : <Play fill="black" className="ml-1" size={26} />}
                  </button>
                </div>

                <button
                  onClick={nextTrack}
                  disabled={playlist.length <= 1 || currentIndex >= playlist.length - 1}
                  className={cx(
                    "w-11 h-11 rounded-2xl flex items-center justify-center border transition-all active:scale-95",
                    playlist.length > 1 && currentIndex < playlist.length - 1
                      ? "btn-glass text-white"
                      : "border-white/5 bg-white/5 text-white/20 cursor-not-allowed"
                  )}
                  aria-label="Next track"
                >
                  <SkipForward size={18} />
                </button>
              </div>

              {/* Time Display */}
              <div className="w-full -mt-1 flex items-center justify-between text-[10px] sm:text-[11px] text-white/40 tracking-[0.2em] sm:tracking-[0.25em] uppercase">
                <span className="font-mono">{formatTime(progressNowSeconds)}</span>
                <span className="text-white/20">
                  {playlist.length > 1 ? `${currentIndex + 1}/${playlist.length}` : "—"}
                </span>
                <span className="font-mono">{formatTime(track.duration)}</span>
              </div>

              {/* Loading Indicator */}
              {isLoading && (
                <div className="flex items-center gap-2 text-[10px] text-white/50 tracking-[0.25em] uppercase">
                  <div className="w-4 h-4 border-2 border-white/20 border-t-cyan-400 rounded-full animate-spin" />
                  <span>{isPlaying ? "Buffering…" : "Loading…"}</span>
                </div>
              )}

              {/* Volume control */}
              <div className="w-full flex items-center gap-3 sm:gap-4">
                <button
                  onClick={toggleMute}
                  className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-white/60 hover:text-white active:scale-90"
                  aria-label={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <div className="flex-1 relative group">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer"
                  />
                  <div 
                    className="absolute top-0 left-0 h-2 bg-gradient-to-r from-cyan-500/70 to-cyan-400 rounded-full pointer-events-none transition-all"
                    style={{ width: `${volume * 100}%` }}
                  />
                </div>
                <span className="text-[10px] sm:text-[11px] text-white/40 tracking-[0.15em] sm:tracking-[0.25em] uppercase w-12 text-right">
                  {Math.round(volume * 100)}%
                </span>
              </div>

              {/* Action buttons */}
              <div className="w-full">
                <div className="flex gap-3 sm:gap-4">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 btn-glass py-3.5 sm:py-4 rounded-none flex items-center justify-center gap-2 text-[10px] sm:text-[11px] font-bold tracking-[0.2em] sm:tracking-[0.25em] uppercase active:scale-95"
                  >
                    <Upload size={14} /> Load
                  </button>
                  <button
                    onClick={() => setSuiteOpen(true)}
                    className="flex-1 btn-primary py-3.5 sm:py-4 rounded-none flex items-center justify-center gap-2 text-[10px] sm:text-[11px] font-bold tracking-[0.2em] sm:tracking-[0.25em] uppercase text-black active:scale-95"
                  >
                    <Settings size={14} /> Suite
                  </button>
                  <button
                    onClick={() => setQueueOpen(true)}
                    disabled={playlist.length === 0}
                    className={cx(
                      "w-14 sm:w-16 btn-glass py-3.5 sm:py-4 rounded-none flex items-center justify-center transition-all active:scale-95",
                      playlist.length ? "text-white" : "text-white/20 cursor-not-allowed"
                    )}
                    aria-label="Queue"
                  >
                    <ListMusic size={16} />
                  </button>
                </div>
              </div>
            </div>
            </main>
          )}

          {/* Queue (playlist) */}
          {queueOpen && (
            <div className="fixed inset-0 z-[55] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-3 animate-fade-in">
              <div className="w-full max-w-md glass-card rounded-none shadow-2xl overflow-hidden animate-slide-up">
                <div className="px-6 py-5 flex items-center justify-between border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                      <ListMusic className="text-cyan-400" size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-bold tracking-[0.3em] uppercase text-white/80">Queue</div>
                      <div className="text-[9px] text-white/40 tracking-[0.15em]">{playlist.length} tracks</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setQueueOpen(false)}
                    className="p-2.5 rounded-xl btn-glass transition-all active:scale-90"
                    aria-label="Close queue"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="px-6 py-4 border-b border-white/10 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" size={14} />
                      <input
                        value={queueSearch}
                        onChange={(e) => setQueueSearch(e.target.value)}
                        placeholder="Search tracks..."
                        className="w-full rounded-xl bg-white/5 border border-white/10 pl-10 pr-3 py-2.5 text-xs text-white/80 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all"
                      />
                    </div>
                    <button
                      onClick={() => addFileInputRef.current?.click()}
                      className="h-10 px-3.5 rounded-xl btn-glass text-[10px] uppercase tracking-[0.2em] flex items-center gap-2"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={handleRemoveSelected}
                      disabled={selectedIds.size === 0}
                      className={cx(
                        "h-10 px-3.5 rounded-xl border text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 transition-all",
                        selectedIds.size
                          ? "bg-red-500/20 border-red-500/30 text-red-200 hover:bg-red-500/30"
                          : "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
                      )}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[9px] text-white/40 uppercase tracking-[0.15em]">
                    <button onClick={toggleSelectAll} className="flex items-center gap-2 hover:text-white/70 transition-colors">
                      <span className={cx("w-2.5 h-2.5 rounded-sm border", allSelected ? "bg-cyan-400 border-cyan-400" : "border-white/30")} />
                      {allSelected ? "Clear" : "Select all"}
                    </button>
                    <div className="flex items-center gap-4">
                      <span>{formatDuration(totalDuration)}</span>
                      <span>{selectedIds.size} selected</span>
                    </div>
                  </div>
                </div>

                <div className="max-h-[55vh] overflow-y-auto">
                  {playlist.length === 0 ? (
                    <div className="p-8 text-center">
                      <Music className="mx-auto text-white/20 mb-3" size={32} />
                      <p className="text-xs text-white/50">No tracks loaded</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {filteredPlaylist.map((it) => {
                        const playlistIndex = playlist.findIndex((entry) => entry.id === it.id);
                        const isCurrent = playlistIndex === currentIndex;
                        return (
                          <div
                            key={it.id}
                            className={cx(
                              "w-full text-left px-6 py-4 flex items-start gap-3 transition-all hover:bg-white/[0.02]",
                              isCurrent && "bg-white/[0.04]"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(it.id)}
                              onChange={() => toggleSelected(it.id)}
                              className="mt-1.5 h-4 w-4 rounded border border-white/20 bg-white/5 accent-cyan-500 cursor-pointer"
                              aria-label={`Select ${it.title}`}
                            />
                            <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center flex-shrink-0">
                              {it.artwork ? (
                                <img src={it.artwork} alt={`${it.title} artwork`} className="w-full h-full object-cover" />
                              ) : (
                                <Music size={18} className="text-white/30" />
                              )}
                              {it.extension && (
                                <div className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[8px] uppercase text-white/50">
                                  {it.extension}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 space-y-2">
                              <input
                                value={it.title}
                                onChange={(e) => updatePlaylistItem(it.id, { title: e.target.value })}
                                className="w-full rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs text-white/80 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all"
                                placeholder="Track title"
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  value={it.artist}
                                  onChange={(e) => updatePlaylistItem(it.id, { artist: e.target.value })}
                                  className="w-full rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 text-[10px] text-white/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all"
                                  placeholder="Artist"
                                />
                                <input
                                  value={it.album}
                                  onChange={(e) => updatePlaylistItem(it.id, { album: e.target.value })}
                                  className="w-full rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 text-[10px] text-white/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all"
                                  placeholder="Album"
                                />
                              </div>
                              <div className="flex items-center gap-3 text-[9px] text-white/30 uppercase tracking-[0.15em]">
                                <span>{formatDuration(it.duration)}</span>
                                <span>#{playlistIndex + 1}</span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <button
                                onClick={() => movePlaylistItem(playlistIndex, playlistIndex - 1)}
                                disabled={playlistIndex === 0}
                                className={cx(
                                  "w-8 h-8 rounded-xl btn-glass flex items-center justify-center active:scale-90",
                                  playlistIndex === 0 && "opacity-40 cursor-not-allowed"
                                )}
                                aria-label={`Move ${it.title} up`}
                              >
                                <ChevronUp size={12} />
                              </button>
                              <button
                                onClick={() => movePlaylistItem(playlistIndex, playlistIndex + 1)}
                                disabled={playlistIndex === playlist.length - 1}
                                className={cx(
                                  "w-8 h-8 rounded-xl btn-glass flex items-center justify-center active:scale-90",
                                  playlistIndex === playlist.length - 1 && "opacity-40 cursor-not-allowed"
                                )}
                                aria-label={`Move ${it.title} down`}
                              >
                                <ChevronDown size={12} />
                              </button>
                              <button
                                onClick={() => {
                                  setQueueOpen(false);
                                  void loadTrackAt(playlistIndex, { autoplay: true });
                                }}
                                className="w-8 h-8 rounded-xl btn-glass flex items-center justify-center active:scale-90"
                                aria-label={`Play ${it.title}`}
                              >
                                <Play size={12} />
                              </button>
                              <label className="w-8 h-8 rounded-xl btn-glass flex items-center justify-center cursor-pointer active:scale-90">
                                <ImagePlus size={12} />
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) updatePlaylistArtwork(it.id, file);
                                    event.target.value = "";
                                  }}
                                />
                              </label>
                              <button
                                onClick={() => {
                                  setSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    next.delete(it.id);
                                    return next;
                                  });
                                  removePlaylistItems([it.id]);
                                }}
                                className="w-8 h-8 rounded-xl btn-glass flex items-center justify-center text-red-300/70 hover:text-red-300 active:scale-90"
                                aria-label={`Remove ${it.title}`}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SUITE */}
          <div className={cx(
            "fixed inset-0 z-50 bg-[#030305] transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex flex-col",
            suiteOpen ? "translate-y-0" : "translate-y-full"
          )}>
            {/* Header */}
            <header className="px-4 sm:px-8 py-4 sm:py-5 flex justify-between items-center border-b border-white/5 bg-black/50 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                  <Zap className="text-cyan-400" size={20} />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-black tracking-[0.1em] sm:tracking-[0.15em] uppercase">NEON_SKY.ENGINE</h2>
                  <p className="text-[9px] text-white/30 tracking-[0.2em] uppercase">Mastering Suite v4.5</p>
                </div>
              </div>
              <button 
                onClick={() => setSuiteOpen(false)} 
                className="p-2.5 sm:p-3 btn-glass rounded-xl transition-all active:scale-90"
              >
                <X size={20} />
              </button>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10 space-y-6 sm:space-y-10">
              <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10">
                
                {/* Left Column */}
                <div className="lg:col-span-4 flex flex-col gap-5 sm:gap-8">
                  
                  {/* Metering Panel */}
                  <div className="glass-card rounded-2xl sm:rounded-3xl p-5 sm:p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <Activity size={14} className="text-cyan-400" />
                      <label className="text-[10px] text-cyan-400 uppercase tracking-[0.3em] font-bold">Metering</label>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-[11px] sm:text-xs text-white/70">
                      <div className="flex flex-col gap-1 p-2 rounded-xl bg-white/5">
                        <span className="text-white/30 uppercase tracking-[0.15em] text-[9px]">Peak</span>
                        <span className="text-cyan-200 font-semibold font-mono">{formatDb(toDb(meter.peak))} dB</span>
                      </div>
                      <div className="flex flex-col gap-1 p-2 rounded-xl bg-white/5">
                        <span className="text-white/30 uppercase tracking-[0.15em] text-[9px]">RMS</span>
                        <span className="text-cyan-200 font-semibold font-mono">{formatDb(toDb(meter.rms))} dB</span>
                      </div>
                      <div className="flex flex-col gap-1 p-2 rounded-xl bg-white/5">
                        <span className="text-white/30 uppercase tracking-[0.15em] text-[9px]">LUFS M</span>
                        <span className="text-cyan-200 font-semibold font-mono">{formatDb(meter.lufsMomentary)} LU</span>
                      </div>
                      <div className="flex flex-col gap-1 p-2 rounded-xl bg-white/5">
                        <span className="text-white/30 uppercase tracking-[0.15em] text-[9px]">LUFS S</span>
                        <span className="text-cyan-200 font-semibold font-mono">{formatDb(meter.lufsShort)} LU</span>
                      </div>
                      <div className="flex flex-col gap-1 p-2 rounded-xl bg-white/5">
                        <span className="text-white/30 uppercase tracking-[0.15em] text-[9px]">LUFS I</span>
                        <span className="text-cyan-200 font-semibold font-mono">{formatDb(meter.lufsIntegrated)} LU</span>
                      </div>
                      <div className="flex flex-col gap-1 p-2 rounded-xl bg-white/5">
                        <span className="text-white/30 uppercase tracking-[0.15em] text-[9px]">Corr</span>
                        <span className="text-cyan-200 font-semibold font-mono">{meter.correlation.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-150"
                        style={{ width: `${clampValue((meter.correlation + 1) * 50, 0, 100)}%` }}
                      />
                    </div>
                  </div>

                  {isDev && (
                    <div className="glass-card rounded-2xl sm:rounded-3xl p-5 sm:p-6 space-y-4">
                      <label className="text-[10px] text-cyan-400 uppercase tracking-[0.3em] font-bold">Diagnostics</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setShowFps(!showFps)}
                          className={cx(
                            "py-2 rounded-xl border text-[9px] tracking-[0.25em] uppercase transition-all active:scale-95",
                            showFps ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm" : "border-white/10 text-white/50 bg-white/5"
                          )}
                        >
                          FPS {showFps ? "On" : "Off"}
                        </button>
                        <button
                          onClick={() => setDisableVisualizer(!disableVisualizer)}
                          className={cx(
                            "py-2 rounded-xl border text-[9px] tracking-[0.25em] uppercase transition-all active:scale-95",
                            disableVisualizer ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm" : "border-white/10 text-white/50 bg-white/5"
                          )}
                        >
                          Viz {disableVisualizer ? "Off" : "On"}
                        </button>
                      </div>
                      <div className="text-[9px] text-white/40 uppercase tracking-[0.2em]">
                        Playback: <span className="text-white/70">{playbackState}</span>
                      </div>
                    </div>
                  )}

                  {installPrompt && (
                    <div className="glass-card rounded-2xl sm:rounded-3xl p-5 sm:p-6 space-y-3">
                      <label className="text-[10px] text-cyan-400 uppercase tracking-[0.3em] font-bold">Install</label>
                      <button
                        onClick={handleInstall}
                        className="w-full py-3 rounded-xl btn-primary text-black text-[10px] tracking-[0.25em] uppercase"
                      >
                        Add to Home Screen
                      </button>
                      <p className="text-[9px] text-white/40 uppercase tracking-[0.2em]">
                        iOS: Share → Add to Home Screen
                      </p>
                    </div>
                  )}

                  {/* Presets Panel */}
                  <div className="glass-card rounded-2xl sm:rounded-3xl p-5 sm:p-6 space-y-4">
                    <label className="text-[10px] text-cyan-400 uppercase tracking-[0.3em] font-bold">Presets</label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => recallPresetSlot("A")}
                        className={cx(
                          "flex-1 py-2.5 rounded-xl border text-[10px] font-bold tracking-[0.25em] uppercase transition-all active:scale-95",
                          activePresetSlot === "A" ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm" : "border-white/10 text-white/50 bg-white/5 hover:border-white/20"
                        )}
                      >
                        A {presetA ? "●" : ""}
                      </button>
                      <button
                        onClick={() => recallPresetSlot("B")}
                        className={cx(
                          "flex-1 py-2.5 rounded-xl border text-[10px] font-bold tracking-[0.25em] uppercase transition-all active:scale-95",
                          activePresetSlot === "B" ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm" : "border-white/10 text-white/50 bg-white/5 hover:border-white/20"
                        )}
                      >
                        B {presetB ? "●" : ""}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => storePresetSlot("A")}
                        className="py-2 rounded-xl btn-glass text-[9px] tracking-[0.2em] uppercase text-white/60"
                      >
                        Store A
                      </button>
                      <button
                        onClick={() => storePresetSlot("B")}
                        className="py-2 rounded-xl btn-glass text-[9px] tracking-[0.2em] uppercase text-white/60"
                      >
                        Store B
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={exportPresetJson}
                        className="py-2 rounded-xl btn-glass text-[9px] tracking-[0.2em] uppercase text-white/60"
                      >
                        Save JSON
                      </button>
                      <button
                        onClick={() => presetInputRef.current?.click()}
                        className="py-2 rounded-xl btn-glass text-[9px] tracking-[0.2em] uppercase text-white/60"
                      >
                        Load JSON
                      </button>
                    </div>
                    <button
                      onClick={() => setGainMatchEnabled(!gainMatchEnabled)}
                      className={cx(
                        "w-full py-2.5 rounded-xl border text-[9px] tracking-[0.25em] uppercase transition-all active:scale-95",
                        gainMatchEnabled ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm" : "border-white/10 text-white/50 bg-white/5"
                      )}
                    >
                      Gain Match {gainMatchEnabled ? "On" : "Off"}
                    </button>
                  </div>

                  {/* Export Panel */}
                  <div className="glass-card rounded-2xl sm:rounded-3xl p-5 sm:p-6 space-y-4">
                    <label className="text-[10px] text-cyan-400 uppercase tracking-[0.3em] font-bold">Export</label>
                    <div className="flex items-center justify-between text-[10px] text-white/60 uppercase tracking-[0.2em]">
                      <span>Loudness Normalize</span>
                      <button
                        onClick={() => setNormalizeLoudness(!normalizeLoudness)}
                        className={cx(
                          "px-3 py-1.5 rounded-full border text-[9px] uppercase tracking-[0.15em] transition-all",
                          normalizeLoudness ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm" : "border-white/10 text-white/50 bg-white/5"
                        )}
                      >
                        {normalizeLoudness ? "On" : "Off"}
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-white/40 uppercase tracking-[0.15em]">Target</span>
                      <input
                        type="range"
                        min={-20}
                        max={-6}
                        step={0.5}
                        value={targetLufs}
                        onChange={(e) => setTargetLufs(parseFloat(e.target.value))}
                        className="flex-1"
                      />
                      <span className="text-[10px] text-white/70 w-14 text-right font-mono">{targetLufs} LUFS</span>
                    </div>
                    <button
                      disabled={!canExport || isExporting}
                      onClick={startExport}
                      className={cx(
                        "w-full py-4 sm:py-5 rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 sm:gap-3 font-bold transition-all tracking-[0.2em] sm:tracking-[0.25em] uppercase text-sm active:scale-95",
                        !canExport || isExporting 
                          ? "bg-white/5 text-white/30 cursor-not-allowed" 
                          : "btn-primary text-black"
                      )}
                    >
                      {isExporting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                          Exporting…
                        </>
                      ) : (
                        <><Download size={18} /> Bounce</>
                      )}
                    </button>
                  </div>
                </div>

                {/* Right Column */}
                <div className="lg:col-span-8 flex flex-col gap-5 sm:gap-6">
                  
                  {/* EQ Panel */}
                  <div className="glass-card rounded-none p-5 sm:p-8 shadow-2xl overflow-hidden">
                    <div className="flex justify-between items-center mb-5 sm:mb-6">
                      <div className="flex items-center gap-2">
                        <Radio size={14} className="text-white/30" />
                        <span className="text-[10px] font-black tracking-[0.3em] text-white/40 uppercase">Parametric EQ</span>
                      </div>
                      <button
                        onClick={resetEq}
                        className="px-4 py-2 rounded-xl btn-glass text-[9px] sm:text-[10px] font-bold tracking-[0.2em] sm:tracking-[0.25em] uppercase active:scale-95"
                      >
                        Reset
                      </button>
                    </div>

                    <div
                      ref={graphEqRef}
                      onMouseDown={onGraphMouseDown}
                      onTouchStart={onGraphTouchStart}
                      onTouchMove={onGraphTouchMove}
                      className="relative h-40 sm:h-52 w-full border border-white/5 bg-gradient-to-b from-zinc-950/80 to-black/90 rounded-none cursor-crosshair overflow-hidden touch-none"
                    >
                      {/* Grid lines */}
                      <div className="absolute inset-0 opacity-20">
                        <div className="absolute inset-0" style={{
                          backgroundImage: `
                            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
                          `,
                          backgroundSize: '25% 25%',
                        }} />
                      </div>
                      
                      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-80" viewBox="0 0 100 160">
                        <path
                          d={`M 0 ${eqBaseLine} L 100 ${eqBaseLine}`}
                          stroke="rgba(255,255,255,0.2)"
                          strokeWidth="1.5"
                          fill="none"
                          strokeDasharray="4 6"
                        />
                        <path
                          d={eqActivePath}
                          stroke={NEON.hex}
                          strokeWidth="2.5"
                          fill="none"
                          className="transition-all duration-300 drop-shadow-[0_0_10px_rgba(188,19,254,0.6)]"
                        />
                      </svg>

                      <div className="absolute inset-0 flex items-center justify-between px-6 sm:px-10">
                        {eqBands.map((band) => (
                          <div
                            key={band}
                            className={cx(
                              "w-3 h-3 sm:w-3.5 sm:h-3.5 border-2 transition-all duration-200",
                              activeBand === band
                                ? "bg-cyan-400 border-white scale-125 shadow-[0_0_18px_rgba(188,19,254,0.8)]"
                                : "bg-transparent border-white/30 hover:border-white/50"
                            )}
                            style={{ transform: `translateY(${-eq[band] * 1.6}px)` }}
                          />
                        ))}
                      </div>

                      <div className="absolute bottom-2 left-3 right-3 flex justify-between text-[9px] text-white/40 uppercase tracking-[0.2em]">
                        <span>0</span>
                        <span>60</span>
                        <span>250</span>
                        <span>1k</span>
                        <span>4k</span>
                        <span>8k</span>
                        <span>16k</span>
                      </div>
                    </div>

                    <div className="mt-5 sm:mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
                      {eqBands.map((band) => (
                        <div 
                          key={band} 
                          className={cx(
                            "p-4 sm:p-5 rounded-none border transition-all",
                            activeBand === band 
                              ? "bg-zinc-900/80 border-cyan-500/40 neon-glow-sm" 
                              : "bg-zinc-950/50 border-white/5"
                          )}
                        >
                          <div className="flex flex-col sm:flex-row justify-between items-center mb-3 gap-1">
                            <span className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em]">{band}</span>
                            <span className="text-base sm:text-lg font-black text-cyan-400 font-mono">{eq[band]}dB</span>
                          </div>

                          <input
                            type="range"
                            min={-24}
                            max={24}
                            step={1}
                            value={eq[band]}
                            onChange={(e) => applyBandGain(band, parseInt(e.target.value, 10))}
                            onFocus={() => setActiveBand(band)}
                            className="w-full eq-slider"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Processing Modules Grid */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    
                    {/* Compressor */}
                    <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Compressor</span>
                        <button
                          onClick={() => setCompressor((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1.5 rounded-full border text-[9px] uppercase tracking-[0.15em] transition-all",
                            compressor.bypass ? "border-white/10 text-white/40 bg-white/5" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm"
                          )}
                        >
                          {compressor.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[11px] text-white/60 uppercase tracking-[0.15em]">
                        <label className="flex items-center justify-between gap-3">
                          <span>Threshold</span>
                          <span className="text-cyan-200 font-mono">{compressor.threshold} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-40}
                          max={0}
                          step={1}
                          value={compressor.threshold}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, threshold: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                        <label className="flex items-center justify-between gap-3">
                          <span>Ratio</span>
                          <span className="text-cyan-200 font-mono">{compressor.ratio.toFixed(1)}:1</span>
                        </label>
                        <input
                          type="range"
                          min={1}
                          max={8}
                          step={0.1}
                          value={compressor.ratio}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, ratio: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                        <label className="flex items-center justify-between gap-3">
                          <span>Attack</span>
                          <span className="text-cyan-200 font-mono">{Math.round(compressor.attack * 1000)} ms</span>
                        </label>
                        <input
                          type="range"
                          min={1}
                          max={200}
                          step={1}
                          value={compressor.attack * 1000}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, attack: parseFloat(e.target.value) / 1000 }))}
                          className="w-full"
                        />
                        <label className="flex items-center justify-between gap-3">
                          <span>Release</span>
                          <span className="text-cyan-200 font-mono">{Math.round(compressor.release * 1000)} ms</span>
                        </label>
                        <input
                          type="range"
                          min={50}
                          max={1000}
                          step={10}
                          value={compressor.release * 1000}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, release: parseFloat(e.target.value) / 1000 }))}
                          className="w-full"
                        />
                        <label className="flex items-center justify-between gap-3">
                          <span>Makeup</span>
                          <span className="text-cyan-200 font-mono">{compressor.makeup} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-6}
                          max={12}
                          step={0.5}
                          value={compressor.makeup}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, makeup: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                    </div>

                    {/* Limiter */}
                    <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Limiter</span>
                        <button
                          onClick={() => setLimiter((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1.5 rounded-full border text-[9px] uppercase tracking-[0.15em] transition-all",
                            limiter.bypass ? "border-white/10 text-white/40 bg-white/5" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm"
                          )}
                        >
                          {limiter.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[11px] text-white/60 uppercase tracking-[0.15em]">
                        <label className="flex items-center justify-between gap-3">
                          <span>Threshold</span>
                          <span className="text-cyan-200 font-mono">{limiter.threshold} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-12}
                          max={0}
                          step={0.5}
                          value={limiter.threshold}
                          onChange={(e) => setLimiter((prev) => ({ ...prev, threshold: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                        <label className="flex items-center justify-between gap-3">
                          <span>Ceiling</span>
                          <span className="text-cyan-200 font-mono">{limiter.ceiling} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-1}
                          max={0}
                          step={0.1}
                          value={limiter.ceiling}
                          onChange={(e) => setLimiter((prev) => ({ ...prev, ceiling: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                        <label className="flex items-center justify-between gap-3">
                          <span>Release</span>
                          <span className="text-cyan-200 font-mono">{limiter.release} ms</span>
                        </label>
                        <input
                          type="range"
                          min={20}
                          max={800}
                          step={10}
                          value={limiter.release}
                          onChange={(e) => setLimiter((prev) => ({ ...prev, release: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                        <button
                          onClick={() => setLimiter((prev) => ({ ...prev, softClip: !prev.softClip }))}
                          className={cx(
                            "w-full py-2.5 rounded-xl border text-[9px] tracking-[0.2em] uppercase transition-all active:scale-95",
                            limiter.softClip ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm" : "border-white/10 text-white/50 bg-white/5"
                          )}
                        >
                          Soft Clip {limiter.softClip ? "On" : "Off"}
                        </button>
                      </div>
                    </div>

                    {/* Saturation */}
                    <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Saturation</span>
                        <button
                          onClick={() => setSaturation((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1.5 rounded-full border text-[9px] uppercase tracking-[0.15em] transition-all",
                            saturation.bypass ? "border-white/10 text-white/40 bg-white/5" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm"
                          )}
                        >
                          {saturation.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[11px] text-white/60 uppercase tracking-[0.15em]">
                        <label className="flex items-center justify-between gap-3">
                          <span>Drive</span>
                          <span className="text-cyan-200 font-mono">{Math.round(saturation.drive * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={saturation.drive}
                          onChange={(e) => setSaturation((prev) => ({ ...prev, drive: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                        <label className="flex items-center justify-between gap-3">
                          <span>Mix</span>
                          <span className="text-cyan-200 font-mono">{Math.round(saturation.mix * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={saturation.mix}
                          onChange={(e) => setSaturation((prev) => ({ ...prev, mix: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                    </div>

                    {/* Stereo Tools */}
                    <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Stereo Tools</span>
                        <button
                          onClick={() => setStereo((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1.5 rounded-full border text-[9px] uppercase tracking-[0.15em] transition-all",
                            stereo.bypass ? "border-white/10 text-white/40 bg-white/5" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm"
                          )}
                        >
                          {stereo.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[11px] text-white/60 uppercase tracking-[0.15em]">
                        <label className="flex items-center justify-between gap-3">
                          <span>Width</span>
                          <span className="text-cyan-200 font-mono">{stereo.width.toFixed(2)}x</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.01}
                          value={stereo.width}
                          onChange={(e) => setStereo((prev) => ({ ...prev, width: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                        <label className="flex items-center justify-between gap-3">
                          <span>Pan</span>
                          <span className="text-cyan-200 font-mono">{stereo.pan.toFixed(2)}</span>
                        </label>
                        <input
                          type="range"
                          min={-1}
                          max={1}
                          step={0.01}
                          value={stereo.pan}
                          onChange={(e) => setStereo((prev) => ({ ...prev, pan: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                        <button
                          onClick={() => setStereo((prev) => ({ ...prev, mono: !prev.mono }))}
                          className={cx(
                            "w-full py-2.5 rounded-xl border text-[9px] tracking-[0.2em] uppercase transition-all active:scale-95",
                            stereo.mono ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm" : "border-white/10 text-white/50 bg-white/5"
                          )}
                        >
                          Mono {stereo.mono ? "On" : "Off"}
                        </button>
                      </div>
                    </div>

                    {/* Output - Full Width */}
                    <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4 xl:col-span-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Output</span>
                        <button
                          onClick={() => setOutput((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1.5 rounded-full border text-[9px] uppercase tracking-[0.15em] transition-all",
                            output.bypass ? "border-white/10 text-white/40 bg-white/5" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10 neon-glow-sm"
                          )}
                        >
                          {output.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[11px] text-white/60 uppercase tracking-[0.15em]">
                        <label className="flex items-center justify-between gap-3">
                          <span>Trim</span>
                          <span className="text-cyan-200 font-mono">{output.trim} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={0.5}
                          value={output.trim}
                          onChange={(e) => setOutput((prev) => ({ ...prev, trim: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <footer className="px-4 sm:px-8 py-3 sm:py-4 bg-black/80 backdrop-blur-xl border-t border-white/5 flex flex-col sm:flex-row gap-2 sm:gap-4 justify-between items-center text-[9px] sm:text-[10px] text-white/30 uppercase tracking-[0.15em] sm:tracking-[0.25em] font-bold">
              <div className="flex gap-4 sm:gap-6 items-center flex-wrap justify-center">
                <span className="flex items-center gap-1.5 sm:gap-2 text-cyan-400">
                  <Terminal size={12} /> System_Stable
                </span>
                <span className="text-white/20">|</span>
                <span>Latency: 2ms</span>
                <span className="text-white/20">|</span>
                <span>SR: 48kHz</span>
              </div>
              <div className="flex items-center gap-3 sm:gap-4 flex-wrap justify-center">
                <span className="text-zinc-600 italic hidden sm:inline">"Sound is survival"</span>
                <span className="text-white/20">|</span>
                <span>Core v4.5</span>
              </div>
            </footer>
          </div>
        </>
      )}
    </div>
  );
}
