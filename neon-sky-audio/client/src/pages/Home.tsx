/**
 * NEON SKY Audio Mastering Suite v4
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

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  ChevronLeft,
  ChevronRight,
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
} from "lucide-react";
import { useAudioEngine, type Band, type Phase, type VizMode } from "../hooks/useAudioEngine";

const NEON = {
  hex: "#bc13fe", // cyberpunk purple
  rgba: "188,19,254",
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

export default function Home() {
  // -------- App/UI State --------
  const [phase, setPhase] = useState<Phase>("splash");
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const presetInputRef = useRef<HTMLInputElement | null>(null);
  const addFileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    vizMode,
    setVizMode,
    isLoading,
    isExporting,
    error,
    clearError,
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
  } = useAudioEngine({ visualizerColor: NEON.rgba, visualizerActive: phase === "player", visualizerPulse: true });

  // -------- Phase timing --------
  useEffect(() => {
    const t = window.setTimeout(() => setPhase("boot"), 2000);
    return () => window.clearTimeout(t);
  }, []);

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

  // -------- Styles --------
  const bgStyle = useMemo(
    () => ({
      background: `radial-gradient(circle at 50% 50%, ${NEON.hex}, #6d28d9, #ff00ff, #050505)`,
      backgroundSize: "400% 400%",
    }),
    []
  );

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

  // -------- Render --------
  return (
    <div className="min-h-screen min-h-[100dvh] bg-black text-white font-mono selection:bg-cyan-500 selection:text-black relative overflow-hidden">
      {/* Persistent elements (never unmount) */}
      <audio ref={audioRef} className="hidden" playsInline crossOrigin="anonymous" />
      <input ref={fileInputRef} type="file" className="hidden" multiple onChange={(e) => handleFile(e, "replace")} />
      <input ref={addFileInputRef} type="file" className="hidden" multiple onChange={(e) => handleFile(e, "append")} />
      <input ref={presetInputRef} type="file" className="hidden" accept="application/json" onChange={handlePresetImport} />

      <div className="fixed inset-0 pointer-events-none opacity-25 z-0">
        <div className="absolute inset-0 animate-tie-dye" style={bgStyle} />
        <div className="absolute inset-0 backdrop-blur-[110px]" />
      </div>

      {error && (
        <div className="fixed top-4 left-4 right-4 z-[60] max-w-2xl mx-auto rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-xl p-3 flex items-start justify-between gap-3">
          <div className="text-xs sm:text-sm text-red-200">{error}</div>
          <button onClick={clearError} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition flex-shrink-0" aria-label="Dismiss">
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
            <p className="text-fuchsia-300/60 font-mono tracking-widest text-[10px] sm:text-xs mt-2 uppercase text-center">Mastering Suite v4</p>
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
            onClick={handleInit}
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
            <div className="w-full max-w-[340px] sm:max-w-sm bg-zinc-900/60 backdrop-blur-3xl border border-white/10 ring-2 ring-black rounded-[2rem] sm:rounded-[3rem] p-5 sm:p-8 shadow-2xl flex flex-col items-center gap-4 sm:gap-5">
              
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
                <div className="absolute right-2 top-2 flex items-center gap-1 bg-black/40 border border-white/10 rounded-full px-1 py-1 backdrop-blur">
                  <button
                    onClick={handleVizPrev}
                    className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white transition active:scale-95"
                    aria-label="Previous visualizer mode"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={handleVizNext}
                    className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white transition active:scale-95"
                    aria-label="Next visualizer mode"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
                <div className="absolute left-2 bottom-2 text-[9px] text-white/50 uppercase tracking-[0.3em]">
                  {vizMode}
                </div>
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
                  onPointerCancel={onRingPointerCancel}
                  className={cx(
                    "relative w-24 h-24 sm:w-28 sm:h-28 select-none touch-none",
                    track.duration ? "cursor-pointer" : "cursor-default"
                  )}
                  aria-label="Seek ring"
                >
                  <div className="absolute inset-2 rounded-full bg-gradient-to-br from-amber-200/20 via-amber-500/10 to-amber-900/40 shadow-[inset_0_2px_10px_rgba(255,255,255,0.25),inset_0_-8px_14px_rgba(0,0,0,0.6),0_10px_18px_rgba(0,0,0,0.45)]" />
                  <svg className="absolute inset-0" viewBox="0 0 120 120">
                    <defs>
                      <linearGradient id="scrub-track" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(255,214,170,0.2)" />
                        <stop offset="100%" stopColor="rgba(255,120,90,0.45)" />
                      </linearGradient>
                      <linearGradient id="scrub-progress" x1="0" x2="1" y1="1" y2="0">
                        <stop offset="0%" stopColor="rgba(255,159,67,0.95)" />
                        <stop offset="100%" stopColor="rgba(255,204,102,0.95)" />
                      </linearGradient>
                      <radialGradient id="scrub-handle" cx="30%" cy="30%" r="70%">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
                        <stop offset="60%" stopColor="rgba(255,191,115,0.95)" />
                        <stop offset="100%" stopColor="rgba(178,88,20,0.95)" />
                      </radialGradient>
                      <filter id="scrub-shadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="rgba(0,0,0,0.7)" />
                      </filter>
                    </defs>
                    <circle cx="60" cy="60" r="50" stroke="url(#scrub-track)" strokeWidth="9" fill="none" />
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      stroke="url(#scrub-progress)"
                      strokeWidth="9"
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
                        r="6.5"
                        fill="url(#scrub-handle)"
                        stroke="rgba(255,255,255,0.6)"
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
                        ? "bg-gradient-to-br from-white via-amber-50 to-amber-200 text-black hover:scale-105 shadow-[0_6px_18px_rgba(255,200,120,0.35)]"
                        : "bg-white/20 text-white/60 cursor-not-allowed"
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

                <div className="px-5 py-3 border-b border-white/10 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={14} />
                      <input
                        value={queueSearch}
                        onChange={(e) => setQueueSearch(e.target.value)}
                        placeholder="Search title, artist, album, type..."
                        className="w-full rounded-xl bg-white/5 border border-white/10 pl-9 pr-3 py-2 text-xs text-white/80 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                      />
                    </div>
                    <button
                      onClick={() => addFileInputRef.current?.click()}
                      className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-white/10 transition"
                    >
                      <Plus size={12} /> Add
                    </button>
                    <button
                      onClick={handleRemoveSelected}
                      disabled={selectedIds.size === 0}
                      className={cx(
                        "h-9 px-3 rounded-xl border text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 transition",
                        selectedIds.size
                          ? "bg-red-500/20 border-red-500/30 text-red-200 hover:bg-red-500/30"
                          : "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
                      )}
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[9px] text-white/40 uppercase tracking-[0.2em]">
                    <button onClick={toggleSelectAll} className="flex items-center gap-2 hover:text-white/70 transition">
                      <span className={cx("w-2 h-2 rounded-full", allSelected ? "bg-cyan-400" : "bg-white/20")} />
                      {allSelected ? "Clear selection" : "Select all"}
                    </button>
                    <div className="flex items-center gap-4">
                      <span>{playlist.length} tracks</span>
                      <span>Total {formatDuration(totalDuration)}</span>
                      <span>{selectedIds.size} selected</span>
                    </div>
                  </div>
                </div>

                <div className="max-h-[60vh] overflow-y-auto">
                  {playlist.length === 0 ? (
                    <div className="p-6 text-xs text-white/50">No tracks loaded.</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {filteredPlaylist.map((it) => {
                        const playlistIndex = playlist.findIndex((entry) => entry.id === it.id);
                        return (
                          <div
                            key={it.id}
                            className={cx(
                              "w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-white/5 transition",
                              playlistIndex === currentIndex && "bg-white/5"
                            )}
                          >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(it.id)}
                            onChange={() => toggleSelected(it.id)}
                            className="mt-1 h-4 w-4 rounded border border-white/20 bg-white/5 accent-cyan-500"
                            aria-label={`Select ${it.title}`}
                          />
                          <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center flex-shrink-0">
                            {it.artwork ? (
                              <img src={it.artwork} alt={`${it.title} artwork`} className="w-full h-full object-cover" />
                            ) : (
                              <Music size={16} className="text-white/30" />
                            )}
                            {it.extension && (
                              <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[8px] uppercase text-white/60">
                                {it.extension}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            <input
                              value={it.title}
                              onChange={(e) => updatePlaylistItem(it.id, { title: e.target.value })}
                              className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-xs text-white/80 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                              placeholder="Track title"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                value={it.artist}
                                onChange={(e) => updatePlaylistItem(it.id, { artist: e.target.value })}
                                className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-white/70 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                placeholder="Artist"
                              />
                              <input
                                value={it.album}
                                onChange={(e) => updatePlaylistItem(it.id, { album: e.target.value })}
                                className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-white/70 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                placeholder="Album"
                              />
                            </div>
                            <div className="flex items-center gap-3 text-[9px] text-white/40 uppercase tracking-[0.2em]">
                              <span>{formatDuration(it.duration)}</span>
                              <span>#{playlistIndex + 1}</span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => {
                                setQueueOpen(false);
                                void loadTrackAt(playlistIndex, { autoplay: true });
                              }}
                              className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition"
                              aria-label={`Play ${it.title}`}
                            >
                              <Play size={12} />
                            </button>
                            <label className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition cursor-pointer">
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
                              className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition text-red-200"
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
                    <label className="text-[9px] sm:text-[10px] text-cyan-400 uppercase tracking-[0.3em] sm:tracking-[0.35em] font-bold">Metering</label>
                    <div className="grid grid-cols-2 gap-3 text-[10px] sm:text-xs text-white/70">
                      <div className="flex flex-col gap-1">
                        <span className="text-white/40 uppercase tracking-[0.2em]">Peak</span>
                        <span className="text-cyan-200 font-semibold">{formatDb(toDb(meter.peak))} dB</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-white/40 uppercase tracking-[0.2em]">RMS</span>
                        <span className="text-cyan-200 font-semibold">{formatDb(toDb(meter.rms))} dB</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-white/40 uppercase tracking-[0.2em]">LUFS M</span>
                        <span className="text-cyan-200 font-semibold">{formatDb(meter.lufsMomentary)} LU</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-white/40 uppercase tracking-[0.2em]">LUFS S</span>
                        <span className="text-cyan-200 font-semibold">{formatDb(meter.lufsShort)} LU</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-white/40 uppercase tracking-[0.2em]">LUFS I</span>
                        <span className="text-cyan-200 font-semibold">{formatDb(meter.lufsIntegrated)} LU</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-white/40 uppercase tracking-[0.2em]">Corr</span>
                        <span className="text-cyan-200 font-semibold">{meter.correlation.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-cyan-400"
                        style={{ width: `${clampValue((meter.correlation + 1) * 50, 0, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="bg-white/5 rounded-2xl sm:rounded-3xl p-5 sm:p-8 border border-white/10 space-y-4 sm:space-y-6">
                    <label className="text-[9px] sm:text-[10px] text-cyan-400 uppercase tracking-[0.3em] sm:tracking-[0.35em] font-bold">Presets</label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => recallPresetSlot("A")}
                        className={cx(
                          "flex-1 py-2 rounded-xl border text-[10px] font-bold tracking-[0.25em] uppercase transition",
                          activePresetSlot === "A" ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10" : "border-white/10 text-white/50 bg-white/5"
                        )}
                      >
                        A {presetA ? "●" : ""}
                      </button>
                      <button
                        onClick={() => recallPresetSlot("B")}
                        className={cx(
                          "flex-1 py-2 rounded-xl border text-[10px] font-bold tracking-[0.25em] uppercase transition",
                          activePresetSlot === "B" ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10" : "border-white/10 text-white/50 bg-white/5"
                        )}
                      >
                        B {presetB ? "●" : ""}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => storePresetSlot("A")}
                        className="py-2 rounded-xl border border-white/10 text-[9px] tracking-[0.2em] uppercase text-white/60 hover:bg-white/10 transition"
                      >
                        Store A
                      </button>
                      <button
                        onClick={() => storePresetSlot("B")}
                        className="py-2 rounded-xl border border-white/10 text-[9px] tracking-[0.2em] uppercase text-white/60 hover:bg-white/10 transition"
                      >
                        Store B
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={exportPresetJson}
                        className="py-2 rounded-xl border border-white/10 text-[9px] tracking-[0.2em] uppercase text-white/60 hover:bg-white/10 transition"
                      >
                        Save JSON
                      </button>
                      <button
                        onClick={() => presetInputRef.current?.click()}
                        className="py-2 rounded-xl border border-white/10 text-[9px] tracking-[0.2em] uppercase text-white/60 hover:bg-white/10 transition"
                      >
                        Load JSON
                      </button>
                    </div>
                    <button
                      onClick={() => setGainMatchEnabled(!gainMatchEnabled)}
                      className={cx(
                        "w-full py-2 rounded-xl border text-[9px] tracking-[0.25em] uppercase transition",
                        gainMatchEnabled ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10" : "border-white/10 text-white/50 bg-white/5"
                      )}
                    >
                      Gain Match {gainMatchEnabled ? "On" : "Off"}
                    </button>
                  </div>

                  <div className="bg-white/5 rounded-2xl sm:rounded-3xl p-5 sm:p-8 border border-white/10 space-y-4 sm:space-y-6">
                    <label className="text-[9px] sm:text-[10px] text-cyan-400 uppercase tracking-[0.3em] sm:tracking-[0.35em] font-bold">Export</label>
                    <div className="flex items-center justify-between text-[9px] sm:text-[10px] text-white/60 uppercase tracking-[0.2em]">
                      <span>Loudness Normalize</span>
                      <button
                        onClick={() => setNormalizeLoudness(!normalizeLoudness)}
                        className={cx(
                          "px-3 py-1 rounded-full border transition",
                          normalizeLoudness ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10" : "border-white/10 text-white/50 bg-white/5"
                        )}
                      >
                        {normalizeLoudness ? "On" : "Off"}
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[9px] sm:text-[10px] text-white/40 uppercase tracking-[0.2em]">Target</span>
                      <input
                        type="range"
                        min={-20}
                        max={-6}
                        step={0.5}
                        value={targetLufs}
                        onChange={(e) => setTargetLufs(parseFloat(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <span className="text-[9px] sm:text-[10px] text-white/70 w-12 text-right">{targetLufs} LUFS</span>
                    </div>
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
                      <span className="text-[9px] sm:text-[10px] font-black tracking-[0.3em] sm:tracking-[0.4em] text-white/30 uppercase">Parametric EQ</span>
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

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-black/70 rounded-2xl border border-white/10 p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Compressor</span>
                        <button
                          onClick={() => setCompressor((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1 rounded-full border text-[9px] uppercase tracking-[0.2em]",
                            compressor.bypass ? "border-white/10 text-white/40" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10"
                          )}
                        >
                          {compressor.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[10px] text-white/60 uppercase tracking-[0.2em]">
                        <label className="flex items-center justify-between gap-3">
                          Threshold <span className="text-cyan-200">{compressor.threshold} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-40}
                          max={0}
                          step={1}
                          value={compressor.threshold}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, threshold: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                        <label className="flex items-center justify-between gap-3">
                          Ratio <span className="text-cyan-200">{compressor.ratio.toFixed(1)}:1</span>
                        </label>
                        <input
                          type="range"
                          min={1}
                          max={8}
                          step={0.1}
                          value={compressor.ratio}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, ratio: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                        <label className="flex items-center justify-between gap-3">
                          Attack <span className="text-cyan-200">{Math.round(compressor.attack * 1000)} ms</span>
                        </label>
                        <input
                          type="range"
                          min={1}
                          max={200}
                          step={1}
                          value={compressor.attack * 1000}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, attack: parseFloat(e.target.value) / 1000 }))}
                          className="w-full accent-cyan-500"
                        />
                        <label className="flex items-center justify-between gap-3">
                          Release <span className="text-cyan-200">{Math.round(compressor.release * 1000)} ms</span>
                        </label>
                        <input
                          type="range"
                          min={50}
                          max={1000}
                          step={10}
                          value={compressor.release * 1000}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, release: parseFloat(e.target.value) / 1000 }))}
                          className="w-full accent-cyan-500"
                        />
                        <label className="flex items-center justify-between gap-3">
                          Makeup <span className="text-cyan-200">{compressor.makeup} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-6}
                          max={12}
                          step={0.5}
                          value={compressor.makeup}
                          onChange={(e) => setCompressor((prev) => ({ ...prev, makeup: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                      </div>
                    </div>

                    <div className="bg-black/70 rounded-2xl border border-white/10 p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Limiter</span>
                        <button
                          onClick={() => setLimiter((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1 rounded-full border text-[9px] uppercase tracking-[0.2em]",
                            limiter.bypass ? "border-white/10 text-white/40" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10"
                          )}
                        >
                          {limiter.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[10px] text-white/60 uppercase tracking-[0.2em]">
                        <label className="flex items-center justify-between gap-3">
                          Threshold <span className="text-cyan-200">{limiter.threshold} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-12}
                          max={0}
                          step={0.5}
                          value={limiter.threshold}
                          onChange={(e) => setLimiter((prev) => ({ ...prev, threshold: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                        <label className="flex items-center justify-between gap-3">
                          Ceiling <span className="text-cyan-200">{limiter.ceiling} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-1}
                          max={0}
                          step={0.1}
                          value={limiter.ceiling}
                          onChange={(e) => setLimiter((prev) => ({ ...prev, ceiling: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                        <label className="flex items-center justify-between gap-3">
                          Release <span className="text-cyan-200">{limiter.release} ms</span>
                        </label>
                        <input
                          type="range"
                          min={20}
                          max={800}
                          step={10}
                          value={limiter.release}
                          onChange={(e) => setLimiter((prev) => ({ ...prev, release: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                        <button
                          onClick={() => setLimiter((prev) => ({ ...prev, softClip: !prev.softClip }))}
                          className={cx(
                            "w-full py-2 rounded-xl border text-[9px] tracking-[0.2em] uppercase transition",
                            limiter.softClip ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10" : "border-white/10 text-white/50 bg-white/5"
                          )}
                        >
                          Soft Clip {limiter.softClip ? "On" : "Off"}
                        </button>
                      </div>
                    </div>

                    <div className="bg-black/70 rounded-2xl border border-white/10 p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Saturation</span>
                        <button
                          onClick={() => setSaturation((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1 rounded-full border text-[9px] uppercase tracking-[0.2em]",
                            saturation.bypass ? "border-white/10 text-white/40" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10"
                          )}
                        >
                          {saturation.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[10px] text-white/60 uppercase tracking-[0.2em]">
                        <label className="flex items-center justify-between gap-3">
                          Drive <span className="text-cyan-200">{Math.round(saturation.drive * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={saturation.drive}
                          onChange={(e) => setSaturation((prev) => ({ ...prev, drive: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                        <label className="flex items-center justify-between gap-3">
                          Mix <span className="text-cyan-200">{Math.round(saturation.mix * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={saturation.mix}
                          onChange={(e) => setSaturation((prev) => ({ ...prev, mix: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                      </div>
                    </div>

                    <div className="bg-black/70 rounded-2xl border border-white/10 p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Stereo Tools</span>
                        <button
                          onClick={() => setStereo((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1 rounded-full border text-[9px] uppercase tracking-[0.2em]",
                            stereo.bypass ? "border-white/10 text-white/40" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10"
                          )}
                        >
                          {stereo.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[10px] text-white/60 uppercase tracking-[0.2em]">
                        <label className="flex items-center justify-between gap-3">
                          Width <span className="text-cyan-200">{stereo.width.toFixed(2)}x</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.01}
                          value={stereo.width}
                          onChange={(e) => setStereo((prev) => ({ ...prev, width: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                        <label className="flex items-center justify-between gap-3">
                          Pan <span className="text-cyan-200">{stereo.pan.toFixed(2)}</span>
                        </label>
                        <input
                          type="range"
                          min={-1}
                          max={1}
                          step={0.01}
                          value={stereo.pan}
                          onChange={(e) => setStereo((prev) => ({ ...prev, pan: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                        <button
                          onClick={() => setStereo((prev) => ({ ...prev, mono: !prev.mono }))}
                          className={cx(
                            "w-full py-2 rounded-xl border text-[9px] tracking-[0.2em] uppercase transition",
                            stereo.mono ? "border-cyan-500/60 text-cyan-200 bg-cyan-500/10" : "border-white/10 text-white/50 bg-white/5"
                          )}
                        >
                          Mono {stereo.mono ? "On" : "Off"}
                        </button>
                      </div>
                    </div>

                    <div className="bg-black/70 rounded-2xl border border-white/10 p-5 sm:p-6 space-y-4 xl:col-span-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">Output</span>
                        <button
                          onClick={() => setOutput((prev) => ({ ...prev, bypass: !prev.bypass }))}
                          className={cx(
                            "px-3 py-1 rounded-full border text-[9px] uppercase tracking-[0.2em]",
                            output.bypass ? "border-white/10 text-white/40" : "border-cyan-500/60 text-cyan-200 bg-cyan-500/10"
                          )}
                        >
                          {output.bypass ? "Bypass" : "Active"}
                        </button>
                      </div>
                      <div className="space-y-3 text-[10px] text-white/60 uppercase tracking-[0.2em]">
                        <label className="flex items-center justify-between gap-3">
                          Trim <span className="text-cyan-200">{output.trim} dB</span>
                        </label>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={0.5}
                          value={output.trim}
                          onChange={(e) => setOutput((prev) => ({ ...prev, trim: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-500"
                        />
                      </div>
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
                <span>Core v4</span>
              </div>
            </footer>
          </div>
        </>
      )}
    </div>
  );
}
