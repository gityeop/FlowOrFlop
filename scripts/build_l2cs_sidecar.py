#!/usr/bin/env python3
from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_TAURI_DIR = REPO_ROOT / "src-tauri"
WORKER_PATH = SRC_TAURI_DIR / "sidecars" / "l2cs_worker.py"
WEIGHTS_PATH = SRC_TAURI_DIR / "models" / "L2CSNet_gaze360.pkl"
BINARIES_DIR = SRC_TAURI_DIR / "binaries"
BUILD_ROOT = SRC_TAURI_DIR / ".pyinstaller"


def target_binary_name() -> str:
    system = sys.platform
    machine = platform.machine().lower()

    if system == "darwin" and machine == "arm64":
        return "floworflop-l2cs-sidecar-aarch64-apple-darwin"
    if system == "darwin" and machine in {"x86_64", "amd64"}:
        return "floworflop-l2cs-sidecar-x86_64-apple-darwin"
    if system == "win32" and machine in {"x86_64", "amd64"}:
        return "floworflop-l2cs-sidecar-x86_64-pc-windows-msvc.exe"

    raise SystemExit(f"unsupported build host: platform={system} arch={machine}")


def main() -> int:
    if not WORKER_PATH.exists():
        raise SystemExit(f"worker file not found: {WORKER_PATH}")
    if not WEIGHTS_PATH.exists():
        raise SystemExit(f"weights file not found: {WEIGHTS_PATH}")

    try:
        import PyInstaller  # noqa: F401
    except ImportError as error:
        raise SystemExit(
            "pyinstaller is not installed in the current environment. "
            "Activate .venv-l2cs and install requirements first. "
            f"Import error: {error}"
        )
    pyinstaller_entry = [sys.executable, "-m", "PyInstaller"]

    binary_name = target_binary_name()
    BINARIES_DIR.mkdir(parents=True, exist_ok=True)
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)

    command = [
        *pyinstaller_entry,
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        binary_name,
        "--distpath",
        str(BINARIES_DIR),
        "--workpath",
        str(BUILD_ROOT / "build"),
        "--specpath",
        str(BUILD_ROOT / "spec"),
        "--collect-all",
        "l2cs",
        "--collect-all",
        "face_detection",
        "--hidden-import",
        "torch",
        "--hidden-import",
        "torchvision",
        "--hidden-import",
        "cv2",
        str(WORKER_PATH),
    ]

    print("Building L2CS sidecar executable...")
    print(" ".join(command))
    subprocess.run(command, check=True, cwd=REPO_ROOT)

    output_path = BINARIES_DIR / binary_name
    if not output_path.exists():
        raise SystemExit(f"expected sidecar output was not created: {output_path}")

    print(f"Built sidecar: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
