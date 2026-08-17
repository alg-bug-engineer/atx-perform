#!/usr/bin/env python3
"""预合成各幕讲解语音（Qwen TTS Realtime → 本地 WAV）。

用法（项目根目录）：
  references/agent-loop-project/.venv/bin/python scripts/synthesize_tts.py
  references/agent-loop-project/.venv/bin/python scripts/synthesize_tts.py --scene 3
  references/agent-loop-project/.venv/bin/python scripts/synthesize_tts.py --force

依赖：.env 中的 DASHSCOPE_API_KEY / QWEN_TTS_*；dashscope（agent-loop .venv 已装）。
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import struct
import sys
import threading
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "data" / "tts" / "scripts.json"
OUT_DIR = ROOT / "data" / "tts"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


def pcm_to_wav(pcm: bytes, sample_rate: int = 24000) -> bytes:
    channels = 1
    sample_width = 2
    data_size = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        sample_rate,
        sample_rate * channels * sample_width,
        channels * sample_width,
        sample_width * 8,
        b"data",
        data_size,
    )
    return header + pcm


def wav_duration_sec(path: Path) -> float:
    with path.open("rb") as f:
        header = f.read(44)
        if len(header) < 44 or header[0:4] != b"RIFF":
            return 0.0
        rate = struct.unpack_from("<I", header, 24)[0]
        bits = struct.unpack_from("<H", header, 34)[0]
        channels = struct.unpack_from("<H", header, 22)[0]
        data_size = path.stat().st_size - 44
        if rate <= 0 or bits <= 0 or channels <= 0:
            return 0.0
        return data_size / (rate * channels * (bits // 8))


class _Collector:
    def __init__(self, callback_base: type) -> None:
        self.chunks: list[bytes] = []
        self.done = threading.Event()
        self.error: Exception | None = None

        class Callback(callback_base):  # type: ignore[misc, valid-type]
            def on_open(inner_self) -> None:
                return

            def on_close(inner_self, close_status_code, close_msg) -> None:
                self.done.set()

            def on_event(inner_self, response: dict[str, Any]) -> None:
                try:
                    et = response.get("type")
                    if et == "response.audio.delta":
                        self.chunks.append(base64.b64decode(response["delta"]))
                    elif et == "error":
                        self.error = RuntimeError(str(response.get("error", response)))
                        self.done.set()
                    elif et in {"response.done", "session.finished"}:
                        self.done.set()
                except Exception as exc:  # noqa: BLE001
                    self.error = exc
                    self.done.set()

        self.callback = Callback()

    def wait(self, timeout: float = 45.0) -> bytes:
        if not self.done.wait(timeout):
            raise TimeoutError("Qwen TTS synthesis timed out")
        if self.error:
            raise self.error
        return b"".join(self.chunks)


def synthesize(text: str, *, voice: str, model: str, base_url: str) -> bytes:
    """通过百炼 MaaS 原生 SpeechSynthesizer 端点（非 WebSocket）合成，返回 WAV 字节。"""
    import requests

    api_key = (
        os.environ.get("QWEN_API_KEY")
        or os.environ.get("DASHSCOPE_API_KEY")
        or os.environ.get("VITE_QWEN_TTS_API_KEY")
    )
    if not api_key:
        raise RuntimeError("缺少 QWEN_API_KEY / DASHSCOPE_API_KEY")

    url = f"{base_url.rstrip('/')}/api/v1/services/audio/tts/SpeechSynthesizer"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        json={"model": model, "input": {"text": text, "voice": voice}},
        timeout=60,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"TTS 合成失败 {resp.status_code}: {resp.text[:300]}")
    payload = resp.json()
    audio_url = payload.get("output", {}).get("audio", {}).get("url")
    if not audio_url:
        raise RuntimeError(f"TTS 响应无音频 URL: {resp.text[:300]}")

    audio_resp = requests.get(audio_url, timeout=60)
    if audio_resp.status_code != 200:
        raise RuntimeError(f"下载音频失败 {audio_resp.status_code}")
    return audio_resp.content


def main() -> int:
    parser = argparse.ArgumentParser(description="预合成各幕讲解 TTS")
    parser.add_argument(
        "--scene",
        choices=["1", "3", "3b", "4", "5"],
        help="只合成指定幕（注意 manifest 会只保留该幕，通常不加此参数）",
    )
    parser.add_argument("--force", action="store_true", help="覆盖已有 wav")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不调 API")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")

    data = json.loads(SCRIPTS.read_text(encoding="utf-8"))
    meta = data["meta"]
    voice = os.environ.get("QWEN_TTS_VOICE") or meta.get("voice") or "longanlufeng"
    model = os.environ.get("QWEN_TTS_MODEL") or meta.get("model") or "qwen-audio-3.0-tts-plus"
    base_url = os.environ.get("QWEN_TTS_BASE_URL") or "https://token-plan.cn-beijing.maas.aliyuncs.com"
    sample_rate = int(os.environ.get("QWEN_TTS_SAMPLE_RATE") or meta.get("sample_rate") or 24000)

    scenes = data["scenes"]
    keys = [args.scene] if args.scene else sorted(scenes.keys())
    manifest: dict[str, Any] = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "voice": voice,
        "model": model,
        "sample_rate": sample_rate,
        "scenes": {},
    }

    for key in keys:
        scene = scenes[key]
        rows = []
        print(f"\n=== 幕 {key} · {scene['title']} ===")
        for seg in scene["segments"]:
            out = OUT_DIR / seg["file"]
            out.parent.mkdir(parents=True, exist_ok=True)
            chars = len(seg["text"])
            budget = seg.get("approx_sec")
            print(f"- {seg['id']}: {chars} 字 · 预算 ~{budget}s → {out.relative_to(ROOT)}")

            if out.exists() and not args.force:
                dur = round(wav_duration_sec(out), 2)
                print(f"  skip existing ({dur}s)")
                rows.append({**seg, "duration_sec": dur, "chars": chars})
                continue

            if args.dry_run:
                rows.append({**seg, "duration_sec": None, "chars": chars})
                continue

            audio = synthesize(
                seg["text"],
                voice=voice,
                model=model,
                base_url=base_url,
            )
            out.write_bytes(audio)
            dur = round(wav_duration_sec(out), 2)
            print(f"  wrote {out.stat().st_size} bytes · {dur}s")
            rows.append({**seg, "duration_sec": dur, "chars": chars})
            time.sleep(0.4)

        total = round(sum(r["duration_sec"] or 0 for r in rows), 2)
        print(f"幕 {key} 合计时长: {total}s")
        manifest["scenes"][key] = {
            "title": scene["title"],
            "total_duration_sec": total,
            "segments": rows,
        }

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\nmanifest → {OUT_DIR / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        raise SystemExit(130)
