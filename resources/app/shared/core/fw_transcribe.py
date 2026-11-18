# Runner faster-whisper cho AutoSub Typo Pro (device='cpu', compute_type='int8', vad_filter=True)
import argparse
import json
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from faster_whisper import WhisperModel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--wav", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--lang", default="vi")
    ap.add_argument("--prompt", default="")
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()

    is_local = os.path.isdir(args.model)
    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        cpu_threads=max(1, args.threads),
        local_files_only=is_local,
    )

    lang = None if (not args.lang or args.lang == "auto") else args.lang
    kw = {
        "language": lang,
        "vad_filter": True,
        "vad_parameters": {
            "min_silence_duration_ms": 450,
            "speech_pad_ms": 150,
        },
        "word_timestamps": True,
        "beam_size": 5,
        "condition_on_previous_text": False,
        "repetition_penalty": 1.1,
        "no_repeat_ngram_size": 3,
        "compression_ratio_threshold": 2.2,
        "log_prob_threshold": -1.0,
        "no_speech_threshold": 0.6,
    }
    if args.prompt:
        kw["initial_prompt"] = args.prompt

    sys.stderr.write("progress = 2%\n")
    sys.stderr.flush()

    segments, info = model.transcribe(args.wav, **kw)
    total_dur = max(0.1, float(getattr(info, "duration", 0.0) or 0.0))

    out_segs = []
    last_pct = 2
    for seg in segments:
        words = []
        if seg.words:
            for w in seg.words:
                words.append({
                    "word": w.word,
                    "start": round(float(w.start), 4),
                    "end": round(float(w.end), 4),
                    "probability": round(float(getattr(w, "probability", 1.0) or 1.0), 4),
                })
        out_segs.append({
            "start": round(float(seg.start), 4),
            "end": round(float(seg.end), 4),
            "text": seg.text,
            "avg_logprob": round(float(getattr(seg, "avg_logprob", 0.0) or 0.0), 4),
            "no_speech_prob": round(float(getattr(seg, "no_speech_prob", 0.0) or 0.0), 4),
            "words": words,
        })
        pct = min(99, max(last_pct, int(round(float(seg.end) / total_dur * 100))))
        if pct > last_pct:
            last_pct = pct
            sys.stderr.write(f"progress = {pct}%\n")
            sys.stderr.flush()

    payload = {
        "engine": "faster-whisper",
        "device": "cpu",
        "compute_type": "int8",
        "vad_filter": True,
        "model": os.path.basename(os.path.normpath(args.model)),
        "language": getattr(info, "language", lang) or args.lang,
        "duration": round(total_dur, 4),
        "segments": out_segs,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    sys.stderr.write("progress = 100%\n")
    sys.stderr.flush()


if __name__ == "__main__":
    main()
