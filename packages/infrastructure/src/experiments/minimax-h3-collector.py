#!/usr/bin/env python3
"""
MiniMax-H3 Experiment Child Instrumentation Collector & Bootstrap.
Protocol: v2-jsonl

Repository-owned Python bootstrap used only by the experiment process runner.
It records deterministic, additive phase accounting without modifying ComfyUI checkout.
"""

import atexit
import hashlib
import inspect
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
        self.accelerated_call_count = 0
        self.dense_call_count = 0
        self.planned_dense_call_count = 0
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

    def record_accelerated(self, backend: str, impl: str, step_index: Optional[int] = None):
        self.accelerated_call_count += 1
        self.actual_backend = backend
        self.dispatch_impl = impl
        if self.status != "fallback" and self.status != "failed":
            self.status = "verified"
        if step_index is not None:
            self.step_records.append({
                "stepIndex": int(step_index),
                "backend": backend,
                "implementation": impl,
                "callType": "accelerated",
                "monotonicMs": now_mono_ms()
            })

    def record_dense(self, is_planned: bool = False, step_index: Optional[int] = None):
        call_type = "planned_dense" if is_planned else "dense"
        if is_planned:
            self.planned_dense_call_count += 1
            if self.expected_backend and self.expected_backend not in ("torch_sdpa", "dense", "default") and not self.allow_planned_dense:
                reason = "Planned dense attention call executed under zero-dense policy regime"
                self.record_fallback(self.expected_backend, "torch_sdpa", reason, step_index=step_index or 0)
                return
        else:
            self.dense_call_count += 1
            if self.expected_backend and self.expected_backend not in ("torch_sdpa", "dense", "default"):
                reason = "Unexpected dense attention call executed during accelerated regime"
                if not self.allow_planned_dense:
                    reason += " (allowPlannedDense=false)"
                self.record_fallback(self.expected_backend, "torch_sdpa", reason, step_index=step_index or 0)
                return
        if self.status != "fallback" and self.status != "failed":
            if self.actual_backend in ("unknown", None):
                self.actual_backend = "torch_sdpa"
                self.dispatch_impl = "torch.nn.functional.scaled_dot_product_attention"
                self.status = "verified"
        if step_index is not None:
            self.step_records.append({
                "stepIndex": int(step_index),
                "backend": "torch_sdpa",
                "implementation": "torch.nn.functional.scaled_dot_product_attention",
                "callType": call_type,
                "monotonicMs": now_mono_ms()
            })

    def record_fallback(self, requested: str, fallback: str, reason: str, step_index: int = 0):
        event = {
            "stepIndex": int(step_index),
            "layerIndex": None,
            "requestedBackend": requested,
            "fallbackBackend": fallback,
            "reason": reason,
            "monotonicMs": now_mono_ms()
        }
        self.fallback_events.append(event)
        self.status = "fallback"
        self.failure_reason = reason
        self.step_records.append({
            "stepIndex": int(step_index),
            "backend": fallback,
            "implementation": "torch.nn.functional.scaled_dot_product_attention",
            "callType": "fallback",
            "monotonicMs": now_mono_ms()
        })
        if self.expected_backend and self.expected_backend not in ("torch_sdpa", "dense", "default") and not self.allow_planned_dense:
            self.status = "failed"
            print(f"[ERROR] Terminal attention experiment failure: {reason}", file=sys.stderr)
            if _GLOBAL_COLLECTOR:
                _GLOBAL_COLLECTOR.close()
            sys.exit(1)

    def summary(self) -> Dict[str, Any]:
        return {
            "acceleratedCallCount": self.accelerated_call_count,
            "denseCallCount": self.dense_call_count,
            "plannedDenseCallCount": self.planned_dense_call_count,
            "fallbackEvents": self.fallback_events,
            "actualBackend": self.actual_backend,
            "dispatchImplementation": self.dispatch_impl,
            "missingKernelFailure": self.missing_kernel_failure,
            "status": self.status,
            "failureReason": self.failure_reason,
            "dtypeLayoutDiagnostics": self.dtype_diagnostics
        }

