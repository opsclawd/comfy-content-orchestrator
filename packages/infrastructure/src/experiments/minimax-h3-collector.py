#!/usr/bin/env python3
"""
MiniMax-H3 Experiment Child Instrumentation Collector & Bootstrap.
Protocol: v2-jsonl

Repository-owned Python bootstrap used only by the experiment process runner.
It records deterministic, additive phase accounting without modifying ComfyUI checkout.
"""

import atexit
import hashlib
import json
import os
import sys
import time
import traceback
from typing import Any, Dict, Optional

# Clock domain: Monotonic child clock
def now_mono_ms() -> float:
    return time.monotonic() * 1000.0

class Collector:
    def __init__(self, log_path: str, run_id: str, attempt_token: str):
        self.log_path = log_path
        self.run_id = run_id
        self.attempt_token = attempt_token
        self.prompt_id: Optional[str] = None
        self.seq = 0
        self.file = open(self.log_path, "a", encoding="utf-8")
        self.active_spans: Dict[str, Dict[str, Any]] = {}
        self.span_counter = 0

    def next_span_id(self, prefix: str = "span") -> str:
        self.span_counter += 1
        return f"{prefix}-{self.span_counter:04d}"

    def emit(
        self,
        phase: str,
        event_type: str,
        span_id: str,
        parent_span_id: Optional[str] = None,
        monotonic_ms: Optional[float] = None,
        node_id: Optional[str] = None,
        class_type: Optional[str] = None,
        step_index: Optional[int] = None,
        outcome: Optional[str] = None,
        error: Optional[Dict[str, str]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        if monotonic_ms is None:
            monotonic_ms = now_mono_ms()
        self.seq += 1
        record = {
            "protocolVersion": "v2-jsonl",
            "sequence": self.seq,
            "runId": self.run_id,
            "attemptToken": self.attempt_token,
            "promptId": self.prompt_id,
            "spanId": span_id,
            "parentSpanId": parent_span_id,
            "phase": phase,
            "type": event_type,
            "boundarySource": "child_bootstrap",
            "clockDomain": "mono_child",
            "monotonicMs": round(monotonic_ms, 3)
        }
        if node_id is not None:
            record["nodeId"] = str(node_id)
        if class_type is not None:
            record["classType"] = str(class_type)
        if step_index is not None:
            record["stepIndex"] = int(step_index)
        if outcome is not None:
            record["outcome"] = outcome
        if error is not None:
            record["error"] = error
        if metadata is not None:
            record["metadata"] = metadata

        line = json.dumps(record, separators=(",", ":"))
        self.file.write(line + "\n")
        self.file.flush()

    def start_span(
        self,
        phase: str,
        span_id: Optional[str] = None,
        parent_span_id: Optional[str] = None,
        node_id: Optional[str] = None,
        class_type: Optional[str] = None,
        step_index: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        if span_id is None:
            span_id = self.next_span_id(phase)
        mono_ms = now_mono_ms()
        self.active_spans[span_id] = {
            "phase": phase,
            "parent_span_id": parent_span_id,
            "start_ms": mono_ms,
            "node_id": node_id,
            "class_type": class_type,
            "step_index": step_index
        }
        self.emit(
            phase=phase,
            event_type="span_start",
            span_id=span_id,
            parent_span_id=parent_span_id,
            monotonic_ms=mono_ms,
            node_id=node_id,
            class_type=class_type,
            step_index=step_index,
            metadata=metadata
        )
        return span_id

    def end_span(
        self,
        span_id: str,
        outcome: str = "success",
        error: Optional[Dict[str, str]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        span = self.active_spans.pop(span_id, None)
        if not span:
            return
        mono_ms = now_mono_ms()
        self.emit(
            phase=span["phase"],
            event_type="span_end",
            span_id=span_id,
            parent_span_id=span["parent_span_id"],
            monotonic_ms=mono_ms,
            node_id=span.get("node_id"),
            class_type=span.get("class_type"),
            step_index=span.get("step_index"),
            outcome=outcome,
            error=error,
            metadata=metadata
        )

    def close(self):
        # Close any lingering spans as interrupted
        for span_id, span in list(self.active_spans.items()):
            self.emit(
                phase=span["phase"],
                event_type="span_end",
                span_id=span_id,
                parent_span_id=span["parent_span_id"],
                outcome="interrupted",
                error={"message": "Process exiting before span closed"}
            )
        self.active_spans.clear()
        if not self.file.closed:
            self.file.flush()
            self.file.close()

_GLOBAL_COLLECTOR: Optional[Collector] = None

def get_global_collector() -> Optional[Collector]:
    return _GLOBAL_COLLECTOR

def compute_file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def classify_node_phase(node_id: str, class_type: str) -> str:
    # Deterministic phase classification for MiniMax-H3 pipeline nodes
    if class_type in ("UNETLoader", "VAELoader", "CLIPLoader"):
        return "model_loading"
    if class_type in ("MiniMaxH3ImageToVideo", "MiniMaxH3ReferenceToVideo"):
        return "conditioning"
    if class_type in ("SamplerCustomAdvanced", "KSampler", "KSamplerAdvanced"):
        return "sampling"
    if class_type == "VAEDecode":
        return "vae_decode_video"
    if class_type == "VAEDecodeAudio":
        return "vae_decode_audio"
    if class_type in ("CreateVideo", "SaveVideo"):
        return "mux_and_save"
    return "unattributed"

def install_hooks(collector: Collector):
    """
    Hook into ComfyUI modules in-memory.
    Wraps model loading, node execution, sampling loops, and teardown.
    """
    # 1. Hook comfy.model_management for lazy GPU transfers
    try:
        import comfy.model_management as mm
        orig_load_models_gpu = getattr(mm, "load_models_gpu", None)
        if orig_load_models_gpu:
            def hooked_load_models_gpu(*args, **kwargs):
                span_id = collector.start_span("lazy_gpu_residency_transfer")
                try:
                    res = orig_load_models_gpu(*args, **kwargs)
                    collector.end_span(span_id, outcome="success")
                    return res
                except Exception as e:
                    collector.end_span(span_id, outcome="failed", error={"message": str(e), "exceptionType": type(e).__name__})
                    raise
            mm.load_models_gpu = hooked_load_models_gpu
    except ImportError:
        pass

    # 2. Hook execution.PromptExecutor / nodes execution
    try:
        import execution
        orig_execute = getattr(execution.PromptExecutor, "execute", None)
        if orig_execute:
            def hooked_prompt_execute(self, *args, **kwargs):
                # Try to extract prompt_id from args if available
                if args and len(args) > 1 and isinstance(args[1], str):
                    collector.prompt_id = args[1]
                return orig_execute(self, *args, **kwargs)
            execution.PromptExecutor.execute = hooked_prompt_execute
    except ImportError:
        pass

    # 3. Hook comfy.samplers for sampling and step boundaries
    try:
        import comfy.samplers as samplers
        orig_sample = getattr(samplers.KSampler, "sample", None)
        if orig_sample:
            def hooked_sample(self, *args, **kwargs):
                sampler_span_id = collector.start_span("sampling", class_type="KSampler")
                # Progress callbacks generally run after a step. They do not
                # establish a trustworthy step-start boundary, so preserve the
                # callback unchanged and leave individual step times unknown.
                try:
                    res = orig_sample(self, *args, **kwargs)
                    collector.end_span(sampler_span_id, outcome="success")
                    return res
                except Exception as e:
                    collector.end_span(sampler_span_id, outcome="failed", error={"message": str(e), "exceptionType": type(e).__name__})
                    raise
            samplers.KSampler.sample = hooked_sample
    except ImportError:
        pass

def main():
    global _GLOBAL_COLLECTOR

    run_dir = os.environ.get("CCO_EXPERIMENT_RUN_DIR", os.getcwd())
    run_id = os.environ.get("CCO_EXPERIMENT_RUN_ID", "default-run")
    attempt_token = os.environ.get("CCO_EXPERIMENT_ATTEMPT_TOKEN", "default-attempt")
    log_path = os.environ.get("CCO_EXPERIMENT_EVENT_LOG", os.path.join(run_dir, "phase-events.jsonl"))

    _GLOBAL_COLLECTOR = Collector(log_path, run_id, attempt_token)
    collector = _GLOBAL_COLLECTOR

    # Emit startup span
    startup_span_id = collector.start_span("environment_startup")

    # Handshake record
    collector.emit(
        phase="environment_startup",
        event_type="point_event",
        span_id=startup_span_id,
        metadata={
            "handshake": "v2-jsonl",
            "pythonVersion": sys.version,
            "pid": os.getpid()
        }
    )

    atexit.register(collector.close)

    # Parse args: if first arg is --bootstrap-entrypoint or a python file
    args = sys.argv[1:]
    target_script = None
    if args and args[0] == "--bootstrap-entrypoint" and len(args) > 1:
        target_script = args[1]
        target_argv = [target_script] + args[2:]
    elif args:
        target_script = args[0]
        target_argv = args

    if not target_script:
        collector.end_span(startup_span_id, outcome="failed", error={"message": "No entrypoint specified"})
        sys.exit(1)

    install_hooks(collector)
    collector.end_span(startup_span_id, outcome="success")

    # Replace sys.argv with target arguments
    sys.argv = target_argv
    sys.path.insert(0, os.path.dirname(os.path.abspath(target_script)))

    teardown_span_id = None
    try:
        with open(target_script, "rb") as f:
            code = compile(f.read(), target_script, "exec")
            globs = {
                "__name__": "__main__",
                "__file__": os.path.abspath(target_script),
                "__builtins__": __builtins__
            }
            exec(code, globs)
    except SystemExit as e:
        teardown_span_id = collector.start_span("teardown")
        collector.end_span(teardown_span_id, outcome="success" if e.code in (0, None) else "failed")
        collector.close()
        sys.exit(e.code)
    except Exception as e:
        teardown_span_id = collector.start_span("teardown")
        collector.end_span(
            teardown_span_id,
            outcome="failed",
            error={"message": str(e), "exceptionType": type(e).__name__, "traceback": traceback.format_exc()}
        )
        collector.close()
        raise
    else:
        teardown_span_id = collector.start_span("teardown")
        collector.end_span(teardown_span_id, outcome="success")
        collector.close()

if __name__ == "__main__":
    main()
