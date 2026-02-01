# Feature Wiring Map & Audit

## 1) User-facing feature inventory (from UI)
- Player transport (play/pause, previous/next) and track info display.
- Visualizer (bars/wave) on the main player.
- Seek/progress ring (touch + drag).
- Playlist/queue modal with highlight + selection.
- EQ suite (graph + sliders).
- Export/bounce.
- Metadata parsing (ID3 artwork/title/artist/album).
- Volume/mute control.

## 2) Feature wiring map

| Feature | UI Location | Implementing code | Status | Notes |
| --- | --- | --- | --- | --- |
| Player transport | Home player transport controls | `Home.tsx` + `useAudioEngine` (play/pause/prev/next) | **Partially wired** | Logic existed in UI file; now delegated to hook. Requires AudioContext initialization to work reliably. |
| Visualizer | Player canvas + mode toggle | `useAudioEngine` visualizer loop + analyser | **Broken** | Prior code could render at 0×0 and didn’t reliably resume AudioContext on visibility/gesture. |
| Seek/progress ring | Player seek ring | `useAudioEngine` pointer handlers | **Partially wired** | Ring logic existed but no pointer cancel handling and no central AudioEngine module. |
| Playlist / queue | Queue modal + load button | `useAudioEngine` file handling, queue selection | **Partially wired** | File URLs were created but object URL cleanup and auto-advance needed formalization. |
| EQ suite | Graph + sliders in Suite | `useAudioEngine` EQ filters | **Partially wired** | EQ state existed, but needed to be centralized and reused for export. |
| Export/bounce | Suite export button | `useAudioEngine` export logic | **Broken** | MediaRecorder-only; unreliable on Safari/iOS; no offline export fallback. |
| Metadata | Track info + artwork | `useAudioEngine` ID3 parsing | **Working** | Uses `music-metadata` to parse tags and artwork. |
| Volume/mute | Player volume slider + mute | `useAudioEngine` gain control | **Working** | Gain node updates volume, mute toggles. |

## 3) Root-cause analysis (broken behaviors)
- **Visualizer 0×0 canvas**: The canvas size depended on layout timing only; no ResizeObserver to update on dynamic layout changes or font loading, so some render phases produced 0×0 dimensions.
- **AudioContext suspend bugs**: Safari/iOS requires a user gesture to resume; when returning from background or after visibility changes, the AudioContext remained suspended.
- **Seek ring robustness**: Pointer cancel wasn’t handled; on touch interruption the drag state could stick, preventing updates.
- **Playlist leaks & auto-advance**: Object URLs for audio + artwork weren’t consistently revoked on replacement/unmount. Auto-advance needed to be coordinated with the audio element lifecycle.
- **Export reliability**: MediaRecorder is not reliable across Safari/iOS; a deterministic offline render (OfflineAudioContext) is needed.

## 4) Smallest changes that wire features end-to-end (without UI changes)
1. **Introduce a dedicated audio engine module** (`useAudioEngine`) to own WebAudio graph, transport, and lifecycle state.
2. **Make visualizer resilient** with resize observers and loop checks for non-zero canvas sizes, and resume AudioContext on pointer/visibility events.
3. **Harden seek ring** with pointer cancel handling and integrate with engine state (drag vs. playback time).
4. **Playlist robustness** with object URL revocation, auto-advance on ended, and stable queue state in a single engine.
5. **Export reliability** with OfflineAudioContext WAV export and MediaRecorder fallback.

## 5) Priority checklist (top fixes first)
- [x] Add `useAudioEngine` and move WebAudio lifecycle/playlist logic into it.
- [x] Visualizer: enforce ResizeObserver + non-zero canvas checks + resume AudioContext on visibility/gesture.
- [x] Seek ring: pointer cancel handling + drag updates wired to audio engine.
- [x] Playlist: multi-file upload, queue selection, auto-advance, URL cleanup.
- [x] Export: offline WAV export via OfflineAudioContext (fallback to MediaRecorder).

## 6) Top 5 fixes implemented in this PR
1. Modular `useAudioEngine` hook that owns WebAudio nodes, transport, and EQ state.
2. Robust visualizer sizing and resume handling to avoid 0×0 render + suspended contexts.
3. Pointer-safe seek ring with drag/commit + cancel logic.
4. Playlist lifecycle (multi-file upload, highlight current track, auto-advance, URL cleanup).
5. Reliable export pipeline with OfflineAudioContext WAV render + recorder fallback.
