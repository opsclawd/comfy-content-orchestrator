#!/usr/bin/env python3
"""
WhisperX forced alignment wrapper for comfy-content-orchestrator.

Aligns synthesized voiceover audio against known ground-truth transcript text,
emitting word-level timestamps as JSON on stdout.
All logs and diagnostics are directed to stderr to keep stdout clean JSON.
"""

import argparse
import contextlib
import json
import os
import sys

# Ensure offline operation by default
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


def parse_args():
    parser = argparse.ArgumentParser(description="WhisperX forced alignment")
    parser.add_argument("--audio", required=True, help="Path to input audio WAV file")
    parser.add_argument("--text-file", required=True, help="Path to transcript text file")
    parser.add_argument("--language", default="en", help="Language code (default: en)")
    parser.add_argument("--device", default="cpu", help="Device (cpu or cuda, default: cpu)")
    parser.add_argument("--model-dir", default=None, help="Directory containing cached models")
    parser.add_argument("--model-name", default="WAV2VEC2_ASR_BASE_960H", help="Alignment model identity")
    return parser.parse_args()


def normalize_token(token: str) -> str:
    """Normalize token by keeping only alphanumeric characters in lowercase."""
    return "".join(ch for ch in token if ch.isalnum()).lower()


def reconcile_tokens(raw_words, collected_words):
    """
    Deterministic sequence alignment (exact normalized token identity).
    
    Preserves exact transcript word count and order, mapping WhisperX's measured
    word spans only when exact normalized 1:1 token identity matches monotonically.
    Treats unmatched, ambiguous, or substring-only pairs (e.g. a/cat, he/the) as
    unaligned (aligned: False) without consuming unrelated measured tokens.
    """
    n = len(raw_words)

    # Filter candidate words from WhisperX to those with valid, finite, positive timestamps
    valid_cands = []
    for c in collected_words:
        if not isinstance(c, dict):
            continue
        w = c.get("word", "")
        start = c.get("start")
        end = c.get("end")
        if (
            isinstance(w, str)
            and normalize_token(w) != ""
            and start is not None
            and end is not None
            and isinstance(start, (int, float))
            and isinstance(end, (int, float))
            and float(end) > float(start)
            and float(start) >= 0.0
        ):
            valid_cands.append(c)

    m = len(valid_cands)

    # Longest Common Subsequence of exact normalized tokens
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        clean_raw = normalize_token(raw_words[i])
        for j in range(m - 1, -1, -1):
            clean_cand = normalize_token(valid_cands[j].get("word", ""))
            if clean_raw != "" and clean_raw == clean_cand:
                dp[i][j] = 1 + dp[i + 1][j + 1]
            else:
                dp[i][j] = max(dp[i + 1][j], dp[i][j + 1])

    # Backtrack to reconstruct the optimal monotone 1:1 match
    matches = {}
    i = 0
    j = 0
    while i < n and j < m:
        clean_raw = normalize_token(raw_words[i])
        clean_cand = normalize_token(valid_cands[j].get("word", ""))
        if clean_raw != "" and clean_raw == clean_cand and dp[i][j] == 1 + dp[i + 1][j + 1]:
            matches[i] = valid_cands[j]
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1

    output_words = []
    for idx, raw_word in enumerate(raw_words):
        if idx in matches:
            cand = matches[idx]
            output_words.append({
                "word": raw_word,
                "start": float(cand["start"]),
                "end": float(cand["end"]),
                "aligned": True
            })
        else:
            output_words.append({
                "word": raw_word,
                "start": None,
                "end": None,
                "aligned": False
            })

    return output_words


def main():
    args = parse_args()

    if not os.path.isfile(args.audio):
        sys.stderr.write(f"Error: audio file not found: {args.audio}\n")
        sys.exit(1)

    if not os.path.isfile(args.text_file):
        sys.stderr.write(f"Error: text file not found: {args.text_file}\n")
        sys.exit(1)

    with open(args.text_file, "r", encoding="utf-8") as f:
        text = f.read().strip()

    raw_words = text.split()
    if not raw_words:
        sys.stdout.write(json.dumps({"words": []}) + "\n")
        return

    try:
        import whisperx
    except ImportError as e:
        sys.stderr.write(f"Error importing whisperx: {e}\n")
        sys.exit(1)

    try:
        # Redirect all library stdout to sys.stderr to guarantee subprocess stdout is clean JSON
        with contextlib.redirect_stdout(sys.stderr):
            audio = whisperx.load_audio(args.audio)
            sample_rate = 16000
            duration = float(len(audio)) / sample_rate

            # NOTE: whisperx 3.3.1's load_align_model() has no model_cache_only
            # parameter (signature: language_code, device, model_name=None,
            # model_dir=None) — passing one raises TypeError. Offline/cache-only
            # behavior is instead enforced via the HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE
            # env vars set at the top of this file, plus model_dir pointing at the
            # pinned, checksum-verified local cache.
            model_a, metadata = whisperx.load_align_model(
                language_code=args.language,
                device=args.device,
                model_name=args.model_name,
                model_dir=args.model_dir
            )

            segments = [{"text": text, "start": 0.0, "end": duration}]
            result = whisperx.align(
                segments,
                model_a,
                metadata,
                audio,
                device=args.device,
                return_char_alignments=False
            )

            collected_words = []
            for seg in result.get("segments", []):
                for w in seg.get("words", []):
                    collected_words.append(w)

        # Deterministic sequence alignment and token reconciliation
        output_words = reconcile_tokens(raw_words, collected_words)

        # Write clean JSON exclusively to stdout
        sys.stdout.write(json.dumps({"words": output_words}) + "\n")
        sys.stdout.flush()

    except Exception as e:
        sys.stderr.write(f"Error during alignment: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
