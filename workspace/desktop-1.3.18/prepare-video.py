"""Local timed audio and visual preparation for the desktop video workflow."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess

def command(args):
    return subprocess.run(args, check=True, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

def write_json(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, path)

def prepare_base(video, out, ffmpeg, model_path):
    out.mkdir(parents=True, exist_ok=True)
    def progress(stage, percent):
        write_json(out / "progress.json", dict(stage=stage, progress=round(percent*.55)))
    probe = str(Path(ffmpeg).with_name("ffprobe.exe"))
    info = json.loads(command([probe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(video)]).stdout)
    duration = float(info["format"]["duration"])
    if not 0 < duration <= 7200:
        raise ValueError("单集需在 2 小时以内")
    if not any(s["codec_type"] == "audio" for s in info["streams"]):
        raise ValueError("视频没有音轨，请确认原片")
    progress("提取原音", 8)
    audio = out / "audio.wav"
    command([ffmpeg, "-v", "error", "-y", "-i", str(video), "-vn", "-ar", "16000", "-ac", "1", str(audio)])
    progress("原音转写与词级时间码", 15)
    from faster_whisper import WhisperModel
    model = WhisperModel(model_path, device="cpu", compute_type="int8", local_files_only=True)
    segments, language = model.transcribe(str(audio), beam_size=5, word_timestamps=True, vad_filter=True)
    transcript = []
    for segment in segments:
        transcript.append(dict(id=len(transcript)+1, start_ms=round(segment.start*1000), end_ms=round(segment.end*1000),
            text=segment.text.strip(), words=[dict(start_ms=round(w.start*1000), end_ms=round(w.end*1000), text=w.word) for w in segment.words or []]))
        progress("原音转写与词级时间码", 15 + round(35*segment.end/duration))
    if not transcript:
        raise ValueError("原音未识别到可用台词，请核对音轨")
    progress("检测切镜与逐秒画面", 52)
    scene = command([ffmpeg, "-hide_banner", "-i", str(video), "-an", "-vf", "select='gt(scene,0.28)',showinfo", "-vsync", "vfr", "-f", "null", "-"]).stderr.decode("utf-8", errors="replace")
    raw_cuts = [float(t) for t in re.findall(r"pts_time:([0-9.]+)", scene)]
    cuts = [0.0]
    for cut in raw_cuts:
        if cut-cuts[-1] >= 0.25 and duration-cut >= 0.25:
            cuts.append(cut)
    cuts.append(duration)
    frames_dir = out / "frames"
    frames_dir.mkdir(exist_ok=True)
    command([ffmpeg, "-v", "error", "-y", "-i", str(video), "-an", "-vf", "fps=1,scale=480:-2", "-q:v", "4", str(frames_dir / "%06d.jpg")])
    progress("提取字幕带与逐句绑定画面", 64)
    subs_dir = out / "subtitles"
    subs_dir.mkdir(exist_ok=True)
    command([ffmpeg, "-v", "error", "-y", "-i", str(video), "-an", "-vf", "fps=4,crop=iw:ih*0.48:0:ih*0.52,scale=640:-2", "-q:v", "4", str(subs_dir / "%06d.jpg")])
    def data_url(path):
        return "data:image/jpeg;base64,"+base64.b64encode(path.read_bytes()).decode()
    frames = [dict(time_ms=round((int(p.stem)-0.5)*1000), image=data_url(p)) for p in sorted(frames_dir.glob("*.jpg"))]
    subtitles = [dict(time_ms=round((int(p.stem)-0.5)*250), image=data_url(p)) for p in sorted(subs_dir.glob("*.jpg"))]
    for index, segment in enumerate(transcript):
        segment["frames"] = []
        for point in (0.25, 0.5, 0.75):
            time = (segment["start_ms"]+(segment["end_ms"]-segment["start_ms"])*point)/1000
            image = out / f"sentence-{index}-{point}.jpg"
            command([ffmpeg, "-v", "error", "-y", "-ss", str(time), "-i", str(video), "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", str(image)])
            segment["frames"].append(dict(time_ms=round(time*1000), image=data_url(image)))
        progress("逐句绑定开头、中点与结尾画面", 65+round(29*(index+1)/len(transcript)))
    shots = []
    for index, (start, end) in enumerate(zip(cuts, cuts[1:])):
        image = out / f"shot-{index}.jpg"
        midpoint = (start+end)/2
        command([ffmpeg, "-v", "error", "-y", "-ss", str(midpoint), "-i", str(video), "-frames:v", "1", "-vf", "scale=240:-2", "-q:v", "4", str(image)])
        shots.append(dict(start_ms=round(start*1000), end_ms=round(end*1000), image=data_url(image)))
    result = dict(duration_ms=round(duration*1000), language=language.language,
                  segments=transcript, frames=frames, subtitles=subtitles, shots=shots,
                  method="faster-whisper-small/int8/word-timestamps + ffmpeg/1fps/4fps-subtitles/scene-0.28")
    write_json(out / "base-result.json", result)
    progress("原音与画面准备完成", 100)
    return result

def prepare(video, out, ffmpeg, model_path):
    import importlib.util
    entry=Path(__file__).with_name('video-evidence.py')
    spec=importlib.util.spec_from_file_location('video_evidence',entry)
    evidence=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evidence)
    base = None
    for cached in (out/'base-result.json', out/'result.json'):
        try:
            value = json.loads(cached.read_text(encoding='utf-8'))
        except (FileNotFoundError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(value, dict) and value.get('segments') and (out/'audio.wav').is_file():
            base = value
            break
    if base is None:
        base = prepare_base(video, out, ffmpeg, model_path)
    return evidence.enrich(video,out,ffmpeg,model_path,base)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("video", "out", "ffmpeg", "model"):
        parser.add_argument("--"+name, required=True)
    args = parser.parse_args()
    try:
        prepare(Path(args.video), Path(args.out), args.ffmpeg, args.model)
    except Exception as error:
        write_json(Path(args.out) / "progress.json", dict(stage="失败", error=str(error), progress=0))
        raise
