import argparse
import json
import math
import os
import subprocess
import tempfile
import urllib.request
from pathlib import Path


def run(cmd):
    completed = subprocess.run(cmd, text=True)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def download(url, target):
    with urllib.request.urlopen(url, timeout=300) as response:
        target.write_bytes(response.read())


def duration(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        text=True,
        capture_output=True,
        check=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def load_json(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    scenes = data.get("scenes") or []
    cleaned = []
    for scene in scenes:
        start = float(scene.get("start", 0))
        end = float(scene.get("end", 0))
        tags = scene.get("tags") or []
        if end > start and "trash" not in tags:
            cleaned.append({"start": start, "end": end, "tags": tags})
    return cleaned


def make_concat(video, scenes, workdir):
    parts = []
    for index, scene in enumerate(scenes, start=1):
        part = workdir / f"part_{index:03d}.mp4"
        start = max(0, scene["start"] - 0.2)
        length = max(0.4, scene["end"] - scene["start"] + 0.4)
        run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(video),
            "-c", "copy", str(part)
        ])
        parts.append(part)
    list_file = workdir / "concat.txt"
    list_file.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    merged = workdir / "merged.mp4"
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(merged)])
    return merged


def render_vertical(source, output, max_mb, mode):
    target_bits = max(450_000, int((max_mb * 8_000_000) / max(duration(source), 1) * 0.88))
    if mode == "crop":
        vf = "scale=1920:1080:force_original_aspect_ratio=increase,crop=607:1080,scale=1080:1920"
    else:
        # Preserves the full horizontal court: blurred vertical background plus sharp horizontal foreground.
        vf = (
            "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,boxblur=24:1[bg];"
            "[0:v]scale=1080:-2[fg];"
            "[bg][fg]overlay=(W-w)/2:250"
        )
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(source),
        "-filter_complex" if mode != "crop" else "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-b:v", str(target_bits),
        "-maxrate", str(target_bits), "-bufsize", str(target_bits * 2),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "64k",
        "-movflags", "+faststart",
        str(output),
    ])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-url", required=True)
    parser.add_argument("--json-url", required=True)
    parser.add_argument("--output", default="fronton_vertical.mp4")
    parser.add_argument("--max-mb", type=int, default=40)
    parser.add_argument("--mode", choices=["fit", "crop"], default="fit")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as temp:
        workdir = Path(temp)
        video = workdir / "video.mp4"
        marks = workdir / "marks.json"
        download(args.video_url, video)
        download(args.json_url, marks)
        scenes = load_json(marks)
        if not scenes:
            raise SystemExit("No scenes found in JSON.")
        merged = make_concat(video, scenes, workdir)
        render_vertical(merged, Path(args.output), args.max_mb, args.mode)


if __name__ == "__main__":
    main()
