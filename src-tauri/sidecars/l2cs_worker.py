#!/usr/bin/env python3
import argparse
import base64
import json
import math
import os
import pathlib
import sys
from typing import Any, Dict

import cv2
import numpy as np
import torch

try:
    from l2cs import Pipeline
except Exception as error:  # pragma: no cover - runtime dependency guard
    Pipeline = None
    PIPELINE_IMPORT_ERROR = str(error)
else:
    PIPELINE_IMPORT_ERROR = ""


def write_payload(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="L2CS-Net sidecar worker")
    parser.add_argument("--weights", type=str, default="")
    parser.add_argument("--arch", type=str, default="ResNet50")
    parser.add_argument("--device", type=str, default="")
    return parser.parse_args()


def resolve_device(raw_device: str) -> torch.device:
    if raw_device:
        return torch.device(raw_device)
    if torch.cuda.is_available():
        return torch.device("cuda:0")
    return torch.device("cpu")


def init_pipeline(args: argparse.Namespace):
    if Pipeline is None:
        raise RuntimeError(
            "failed to import l2cs pipeline. install dependencies first: "
            + PIPELINE_IMPORT_ERROR
        )

    if not args.weights:
        raise RuntimeError(
            "L2CS weights path is missing. "
            "Provide --weights or FLOWORFLOP_L2CS_WEIGHTS."
        )

    if not os.path.exists(args.weights):
        raise RuntimeError(f"L2CS weights file not found: {args.weights}")

    # Use positional args for broader compatibility across l2cs package variants.
    return Pipeline(pathlib.Path(args.weights), args.arch, resolve_device(args.device))


def decode_frame(base64_jpeg: str) -> np.ndarray:
    frame_bytes = base64.b64decode(base64_jpeg, validate=True)
    frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
    frame = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("failed to decode jpeg frame")
    return frame


def main() -> int:
    args = parse_args()
    if not args.weights:
        args.weights = os.environ.get("FLOWORFLOP_L2CS_WEIGHTS", "")

    try:
        pipeline = init_pipeline(args)
    except Exception as error:
        pipeline = None
        init_error = str(error)
    else:
        init_error = ""

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except Exception as error:
            write_payload({"ok": False, "error": f"invalid json request: {error}"})
            continue

        if pipeline is None:
            write_payload({"ok": False, "error": f"L2CS init failed: {init_error}"})
            continue

        frame_b64 = request.get("frameBase64")
        if not isinstance(frame_b64, str) or not frame_b64:
            write_payload({"ok": False, "error": "frameBase64 is required"})
            continue

        try:
            frame = decode_frame(frame_b64)
            try:
                result = pipeline.step(frame)
            except ValueError as error:
                # Current l2cs Pipeline raises this when no face survives detector filtering.
                if "need at least one array to stack" in str(error):
                    write_payload(
                        {
                            "ok": True,
                            "hasFace": False,
                            "yawDeg": None,
                            "pitchDeg": None,
                            "confidence": None,
                        }
                    )
                    continue
                raise

            pitch_values = list(getattr(result, "pitch", []))
            yaw_values = list(getattr(result, "yaw", []))
            score_values = list(getattr(result, "scores", []))

            if len(pitch_values) == 0 or len(yaw_values) == 0:
                write_payload(
                    {
                        "ok": True,
                        "hasFace": False,
                        "yawDeg": None,
                        "pitchDeg": None,
                        "confidence": None,
                    }
                )
                continue

            selected_index = 0
            if len(score_values) > 0:
                selected_index = max(
                    range(len(score_values)),
                    key=lambda idx: float(score_values[idx]),
                )

            # l2cs returns radians. Frontend thresholds are in degrees.
            yaw = math.degrees(float(yaw_values[selected_index]))
            pitch = math.degrees(float(pitch_values[selected_index]))
            confidence = (
                float(score_values[selected_index])
                if len(score_values) > selected_index
                else 0.0
            )

            write_payload(
                {
                    "ok": True,
                    "hasFace": True,
                    "yawDeg": yaw,
                    "pitchDeg": pitch,
                    "confidence": confidence,
                }
            )
        except Exception as error:
            write_payload({"ok": False, "error": f"L2CS inference failed: {error}"})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
