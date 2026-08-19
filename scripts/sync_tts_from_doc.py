#!/usr/bin/env python3
"""以 docs/语音播报文档.md 为文案唯一权威，回灌 scripts.json 并合成新增/变更语音。

用法（项目根目录）：
  python3 scripts/sync_tts_from_doc.py

流程：
  1. 解析文档各幕表格（| # | 播报文案 | `音频文件` | 时长 |）；
  2. 按音频文件路径回灌 data/tts/scripts.json 的 text（已有段更新文案；
     文档新增的文件自动建段，id 取文件 stem）；文档未收录的段删除（文档为唯一权威）；
  3. 与 manifest.json 比对，文案变化或 wav 缺失的段走
     synthesize_tts.py --force-files 强制重合成（统一音色不变）。

文档即源：直接编辑 docs/语音播报文档.md 的「播报文案」列或新增表格行，
再运行本脚本即可，无需手改 scripts.json。
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "语音播报文档.md"
SCRIPTS = ROOT / "data" / "tts" / "scripts.json"
MANIFEST = ROOT / "data" / "tts" / "manifest.json"

HEADING_TO_SCENE = {
    "第二幕 · 问题定位": "1",
    "第三幕 · 分析成因": "2",
    "第四幕 · 优化方案": "3",
    "第四幕 · 信控方案调节（插幕）": "3b",
    "第五幕 · 效果评估": "4",
    "第六幕 · 技能固化": "5",
}

ROW_RE = re.compile(r"^\|\s*\d+\s*\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|")


def parse_doc(text: str) -> dict[str, list[dict]]:
    """返回 {sceneKey: [{text, file}]}，保持文档行序。"""
    scenes: dict[str, list[dict]] = {}
    current = None
    for line in text.splitlines():
        if line.startswith("## "):
            current = HEADING_TO_SCENE.get(line[3:].strip())
            if current:
                scenes.setdefault(current, [])
            continue
        if current is None:
            continue
        m = ROW_RE.match(line.strip())
        if m:
            scenes[current].append({"text": m.group(1), "file": m.group(2)})
    return scenes


def main() -> int:
    if not DOC.exists():
        print(f"缺少文档：{DOC}", file=sys.stderr)
        return 1

    doc_scenes = parse_doc(DOC.read_text(encoding="utf-8"))
    data = json.loads(SCRIPTS.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {"scenes": {}}

    changed: list[str] = []
    for key, rows in doc_scenes.items():
        scene = data["scenes"].setdefault(key, {"scene_key": key, "title": "", "segments": []})
        by_file = {seg["file"]: seg for seg in scene["segments"]}
        baked = {s["file"]: s for s in (manifest.get("scenes", {}).get(key) or {}).get("segments", [])}
        doc_files = set()
        for row in rows:
            doc_files.add(row["file"])
            seg = by_file.get(row["file"])
            if seg is None:
                stem = Path(row["file"]).stem
                seg = {
                    "id": stem,
                    "file": row["file"],
                    "approx_sec": max(2, round(len(row["text"]) / 4.5)),
                    "text": row["text"],
                }
                scene["segments"].append(seg)
                by_file[row["file"]] = seg
                changed.append(row["file"])
                print(f"[new] {key} {row['file']}")
                continue
            if seg["text"] != row["text"]:
                seg["text"] = row["text"]
                print(f"[text] {key} {row['file']}")
            bake = baked.get(row["file"])
            wav = ROOT / "data" / "tts" / row["file"]
            if (bake is None or bake.get("text") != seg["text"]) or not wav.exists():
                if row["file"] not in changed:
                    changed.append(row["file"])
        stale = [f for f in by_file if f not in doc_files]
        for f in stale:
            scene["segments"] = [s for s in scene["segments"] if s["file"] != f]
            print(f"[del] 文档未收录，移除：{f}")

    SCRIPTS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if not changed:
        print("文档与 scripts.json / manifest 一致，无需合成。")
        return 0

    print(f"\n重合成 {len(changed)} 段：{', '.join(changed)}")
    cmd = [
        sys.executable,
        str(ROOT / "scripts" / "synthesize_tts.py"),
        "--force-files",
        ",".join(changed),
    ]
    return subprocess.call(cmd, cwd=ROOT)


if __name__ == "__main__":
    raise SystemExit(main())
