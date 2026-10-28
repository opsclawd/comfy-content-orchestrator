#!/usr/bin/env python3
"""
MiniMax-H3 Experiment Child Instrumentation Collector & Bootstrap.
Protocol: v2-jsonl

Repository-owned Python bootstrap used only by the experiment process runner.
It records deterministic, additive phase accounting without modifying ComfyUI checkout.
"""

import atexit
import builtins
import contextlib
import contextvars
import csv
import hashlib
import inspect
import io
import json
import os
import sys
import threading
import time
import traceback
from typing import Any, Dict, Optional

_CURRENT_PLANNED_EXCLUSION: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar(
    "_CURRENT_PLANNED_EXCLUSION", default=None
)
_ACTIVE_OVERRIDE_INSTANCE: contextvars.ContextVar[Optional[Any]] = contextvars.ContextVar(
    "_ACTIVE_OVERRIDE_INSTANCE", default=None
)
_ACTIVE_OVERRIDE_CALL_ARGS: contextvars.ContextVar[Optional[tuple]] = contextvars.ContextVar(
    "_ACTIVE_OVERRIDE_CALL_ARGS", default=None
)
_IN_DENSE_DISPATCH: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "_IN_DENSE_DISPATCH", default=False
)

class StepIntervalBuffer:
    def __init__(self):
        self.pending_calls = []
        self.completed_step_indices = set()

_SAMPLING_STEP_CALL_BUFFER: contextvars.ContextVar[Optional[StepIntervalBuffer]] = contextvars.ContextVar(
    "_SAMPLING_STEP_CALL_BUFFER", default=None
)

_HOOK_INSTALL_ERROR: Optional[str] = None

def _validate_callable_shape(fn: Any, min_params: int = 0) -> bool:
    if not callable(fn):
        return False
    # Explicit adapter: torch.nn.functional.scaled_dot_product_attention may be a C builtin without signature
    try:
        import torch.nn.functional as F
        if fn is getattr(F, "scaled_dot_product_attention", None):
            return True
    except Exception:
        pass

    try:
        sig = inspect.signature(fn)
    except (ValueError, TypeError):
        # Fail closed on uninspectable callables without an explicit adapter
        return False

    params = list(sig.parameters.values())
    pos_params = [
        p for p in params
        if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]
    offset = 1 if pos_params and pos_params[0].name in ("self", "cls") else 0

    dummy = [object()] * (min_params + offset)
    try:
        sig.bind(*dummy)
        return True
    except TypeError:
        return False

def _parse_nonnegative_int(val: Any) -> Optional[int]:
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, int):
        return val if val >= 0 else None
    if isinstance(val, str):
        s = val.strip()
        if s.isdigit():
            return int(s)
    return None

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
        metadata: Optional[Dict[str, Any]] = None,
        boundary_source: str = "child_bootstrap"
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
            "boundarySource": boundary_source,
            "clockDomain": "mono_child",
            "monotonicMs": round(monotonic_ms, 3)
        }
        if node_id is not None:
            record["nodeId"] = str(node_id)
        if class_type is not None:
            record["classType"] = str(class_type)
        if step_index is not None:
            parsed_step = _parse_nonnegative_int(step_index)
            if parsed_step is not None:
                record["stepIndex"] = parsed_step
        if outcome is not None:
            record["outcome"] = outcome
        if error is not None:
            record["error"] = error
        if metadata is not None:
            record["metadata"] = metadata

        if self.file.closed:
            return

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
        if self.file.closed:
            return
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

        # Emit attention summary point event before closing
        try:
            summary = _ATTENTION_TRACKER.summary()
            self.emit(
                phase="teardown",
                event_type="point_event",
                span_id=self.next_span_id("attn-summary"),
                boundary_source="diagnostic",
                metadata={
                    "attentionSummary": summary,
                    "stepRecords": _ATTENTION_TRACKER.step_records
                }
            )
        except Exception:
            pass

        if not self.file.closed:
            self.file.flush()
            self.file.close()

