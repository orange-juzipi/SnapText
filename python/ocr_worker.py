#!/usr/bin/env python3
"""SnapText PaddleOCR worker.

The worker keeps the Rust desktop shell decoupled from PaddleOCR's Python runtime.
It prints one JSON object to stdout and sends diagnostics to stderr.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


def _line_from_fake_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "text": str(payload.get("text", "fake text")),
        "bbox": payload.get("bbox", {"x": 0, "y": 0, "width": 1, "height": 1}),
        "confidence": float(payload.get("confidence", 1.0)),
    }


def _fake_result() -> dict[str, Any] | None:
    raw = os.environ.get("SNAPTEXT_OCR_FAKE_OUTPUT")
    if raw is None:
        return None
    payload = json.loads(raw) if raw.strip() else {"text": "fake text"}
    lines = payload.get("lines")
    if not isinstance(lines, list):
        lines = [_line_from_fake_payload(payload)]
    source_text = payload.get("source_text")
    if source_text is None:
        source_text = "\n".join(str(line.get("text", "")).strip() for line in lines).strip()
    return {"source_text": source_text, "text_lines": lines}


def _bbox_from_points(points: Any) -> dict[str, int]:
    if hasattr(points, "tolist"):
        points = points.tolist()
    if not isinstance(points, list) or not points:
        return {"x": 0, "y": 0, "width": 1, "height": 1}
    if len(points) >= 4 and all(isinstance(value, (int, float)) for value in points[:4]):
        left = max(0, round(float(points[0])))
        top = max(0, round(float(points[1])))
        right = max(left + 1, round(float(points[2])))
        bottom = max(top + 1, round(float(points[3])))
        return {"x": left, "y": top, "width": right - left, "height": bottom - top}
    xs = [float(point[0]) for point in points if isinstance(point, list) and len(point) >= 2]
    ys = [float(point[1]) for point in points if isinstance(point, list) and len(point) >= 2]
    if not xs or not ys:
        return {"x": 0, "y": 0, "width": 1, "height": 1}
    left = max(0, round(min(xs)))
    top = max(0, round(min(ys)))
    right = max(left + 1, round(max(xs)))
    bottom = max(top + 1, round(max(ys)))
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def _first_present(page: Any, *keys: str) -> Any:
    for key in keys:
        value = page.get(key)
        if value is not None:
            return value
    return []


def _collect_lines(result: Any) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for page in result:
        data = getattr(page, "json", None)
        if callable(data):
            page = data()
        if hasattr(page, "get"):
            # PaddleOCR may return numpy arrays here; avoid boolean `or` checks
            # because ndarray truthiness is ambiguous.
            rec_texts = _first_present(page, "rec_texts", "texts")
            rec_scores = _first_present(page, "rec_scores", "scores")
            rec_boxes = _first_present(page, "rec_polys", "rec_boxes")
            for index, text in enumerate(rec_texts):
                text = str(text).strip()
                if not text:
                    continue
                lines.append(
                    {
                        "text": text,
                        "bbox": _bbox_from_points(
                            rec_boxes[index] if index < len(rec_boxes) else None
                        ),
                        "confidence": float(rec_scores[index]) if index < len(rec_scores) else 0.0,
                    }
                )
    return lines


def _predict(image_path: Path) -> dict[str, Any]:
    fake = _fake_result()
    if fake is not None:
        return fake

    from paddleocr import PaddleOCR

    ocr = PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    result = ocr.predict(str(image_path))
    lines = _collect_lines(result)
    source_text = "\n".join(line["text"] for line in lines).strip()
    if not source_text:
        raise RuntimeError("OCR did not detect any translatable text")
    return {"source_text": source_text, "text_lines": lines}


def _check() -> dict[str, Any]:
    python_available = True
    fake = _fake_result()
    if fake is not None:
        return {
            "python_available": python_available,
            "paddleocr_available": True,
            "worker_ready": True,
            "message": "OCR worker fake mode is ready.",
        }

    try:
        import paddleocr  # noqa: F401
    except Exception as exc:  # pragma: no cover - depends on host environment.
        return {
            "python_available": python_available,
            "paddleocr_available": False,
            "worker_ready": False,
            "message": f"paddleocr is not importable: {exc}",
        }

    try:
        import paddle  # noqa: F401
    except Exception as exc:  # pragma: no cover - depends on host environment.
        return {
            "python_available": python_available,
            "paddleocr_available": True,
            "worker_ready": False,
            "message": f"paddlepaddle is not importable: {exc}",
        }

    return {
        "python_available": python_available,
        "paddleocr_available": True,
        "worker_ready": True,
        "message": "paddleocr and paddlepaddle are importable.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="SnapText PaddleOCR worker")
    parser.add_argument("--check", action="store_true", help="check Python and paddleocr availability")
    parser.add_argument("--image", help="image path to OCR")
    args = parser.parse_args()

    try:
        if args.check:
            print(json.dumps(_check(), ensure_ascii=False))
            return 0
        if not args.image:
            raise RuntimeError("--image is required unless --check is used")
        image_path = Path(args.image)
        if not image_path.is_file():
            raise RuntimeError(f"image file does not exist: {image_path}")
        print(json.dumps(_predict(image_path), ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