_ATTENTION_TRACKER = AttentionTracker()
_GLOBAL_COLLECTOR: Optional[Collector] = None
_IN_DENSE_DISPATCH = False

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
    global _IN_DENSE_DISPATCH

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
    except (ImportError, AttributeError):
        pass

    # 2. Hook execution.PromptExecutor / nodes execution
    try:
        import execution
        prompt_executor_cls = getattr(execution, "PromptExecutor", None)
        if prompt_executor_cls:
            orig_execute = getattr(prompt_executor_cls, "execute", None)
            if orig_execute:
                def hooked_prompt_execute(self, *args, **kwargs):
                    # Try to extract prompt_id from args if available
                    if args and len(args) > 1 and isinstance(args[1], str):
                        collector.prompt_id = args[1]
                    return orig_execute(self, *args, **kwargs)
                prompt_executor_cls.execute = hooked_prompt_execute
    except (ImportError, AttributeError):
        pass

    # 3. Hook comfy.samplers for sampling and step boundaries
    try:
        import comfy.samplers as samplers
        ksampler_cls = getattr(samplers, "KSampler", None)
        if ksampler_cls:
            orig_sample = getattr(ksampler_cls, "sample", None)
            if orig_sample:
                def hooked_sample(self, *args, **kwargs):
                    sampler_span_id = collector.start_span("sampling", class_type="KSampler")
                    state = {
                        "last_step_end_ms": None,
                        "seen_steps": set()
                    }

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
                        cur_idx = step if isinstance(step, int) else None
                        if cur_idx is not None and cur_idx not in state["seen_steps"]:
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
                ksampler_cls.sample = hooked_sample
    except (ImportError, AttributeError):
        pass

    # 4. Hook SamplerCustomAdvanced for canonical pipeline sampling
    try:
        import comfy_extras.nodes_custom_sampler as custom_sampler
        custom_node_cls = getattr(custom_sampler, "SamplerCustomAdvanced", None)
        if custom_node_cls:
            orig_custom_execute = getattr(custom_node_cls, "execute", None)
            if orig_custom_execute is None:
                orig_custom_execute = getattr(custom_node_cls, "sample", None)

            if orig_custom_execute:
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

                    def step_callback(chain_cb):
                        def cb(step, x0, x, total_s, *cb_args, **cb_kwargs):
                            cur_idx = step if isinstance(step, int) else None
                            if cur_idx is not None and cur_idx not in state["seen_steps"]:
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

                    try:
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
                        if orig_guider_sample is not None:
                            guider.sample = orig_guider_sample

                wrapped_execute = classmethod(hooked_custom_execute)
                custom_node_cls.execute = wrapped_execute
                custom_node_cls.sample = wrapped_execute
    except (ImportError, AttributeError):
        pass

    # 4b. Hook conditioning nodes (MiniMaxH3ImageToVideo and MiniMaxH3ReferenceToVideo)
    try:
        import comfy_extras.nodes_minimax_h3 as nodes_minimax_h3
        for cls_name in ("MiniMaxH3ImageToVideo", "MiniMaxH3ReferenceToVideo"):
            node_cls = getattr(nodes_minimax_h3, cls_name, None)
            if node_cls:
                orig_execute = getattr(node_cls, "execute", None)
                if orig_execute:
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
                                    # Fallback when signature binding fails
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
                        return classmethod(hooked_execute)

                    hooked_func = make_hooked_execute(cls_name, orig_execute)
                    setattr(node_cls, "execute", hooked_func)
    except (ImportError, AttributeError):
        pass

    # 5. Hook comfy.ldm.modules.attention for attention backend monitoring
    sage_attn_fn = None
    sage_attn3_fn = None
    try:
        import comfy.ldm.modules.attention as comfy_attn

        sage_attn_fn = getattr(comfy_attn, "sageattn", None)
        if sage_attn_fn:
            def hooked_sageattn(*args, **kwargs):
                try:
                    res = sage_attn_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated("sage", "sageattention.sageattn")
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback("sage", "torch_sdpa", f"sageattn kernel exception: {e}")
                    raise
            comfy_attn.sageattn = hooked_sageattn

        sage_attn3_fn = getattr(comfy_attn, "sageattn3", None)
        if sage_attn3_fn:
            def hooked_sageattn3(*args, **kwargs):
                try:
                    res = sage_attn3_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated("sage", "sageattention.sageattn3")
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback("sage", "torch_sdpa", f"sageattn3 kernel exception: {e}")
                    raise
            comfy_attn.sageattn3 = hooked_sageattn3

        sdp_fn = getattr(comfy_attn, "sdp", None)
        if sdp_fn:
            def hooked_sdp(*args, **kwargs):
                global _IN_DENSE_DISPATCH
                if _IN_DENSE_DISPATCH:
                    return sdp_fn(*args, **kwargs)
                _IN_DENSE_DISPATCH = True
                try:
                    res = sdp_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_dense()
                    return res
                finally:
                    _IN_DENSE_DISPATCH = False
            comfy_attn.sdp = hooked_sdp

        orig_attention_pytorch = getattr(comfy_attn, "attention_pytorch", None)
        if orig_attention_pytorch:
            def hooked_attention_pytorch(*args, **kwargs):
                global _IN_DENSE_DISPATCH
                if _IN_DENSE_DISPATCH:
                    return orig_attention_pytorch(*args, **kwargs)
                _IN_DENSE_DISPATCH = True
                try:
                    res = orig_attention_pytorch(*args, **kwargs)
                    _ATTENTION_TRACKER.record_dense()
                    return res
                finally:
                    _IN_DENSE_DISPATCH = False
            comfy_attn.attention_pytorch = hooked_attention_pytorch

        orig_attention_sage = getattr(comfy_attn, "attention_sage", None)
        if orig_attention_sage:
            def hooked_attention_sage(*args, **kwargs):
                pre_accel = _ATTENTION_TRACKER.accelerated_call_count
                pre_fallbacks = len(_ATTENTION_TRACKER.fallback_events)
                try:
                    res = orig_attention_sage(*args, **kwargs)
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback("sage", "torch_sdpa", f"attention_sage exception: {e}")
                    raise
                if _ATTENTION_TRACKER.accelerated_call_count == pre_accel and len(_ATTENTION_TRACKER.fallback_events) == pre_fallbacks:
                    reason = "ComfyUI attention_sage caught internal exception and silently dispatched to PyTorch dense attention"
                    _ATTENTION_TRACKER.record_fallback("sage", "torch_sdpa", reason)
                return res
            comfy_attn.attention_sage = hooked_attention_sage

        orig_optimized = getattr(comfy_attn, "optimized_attention", None)
        if orig_optimized:
            def hooked_optimized(*args, **kwargs):
                try:
                    return orig_optimized(*args, **kwargs)
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback("accelerated", "torch_sdpa", str(e))
                    raise
            comfy_attn.optimized_attention = hooked_optimized
    except (ImportError, AttributeError):
        pass

    # 6. Hook comfy.ops and torch.nn.functional for scaled_dot_product_attention
    try:
        import comfy.ops as comfy_ops
        orig_sdpa = getattr(comfy_ops, "scaled_dot_product_attention", None)
        if orig_sdpa:
            def hooked_sdpa(*args, **kwargs):
                global _IN_DENSE_DISPATCH
                if _IN_DENSE_DISPATCH:
                    return orig_sdpa(*args, **kwargs)
                _IN_DENSE_DISPATCH = True
                try:
                    res = orig_sdpa(*args, **kwargs)
                    _ATTENTION_TRACKER.record_dense()
                    return res
                finally:
                    _IN_DENSE_DISPATCH = False
            comfy_ops.scaled_dot_product_attention = hooked_sdpa
    except (ImportError, AttributeError):
        pass

    try:
        import torch.nn.functional as F
        orig_torch_sdpa = getattr(F, "scaled_dot_product_attention", None)
        if orig_torch_sdpa:
            def hooked_torch_sdpa(*args, **kwargs):
                global _IN_DENSE_DISPATCH
                if _IN_DENSE_DISPATCH:
                    return orig_torch_sdpa(*args, **kwargs)
                _IN_DENSE_DISPATCH = True
                try:
                    res = orig_torch_sdpa(*args, **kwargs)
                    _ATTENTION_TRACKER.record_dense()
                    return res
                finally:
                    _IN_DENSE_DISPATCH = False
            F.scaled_dot_product_attention = hooked_torch_sdpa
    except (ImportError, AttributeError):
        pass

    # 7. Hook comfy_kitchen for sol_attn
    sol_attn_fn = None
    try:
        import comfy_kitchen
        sol_attn_fn = getattr(comfy_kitchen, "sol_attn", None)
        if sol_attn_fn:
            def hooked_sol_attn(*args, **kwargs):
                try:
                    res = sol_attn_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated("sol_attn", "comfy_kitchen.sol_attn")
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback("sol_attn", "torch_sdpa", f"sol_attn kernel exception: {e}")
                    raise
            comfy_kitchen.sol_attn = hooked_sol_attn
    except (ImportError, AttributeError):
        pass

    # 8. Hook veda_sparse_attention for veda
    veda_kernel_fn = None
    try:
        import veda_sparse_attention
        veda_kernel_fn = getattr(veda_sparse_attention, "triton_kernel", None)
        if veda_kernel_fn:
            def hooked_veda(*args, **kwargs):
                try:
                    res = veda_kernel_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated("veda", "veda_sparse_attention.triton_kernel")
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback("veda", "torch_sdpa", f"veda kernel exception: {e}")
                    raise
            veda_sparse_attention.triton_kernel = hooked_veda
    except (ImportError, AttributeError):
        pass

    # 8b. Hook comfy_kitchen.sol_attn_chunked for actual FastH3 BlockSparseAttention dispatch
    bsa_kernel_found = False
    try:
        import comfy_kitchen
        sol_chunked_fn = getattr(comfy_kitchen, "sol_attn_chunked", None)
        if sol_chunked_fn:
            bsa_kernel_found = True
            def hooked_sol_chunked(*args, **kwargs):
                try:
                    res = sol_chunked_fn(*args, **kwargs)
                    _ATTENTION_TRACKER.record_accelerated("comfy kitchen attention", "block_sparse_triton")
                    return res
                except Exception as e:
                    _ATTENTION_TRACKER.record_fallback("comfy kitchen attention", "torch_sdpa", f"comfy_kitchen.sol_attn_chunked exception: {e}")
                    raise
            comfy_kitchen.sol_attn_chunked = hooked_sol_chunked
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
    global _GLOBAL_COLLECTOR

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
    collector.emit(
        phase="environment_startup",
        event_type="point_event",
        span_id=startup_span_id,
        metadata={
            "handshake": "v2-jsonl",
            "protocol": "v2-jsonl",
            "protocolVersion": "v2-jsonl",
            "collectorDigest": os.environ.get("CCO_EXPERIMENT_COLLECTOR_DIGEST", ""),
            "hookManifestDigest": os.environ.get("CCO_EXPERIMENT_HOOK_MANIFEST_DIGEST", ""),
            "pythonVersion": sys.version,
            "pid": os.getpid(),
            "attentionSummary": _ATTENTION_TRACKER.summary()
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
