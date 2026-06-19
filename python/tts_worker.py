#!/usr/bin/env python3
"""SnapText Coqui TTS worker.

The worker keeps optional local TTS dependencies outside the Rust binary.
It prints one JSON object to stdout and sends diagnostics to stderr.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import sys
import wave
from pathlib import Path
from typing import Any


def _fake_payload() -> dict[str, Any] | None:
    raw = os.environ.get("SNAPTEXT_TTS_FAKE_OUTPUT")
    if raw is None:
        return None
    return json.loads(raw) if raw.strip() else {}


def _write_silent_wav(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16_000)
        wav.writeframes(b"\x00\x00" * 1600)


def _check(model_name: str | None, cache_dir: str | None) -> dict[str, Any]:
    fake = _fake_payload()
    if fake is not None:
        return {
            "python_available": True,
            "coqui_available": True,
            "worker_ready": True,
            "message": "TTS worker fake mode is ready.",
        }

    try:
        from TTS.api import TTS  # noqa: F401
    except Exception as exc:  # pragma: no cover - depends on host environment.
        return {
            "python_available": True,
            "coqui_available": False,
            "worker_ready": False,
            "message": f"coqui-tts is not importable: {exc}",
        }

    if cache_dir:
        Path(cache_dir).mkdir(parents=True, exist_ok=True)
    if not model_name:
        return {
            "python_available": True,
            "coqui_available": True,
            "worker_ready": False,
            "message": "Coqui model name is required.",
        }

    return {
        "python_available": True,
        "coqui_available": True,
        "worker_ready": True,
        "message": "coqui-tts is importable.",
    }


def _synthesize(
    text: str,
    lang: str,
    out_path: Path,
    model_name: str,
    speaker_wav: str | None,
    cache_dir: str | None,
) -> dict[str, Any]:
    fake = _fake_payload()
    if fake is not None:
        audio_base64 = fake.get("audio_base64")
        if isinstance(audio_base64, str) and audio_base64:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(base64.b64decode(audio_base64))
        else:
            source = fake.get("audio_path")
            if isinstance(source, str) and Path(source).is_file():
                out_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, out_path)
            else:
                _write_silent_wav(out_path)
        return {"audio_path": str(out_path), "lang": lang, "provider": "coqui"}

    from TTS.api import TTS

    if cache_dir:
        # Coqui reads this variable when resolving model downloads and cache files.
        os.environ["TTS_HOME"] = str(Path(cache_dir))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tts = TTS(model_name=model_name)
    kwargs: dict[str, Any] = {"text": text, "file_path": str(out_path)}
    if lang:
        kwargs["language"] = _coqui_language(lang)
    if speaker_wav:
        kwargs["speaker_wav"] = speaker_wav
    tts.tts_to_file(**kwargs)
    if not out_path.is_file():
        raise RuntimeError(f"Coqui did not create audio file: {out_path}")
    return {"audio_path": str(out_path), "lang": lang, "provider": "coqui"}


def _coqui_language(lang: str) -> str:
    # Keep SnapText language IDs decoupled from model-specific Coqui IDs.
    return {
        "zh_cn": "zh-cn",
        "en": "en",
        "ja": "ja",
        "ko": "ko",
        "fr": "fr",
        "de": "de",
        "es": "es",
        "ru": "ru",
    }.get(lang.strip().lower(), lang.strip().lower())


def main() -> int:
    parser = argparse.ArgumentParser(description="SnapText Coqui TTS worker")
    parser.add_argument("--check", action="store_true", help="check Python and coqui-tts availability")
    parser.add_argument("--text", help="text to synthesize")
    parser.add_argument("--lang", default="en", help="SnapText language ID")
    parser.add_argument("--out", help="output WAV path")
    parser.add_argument("--model", default="", help="Coqui model name")
    parser.add_argument("--speaker-wav", help="optional speaker reference WAV")
    parser.add_argument("--cache-dir", help="optional Coqui cache directory")
    args = parser.parse_args()

    try:
        if args.check:
            print(json.dumps(_check(args.model, args.cache_dir), ensure_ascii=False))
            return 0
        if not args.text or not args.text.strip():
            raise RuntimeError("--text is required unless --check is used")
        if not args.out:
            raise RuntimeError("--out is required unless --check is used")
        if not args.model.strip():
            raise RuntimeError("--model is required unless --check is used")
        result = _synthesize(
            text=args.text.strip(),
            lang=args.lang,
            out_path=Path(args.out),
            model_name=args.model.strip(),
            speaker_wav=args.speaker_wav,
            cache_dir=args.cache_dir,
        )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
