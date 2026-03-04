# FlowOrFlop

Tauri v2 desktop app (macOS/Windows) that monitors whether you are looking at the screen.

- If you look away for long enough, it opens a configured application URL.
- If you look back at the screen, it closes the in-app application window.
- It uses a separate always-on-top camera overlay window with click-to-toggle modes.

## Core behavior

- Overlay window: always on top, camera preview, click to toggle `booth`/`circle` mode.
- Mode transition animation: width/height, border radius/clip, shadow, scale, opacity (`300ms ease-in-out`).
- Gaze logic:
  - `LOOK_AWAY` when non-front-facing state is continuous for `700ms`.
  - `LOOK_BACK` when front-facing state is continuous for `500ms`.
  - Hysteresis: away transition uses threshold + `3deg`, return transition uses base threshold.
  - `NO_FACE` for `>= 400ms` is treated as away.
- URL window behavior:
  - `webview` mode: open/focus single in-app window, close on `LOOK_BACK`.
  - `browser` mode: open default browser on `LOOK_AWAY`; auto-close is not supported.
  - URL action toggle: when disabled, automatic URL open/close actions are fully paused.

## Privacy

- Face direction estimation runs locally.
- No video recording.
- No video upload/transfer.
- Detection can be enabled/disabled in settings.

## Tech stack

- Shell: Tauri v2 + Rust
- UI: React + TypeScript + Vite
- Camera preview: `getUserMedia`
- Face direction estimation: `@mediapipe/tasks-vision` Face Landmarker (bundled model)
- Optional gaze sidecar: `L2CS-Net` Python worker (`src-tauri/sidecars/l2cs_worker.py`)
- Settings persistence: `@tauri-apps/plugin-store`

## Project structure

- `src-tauri/src/windows.rs`: overlay/application window creation and management
- `src-tauri/src/commands.rs`: open/close/focus commands
- `src/windows/overlay/OverlayApp.tsx`: camera preview, mode toggle, detection loop
- `src/windows/settings/SettingsApp.tsx`: settings UI and privacy modal
- `src/lib/attentionStateMachine.ts`: debounce state machine
- `src/lib/gazeEstimator.ts`: yaw/pitch estimation + hysteresis + no-face handling
- `src-tauri/src/l2cs_sidecar.rs`: persistent sidecar manager for L2CS worker
- `src-tauri/sidecars/l2cs_worker.py`: L2CS inference worker (JSON stdin/stdout)
- `src/assets/models/face_landmarker.task`: bundled local model
- `public/mediapipe/*`: local wasm runtime files

## Development

### Requirements

- Node.js 20+
- pnpm
- Rust toolchain (tested with `rustc 1.93.1`)
- Tauri desktop prerequisites:
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools + WebView2 Runtime

### Install

```bash
pnpm install
```

### Run (desktop dev)

```bash
pnpm tauri dev
```

### Build

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

## L2CS sidecar setup

L2CS is enabled by default via the `gazeProvider` setting (`l2cs_sidecar`).

1. Install Python dependencies:

```bash
python3 -m venv .venv-l2cs
source .venv-l2cs/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install -r src-tauri/sidecars/requirements-l2cs.txt
```

2. Download `L2CSNet_gaze360.pkl` weights from the official L2CS-Net repo and place it at:

`src-tauri/models/L2CSNet_gaze360.pkl`

Or set an absolute path:

```bash
export FLOWORFLOP_L2CS_WEIGHTS="/absolute/path/L2CSNet_gaze360.pkl"
```

3. Optional Python binary override:

```bash
export FLOWORFLOP_PYTHON="/path/to/python3"
```

### Tests

```bash
pnpm test
```

## Settings

- Detection enabled toggle
- URL open/close action toggle
- Application URL input
- Open mode (`webview` | `browser`)
- Gaze provider (`l2cs_sidecar` | `mediapipe`)
- Start 9+8 calibration (fullscreen guide on current settings monitor)
- Sensitivity sliders (yaw/pitch thresholds)
- Advanced options:
  - away/back debounce
  - no-face timeout
  - processing FPS

### Fullscreen 9+8 calibration

1. Click **Start 9+8 calibration** in the settings window.
2. A fullscreen calibration guide appears on the same monitor as the settings window.
3. Complete 9 inside-screen points (corners/edges/center), then 8 outside-screen directions.
4. For each step, follow the `2 -> 1` countdown (visual + short beep), then hold gaze during sampling.
5. When all 17 steps finish, inside thresholds and outside forced-away thresholds are updated automatically.

Notes:
- If audio playback is unavailable, calibration still runs with visual countdown.
- During calibration, LOOK_AWAY/LOOK_BACK actions are paused and resume after completion.
- If URL action toggle is OFF, URL window open/close remains paused even when events are detected.

## macOS camera permission notes

- Camera usage description is configured in `src-tauri/Info.plist`.
- On first permission denial, macOS may require manual re-enable:
  - System Settings -> Privacy & Security -> Camera -> enable FlowOrFlop.

## Known limitations and future improvements

- Yaw/pitch approximation is landmark-based and can be sensitive to lighting/camera angle.
- Browser mode cannot close tabs/windows automatically on `LOOK_BACK`.
- Accuracy can be improved with a more robust head-pose estimator and per-user calibration.
- Low-end devices may need reduced FPS or lighter models for smoother performance.
