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
- Settings persistence: `@tauri-apps/plugin-store`

## Project structure

- `src-tauri/src/windows.rs`: overlay/application window creation and management
- `src-tauri/src/commands.rs`: open/close/focus commands
- `src/windows/overlay/OverlayApp.tsx`: camera preview, mode toggle, detection loop
- `src/windows/settings/SettingsApp.tsx`: settings UI and privacy modal
- `src/lib/attentionStateMachine.ts`: debounce state machine
- `src/lib/gazeEstimator.ts`: yaw/pitch estimation + hysteresis + no-face handling
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

### Tests

```bash
pnpm test
```

## Settings

- Detection enabled toggle
- Application URL input
- Open mode (`webview` | `browser`)
- Sensitivity sliders (yaw/pitch thresholds)
- Advanced options:
  - away/back debounce
  - no-face timeout
  - processing FPS

## macOS camera permission notes

- Camera usage description is configured in `src-tauri/Info.plist`.
- On first permission denial, macOS may require manual re-enable:
  - System Settings -> Privacy & Security -> Camera -> enable FlowOrFlop.

## Known limitations and future improvements

- Yaw/pitch approximation is landmark-based and can be sensitive to lighting/camera angle.
- Browser mode cannot close tabs/windows automatically on `LOOK_BACK`.
- Accuracy can be improved with a more robust head-pose estimator and per-user calibration.
- Low-end devices may need reduced FPS or lighter models for smoother performance.