class AttentionTracker:
    def __init__(self):
        self._lock = threading.RLock()
        self.accelerated_call_count = 0
        self.dense_call_count = 0
        self.planned_dense_call_count = 0
        self.unflushed_calls_count = 0
        self.unattributed_call_count = 0
        self.fallback_events = []
        self.step_records = []
        self.actual_backend = None
        self.dispatch_impl = None
        self.missing_kernel_failure = None
        self.status = "unknown"
        self.failure_reason = None
        self.dtype_diagnostics = {}
        self.expected_backend = os.environ.get("CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND", os.environ.get("CCO_EXPECTED_ATTENTION_BACKEND"))
        allow_planned = os.environ.get("CCO_EXPERIMENT_ALLOW_PLANNED_DENSE", "true")
        self.allow_planned_dense = allow_planned.lower() in ("1", "true", "yes")

    def reset(self):
        with self._lock:
            self.accelerated_call_count = 0
            self.dense_call_count = 0
            self.planned_dense_call_count = 0
            self.unflushed_calls_count = 0
            self.unattributed_call_count = 0
            self.fallback_events.clear()
            self.step_records.clear()
            self.actual_backend = None
            self.dispatch_impl = None
            self.missing_kernel_failure = None
            self.status = "unknown"
            self.failure_reason = None
            self.dtype_diagnostics.clear()

    def record_accelerated(
        self,
        backend: str,
        impl: str,
        step_index: Optional[int] = None,
        layer_index: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        with self._lock:
            buf = _SAMPLING_STEP_CALL_BUFFER.get()
            self.accelerated_call_count += 1
            self.actual_backend = backend
            self.dispatch_impl = impl
            if self.status != "fallback" and self.status != "failed":
                self.status = "verified"

            step_idx = _parse_nonnegative_int(step_index)
            layer_idx = _parse_nonnegative_int(layer_index)

            call_payload = {
                "backend": backend,
                "implementation": impl,
                "callType": "accelerated",
                "directStep": step_idx,
                "layerIndex": layer_idx,
                "monotonicMs": now_mono_ms()
            }
            if metadata:
                call_payload["metadata"] = metadata

            if buf is not None:
                buf.pending_calls.append(call_payload)
            else:
                if step_idx is not None:
                    rec = {
                        "stepIndex": step_idx,
                        "layerIndex": layer_idx,
                        "backend": backend,
                        "implementation": impl,
                        "callType": "accelerated",
                        "monotonicMs": call_payload["monotonicMs"]
                    }
                    if metadata:
                        rec["metadata"] = metadata
                    self.step_records.append(rec)
                else:
                    self.unattributed_call_count += 1

    def record_dense(
        self,
        is_planned: bool = False,
        metadata: Optional[Dict[str, Any]] = None,
        step_index: Optional[int] = None,
        layer_index: Optional[int] = None
    ):
        with self._lock:
            buf = _SAMPLING_STEP_CALL_BUFFER.get()
            is_accelerated = bool(
                self.expected_backend and self.expected_backend not in ("torch_sdpa", "dense", "default")
            )
            step_idx = _parse_nonnegative_int(step_index)
            layer_idx = _parse_nonnegative_int(layer_index)

            if not is_planned:
                self.dense_call_count += 1
                if is_accelerated:
                    reason = "Unexpected dense attention call executed during accelerated regime"
                    if not self.allow_planned_dense:
                        reason += " (allowPlannedDense=false)"
                    self.record_fallback(self.expected_backend, "torch_sdpa", reason, step_index=step_idx, terminal=True)
                    return
            else:
                if not self.allow_planned_dense:
                    self.dense_call_count += 1
                    reason = "Planned dense attention call executed under zero-dense policy regime (allowPlannedDense=false)"
                    self.record_fallback(self.expected_backend, "torch_sdpa", reason, step_index=step_idx, terminal=True)
                    return
                self.planned_dense_call_count += 1

            if not is_accelerated and self.status != "fallback" and self.status != "failed":
                if self.actual_backend in ("unknown", None):
                    self.actual_backend = "torch_sdpa"
                    self.dispatch_impl = "torch.nn.functional.scaled_dot_product_attention"
                    self.status = "verified"

            call_payload = {
                "backend": "torch_sdpa",
                "implementation": "torch.nn.functional.scaled_dot_product_attention",
                "callType": "planned_dense" if is_planned else "dense",
                "directStep": step_idx,
                "layerIndex": layer_idx,
                "monotonicMs": now_mono_ms()
            }
            if metadata:
                call_payload["metadata"] = metadata

            if buf is not None:
                buf.pending_calls.append(call_payload)
            else:
                if step_idx is not None:
                    rec = {
                        "stepIndex": step_idx,
                        "layerIndex": layer_idx,
                        "backend": "torch_sdpa",
                        "implementation": "torch.nn.functional.scaled_dot_product_attention",
                        "callType": "planned_dense" if is_planned else "dense",
                        "monotonicMs": call_payload["monotonicMs"]
                    }
                    if metadata:
                        rec["metadata"] = metadata
                    self.step_records.append(rec)
                else:
                    self.unattributed_call_count += 1

    def record_fallback(
        self,
        requested: str,
        fallback: str,
        reason: str,
        step_index: Optional[int] = None,
        terminal: bool = False
    ):
        s_idx = _parse_nonnegative_int(step_index)
        event = {
            "stepIndex": s_idx,
            "layerIndex": None,
            "requestedBackend": requested,
            "fallbackBackend": fallback,
            "reason": reason,
            "monotonicMs": now_mono_ms()
        }
        with self._lock:
            self.fallback_events.append(event)
            self.status = "fallback"
            self.failure_reason = reason
            if s_idx is not None:
                self.step_records.append({
                    "stepIndex": s_idx,
                    "backend": fallback,
                    "implementation": "torch.nn.functional.scaled_dot_product_attention",
                    "callType": "fallback",
                    "monotonicMs": now_mono_ms()
                })
            else:
                self.unattributed_call_count += 1
            is_accelerated = bool(
                self.expected_backend and self.expected_backend not in ("torch_sdpa", "dense", "default")
            )
            should_fail_terminal = terminal or is_accelerated
        if _GLOBAL_COLLECTOR and not _GLOBAL_COLLECTOR.file.closed:
            try:
                _GLOBAL_COLLECTOR.emit(
                    phase="sampling",
                    event_type="point_event",
                    span_id=_GLOBAL_COLLECTOR.next_span_id("attn-fallback"),
                    step_index=s_idx,
                    metadata={
                        "attentionEvent": "fallback",
                        "requestedBackend": requested,
                        "fallbackBackend": fallback,
                        "reason": reason
                    }
                )
            except Exception:
                pass
        if should_fail_terminal:
            self.status = "failed"
            print(f"[ERROR] Terminal attention experiment failure: {reason}", file=sys.stderr)
            if _GLOBAL_COLLECTOR:
                _GLOBAL_COLLECTOR.close()
            sys.exit(1)

    @contextlib.contextmanager
    def planned_exclusion(self, reason: str, metadata: Optional[Dict[str, Any]] = None):
        payload = {"reason": reason, **(metadata or {})}
        reset_handle = _CURRENT_PLANNED_EXCLUSION.set(payload)
        try:
            yield
        finally:
            _CURRENT_PLANNED_EXCLUSION.reset(reset_handle)

    def summary(self) -> Dict[str, Any]:
        with self._lock:
            eff_status = self.status
            eff_reason = self.failure_reason
            if self.unflushed_calls_count > 0:
                if eff_status != "failed":
                    eff_status = "fallback"
                    if not eff_reason:
                        eff_reason = (
                            f"Attention evidence incomplete: {self.unflushed_calls_count} unflushed call(s)"
                        )
            return {
                "acceleratedCallCount": self.accelerated_call_count,
                "denseCallCount": self.dense_call_count,
                "plannedDenseCallCount": self.planned_dense_call_count,
                "unflushedCallCount": self.unflushed_calls_count,
                "unattributedCallCount": self.unattributed_call_count,
                "fallbackEvents": list(self.fallback_events),
                "actualBackend": self.actual_backend,
                "dispatchImplementation": self.dispatch_impl,
                "missingKernelFailure": self.missing_kernel_failure,
                "status": eff_status,
                "failureReason": eff_reason,
                "dtypeLayoutDiagnostics": dict(self.dtype_diagnostics)
            }

_ATTENTION_TRACKER = AttentionTracker()
_GLOBAL_COLLECTOR: Optional[Collector] = None

def flush_step_buffer(step_idx: int):
    s_idx = _parse_nonnegative_int(step_idx)
    if s_idx is None:
        return
    buf = _SAMPLING_STEP_CALL_BUFFER.get()
    if buf is None:
        return
    with _ATTENTION_TRACKER._lock:
        if s_idx in buf.completed_step_indices:
            # Duplicate completion callback for an already-flushed step index. Any calls
            # buffered since the prior flush belong to this duplicate completion, not to
            # whatever step is flushed next -- without this, they silently bleed into the
            # next flush_step_buffer() call and get misattributed to a different step
            # (F-a4b12b34). Count them as unflushed instead of discarding the evidence
            # entirely.
            if buf.pending_calls:
                _ATTENTION_TRACKER.unflushed_calls_count += len(buf.pending_calls)
                buf.pending_calls.clear()
            return
        buf.completed_step_indices.add(s_idx)
        calls_to_flush = list(buf.pending_calls)
        buf.pending_calls.clear()
        for call in calls_to_flush:
            direct = call.get("directStep")
            if direct is not None and direct != s_idx:
                _ATTENTION_TRACKER.record_fallback(
                    _ATTENTION_TRACKER.expected_backend or call["backend"],
                    "torch_sdpa",
                    f"Contradictory step index: direct={direct} vs callback={s_idx}",
                    step_index=s_idx
                )
            rec = {
                "stepIndex": s_idx,
                "layerIndex": call.get("layerIndex"),
                "backend": call["backend"],
                "implementation": call["implementation"],
                "callType": call["callType"],
                "monotonicMs": call["monotonicMs"]
            }
            if "metadata" in call and call["metadata"]:
                rec["metadata"] = call["metadata"]
            _ATTENTION_TRACKER.step_records.append(rec)
            if _GLOBAL_COLLECTOR and not _GLOBAL_COLLECTOR.file.closed:
                _GLOBAL_COLLECTOR.emit(
                    phase="sampling",
                    event_type="point_event",
                    span_id=_GLOBAL_COLLECTOR.next_span_id("attn-step-rec"),
                    step_index=s_idx,
                    metadata={"attentionStepRecord": rec}
                )

def get_global_collector() -> Optional[Collector]:
    return _GLOBAL_COLLECTOR

def compute_file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def _resolve_custom_node_git_revision(source_file: str) -> Optional[str]:
    """Walk upward from a registered node's source file to find the git
    checkout root of the custom-node package that defines it (if any), and
    return its current HEAD commit SHA. Returns None if the file is not
    inside a git checkout or git is unavailable/times out."""
    try:
        import subprocess
        d = os.path.dirname(os.path.abspath(source_file))
        for _ in range(8):
            if os.path.isdir(os.path.join(d, ".git")):
                proc = subprocess.run(
                    ["git", "-C", d, "rev-parse", "HEAD"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    return proc.stdout.strip()
                return None
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    except Exception:
        pass
    return None

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

def load_veda_exclusion_spec() -> Dict[str, Any]:
    fixture_path = os.environ.get("CCO_VEDA_FIXTURE_PATH", os.environ.get("CCO_EXPERIMENT_VEDA_FIXTURE_PATH"))
    if not fixture_path:
        candidate = os.path.normpath(
            os.path.join(
                os.path.dirname(__file__),
                "../../../../experiments/minimax-h3-attention/fixtures/veda-sparse-attention-api.json"
            )
        )
        if os.path.exists(candidate):
            fixture_path = candidate
    if fixture_path and os.path.exists(fixture_path):
        try:
            with open(fixture_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                hooks = data.get("exclusionHooks")
                if isinstance(hooks, dict):
                    return hooks
        except Exception:
            pass
    return {
        "patchClass": "VedaPatch",
        "sourceFile": "veda_comfy/comfy_patch.py",
        "decisionMethods": ["make_override", "_routed_forward", "_dense_reason", "_block_reason"],
        "supportedExclusionReasons": ["full-attention layer", "full-attention step"]
    }

_VEDA_EXCLUSION_SPEC = load_veda_exclusion_spec()
VERIFIED_VEDA_EXCLUSION_REASONS = frozenset(
    _VEDA_EXCLUSION_SPEC.get("supportedExclusionReasons", ["full-attention layer", "full-attention step"])
)

def _resolve_teacache_module(guider=None, model_patcher=None):
    # 1. Inspect model_patcher or guider for wrapped model
    mp = model_patcher
    if mp is None and guider is not None:
        mp = getattr(guider, "model_patcher", None) or getattr(guider, "model", None)
    if mp is not None:
        opts = getattr(mp, "model_options", None)
        if isinstance(opts, dict):
            wrapper = opts.get("model_function_wrapper")
            while hasattr(wrapper, "__wrapped__"):
                wrapper = getattr(wrapper, "__wrapped__")
            if wrapper is not None:
                mod = getattr(wrapper, "_teacache_module", None)
                if mod is not None and hasattr(mod, "TeaCacheSession"):
                    return mod
                fn_globals = getattr(wrapper, "__globals__", {})
                mod = fn_globals.get("_teacache_mod") or fn_globals.get("teacache")
                if mod is not None and hasattr(mod, "TeaCacheSession"):
                    return mod

    # 2. Check ComfyUI registered node classes if available
    try:
        import nodes as comfy_nodes
        mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {})
        for key in ("CCOMiniMaxH3TeaCache", "MiniMaxH3TeaCache"):
            if key in mappings:
                cls = mappings[key]
                mod = getattr(cls, "_teacache_module", None)
                if mod is not None and hasattr(mod, "TeaCacheSession"):
                    return mod
                cls_mod = sys.modules.get(cls.__module__)
                if cls_mod is not None:
                    mod = getattr(cls_mod, "_teacache_mod", None) or getattr(cls_mod, "teacache", None)
                    if mod is not None and hasattr(mod, "TeaCacheSession"):
                        return mod
    except Exception:
        pass

    # 3. Search sys.modules for loaded adapter packages
    for mod_name, mod in list(sys.modules.items()):
        if mod is not None and hasattr(mod, "CCOMiniMaxH3TeaCacheNode"):
            tc_mod = getattr(mod, "_teacache_module", None) or getattr(mod, "_teacache_mod", None) or getattr(mod, "teacache", None)
            if tc_mod is not None and hasattr(tc_mod, "TeaCacheSession"):
                return tc_mod

    for mod_name, mod in list(sys.modules.items()):
        if mod is not None and (mod_name.endswith(".teacache") or mod_name == "teacache"):
            if hasattr(mod, "TeaCacheSession") and hasattr(mod, "get_active_session") and hasattr(mod, "set_active_session"):
                return mod

    # 4. Check custom_nodes directories for staged cco-minimax-h3-teacache
    for base in [os.getcwd(), "/opt/comfyui-isolated-teacache"]:
        cn_dir = os.path.join(base, "custom_nodes")
        if os.path.isdir(cn_dir):
            for entry in ["cco-minimax-h3-teacache", "ComfyUI-MiniMaxH3-TeaCache", "minimax-h3-teacache"]:
                pkg_path = os.path.join(cn_dir, entry)
                tc_file = os.path.join(pkg_path, "teacache.py")
                if os.path.isfile(tc_file):
                    try:
                        import importlib.util
                        spec = importlib.util.spec_from_file_location(f"custom_nodes_{entry.replace('-', '_')}_teacache", tc_file)
                        if spec and spec.loader:
                            mod = importlib.util.module_from_spec(spec)
                            spec.loader.exec_module(mod)
                            if hasattr(mod, "TeaCacheSession"):
                                return mod
                    except Exception:
                        pass

    # 5. Fallback import
    try:
        from experiments.minimax_h3_teacache import teacache
        return teacache
    except Exception:
        pass
    try:
        import teacache
        return teacache
    except Exception:
        pass
    candidates = [
        os.path.join(os.getcwd(), "experiments", "minimax-h3-teacache"),
        os.path.join(os.path.dirname(__file__), "../../../../experiments/minimax-h3-teacache")
    ]
    for cdir in candidates:
        norm = os.path.normpath(cdir)
        if os.path.exists(norm) and norm not in sys.path:
            sys.path.insert(0, norm)
            try:
                import teacache
                return teacache
            except Exception:
                pass
    return None

# Pinned post-adaptation local-file digest for the staged TeaCache adapter
# package, matching packages/contracts/src/minimax-h3-teacache.ts's
# TEACACHE_LOCAL_ADAPTER_DIGEST exactly (same three files, same
# json.dumps(sort_keys=True, separators=(",", ":")) canonicalization). Kept
# here (rather than only checked statically pre-run by runtime-registry.ts)
# so the digest of the module *actually resolved and bound* at sampling time
# is itself verified -- a static pre-flight check cannot prove that a later
# runtime resolution step didn't substitute a different, unverified copy.
TEACACHE_LOCAL_ADAPTER_DIGEST = "84b6277f94fa5581d0bd046e9f4d3115442478aee06a003e9de795195a30ab10"


def _compute_teacache_adapter_digest(package_dir: str) -> Optional[str]:
    try:
        file_hashes = {}
        for fname in ("__init__.py", "nodes.py", "teacache.py"):
            fpath = os.path.join(package_dir, fname)
            if not os.path.isfile(fpath):
                return None
            with open(fpath, "rb") as f:
                file_hashes[fname] = hashlib.sha256(f.read()).hexdigest()
        payload = json.dumps(file_hashes, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
    except Exception:
        return None


def _verify_teacache_adapter_identity(tc_mod) -> Dict[str, Any]:
    """Hash the actually-resolved adapter module's directory and compare
    against the pinned local-adapter digest. Returns a dict describing the
    verification outcome; never raises (the caller decides how to act)."""
    mod_file = getattr(tc_mod, "__file__", None)
    if not mod_file:
        return {"verified": False, "reason": "resolved_module_has_no___file__"}
    package_dir = os.path.dirname(os.path.abspath(mod_file))
    digest = _compute_teacache_adapter_digest(package_dir)
    if digest is None:
        return {"verified": False, "reason": "missing_adapter_files", "packageDir": package_dir}
    if digest != TEACACHE_LOCAL_ADAPTER_DIGEST:
        return {
            "verified": False,
            "reason": "digest_mismatch",
            "packageDir": package_dir,
            "observedDigest": digest,
            "expectedDigest": TEACACHE_LOCAL_ADAPTER_DIGEST
        }
    return {"verified": True, "packageDir": package_dir, "observedDigest": digest}


def extract_layer_and_step(args, kwargs):
    layer = None
    step = None

    def inspect_dict(d: dict, depth: int = 0):
        nonlocal layer, step
        if depth > 3:
            return
        if layer is None:
            for k in ("block_index", "layer", "transformer_index"):
                if k in d and d[k] is not None:
                    layer = d[k]
                    break
            if layer is None and "block" in d and d["block"] is not None:
                b = d["block"]
                if isinstance(b, (list, tuple)) and len(b) > 1 and isinstance(b[1], int) and not isinstance(b[1], bool):
                    layer = b[1]
                else:
                    layer = b
        if step is None:
            for k in ("step", "sub_step", "step_index"):
                if k in d and d[k] is not None:
                    step = d[k]
                    break
        for sub_k in ("options", "extra_options", "transformer_options"):
            if sub_k in d and isinstance(d[sub_k], dict):
                inspect_dict(d[sub_k], depth + 1)

    for arg in args:
        if isinstance(arg, dict):
            inspect_dict(arg)
    for v in kwargs.values():
        if isinstance(v, dict):
            inspect_dict(v)

    if layer is None or step is None:
        active_call = _ACTIVE_OVERRIDE_CALL_ARGS.get()
        if active_call is not None:
            call_args, call_kwargs = active_call
            for arg in call_args:
                if isinstance(arg, dict):
                    inspect_dict(arg)
            for v in call_kwargs.values():
                if isinstance(v, dict):
                    inspect_dict(v)

    if layer is None or step is None:
        excl = _CURRENT_PLANNED_EXCLUSION.get()
        if excl and isinstance(excl, dict):
            if layer is None and excl.get("layer") is not None:
                layer = excl.get("layer")
            if step is None and excl.get("step") is not None:
                step = excl.get("step")

    norm_layer = _parse_nonnegative_int(layer)
    norm_step = _parse_nonnegative_int(step)

    return norm_layer, norm_step

def is_verified_veda_patch_class(cls) -> bool:
    if not isinstance(cls, type):
        return False
    spec = _VEDA_EXCLUSION_SPEC
    if cls.__name__ != spec.get("patchClass", "VedaPatch"):
        return False

    expected_source_file = spec.get("sourceFile", "veda_comfy/comfy_patch.py").replace("\\", "/")
    expected_module = expected_source_file.replace("/", ".").replace(".py", "")

    mod_name = getattr(cls, "__module__", "")
    source_file = ""
    try:
        source_file = (inspect.getfile(cls) or "").replace("\\", "/")
    except (TypeError, OSError):
        pass

    # Source file MUST be present and end with the verified relative path
    if not source_file or not source_file.endswith(expected_source_file):
        return False

    # Module name MUST match or end with the verified module
    if not (mod_name == expected_module or mod_name.endswith("." + expected_module)):
        return False

    # All decision methods from the fixture specification must be present and callable
    expected_methods = spec.get(
        "decisionMethods",
        ["make_override", "_routed_forward", "_dense_reason", "_block_reason"]
    )
    for method_name in expected_methods:
        if not callable(getattr(cls, method_name, None)):
            return False

    # Verify method shapes and parameter signatures against pinned upstream signatures
    try:
        sig_dense = inspect.signature(getattr(cls, "_dense_reason"))
        params_dense = list(sig_dense.parameters.keys())
        if len(params_dense) < 3 or params_dense[0] != "self" or params_dense[1] != "q":
            return False

        sig_block = inspect.signature(getattr(cls, "_block_reason"))
        params_block = list(sig_block.parameters.keys())
        if len(params_block) < 2 or params_block[0] != "self":
            return False

        sig_override = inspect.signature(getattr(cls, "make_override"))
        params_override = list(sig_override.parameters.keys())
        if len(params_override) < 2 or params_override[0] != "self":
            return False

        sig_routed = inspect.signature(getattr(cls, "_routed_forward"))
        params_routed = list(sig_routed.parameters.keys())
        if len(params_routed) < 5 or params_routed[0] != "self" or params_routed[1] != "func" or params_routed[2] != "q":
            return False
    except (ValueError, TypeError):
        return False

    return True

def hook_veda_patch_class(cls):
    if not is_verified_veda_patch_class(cls):
        return

    def hook_instance_methods(instance):
        for method_name in ("_dense_reason", "_block_reason"):
            if method_name in instance.__dict__:
                orig_fn = instance.__dict__[method_name]
                if callable(orig_fn) and not getattr(orig_fn, "_cco_hooked", False):
                    def make_hooked_inst_reason(m_name, f_orig):
                        def hooked_inst_reason(*args, **kwargs):
                            res = f_orig(*args, **kwargs)
                            active_instance = _ACTIVE_OVERRIDE_INSTANCE.get()
                            if active_instance is not None and active_instance is instance:
                                if isinstance(res, str) and res in VERIFIED_VEDA_EXCLUSION_REASONS:
                                    if _CURRENT_PLANNED_EXCLUSION.get() is None:
                                        layer, step = extract_layer_and_step(args, kwargs)
                                        _CURRENT_PLANNED_EXCLUSION.set({
                                            "patchClass": instance.__class__.__name__,
                                            "decisionMethod": m_name,
                                            "hook": f"{instance.__class__.__name__}.{m_name}",
                                            "reason": res,
                                            "layer": layer,
                                            "step": step
                                        })
                                elif res:
                                    _CURRENT_PLANNED_EXCLUSION.set(None)
                            return res
                        hooked_inst_reason._cco_hooked = True
                        return hooked_inst_reason
                    instance.__dict__[method_name] = make_hooked_inst_reason(method_name, orig_fn)

    def hook_reason_method(target_cls, method_name):
        orig_fn = getattr(target_cls, method_name, None)
        if callable(orig_fn) and not getattr(orig_fn, "_cco_hooked", False):
            def hooked_reason(self, *args, **kwargs):
                res = orig_fn(self, *args, **kwargs)
                active_instance = _ACTIVE_OVERRIDE_INSTANCE.get()
                if active_instance is not None and active_instance is self:
                    if isinstance(res, str) and res in VERIFIED_VEDA_EXCLUSION_REASONS:
                        if _CURRENT_PLANNED_EXCLUSION.get() is None:
                            layer, step = extract_layer_and_step(args, kwargs)
                            _CURRENT_PLANNED_EXCLUSION.set({
                                "patchClass": self.__class__.__name__,
                                "decisionMethod": method_name,
                                "hook": f"{self.__class__.__name__}.{method_name}",
                                "reason": res,
                                "layer": layer,
                                "step": step
                            })
                    elif res:
                        # Truthy return that is NOT a verified exclusion reason
                        # (e.g. 'layer outside the predictor'). Upstream may dispatch
                        # dense attention, but this must NOT be counted as planned.
                        _CURRENT_PLANNED_EXCLUSION.set(None)
                return res
            hooked_reason._cco_hooked = True
            setattr(target_cls, method_name, hooked_reason)

    hook_reason_method(cls, "_dense_reason")
    hook_reason_method(cls, "_block_reason")

    orig_make_override = getattr(cls, "make_override", None)
    if callable(orig_make_override) and not getattr(orig_make_override, "_cco_hooked", False):
        def hooked_make_override(self, *args, **kwargs):
            hook_instance_methods(self)
            override = orig_make_override(self, *args, **kwargs)
            if not callable(override):
                return override

            def wrapped_override(*o_args, **o_kwargs):
                hook_instance_methods(self)
                # If we're already running inside an active scope for this same
                # instance (e.g. _routed_forward delegated into make_override's
                # returned override), don't clobber the enclosing scope's
                # _CURRENT_PLANNED_EXCLUSION / _ACTIVE_OVERRIDE_INSTANCE: the
                # outer scope owns the decision lifetime, not this nested call.
                if _ACTIVE_OVERRIDE_INSTANCE.get() is self:
                    return override(*o_args, **o_kwargs)
                token_instance = _ACTIVE_OVERRIDE_INSTANCE.set(self)
                token_excl = _CURRENT_PLANNED_EXCLUSION.set(None)
                token_args = _ACTIVE_OVERRIDE_CALL_ARGS.set((o_args, o_kwargs))
                try:
                    return override(*o_args, **o_kwargs)
                finally:
                    _ACTIVE_OVERRIDE_CALL_ARGS.reset(token_args)
                    _CURRENT_PLANNED_EXCLUSION.reset(token_excl)
                    _ACTIVE_OVERRIDE_INSTANCE.reset(token_instance)

            wrapped_override._cco_hooked = True
            return wrapped_override

        hooked_make_override._cco_hooked = True
        cls.make_override = hooked_make_override

    orig_routed_forward = getattr(cls, "_routed_forward", None)
    if callable(orig_routed_forward) and not getattr(orig_routed_forward, "_cco_hooked", False):
        def hooked_routed_forward(self, *args, **kwargs):
            hook_instance_methods(self)
            # Same nesting guard as wrapped_override: if make_override's
            # returned override already delegated into _routed_forward for
            # this same instance, preserve the enclosing scope's
            # _CURRENT_PLANNED_EXCLUSION / _ACTIVE_OVERRIDE_INSTANCE instead
            # of resetting it out from under the active decision.
            if _ACTIVE_OVERRIDE_INSTANCE.get() is self:
                return orig_routed_forward(self, *args, **kwargs)
            token_instance = _ACTIVE_OVERRIDE_INSTANCE.set(self)
            token_excl = _CURRENT_PLANNED_EXCLUSION.set(None)
            token_args = _ACTIVE_OVERRIDE_CALL_ARGS.set((args, kwargs))
            try:
                return orig_routed_forward(self, *args, **kwargs)
            finally:
                _ACTIVE_OVERRIDE_CALL_ARGS.reset(token_args)
                _CURRENT_PLANNED_EXCLUSION.reset(token_excl)
                _ACTIVE_OVERRIDE_INSTANCE.reset(token_instance)

        hooked_routed_forward._cco_hooked = True
        cls._routed_forward = hooked_routed_forward

_INSTALLED_WRAPPERS = {}
_BOOTSTRAP_ENTRYPOINT = os.environ.get("CCO_EXPERIMENT_BOOTSTRAP_ENTRYPOINT", None)

def get_collector_digest() -> str:
    h = hashlib.sha256()
    with open(__file__, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def get_installed_hooks_evidence() -> list:
    hooks = []

    attached_import = False
    try:
        cur_imp = builtins.__import__
        attached_import = bool(getattr(cur_imp, "_cco_hooked", False) is True and cur_imp is _INSTALLED_WRAPPERS.get("attention_deferred_import_hook"))
    except Exception:
        pass
    hooks.append({
        "name": "attention_deferred_import_hook",
        "modulePath": "builtins",
        "callable": "__import__",
        "phase": "attention",
        "attached": attached_import
    })

    attached_ks = False
    try:
        import comfy.samplers as samplers
        ks = getattr(samplers, "KSampler", None)
        fn = getattr(ks, "sample", None)
        attached_ks = bool(fn is not None and getattr(fn, "_cco_hooked", False) is True and fn is _INSTALLED_WRAPPERS.get("ksampler_sample"))
    except Exception:
        pass
    hooks.append({
        "name": "ksampler_sample",
        "modulePath": "comfy.samplers",
        "callable": "KSampler.sample",
        "phase": "sampling",
        "attached": attached_ks
    })

    attached_mm = False
    try:
        import comfy.model_management as mm
        fn = getattr(mm, "load_models_gpu", None)
        attached_mm = bool(fn is not None and getattr(fn, "_cco_hooked", False) is True and fn is _INSTALLED_WRAPPERS.get("load_models_gpu"))
    except Exception:
        pass
    hooks.append({
        "name": "load_models_gpu",
        "modulePath": "comfy.model_management",
        "callable": "load_models_gpu",
        "phase": "lazy_gpu_residency_transfer",
        "attached": attached_mm
    })

    attached_cond = False
    try:
        import comfy_extras.nodes_minimax_h3 as nmh3
        node = getattr(nmh3, "MiniMaxH3ImageToVideo", None)
        raw = getattr(node, "__dict__", {}).get("execute", None)
        unbound = getattr(raw, "__func__", raw)
        attached_cond = bool(unbound is not None and getattr(unbound, "_cco_hooked", False) is True and unbound is _INSTALLED_WRAPPERS.get("minimax_h3_image_to_video_execute"))
    except Exception:
        pass
    hooks.append({
        "name": "minimax_h3_image_to_video_execute",
        "modulePath": "comfy_extras.nodes_minimax_h3",
        "callable": "MiniMaxH3ImageToVideo.execute",
        "phase": "conditioning",
        "attached": attached_cond
    })

    attached_ref = False
    try:
        import comfy_extras.nodes_minimax_h3 as nmh3
        node = getattr(nmh3, "MiniMaxH3ReferenceToVideo", None)
        raw = getattr(node, "__dict__", {}).get("execute", None)
        unbound = getattr(raw, "__func__", raw)
        attached_ref = bool(unbound is not None and getattr(unbound, "_cco_hooked", False) is True and unbound is _INSTALLED_WRAPPERS.get("minimax_h3_reference_to_video_execute"))
    except Exception:
        pass
    hooks.append({
        "name": "minimax_h3_reference_to_video_execute",
        "modulePath": "comfy_extras.nodes_minimax_h3",
        "callable": "MiniMaxH3ReferenceToVideo.execute",
        "phase": "conditioning",
        "attached": attached_ref
    })

    attached_pe = False
    try:
        import execution
        pe = getattr(execution, "PromptExecutor", None)
        fn = getattr(pe, "execute", None)
        attached_pe = bool(fn is not None and getattr(fn, "_cco_hooked", False) is True and fn is _INSTALLED_WRAPPERS.get("prompt_executor_execute"))
    except Exception:
        pass
    hooks.append({
        "name": "prompt_executor_execute",
        "modulePath": "execution",
        "callable": "PromptExecutor.execute",
        "phase": "prompt_execution",
        "attached": attached_pe
    })

    attached_cs = False
    try:
        import comfy_extras.nodes_custom_sampler as custom_sampler
        cs = getattr(custom_sampler, "SamplerCustomAdvanced", None)
        raw = getattr(cs, "__dict__", {}).get("execute", None) or getattr(cs, "__dict__", {}).get("sample", None)
        unbound = getattr(raw, "__func__", raw)
        attached_cs = bool(unbound is not None and getattr(unbound, "_cco_hooked", False) is True and unbound is _INSTALLED_WRAPPERS.get("sampler_custom_advanced_execute"))
    except Exception:
        pass
    hooks.append({
        "name": "sampler_custom_advanced_execute",
        "modulePath": "comfy_extras.nodes_custom_sampler",
        "callable": "SamplerCustomAdvanced.execute",
        "phase": "sampling",
        "attached": attached_cs
    })

    return sorted(hooks, key=lambda x: x["name"])

def compute_hook_manifest_digest(hooks: list) -> str:
    canonical_items = [
        {
            "callable": h["callable"],
            "modulePath": h["modulePath"],
            "name": h["name"],
            "phase": h["phase"]
        }
        for h in hooks
    ]
    sorted_hooks = sorted(canonical_items, key=lambda x: x["name"])
    canonical = json.dumps(sorted_hooks, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

def register_capability_route(prompt_server, collector: Collector):
    try:
        from aiohttp import web

        async def capability_handler(request):
            nonce = request.query.get("nonce", "")

            registered_nodes = {}
            try:
                import nodes
                mappings = getattr(nodes, "NODE_CLASS_MAPPINGS", {})
                for name, cls in mappings.items():
                    mod_name = getattr(cls, "__module__", "")
                    src_file = ""
                    mod_hash = None
                    try:
                        import inspect
                        src_file = inspect.getsourcefile(cls) or ""
                    except Exception:
                        pass
                    if not src_file and mod_name and mod_name in sys.modules:
                        src_file = getattr(sys.modules[mod_name], "__file__", "") or ""
                    if src_file and os.path.isfile(src_file):
                        try:
                            with open(src_file, "rb") as f:
                                mod_hash = hashlib.sha256(f.read()).hexdigest()
                        except Exception:
                            pass
                    entry = {
                        "className": getattr(cls, "__name__", str(name)),
                        "module": mod_name,
                        "sourceFile": src_file
                    }
                    if mod_hash:
                        entry["moduleHash"] = mod_hash
                    # The collector never reported a node's custom-node
                    # revision, so a catalog entry that pins a required
                    # node's revision (e.g. the Veda custom node's commit
                    # SHA) could never be satisfied even when the correct
                    # revision is installed (AC-3, F-e35ea06e). Walk up from
                    # the node's source file to the enclosing custom-node
                    # package's git checkout, if any, and report its HEAD.
                    if src_file:
                        revision = _resolve_custom_node_git_revision(src_file)
                        if revision:
                            entry["revision"] = revision
                    registered_nodes[str(name)] = entry
            except Exception:
                pass

            try:
                install_hooks(collector)
            except Exception:
                pass

            installed_hooks = get_installed_hooks_evidence()
            hook_manifest_digest = compute_hook_manifest_digest(installed_hooks)
            collector_digest = get_collector_digest()

            python_ver = sys.version.split()[0]
            pytorch_ver = None
            cuda_build = None
            try:
                import torch
                pytorch_ver = getattr(torch, "__version__", None)
                cuda_build = getattr(getattr(torch, "version", None), "cuda", None)
            except Exception:
                pass

            # Child interpreter identity: the handshake previously reported only
            # the Python version string, which does not distinguish between
            # interpreter builds/ABIs/toolchains that could satisfy the same
            # version constraint while differing in substance (AC-4, F-e35ea06e).
            python_executable_hash = None
            python_abi_tag = None
            python_compiler = None
            try:
                import platform
                import sysconfig
                python_compiler = platform.python_compiler()
                python_abi_tag = sysconfig.get_config_var("SOABI") or getattr(
                    sys.implementation, "cache_tag", None
                )
                exe_path = sys.executable
                if exe_path and os.path.isfile(exe_path):
                    with open(exe_path, "rb") as f:
                        python_executable_hash = hashlib.sha256(f.read()).hexdigest()
            except Exception:
                pass

            driver_ver = None
            try:
                import subprocess
                proc = subprocess.run(
                    ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=5
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    driver_ver = proc.stdout.strip().split("\n")[0].strip()
            except Exception:
                pass

            expected_backend = os.environ.get("CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND", "").strip()
            kernel_callable_available = False
            try:
                import torch
                import torch.nn.functional as F
                base_callable = hasattr(F, "scaled_dot_product_attention") and _validate_callable_shape(F.scaled_dot_product_attention, min_params=3)
                sdpa_wrapper = _INSTALLED_WRAPPERS.get("torch_sdpa")
                sdpa_attached = bool(
                    sdpa_wrapper is not None
                    and getattr(F.scaled_dot_product_attention, "_cco_hooked", False) is True
                    and F.scaled_dot_product_attention is sdpa_wrapper
                )

                if not expected_backend or expected_backend in ("sdpa", "torch_sdpa", "dense", "default"):
                    kernel_callable_available = bool(base_callable and sdpa_attached)
                elif "sage" in expected_backend:
                    import sageattention
                    cand_valid = hasattr(sageattention, "sageattn") and _validate_callable_shape(sageattention.sageattn, min_params=3)
                    comfy_attn = sys.modules.get("comfy.ldm.modules.attention")
                    sage_target = None
                    if comfy_attn:
                        for attr in ("sageattn", "attention_sage", "sageattn3"):
                            cand_t = getattr(comfy_attn, attr, None)
                            if cand_t is not None:
                                sage_target = cand_t
                                break
                    wrapper_attached = bool(
                        sage_target is not None
                        and getattr(sage_target, "_cco_hooked", False) is True
                        and (
                            sage_target is _INSTALLED_WRAPPERS.get("sageattn")
                            or sage_target is _INSTALLED_WRAPPERS.get("attention_sage")
                            or sage_target is _INSTALLED_WRAPPERS.get("sageattn3")
                        )
                    )
                    kernel_callable_available = bool(cand_valid and wrapper_attached)
                elif "kitchen" in expected_backend or "sol" in expected_backend:
                    import comfy_kitchen
                    if "chunked" in expected_backend or "block" in expected_backend:
                        cand_valid = hasattr(comfy_kitchen, "sol_attn_chunked") and _validate_callable_shape(comfy_kitchen.sol_attn_chunked, min_params=3)
                        chunk_target = getattr(comfy_kitchen, "sol_attn_chunked", None)
                        wrapper_attached = bool(
                            chunk_target is not None
                            and getattr(chunk_target, "_cco_hooked", False) is True
                            and _INSTALLED_WRAPPERS.get("sol_attn_chunked") is not None
                            and chunk_target is _INSTALLED_WRAPPERS.get("sol_attn_chunked")
                        )
                    else:
                        cand_valid = hasattr(comfy_kitchen, "sol_attn") and _validate_callable_shape(comfy_kitchen.sol_attn, min_params=3)
                        sol_target = getattr(comfy_kitchen, "sol_attn", None)
                        wrapper_attached = bool(
                            sol_target is not None
                            and getattr(sol_target, "_cco_hooked", False) is True
                            and _INSTALLED_WRAPPERS.get("sol_attn") is not None
                            and sol_target is _INSTALLED_WRAPPERS.get("sol_attn")
                        )
                    kernel_callable_available = bool(cand_valid and wrapper_attached)
                elif "veda" in expected_backend:
                    import veda_sparse_attention
                    cand_valid = hasattr(veda_sparse_attention, "triton_kernel") and _validate_callable_shape(veda_sparse_attention.triton_kernel, min_params=3)
                    veda_target = getattr(veda_sparse_attention, "triton_kernel", None)
                    wrapper_attached = bool(
                        veda_target is not None
                        and getattr(veda_target, "_cco_hooked", False) is True
                        and _INSTALLED_WRAPPERS.get("veda_kernel") is not None
                        and veda_target is _INSTALLED_WRAPPERS.get("veda_kernel")
                    )
                    kernel_callable_available = bool(cand_valid and wrapper_attached)
                else:
                    kernel_callable_available = False
            except Exception:
                kernel_callable_available = False

            package_identities = []
            try:
                import importlib.metadata
                req_pkg_env = os.environ.get("CCO_EXPERIMENT_REQUIRED_PACKAGES", "")
                dists_to_check = ["torch", "comfy-kitchen"]
                if req_pkg_env:
                    try:
                        if req_pkg_env.startswith("["):
                            parsed = json.loads(req_pkg_env)
                            for item in parsed:
                                name = item if isinstance(item, str) else item.get("name")
                                if name and name not in dists_to_check:
                                    dists_to_check.append(name)
                        else:
                            for p in req_pkg_env.split(","):
                                p_clean = p.strip()
                                if p_clean and p_clean not in dists_to_check:
                                    dists_to_check.append(p_clean)
                    except Exception:
                        pass
                for dist_name in dists_to_check:
                    try:
                        dist = importlib.metadata.distribution(dist_name)
                        rec = dist.read_text("RECORD")
                        if rec and rec.strip():
                            valid_files = []
                            for row in csv.reader(io.StringIO(rec)):
                                if not row or not row[0].strip():
                                    continue
                                norm_p = row[0].strip().replace("\\", "/")
                                if norm_p.endswith(".pyc") or "/__pycache__/" in norm_p or norm_p.endswith(".dist-info/RECORD"):
                                    continue
                                loc = dist.locate_file(row[0].strip())
                                if os.path.isfile(str(loc)):
                                    with open(str(loc), "rb") as f:
                                        valid_files.append((norm_p, hashlib.sha256(f.read()).hexdigest()))
                            valid_files.sort(key=lambda x: x[0])
                            p_payload = {
                                "files": [{"path": p, "sha256": s} for p, s in valid_files],
                                "method": "installed_record_sha256_v1",
                                "name": dist_name,
                                "version": dist.version
                            }
                            h = hashlib.sha256(json.dumps(p_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
                            package_identities.append({
                                "name": dist_name,
                                "version": dist.version,
                                "artifactHash": h,
                                "artifactMethod": "installed_record_sha256_v1"
                            })
                    except Exception:
                        pass
            except Exception:
                pass

            source_identities = {}
            try:
                source_modules = {
                    "main": "main.py",
                    "comfy.model_management": "comfy/model_management.py",
                    "comfy.cli_args": "comfy/cli_args.py",
                    "nodes": "nodes.py",
                    "comfy_extras.nodes_minimax_h3": "comfy_extras/nodes_minimax_h3.py",
                    "execution": "execution.py",
                    "comfy.samplers": "comfy/samplers.py",
                    "comfy_extras.nodes_custom_sampler": "comfy_extras/nodes_custom_sampler.py",
                }
                for mod_k, identity_path in source_modules.items():
                    if mod_k in sys.modules:
                        f_path = getattr(sys.modules[mod_k], "__file__", "")
                        if f_path and os.path.isfile(f_path):
                            with open(f_path, "rb") as f:
                                source_identities[identity_path] = hashlib.sha256(f.read()).hexdigest()

                entrypoint = _BOOTSTRAP_ENTRYPOINT or os.environ.get("CCO_EXPERIMENT_BOOTSTRAP_ENTRYPOINT")
                if entrypoint and os.path.isfile(entrypoint):
                    if "main.py" not in source_identities:
                        with open(entrypoint, "rb") as f:
                            source_identities["main.py"] = hashlib.sha256(f.read()).hexdigest()
                    base_dir = os.path.dirname(os.path.abspath(entrypoint))
                    for identity_path in source_modules.values():
                        if identity_path not in source_identities:
                            cand = os.path.join(base_dir, identity_path)
                            if os.path.isfile(cand):
                                with open(cand, "rb") as f:
                                    source_identities[identity_path] = hashlib.sha256(f.read()).hexdigest()
            except Exception:
                pass

            teacache_adapter_identity = None
            try:
                _tc_mod_probe = _resolve_teacache_module()
                if _tc_mod_probe is not None:
                    teacache_adapter_identity = _verify_teacache_adapter_identity(_tc_mod_probe)
            except Exception:
                pass

            all_hooks_attached = bool(installed_hooks and all(h.get("attached", False) for h in installed_hooks))
            if _HOOK_INSTALL_ERROR:
                status_val = "failed"
                failure_reason = f"hook_install_error: {_HOOK_INSTALL_ERROR}"
            elif all_hooks_attached and kernel_callable_available:
                status_val = "ok"
                failure_reason = None
            else:
                status_val = "failed"
                reasons = []
                if not all_hooks_attached:
                    unattached = [h["name"] for h in installed_hooks if not h.get("attached", False)]
                    reasons.append(f"unattached_hooks: {', '.join(unattached)}")
                if not kernel_callable_available:
                    reasons.append(f"kernel_unavailable_or_invalid: {expected_backend or 'none'}")
                failure_reason = "; ".join(reasons)

            handshake_payload = {
                "status": status_val,
                "protocol": "v2-jsonl",
                "protocolVersion": "v2-jsonl",
                "runId": collector.run_id,
                "attemptToken": collector.attempt_token,
                "pid": os.getpid(),
                "nonce": nonce,
                "collectorDigest": collector_digest,
                "hookManifestDigest": hook_manifest_digest,
                "kernelCallableAvailable": kernel_callable_available,
                "installedHooks": installed_hooks,
                "registeredNodes": registered_nodes,
                "packageIdentities": package_identities,
                "sourceIdentities": source_identities,
                "teacacheAdapterIdentity": teacache_adapter_identity,
                "runtimeVersions": {
                    "pythonVersion": python_ver,
                    "pythonExecutableHash": python_executable_hash,
                    "pythonAbiTag": python_abi_tag,
                    "pythonCompiler": python_compiler,
                    "pytorchVersion": pytorch_ver,
                    "cudaBuildVersion": cuda_build,
                    "cudaRuntimeVersion": None,
                    "driverVersion": driver_ver
                }
            }
            if failure_reason:
                handshake_payload["failureReason"] = failure_reason
            return web.json_response(handshake_payload)

        if hasattr(prompt_server, "app") and hasattr(prompt_server.app, "router"):
            prompt_server.app.router.add_get("/experiment/minimax-h3/capability", capability_handler)
        elif hasattr(prompt_server, "routes"):
            prompt_server.routes.get("/experiment/minimax-h3/capability")(capability_handler)
    except Exception:
        pass

_IN_INSTALL_HOOKS = False

def install_hooks(collector: Collector):
    """
    Hook into ComfyUI modules in-memory.
    Wraps model loading, node execution, sampling loops, and teardown.
    Fails closed if required hooks are missing or malformed when targeting ComfyUI.
    """
    global _IN_INSTALL_HOOKS, _HOOK_INSTALL_ERROR
    if _IN_INSTALL_HOOKS:
        return
    _IN_INSTALL_HOOKS = True
    try:
        _install_hooks_inner(collector)
    except Exception as e:
        _HOOK_INSTALL_ERROR = str(e)
        raise
    finally:
        _IN_INSTALL_HOOKS = False

def _install_hooks_inner(collector: Collector):
    global _IN_DENSE_DISPATCH

    target_script = _BOOTSTRAP_ENTRYPOINT or os.environ.get("CCO_EXPERIMENT_BOOTSTRAP_ENTRYPOINT")
    target_dir = os.path.dirname(os.path.abspath(target_script)) if target_script else ""
    if target_dir and target_dir not in sys.path:
        sys.path.insert(0, target_dir)

    comfy_target = False
    if (
        "comfy" in sys.modules
        or "execution" in sys.modules
        or "server" in sys.modules
        or "nodes" in sys.modules
        or (target_dir and os.path.isdir(os.path.join(target_dir, "comfy")))
        or (target_dir and os.path.isfile(os.path.join(target_dir, "execution.py")))
    ):
        comfy_target = True
    else:
        try:
            import comfy
            comfy_target = True
        except ImportError:
            pass

    # 1. Hook comfy.model_management for lazy GPU transfers
    try:
        import comfy.model_management as mm
        orig_load_models_gpu = getattr(mm, "load_models_gpu", None)
        if getattr(orig_load_models_gpu, "_cco_hooked", False):
            pass
        elif not callable(orig_load_models_gpu) or not _validate_callable_shape(orig_load_models_gpu, min_params=1):
            if comfy_target:
                raise RuntimeError("Required hook missing or malformed: comfy.model_management.load_models_gpu")
        else:
            def hooked_load_models_gpu(*args, **kwargs):
                span_id = collector.start_span("lazy_gpu_residency_transfer")
                try:
                    res = orig_load_models_gpu(*args, **kwargs)
                    collector.end_span(span_id, outcome="success")
                    return res
                except Exception as e:
                    collector.end_span(span_id, outcome="failed", error={"message": str(e), "exceptionType": type(e).__name__})
                    raise
            hooked_load_models_gpu._cco_hooked = True
            mm.load_models_gpu = hooked_load_models_gpu
            _INSTALLED_WRAPPERS["load_models_gpu"] = hooked_load_models_gpu
    except Exception as e:
        if comfy_target:
            raise RuntimeError(f"Required hook missing or malformed: comfy.model_management.load_models_gpu ({e})") from e

    # 2. Hook execution.PromptExecutor / nodes execution
    try:
        import execution
        prompt_executor_cls = getattr(execution, "PromptExecutor", None)
        orig_execute = getattr(prompt_executor_cls, "execute", None) if prompt_executor_cls else None
        if getattr(orig_execute, "_cco_hooked", False):
            pass
        elif not callable(orig_execute) or not _validate_callable_shape(orig_execute, min_params=2):
            if comfy_target:
                raise RuntimeError("Required hook missing or malformed: execution.PromptExecutor.execute")
        else:
            def hooked_prompt_execute(self, *args, **kwargs):
                new_prompt_id = None
                if "prompt_id" in kwargs and isinstance(kwargs["prompt_id"], str):
                    new_prompt_id = kwargs["prompt_id"]
                elif args and len(args) > 1 and isinstance(args[1], str):
                    new_prompt_id = args[1]
                prev_prompt_id = collector.prompt_id
                if new_prompt_id:
                    collector.prompt_id = new_prompt_id
                    _ATTENTION_TRACKER.reset()
                try:
                    return orig_execute(self, *args, **kwargs)
                finally:
                    if new_prompt_id:
                        try:
                            summary = _ATTENTION_TRACKER.summary()
                            collector.emit(
                                phase="teardown",
                                event_type="point_event",
                                span_id=collector.next_span_id("attn-summary"),
                                boundary_source="diagnostic",
                                metadata={
                                    "attentionSummary": summary,
                                    "stepRecords": list(_ATTENTION_TRACKER.step_records)
                                }
                            )
                        except Exception:
                            pass
                        collector.prompt_id = prev_prompt_id
            hooked_prompt_execute._cco_hooked = True
            prompt_executor_cls.execute = hooked_prompt_execute
            _INSTALLED_WRAPPERS["prompt_executor_execute"] = hooked_prompt_execute
    except Exception as e:
        if comfy_target:
            raise RuntimeError(f"Required hook missing or malformed: execution.PromptExecutor.execute ({e})") from e

    # 3. Hook comfy.samplers for sampling and step boundaries
    try:
        import comfy.samplers as samplers
        ksampler_cls = getattr(samplers, "KSampler", None)
        orig_sample = getattr(ksampler_cls, "sample", None) if ksampler_cls else None
        if getattr(orig_sample, "_cco_hooked", False):
            pass
        elif not callable(orig_sample) or not _validate_callable_shape(orig_sample, min_params=2):
            if comfy_target:
                raise RuntimeError("Required hook missing or malformed: comfy.samplers.KSampler.sample")
        else:
            def hooked_sample(self, *args, **kwargs):
                sampler_span_id = collector.start_span("sampling", class_type="KSampler")
                state = {
                    "last_step_end_ms": None,
                    "seen_steps": set()
                }
                buf = StepIntervalBuffer()
                token_buf = _SAMPLING_STEP_CALL_BUFFER.set(buf)

                orig_cb = None
                cb_is_positional = False
                cb_arg_index = None

                if "callback" in kwargs:
                    orig_cb = kwargs["callback"]
                elif len(args) > 10:
                    orig_cb = args[10]
                    cb_is_positional = True
                    cb_arg_index = 10

                def ksampler_cb(step, x0, x, total_steps, *cb_args, **cb_kwargs):
                    cur_idx = _parse_nonnegative_int(step)
                    if cur_idx is not None:
                        flush_step_buffer(cur_idx)
                        if cur_idx not in state["seen_steps"]:
                            state["seen_steps"].add(cur_idx)
                            now = now_mono_ms()
                            span_id = collector.next_span_id("step")
                            collector.emit(
                                "sampling_step",
                                "span_start",
                                span_id=span_id,
                                parent_span_id=sampler_span_id,
                                monotonic_ms=now,
                                step_index=cur_idx
                            )
                            collector.emit(
                                "sampling_step",
                                "span_end",
                                span_id=span_id,
                                parent_span_id=sampler_span_id,
                                monotonic_ms=now,
                                step_index=cur_idx,
                                outcome="success"
                            )

                    if orig_cb:
                        return orig_cb(step, x0, x, total_steps, *cb_args, **cb_kwargs)

                if cb_is_positional and cb_arg_index is not None:
                    args_list = list(args)
                    args_list[cb_arg_index] = ksampler_cb
                    args = tuple(args_list)
                else:
                    kwargs["callback"] = ksampler_cb

                try:
                    res = orig_sample(self, *args, **kwargs)
                    collector.end_span(sampler_span_id, outcome="success")
                    return res
                except Exception as e:
                    collector.end_span(
                        sampler_span_id,
                        outcome="failed",
                        error={"message": str(e), "exceptionType": type(e).__name__}
                    )
                    raise
                finally:
                    if buf is not None and buf.pending_calls:
                        with _ATTENTION_TRACKER._lock:
                            unflushed = len(buf.pending_calls)
                            _ATTENTION_TRACKER.unflushed_calls_count += unflushed
                            _ATTENTION_TRACKER.unattributed_call_count += unflushed
                            if _ATTENTION_TRACKER.status != "failed":
                                _ATTENTION_TRACKER.status = "fallback"
                                if not _ATTENTION_TRACKER.failure_reason:
                                    _ATTENTION_TRACKER.failure_reason = (
                                        f"Sampling completed with {unflushed} unflushed attention call(s) lacking completion callback"
                                    )
                            buf.pending_calls.clear()
                    _SAMPLING_STEP_CALL_BUFFER.reset(token_buf)

            hooked_sample._cco_hooked = True
            ksampler_cls.sample = hooked_sample
            _INSTALLED_WRAPPERS["ksampler_sample"] = hooked_sample
    except Exception as e:
        if comfy_target:
            raise RuntimeError(f"Required hook missing or malformed: comfy.samplers.KSampler.sample ({e})") from e

    # 4. Hook SamplerCustomAdvanced for canonical pipeline sampling
    try:
        import comfy_extras.nodes_custom_sampler as custom_sampler
        custom_node_cls = getattr(custom_sampler, "SamplerCustomAdvanced", None)
        orig_custom_execute = getattr(custom_node_cls, "execute", None) if custom_node_cls else None
        if orig_custom_execute is None and custom_node_cls:
            orig_custom_execute = getattr(custom_node_cls, "sample", None)

        unbound_target = getattr(orig_custom_execute, "__func__", orig_custom_execute)
        if getattr(unbound_target, "_cco_hooked", False):
            pass
        elif not callable(unbound_target) or not _validate_callable_shape(unbound_target, min_params=5):
            if comfy_target:
                raise RuntimeError("Required hook missing or malformed: comfy_extras.nodes_custom_sampler.SamplerCustomAdvanced.execute")
        else:
            def hooked_custom_execute(cls, noise, guider, sampler, sigmas, latent_image, *args, **kwargs):
                sampler_name = getattr(sampler, "sampler_name", None) or getattr(sampler, "name", None) or type(sampler).__name__
                scheduler_name = getattr(sigmas, "scheduler", None) or getattr(sigmas, "name", None) or "simple"
                sampler_span_id = collector.start_span(
                    "sampling",
                    class_type="SamplerCustomAdvanced",
                    metadata={
                        "samplerName": str(sampler_name),
                        "schedulerName": str(scheduler_name)
                    }
                )
                state = {
                    "last_step_end_ms": None,
                    "seen_steps": set()
                }
                buf = StepIntervalBuffer()
                token_buf = _SAMPLING_STEP_CALL_BUFFER.set(buf)

                # Everything from here through the real unbound_fn() call is
                # inside one try/finally (started just below): diffusion_model
                # hooking, TeaCache adapter verification/session setup, and
                # guider.sample hooking all mutate shared/external state
                # (monkey-patched forward, the active-session registry, the
                # patched guider), and any of them can raise. A raise
                # anywhere in this region must still run the same cleanup as
                # a failure during the real sampler call -- otherwise a setup
                # failure (e.g. a rejected nested-session activation, or a
                # failed adapter digest check) leaks the monkey-patched
                # diffusion_model.forward and/or the sampling-step buffer
                # token into whatever runs next in this process.
                orig_diff_forward = None
                diffusion_model = None
                tc_session = None
                tc_token = None
                tc_mod = None
                orig_guider_sample = None
                diff_forward_count = 0
                control_session_id = None

                try:
                    # Inspect guider / model_patcher for TeaCache and diffusion_model
                    model_patcher = getattr(guider, "model_patcher", None)
                    if model_patcher is None:
                        model_patcher = getattr(guider, "model", None)

                    teacache_config = None
                    if model_patcher is not None and hasattr(model_patcher, "model_options") and isinstance(model_patcher.model_options, dict):
                        teacache_config = model_patcher.model_options.get("teacache_config")
                    if teacache_config is None and hasattr(guider, "model_options") and isinstance(guider.model_options, dict):
                        teacache_config = guider.model_options.get("teacache_config")

                    base_model = getattr(model_patcher, "model", None) if model_patcher else None
                    if base_model is None:
                        base_model = getattr(guider, "model", None)
                    diffusion_model = getattr(base_model, "diffusion_model", None) if base_model else None

                    # Hook diffusion_model.forward for independent forward counting
                    orig_diff_forward = getattr(diffusion_model, "forward", None) if diffusion_model else None
                    if orig_diff_forward is not None and callable(orig_diff_forward):
                        def hooked_diff_forward(*df_args, **df_kwargs):
                            nonlocal diff_forward_count
                            # tc_session.step_idx is already the correct
                            # "current step" at the moment a real forward
                            # fires: the sampler advances it (via
                            # step_callback's advance_step call) strictly
                            # before the NEXT step's forward runs, and
                            # advance_step(0) already ran before this hook
                            # could ever fire for the first step. Reporting
                            # it (and the owning session_id) lets the
                            # reducer attribute each independent forward to
                            # a specific step/session instead of only being
                            # able to count totals.
                            df_step_idx = tc_session.step_idx if tc_session is not None else None
                            df_session_id = tc_session.session_id if tc_session is not None else None
                            if tc_session is not None and getattr(tc_session, "is_evaluating_hit", False):
                                tc_session.nested_forwards_on_hits += 1
                            now_start = now_mono_ms()
                            df_span_id = collector.next_span_id("diff_fwd")
                            df_metadata = {
                                "modelForwardCall": True,
                                "phase": "diffusion_forward",
                                "stepIndex": df_step_idx,
                                "sessionId": df_session_id
                            }
                            collector.emit(
                                "sampling",
                                "span_start",
                                span_id=df_span_id,
                                parent_span_id=sampler_span_id,
                                monotonic_ms=now_start,
                                metadata=df_metadata
                            )
                            try:
                                res = orig_diff_forward(*df_args, **df_kwargs)
                                diff_forward_count += 1
                                collector.emit(
                                    "sampling",
                                    "span_end",
                                    span_id=df_span_id,
                                    parent_span_id=sampler_span_id,
                                    monotonic_ms=now_mono_ms(),
                                    outcome="success",
                                    metadata=df_metadata
                                )
                                return res
                            except Exception as e:
                                collector.emit(
                                    "sampling",
                                    "span_end",
                                    span_id=df_span_id,
                                    parent_span_id=sampler_span_id,
                                    monotonic_ms=now_mono_ms(),
                                    outcome="failed",
                                    error={"message": str(e), "exceptionType": type(e).__name__},
                                    metadata=df_metadata
                                )
                                raise
                        diffusion_model.forward = hooked_diff_forward

                    # Setup TeaCache session if configured. This whole
                    # region through the real unbound_fn() call below is
                    # inside the single try/finally that starts above: any
                    # raise here (an ownership-guard rejection, a failed
                    # adapter digest check, or advance_step's validation) is
                    # cleaned up by the same finally block that handles a
                    # real sampling failure, instead of needing its own
                    # separate unwind-and-reraise.
                    tc_mod = _resolve_teacache_module(guider=guider, model_patcher=model_patcher)
                    tc_adapter_identity = None
                    if tc_mod is not None:
                        tc_adapter_identity = _verify_teacache_adapter_identity(tc_mod)
                        if teacache_config is not None and not tc_adapter_identity.get("verified"):
                            raise RuntimeError(
                                "TeaCache adapter identity verification failed: "
                                f"{tc_adapter_identity}. Refusing to use an unverified/substituted "
                                "adapter module for a configured TeaCache render."
                            )
                    if tc_mod is not None and teacache_config is not None:
                        def on_tc_event(*cb_args, **cb_kwargs):
                            evt_name = cb_kwargs.get("event", "unknown")
                            collector.emit(
                                "sampling",
                                "point_event",
                                span_id=collector.next_span_id("teacache-event"),
                                parent_span_id=sampler_span_id,
                                metadata={
                                    "teacacheEvent": evt_name,
                                    **cb_kwargs
                                }
                            )
                        sigmas_list = sigmas.tolist() if hasattr(sigmas, "tolist") else list(sigmas) if isinstance(sigmas, (list, tuple)) else None
                        session_id = collector.next_span_id("teacache_session")
                        tc_thresh = teacache_config.get("rel_l1_thresh", teacache_config.get("threshold", 0.15))
                        tc_start = teacache_config.get("start_step", 2)
                        tc_end = teacache_config.get("end_step", -2)
                        tc_total = teacache_config.get("total_steps", 20)
                        tc_session = tc_mod.TeaCacheSession(
                            session_id=session_id,
                            model_id=teacache_config.get("model_id"),
                            rel_l1_thresh=tc_thresh,
                            start_step=tc_start,
                            end_step=tc_end,
                            total_steps=tc_total,
                            sigmas=sigmas_list,
                            event_callback=on_tc_event
                        )
                        tc_token = tc_mod.set_active_session(tc_session)
                        tc_session.advance_step(0)
                        collector.emit(
                            "sampling",
                            "point_event",
                            span_id=collector.next_span_id("teacache-init"),
                            parent_span_id=sampler_span_id,
                            metadata={
                                "teacacheEvent": "session_init",
                                "sessionId": tc_session.session_id,
                                "adapterIdentity": tc_adapter_identity,
                                "effectiveConfig": {
                                    "mode": "raw-l1-v1",
                                    "relL1Thresh": tc_session.rel_l1_thresh,
                                    "startStep": tc_session.start_step,
                                    "endStep": getattr(tc_session, "raw_end_step", tc_session.end_step),
                                    "totalSteps": tc_session.total_steps,
                                    "normalizedStartStep": tc_session.start_step,
                                    "normalizedEndStep": tc_session.end_step
                                }
                            }
                        )
                    elif tc_session is None and os.environ.get("CCO_EXPERIMENT_TEACACHE_MODE") == "off":
                        # A matched-control run exists specifically to prove
                        # an apples-to-apples comparison against the
                        # candidate -- it must enforce the same loaded-
                        # adapter identity requirement the candidate path
                        # does above, not silently skip it just because
                        # teacache_config is None here.
                        if tc_mod is not None and not tc_adapter_identity.get("verified"):
                            raise RuntimeError(
                                "TeaCache adapter identity verification failed on matched-control "
                                f"run: {tc_adapter_identity}. Refusing to certify a control run against "
                                "an unverified/substituted adapter module."
                            )
                        control_session_id = collector.next_span_id("teacache_control_session")
                        collector.emit(
                            "sampling",
                            "point_event",
                            span_id=collector.next_span_id("teacache-init"),
                            parent_span_id=sampler_span_id,
                            metadata={
                                "teacacheEvent": "session_init",
                                "sessionId": control_session_id,
                                "adapterIdentity": tc_adapter_identity,
                                "effectiveConfig": {
                                    "mode": "off",
                                    "relL1Thresh": 0.15,
                                    "startStep": 2,
                                    "endStep": 18,
                                    "totalSteps": 20,
                                    "normalizedStartStep": 2,
                                    "normalizedEndStep": 18
                                }
                            }
                        )

                    def step_callback(chain_cb):
                        def cb(step, x0, x, total_s, *cb_args, **cb_kwargs):
                            cur_idx = _parse_nonnegative_int(step)
                            if cur_idx is not None:
                                flush_step_buffer(cur_idx)
                                if tc_session is not None:
                                    if cur_idx + 1 < tc_session.total_steps:
                                        # Deliberately not caught: a session-state
                                        # error here means TeaCache's step/cache
                                        # invariants are already violated, and
                                        # continuing to sample with a corrupted
                                        # session would silently serve wrong
                                        # cached output. Fail the render instead.
                                        tc_session.advance_step(cur_idx + 1)
                                if cur_idx not in state["seen_steps"]:
                                    state["seen_steps"].add(cur_idx)
                                    now = now_mono_ms()
                                    span_id = collector.next_span_id("step")
                                    collector.emit(
                                        "sampling_step",
                                        "span_start",
                                        span_id=span_id,
                                        parent_span_id=sampler_span_id,
                                        monotonic_ms=now,
                                        step_index=cur_idx
                                    )
                                    collector.emit(
                                        "sampling_step",
                                        "span_end",
                                        span_id=span_id,
                                        parent_span_id=sampler_span_id,
                                        monotonic_ms=now,
                                        step_index=cur_idx,
                                        outcome="success"
                                    )

                            if chain_cb:
                                return chain_cb(step, x0, x, total_s, *cb_args, **cb_kwargs)
                        return cb

                    orig_latent_cb = latent_image.get("callback", None) if isinstance(latent_image, dict) else None
                    if isinstance(latent_image, dict):
                        latent_image = {**latent_image, "callback": step_callback(orig_latent_cb)}

                    orig_guider_sample = getattr(guider, "sample", None)
                    if orig_guider_sample:
                        def hooked_guider_sample(*g_args, **g_kwargs):
                            caller_cb = g_kwargs.get("callback", None)
                            cb_is_pos = False
                            cb_pos_idx = None
                            if caller_cb is None and len(g_args) > 5:
                                caller_cb = g_args[5]
                                cb_is_pos = True
                                cb_pos_idx = 5

                            chained = step_callback(caller_cb or orig_latent_cb)
                            if cb_is_pos and cb_pos_idx is not None:
                                g_args_list = list(g_args)
                                g_args_list[cb_pos_idx] = chained
                                g_args = tuple(g_args_list)
                            else:
                                g_kwargs["callback"] = chained

                            return orig_guider_sample(*g_args, **g_kwargs)

                        guider.sample = hooked_guider_sample

                    unbound_fn = getattr(orig_custom_execute, "__func__", orig_custom_execute)
                    res = unbound_fn(cls, noise, guider, sampler, sigmas, latent_image, *args, **kwargs)
                    collector.end_span(
                        sampler_span_id,
                        outcome="success",
                        metadata={
                            "samplerName": str(sampler_name),
                            "schedulerName": str(scheduler_name),
                            "completedSteps": len(state["seen_steps"])
                        }
                    )
                    return res
                except Exception as e:
                    collector.end_span(
                        sampler_span_id,
                        outcome="failed",
                        error={"message": str(e), "exceptionType": type(e).__name__}
                    )
                    raise
                finally:
                    if orig_diff_forward is not None and diffusion_model is not None:
                        diffusion_model.forward = orig_diff_forward

                    if tc_session is not None:
                        try:
                            summary = {
                                "mode": "raw-l1-v1",
                                "sessionId": tc_session.session_id,
                                "forwardCalls": tc_session.forward_calls_count,
                                "cacheHits": tc_session.cache_hits_count,
                                "totalSteps": tc_session.total_steps,
                                "nestedForwardsOnHits": tc_session.nested_forwards_on_hits,
                                "effectiveConfig": {
                                    "mode": "raw-l1-v1",
                                    "relL1Thresh": tc_session.rel_l1_thresh,
                                    "startStep": tc_session.start_step,
                                    "endStep": getattr(tc_session, "raw_end_step", tc_session.end_step),
                                    "totalSteps": tc_session.total_steps,
                                    "normalizedStartStep": tc_session.start_step,
                                    "normalizedEndStep": tc_session.end_step
                                }
                            }
                            collector.emit(
                                "sampling",
                                "point_event",
                                span_id=collector.next_span_id("teacache-end"),
                                parent_span_id=sampler_span_id,
                                metadata={
                                    "teacacheSession": "end",
                                    "sessionId": tc_session.session_id,
                                    "summary": summary,
                                    "teacacheSummary": {
                                        "status": "verified" if tc_session.cache_hits_count > 0 else "no_op",
                                        "forwardCallsRecorded": tc_session.forward_calls_count,
                                        "cacheHitsRecorded": tc_session.cache_hits_count,
                                        "modelForwardsRecorded": diff_forward_count,
                                        "nestedForwardsOnHits": tc_session.nested_forwards_on_hits
                                    }
                                }
                            )
                        finally:
                            tc_session.cleanup()
                            if tc_token is not None and tc_mod is not None:
                                tc_mod.reset_active_session(tc_token)
                    elif os.environ.get("CCO_EXPERIMENT_TEACACHE_MODE") == "off":
                        collector.emit(
                            "sampling",
                            "point_event",
                            span_id=collector.next_span_id("teacache-end"),
                            parent_span_id=sampler_span_id,
                            metadata={
                                "teacacheSession": "end",
                                "sessionId": control_session_id,
                                "summary": {
                                    "mode": "off",
                                    "forwardCalls": diff_forward_count,
                                    "cacheHits": 0
                                },
                                "teacacheSummary": {
                                    "status": "verified",
                                    "forwardCallsRecorded": diff_forward_count,
                                    "cacheHitsRecorded": 0,
                                    "modelForwardsRecorded": diff_forward_count,
                                    "nestedForwardsOnHits": 0
                                }
                            }
                        )

                    if buf is not None and buf.pending_calls:
                        with _ATTENTION_TRACKER._lock:
                            unflushed = len(buf.pending_calls)
                            _ATTENTION_TRACKER.unflushed_calls_count += unflushed
                            _ATTENTION_TRACKER.unattributed_call_count += unflushed
                            if _ATTENTION_TRACKER.status != "failed":
                                _ATTENTION_TRACKER.status = "fallback"
                                if not _ATTENTION_TRACKER.failure_reason:
                                    _ATTENTION_TRACKER.failure_reason = (
                                        f"Sampling completed with {unflushed} unflushed attention call(s) lacking completion callback"
                                    )
                            buf.pending_calls.clear()
                    _SAMPLING_STEP_CALL_BUFFER.reset(token_buf)
                    if orig_guider_sample is not None:
                        guider.sample = orig_guider_sample

            hooked_custom_execute._cco_hooked = True
            _INSTALLED_WRAPPERS["sampler_custom_advanced_execute"] = hooked_custom_execute
            wrapped_execute = classmethod(hooked_custom_execute)
            custom_node_cls.execute = wrapped_execute
            custom_node_cls.sample = wrapped_execute
    except Exception as e:
        if comfy_target:
            raise RuntimeError(f"Required hook missing or malformed: comfy_extras.nodes_custom_sampler.SamplerCustomAdvanced.execute ({e})") from e

    # 4b. Hook conditioning nodes (MiniMaxH3ImageToVideo and MiniMaxH3ReferenceToVideo)
    try:
        import comfy_extras.nodes_minimax_h3 as nodes_minimax_h3
        for cls_name in ("MiniMaxH3ImageToVideo", "MiniMaxH3ReferenceToVideo"):
            node_cls = getattr(nodes_minimax_h3, cls_name, None)
            orig_execute = getattr(node_cls, "execute", None) if node_cls else None
            unbound_execute = getattr(orig_execute, "__func__", orig_execute)
            req_params = 6 if cls_name == "MiniMaxH3ImageToVideo" else 7
            if getattr(unbound_execute, "_cco_hooked", False):
                continue
            elif not callable(unbound_execute) or not _validate_callable_shape(unbound_execute, min_params=req_params):
                if comfy_target:
                    raise RuntimeError(f"Required hook missing or malformed: comfy_extras.nodes_minimax_h3.{cls_name}.execute")
            else:
                def make_hooked_execute(c_name, orig_fn):
                    def hooked_execute(cls, *args, **kwargs):
                        task_mode = "i2v" if c_name == "MiniMaxH3ImageToVideo" else "ref2v"
                        ref_count = None
                        try:
                            sig = inspect.signature(orig_fn)
                            bound = None
                            try:
                                bound = sig.bind(*args, **kwargs)
                            except TypeError:
                                try:
                                    bound = sig.bind(cls, *args, **kwargs)
                                except TypeError:
                                    bound = None

                            if bound is not None:
                                bound.apply_defaults()
                                bound_args = bound.arguments
                                if c_name == "MiniMaxH3ReferenceToVideo":
                                    ref_images = bound_args.get("ref_images")
                                    if ref_images is not None:
                                        if isinstance(ref_images, dict):
                                            ref_count = sum(1 for v in ref_images.values() if v is not None)
                                        elif isinstance(ref_images, (list, tuple, set)):
                                            ref_count = sum(1 for v in ref_images if v is not None)
                                        else:
                                            ref_count = 1
                                    elif "ref_images" in bound_args:
                                        ref_count = 0
                                else:
                                    first_frame = bound_args.get("first_frame", bound_args.get("image"))
                                    last_frame = bound_args.get("last_frame", bound_args.get("image_tail", bound_args.get("last_image")))
                                    c = 0
                                    if first_frame is not None:
                                        c += 1
                                    if last_frame is not None:
                                        c += 1
                                    ref_count = c
                            else:
                                if c_name == "MiniMaxH3ReferenceToVideo":
                                    if "ref_images" in kwargs:
                                        ref_images = kwargs["ref_images"]
                                        if ref_images is None:
                                            ref_count = 0
                                        elif isinstance(ref_images, dict):
                                            ref_count = sum(1 for v in ref_images.values() if v is not None)
                                        elif isinstance(ref_images, (list, tuple, set)):
                                            ref_count = sum(1 for v in ref_images if v is not None)
                                        else:
                                            ref_count = 1
                                    else:
                                        ref_count = None
                                else:
                                    if "first_frame" in kwargs or "last_frame" in kwargs or "image" in kwargs:
                                        c = 0
                                        if kwargs.get("first_frame") is not None or kwargs.get("image") is not None:
                                            c += 1
                                        if kwargs.get("last_frame") is not None:
                                            c += 1
                                        ref_count = c
                                    else:
                                        ref_count = None
                        except Exception:
                            ref_count = None

                        metadata = {
                            "taskMode": task_mode,
                            "referenceCount": ref_count
                        }
                        span_id = collector.start_span("conditioning", class_type=c_name, metadata=metadata)
                        try:
                            if hasattr(orig_fn, "__self__") and orig_fn.__self__ is not None:
                                res = orig_fn(*args, **kwargs)
                            else:
                                try:
                                    res = orig_fn(cls, *args, **kwargs)
                                except TypeError:
                                    res = orig_fn(*args, **kwargs)
                            collector.end_span(span_id, outcome="success", metadata=metadata)
                            return res
                        except Exception as e:
                            collector.end_span(
                                span_id,
                                outcome="failed",
                                error={"message": str(e), "exceptionType": type(e).__name__},
                                metadata=metadata
                            )
                            raise
                    hooked_execute._cco_hooked = True
                    if c_name == "MiniMaxH3ImageToVideo":
                        _INSTALLED_WRAPPERS["minimax_h3_image_to_video_execute"] = hooked_execute
                    elif c_name == "MiniMaxH3ReferenceToVideo":
                        _INSTALLED_WRAPPERS["minimax_h3_reference_to_video_execute"] = hooked_execute
                    return classmethod(hooked_execute)

                hooked_func = make_hooked_execute(cls_name, orig_execute)
                setattr(node_cls, "execute", hooked_func)
    except Exception as e:
        if comfy_target:
            raise RuntimeError(f"Required hook missing or malformed: comfy_extras.nodes_minimax_h3 ({e})") from e

    # 5. Hook comfy.ldm.modules.attention for attention backend monitoring
    sage_attn_fn = _INSTALLED_WRAPPERS.get("sageattn")
    sage_attn3_fn = _INSTALLED_WRAPPERS.get("sageattn3")
    try:
        import comfy.ldm.modules.attention as comfy_attn

        raw_sageattn = getattr(comfy_attn, "sageattn", None)
        if raw_sageattn and not getattr(raw_sageattn, "_cco_hooked", False) and _validate_callable_shape(raw_sageattn, min_params=3):
            sage_attn_fn = raw_sageattn
            def hooked_sageattn(*args, **kwargs):
                layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                try:
                    res = sage_attn_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated(
                        "sage", "sageattention.sageattn",
                        step_index=step_idx, layer_index=layer_idx
                    )
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback(
                        "sage", "torch_sdpa", f"sageattn kernel exception: {e}",
                        step_index=step_idx
                    )
                    raise
            hooked_sageattn._cco_hooked = True
            comfy_attn.sageattn = hooked_sageattn
            _INSTALLED_WRAPPERS["sageattn"] = hooked_sageattn

        raw_sageattn3 = getattr(comfy_attn, "sageattn3", None)
        if raw_sageattn3 and not getattr(raw_sageattn3, "_cco_hooked", False) and _validate_callable_shape(raw_sageattn3, min_params=3):
            sage_attn3_fn = raw_sageattn3
            def hooked_sageattn3(*args, **kwargs):
                layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                try:
                    res = sage_attn3_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated(
                        "sage", "sageattention.sageattn3",
                        step_index=step_idx, layer_index=layer_idx
                    )
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback(
                        "sage", "torch_sdpa", f"sageattn3 kernel exception: {e}",
                        step_index=step_idx
                    )
                    raise
            hooked_sageattn3._cco_hooked = True
            comfy_attn.sageattn3 = hooked_sageattn3
            _INSTALLED_WRAPPERS["sageattn3"] = hooked_sageattn3

        sdp_fn = getattr(comfy_attn, "sdp", None)
        if sdp_fn and not getattr(sdp_fn, "_cco_hooked", False) and callable(sdp_fn):
            def hooked_sdp(*args, **kwargs):
                if _IN_DENSE_DISPATCH.get():
                    return sdp_fn(*args, **kwargs)
                dispatch_handle = _IN_DENSE_DISPATCH.set(True)
                try:
                    res = sdp_fn(*args, **kwargs)
                    layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                    exclusion = _CURRENT_PLANNED_EXCLUSION.get()
                    _ATTENTION_TRACKER.record_dense(
                        is_planned=(exclusion is not None),
                        metadata=exclusion,
                        step_index=step_idx,
                        layer_index=layer_idx
                    )
                    return res
                finally:
                    _IN_DENSE_DISPATCH.reset(dispatch_handle)
            hooked_sdp._cco_hooked = True
            comfy_attn.sdp = hooked_sdp
            _INSTALLED_WRAPPERS["sdp"] = hooked_sdp

        orig_attention_pytorch = getattr(comfy_attn, "attention_pytorch", None)
        if orig_attention_pytorch and not getattr(orig_attention_pytorch, "_cco_hooked", False) and callable(orig_attention_pytorch):
            def hooked_attention_pytorch(*args, **kwargs):
                if _IN_DENSE_DISPATCH.get():
                    return orig_attention_pytorch(*args, **kwargs)
                dispatch_handle = _IN_DENSE_DISPATCH.set(True)
                try:
                    res = orig_attention_pytorch(*args, **kwargs)
                    layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                    exclusion = _CURRENT_PLANNED_EXCLUSION.get()
                    _ATTENTION_TRACKER.record_dense(
                        is_planned=(exclusion is not None),
                        metadata=exclusion,
                        step_index=step_idx,
                        layer_index=layer_idx
                    )
                    return res
                finally:
                    _IN_DENSE_DISPATCH.reset(dispatch_handle)
            hooked_attention_pytorch._cco_hooked = True
            comfy_attn.attention_pytorch = hooked_attention_pytorch
            _INSTALLED_WRAPPERS["attention_pytorch"] = hooked_attention_pytorch

        orig_attention_sage = getattr(comfy_attn, "attention_sage", None)
        if orig_attention_sage and not getattr(orig_attention_sage, "_cco_hooked", False) and callable(orig_attention_sage):
            def hooked_attention_sage(*args, **kwargs):
                pre_accel = _ATTENTION_TRACKER.accelerated_call_count
                pre_fallbacks = len(_ATTENTION_TRACKER.fallback_events)
                layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                try:
                    res = orig_attention_sage(*args, **kwargs)
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback(
                        "sage", "torch_sdpa", f"attention_sage exception: {e}",
                        step_index=step_idx
                    )
                    raise
                if _ATTENTION_TRACKER.accelerated_call_count == pre_accel and len(_ATTENTION_TRACKER.fallback_events) == pre_fallbacks:
                    reason = "ComfyUI attention_sage caught internal exception and silently dispatched to PyTorch dense attention"
                    _ATTENTION_TRACKER.record_fallback(
                        "sage", "torch_sdpa", reason,
                        step_index=step_idx
                    )
                return res
            hooked_attention_sage._cco_hooked = True
            comfy_attn.attention_sage = hooked_attention_sage
            _INSTALLED_WRAPPERS["attention_sage"] = hooked_attention_sage

        orig_optimized = getattr(comfy_attn, "optimized_attention", None)
        if orig_optimized and not getattr(orig_optimized, "_cco_hooked", False) and callable(orig_optimized):
            def hooked_optimized(*args, **kwargs):
                try:
                    return orig_optimized(*args, **kwargs)
                except Exception as e:
                    layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                    _ATTENTION_TRACKER.record_fallback(
                        "accelerated", "torch_sdpa", str(e),
                        step_index=step_idx
                    )
                    raise
            hooked_optimized._cco_hooked = True
            comfy_attn.optimized_attention = hooked_optimized
            _INSTALLED_WRAPPERS["optimized_attention"] = hooked_optimized
    except (ImportError, AttributeError):
        pass

    # 6. Hook comfy.ops and torch.nn.functional for scaled_dot_product_attention
    try:
        import comfy.ops as comfy_ops
        orig_sdpa = getattr(comfy_ops, "scaled_dot_product_attention", None)
        if orig_sdpa and not getattr(orig_sdpa, "_cco_hooked", False) and callable(orig_sdpa):
            def hooked_sdpa(*args, **kwargs):
                if _IN_DENSE_DISPATCH.get():
                    return orig_sdpa(*args, **kwargs)
                dispatch_handle = _IN_DENSE_DISPATCH.set(True)
                try:
                    res = orig_sdpa(*args, **kwargs)
                    layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                    exclusion = _CURRENT_PLANNED_EXCLUSION.get()
                    _ATTENTION_TRACKER.record_dense(
                        is_planned=(exclusion is not None),
                        metadata=exclusion,
                        step_index=step_idx,
                        layer_index=layer_idx
                    )
                    return res
                finally:
                    _IN_DENSE_DISPATCH.reset(dispatch_handle)
            hooked_sdpa._cco_hooked = True
            comfy_ops.scaled_dot_product_attention = hooked_sdpa
            _INSTALLED_WRAPPERS["comfy_ops_sdpa"] = hooked_sdpa
    except (ImportError, AttributeError):
        pass

    try:
        import torch.nn.functional as F
        orig_torch_sdpa = getattr(F, "scaled_dot_product_attention", None)
        if orig_torch_sdpa and not getattr(orig_torch_sdpa, "_cco_hooked", False) and callable(orig_torch_sdpa):
            def hooked_torch_sdpa(*args, **kwargs):
                if _IN_DENSE_DISPATCH.get():
                    return orig_torch_sdpa(*args, **kwargs)
                dispatch_handle = _IN_DENSE_DISPATCH.set(True)
                try:
                    res = orig_torch_sdpa(*args, **kwargs)
                    layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                    exclusion = _CURRENT_PLANNED_EXCLUSION.get()
                    _ATTENTION_TRACKER.record_dense(
                        is_planned=(exclusion is not None),
                        metadata=exclusion,
                        step_index=step_idx,
                        layer_index=layer_idx
                    )
                    return res
                finally:
                    _IN_DENSE_DISPATCH.reset(dispatch_handle)
            hooked_torch_sdpa._cco_hooked = True
            F.scaled_dot_product_attention = hooked_torch_sdpa
            _INSTALLED_WRAPPERS["torch_sdpa"] = hooked_torch_sdpa
    except (ImportError, AttributeError):
        pass

    # 7. Hook comfy_kitchen for sol_attn
    sol_attn_fn = _INSTALLED_WRAPPERS.get("sol_attn")
    try:
        import comfy_kitchen
        cand_sol = getattr(comfy_kitchen, "sol_attn", None)
        if cand_sol and not getattr(cand_sol, "_cco_hooked", False) and _validate_callable_shape(cand_sol, min_params=3):
            sol_attn_fn = cand_sol
            def hooked_sol_attn(*args, **kwargs):
                layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                try:
                    res = sol_attn_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated(
                        "sol_attn", "comfy_kitchen.sol_attn",
                        step_index=step_idx, layer_index=layer_idx
                    )
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback(
                        "sol_attn", "torch_sdpa", f"sol_attn kernel exception: {e}",
                        step_index=step_idx
                    )
                    raise
            hooked_sol_attn._cco_hooked = True
            comfy_kitchen.sol_attn = hooked_sol_attn
            _INSTALLED_WRAPPERS["sol_attn"] = hooked_sol_attn
    except (ImportError, AttributeError):
        pass

    # 8. Hook veda_sparse_attention for veda
    veda_kernel_fn = _INSTALLED_WRAPPERS.get("veda_kernel")
    try:
        import veda_sparse_attention
        cand_veda = getattr(veda_sparse_attention, "triton_kernel", None)
        if cand_veda and not getattr(cand_veda, "_cco_hooked", False) and _validate_callable_shape(cand_veda, min_params=3):
            veda_kernel_fn = cand_veda
            def hooked_veda(*args, **kwargs):
                layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                try:
                    res = veda_kernel_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated(
                        "veda", "veda_sparse_attention.triton_kernel",
                        step_index=step_idx, layer_index=layer_idx
                    )
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback(
                        "veda", "torch_sdpa", f"veda kernel exception: {e}",
                        step_index=step_idx
                    )
                    raise
            hooked_veda._cco_hooked = True
            veda_sparse_attention.triton_kernel = hooked_veda
            _INSTALLED_WRAPPERS["veda_kernel"] = hooked_veda
    except (ImportError, AttributeError):
        pass

    # 8b. Hook comfy_kitchen.sol_attn_chunked for actual FastH3 BlockSparseAttention dispatch
    bsa_kernel_found = ("sol_attn_chunked" in _INSTALLED_WRAPPERS)
    try:
        import comfy_kitchen
        cand_sol_chunked = getattr(comfy_kitchen, "sol_attn_chunked", None)
        if cand_sol_chunked and not getattr(cand_sol_chunked, "_cco_hooked", False) and _validate_callable_shape(cand_sol_chunked, min_params=3):
            bsa_kernel_found = True
            sol_chunked_fn = cand_sol_chunked
            def hooked_sol_chunked(*args, **kwargs):
                layer_idx, step_idx = extract_layer_and_step(args, kwargs)
                try:
                    res = sol_chunked_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated(
                        "comfy kitchen attention", "block_sparse_triton",
                        step_index=step_idx, layer_index=layer_idx
                    )
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback(
                        "comfy kitchen attention", "torch_sdpa", f"comfy_kitchen.sol_attn_chunked exception: {e}",
                        step_index=step_idx
                    )
                    raise
            hooked_sol_chunked._cco_hooked = True
            comfy_kitchen.sol_attn_chunked = hooked_sol_chunked
            _INSTALLED_WRAPPERS["sol_attn_chunked"] = hooked_sol_chunked
    except (ImportError, AttributeError):
        pass

    # 8c. Hook VedaPatch and dynamic module loading for planned exclusion tracking
    for mod_name in list(sys.modules.keys()):
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, "VedaPatch"):
            hook_veda_patch_class(getattr(mod, "VedaPatch"))

    orig_import = builtins.__import__
    if not getattr(orig_import, "_cco_hooked", False):
        def hooked_import(name, globals=None, locals=None, fromlist=(), level=0):
            mod = orig_import(name, globals, locals, fromlist, level)
            try:
                if name == "server" or name.startswith("server."):
                    if hasattr(mod, "PromptServer"):
                        ps_cls = getattr(mod, "PromptServer")
                        orig_init = getattr(ps_cls, "__init__", None)
                        if orig_init and not getattr(orig_init, "_cco_hooked", False):
                            def hooked_server_init(self, *args, **kwargs):
                                orig_init(self, *args, **kwargs)
                                register_capability_route(self, collector)
                            hooked_server_init._cco_hooked = True
                            ps_cls.__init__ = hooked_server_init
                        if hasattr(ps_cls, "instance") and ps_cls.instance is not None:
                            register_capability_route(ps_cls.instance, collector)
                if name.startswith("comfy") or name.startswith("execution") or name in ("nodes", "server"):
                    try:
                        install_hooks(collector)
                    except Exception:
                        pass
                if hasattr(mod, "VedaPatch"):
                    hook_veda_patch_class(getattr(mod, "VedaPatch"))
                for m_key in ("veda_comfy.comfy_patch", "veda_comfy.patch", name):
                    if m_key in sys.modules:
                        patch_mod = sys.modules.get(m_key)
                        if patch_mod and hasattr(patch_mod, "VedaPatch"):
                            hook_veda_patch_class(getattr(patch_mod, "VedaPatch"))
            except Exception:
                pass
            return mod
        hooked_import._cco_hooked = True
        builtins.__import__ = hooked_import
        _INSTALLED_WRAPPERS["attention_deferred_import_hook"] = hooked_import

    # Hook server.PromptServer if already available
    try:
        import server
        if hasattr(server, "PromptServer"):
            ps_cls = getattr(server, "PromptServer")
            orig_init = getattr(ps_cls, "__init__", None)
            if orig_init and not getattr(orig_init, "_cco_hooked", False):
                def hooked_server_init(self, *args, **kwargs):
                    orig_init(self, *args, **kwargs)
                    register_capability_route(self, collector)
                hooked_server_init._cco_hooked = True
                ps_cls.__init__ = hooked_server_init
            if hasattr(ps_cls, "instance") and ps_cls.instance is not None:
                register_capability_route(ps_cls.instance, collector)
    except (ImportError, AttributeError):
        pass

    # Check for missing accelerated kernels when accelerated regime is requested
    expected_backend = os.environ.get("CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND", os.environ.get("CCO_EXPECTED_ATTENTION_BACKEND"))
    if expected_backend == "sage" and not (sage_attn_fn or sage_attn3_fn):
        err = "SageAttention kernel not found or not registered in ComfyUI attention module"
        _ATTENTION_TRACKER.missing_kernel_failure = err
        _ATTENTION_TRACKER.status = "failed"
        _ATTENTION_TRACKER.failure_reason = err
        raise RuntimeError(f"Terminal attention experiment failure: {err}")
    elif expected_backend == "sol_attn" and not sol_attn_fn:
        err = "Native sol_attn kernel not found or not registered in comfy_kitchen"
        _ATTENTION_TRACKER.missing_kernel_failure = err
        _ATTENTION_TRACKER.status = "failed"
        _ATTENTION_TRACKER.failure_reason = err
        raise RuntimeError(f"Terminal attention experiment failure: {err}")
    elif expected_backend == "veda" and not veda_kernel_fn:
        err = "Veda sparse attention kernel not found or not registered in veda_sparse_attention"
        _ATTENTION_TRACKER.missing_kernel_failure = err
        _ATTENTION_TRACKER.status = "failed"
        _ATTENTION_TRACKER.failure_reason = err
        raise RuntimeError(f"Terminal attention experiment failure: {err}")
    elif expected_backend == "comfy kitchen attention" and not bsa_kernel_found:
        err = "BlockSparseAttention kernel comfy_kitchen.sol_attn_chunked not found or not registered in comfy_kitchen"
        _ATTENTION_TRACKER.missing_kernel_failure = err
        _ATTENTION_TRACKER.status = "failed"
        _ATTENTION_TRACKER.failure_reason = err
        raise RuntimeError(f"Terminal attention experiment failure: {err}")

def main():
    global _GLOBAL_COLLECTOR, _BOOTSTRAP_ENTRYPOINT

    run_dir = os.environ.get("CCO_EXPERIMENT_RUN_DIR", os.getcwd())
    run_id = os.environ.get("CCO_EXPERIMENT_RUN_ID", "default-run")
    attempt_token = os.environ.get("CCO_EXPERIMENT_ATTEMPT_TOKEN", "default-attempt")
    log_path = os.environ.get("CCO_EXPERIMENT_EVENT_LOG", os.path.join(run_dir, "phase-events.jsonl"))

    _GLOBAL_COLLECTOR = Collector(log_path, run_id, attempt_token)
    collector = _GLOBAL_COLLECTOR

    # Parse args: if first arg is --bootstrap-entrypoint or a python file
    args = sys.argv[1:]
    target_script = None
    if args and args[0] == "--bootstrap-entrypoint" and len(args) > 1:
        target_script = args[1]
        target_argv = [target_script] + args[2:]
    elif args:
        target_script = args[0]
        target_argv = args
    _BOOTSTRAP_ENTRYPOINT = target_script

    if target_script:
        target_dir = os.path.dirname(os.path.abspath(target_script))
        if target_dir not in sys.path:
            sys.path.insert(0, target_dir)

    startup_span_id = collector.start_span("environment_startup")

    if not target_script:
        collector.end_span(startup_span_id, outcome="failed", error={"message": "No entrypoint specified"})
        sys.exit(1)

    try:
        install_hooks(collector)
    except Exception as e:
        collector.end_span(startup_span_id, outcome="failed", error={"message": str(e), "exceptionType": type(e).__name__})
        collector.close()
        sys.exit(1)

    # Handshake record emitted after hooks successfully installed
    installed_hooks_evidence = get_installed_hooks_evidence()
    hook_manifest_digest = compute_hook_manifest_digest(installed_hooks_evidence)
    collector_digest = get_collector_digest()

    collector.emit(
        phase="environment_startup",
        event_type="point_event",
        span_id=startup_span_id,
        boundary_source="child_bootstrap",
        metadata={
            "handshake": "v2-jsonl",
            "protocol": "v2-jsonl",
            "protocolVersion": "v2-jsonl",
            "collectorDigest": collector_digest,
            "hookManifestDigest": hook_manifest_digest,
            "pythonVersion": sys.version,
            "pid": os.getpid()
        }
    )

    atexit.register(collector.close)
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
