"""
MiniMax-H3 TeaCache Session & Caching Engine (CCO Adapted)
Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
"""

import contextvars
import math
import sys
import threading
from typing import Any, Dict, List, Optional, Tuple

SUPPORTED_THRESHOLDS = (0.05, 0.1, 0.15)

_SHARED_VAR_KEY = "_CCO_MINIMAX_H3_TEACACHE_ACTIVE_SESSION_VAR"
if hasattr(sys, _SHARED_VAR_KEY):
    _ACTIVE_TEACACHE_SESSION = getattr(sys, _SHARED_VAR_KEY)
else:
    _ACTIVE_TEACACHE_SESSION = contextvars.ContextVar(
        "_ACTIVE_TEACACHE_SESSION", default=None
    )
    setattr(sys, _SHARED_VAR_KEY, _ACTIVE_TEACACHE_SESSION)

# Process-wide registry mapping model_id -> the session_id that currently
# owns it. Guards against two sessions being activated for the same model
# concurrently (e.g. nested/re-entrant sampling, or a leaked session from a
# prior failed setup) regardless of which asyncio/thread context activated
# them -- the ContextVar alone only isolates *context*, not *model
# identity*. Mapping to the owning session_id (rather than a bare set of
# model_ids) matters: a session whose own activation attempt was REJECTED
# (because a different session already legitimately owns that model_id)
# must not be able to evict that other session's lock when it is cleaned
# up -- cleanup() only releases the slot it actually owns.
_ACTIVE_MODEL_IDS_KEY = "_CCO_MINIMAX_H3_TEACACHE_ACTIVE_MODEL_IDS"
_ACTIVE_MODEL_IDS_LOCK_KEY = "_CCO_MINIMAX_H3_TEACACHE_ACTIVE_MODEL_IDS_LOCK"
if hasattr(sys, _ACTIVE_MODEL_IDS_KEY):
    _ACTIVE_MODEL_IDS = getattr(sys, _ACTIVE_MODEL_IDS_KEY)
    _ACTIVE_MODEL_IDS_LOCK = getattr(sys, _ACTIVE_MODEL_IDS_LOCK_KEY)
else:
    _ACTIVE_MODEL_IDS: Dict[Any, str] = {}
    _ACTIVE_MODEL_IDS_LOCK = threading.Lock()
    setattr(sys, _ACTIVE_MODEL_IDS_KEY, _ACTIVE_MODEL_IDS)
    setattr(sys, _ACTIVE_MODEL_IDS_LOCK_KEY, _ACTIVE_MODEL_IDS_LOCK)


def _snapshot_for_fingerprint(value: Any) -> Any:
    """Build an immutable, decoupled snapshot of value suitable for an
    equality-based conditioning fingerprint.

    Two properties matter here, both learned from a real adversarial
    probe against the naive version of this function:
    1. The result must not alias the caller's own mutable containers
       (dict/list). Storing a live reference means an in-place mutation
       of the ORIGINAL object after capture silently changes what the
       "old" fingerprint compares as, defeating the whole point of a
       change check.
    2. Tensor-like values (anything with .shape/.dtype -- real torch
       tensors, or the lightweight mocks used in tests) must never reach
       Python's `==`/`!=` directly: a real tensor's __eq__ returns an
       elementwise tensor, not a bool, which raises when something tries
       to use it as one (e.g. inside a tuple's own __eq__). Identity is
       compared via shape/dtype/device instead, exactly as evaluate()
       already does for the cached input tensor elsewhere in this file.
    """
    if hasattr(value, "shape") and hasattr(value, "dtype"):
        return (
            "__tensor__",
            tuple(value.shape) if value.shape is not None else None,
            str(getattr(value, "dtype", None)),
            str(getattr(value, "device", None)),
        )
    if isinstance(value, dict):
        return tuple(sorted((k, _snapshot_for_fingerprint(v)) for k, v in value.items()))
    if isinstance(value, (list, tuple)):
        return tuple(_snapshot_for_fingerprint(v) for v in value)
    return value


class TeaCacheSession:
    def __init__(
        self,
        session_id: str,
        model_id: Any,
        rel_l1_thresh: float,
        start_step: int,
        end_step: int,
        total_steps: int = 20,
        sigmas: Optional[List[float]] = None,
        event_callback: Optional[Any] = None,
    ):
        if sigmas is None:
            raise ValueError(
                "sigmas schedule is required: TeaCache cannot verify step/timestep "
                "alignment without the sampler's actual sigma schedule"
            )
        if isinstance(total_steps, bool) or not isinstance(total_steps, int) or total_steps != 20:
            raise ValueError(f"total_steps must be 20, got {total_steps}")
        if isinstance(rel_l1_thresh, bool) or not isinstance(rel_l1_thresh, (int, float)) or not math.isfinite(rel_l1_thresh):
            raise ValueError(f"rel_l1_thresh must be a finite number, got {rel_l1_thresh}")
        if round(float(rel_l1_thresh), 4) not in SUPPORTED_THRESHOLDS:
            raise ValueError(
                f"rel_l1_thresh must be one of {SUPPORTED_THRESHOLDS}, got {rel_l1_thresh}"
            )
        if isinstance(start_step, bool) or isinstance(end_step, bool) or not isinstance(start_step, int) or not isinstance(end_step, int):
            raise ValueError("start_step and end_step must be integers")

        effective_end = total_steps + end_step if end_step < 0 else end_step
        if start_step < 2 or effective_end > 18 or start_step >= effective_end:
            raise ValueError(
                f"Invalid step window [{start_step}, {effective_end}); must satisfy 2 <= start < end <= 18"
            )

        self.session_id = str(session_id)
        self.model_id = model_id
        self.rel_l1_thresh = float(rel_l1_thresh)
        self.start_step = int(start_step)
        self.raw_end_step = int(end_step)
        self.end_step = int(effective_end)
        self.normalized_end_step = int(effective_end)
        self.total_steps = int(total_steps)
        self.event_callback = event_callback

        self.accumulated_rel_l1 = 0.0
        self.last_real_input = None
        self.last_real_output = None
        self.step_idx = -1
        self.forward_calls_count = 0
        self.cache_hits_count = 0
        self.nested_forwards_on_hits = 0
        self.evaluations_in_current_step = 0
        self.is_evaluating = False
        self.is_evaluating_hit = False
        self.is_active = True
        self.conditioning_fingerprint: Optional[Tuple[Any, ...]] = None
        self._lock = threading.Lock()

        # Validate sigmas if provided
        self.sigmas: Optional[List[float]] = None
        if sigmas is not None:
            self.set_and_validate_sigmas(sigmas)

    def set_and_validate_sigmas(self, sigmas: List[float]):
        if len(sigmas) != self.total_steps + 1:
            raise ValueError(
                f"Expected schedule with {self.total_steps + 1} sigmas for {self.total_steps} steps, got {len(sigmas)}"
            )
        for i, s in enumerate(sigmas):
            val = float(s)
            if not math.isfinite(val):
                raise ValueError(f"Sigma at index {i} is non-finite: {s}")
            if i > 0 and val >= float(sigmas[i - 1]):
                raise ValueError(
                    f"Sigma schedule is not strictly descending at index {i}: {sigmas[i - 1]} -> {val}"
                )
        self.sigmas = [float(s) for s in sigmas]

    def advance_step(self, step_index: int):
        with self._lock:
            if not self.is_active:
                raise RuntimeError("Cannot advance step on inactive or cleaned-up TeaCacheSession")
            if isinstance(step_index, bool) or not isinstance(step_index, int) or not (0 <= step_index < self.total_steps):
                raise ValueError(
                    f"step_index must be an integer in [0, {self.total_steps}), got {step_index}"
                )
            if self.step_idx == -1:
                if step_index != 0:
                    raise ValueError(f"First step advancement must be to step 0, got {step_index}")
            else:
                if step_index <= self.step_idx:
                    raise ValueError(
                        f"step_index cannot repeat or go backwards: current {self.step_idx}, got {step_index}"
                    )
                if step_index > self.step_idx + 1:
                    raise ValueError(
                        f"step_index jumped non-sequentially: current {self.step_idx}, got {step_index}"
                    )
            self.step_idx = int(step_index)
            self.evaluations_in_current_step = 0

    def evaluate(self, apply_model: Any, kwargs: Dict[str, Any]) -> Any:
        with self._lock:
            if not self.is_active:
                raise RuntimeError("Cannot evaluate on inactive or cleaned-up TeaCacheSession")
            if self.step_idx < 0:
                raise RuntimeError("Cannot evaluate on TeaCacheSession before first step advancement")
            if self.is_evaluating:
                raise RuntimeError(
                    "Concurrent or reentrant evaluation on the same TeaCacheSession is forbidden"
                )
            if self.evaluations_in_current_step > 0:
                raise RuntimeError(
                    f"Duplicate or multi-branch evaluation detected in step {self.step_idx}: "
                    "exactly one evaluation per step interval is supported"
                )
            self.is_evaluating = True

        try:
            curr_input = kwargs.get("input")
            if curr_input is None:
                raise ValueError("kwargs missing 'input' tensor")

            # Validate timestep alignment against the pinned sigma schedule.
            # Both sides are mandatory (fail-closed): a missing timestep or an
            # unreadable/mismatched value must abort the step, not silently
            # skip the scheduler-conformance check.
            curr_timestep = kwargs.get("timestep")
            if curr_timestep is None:
                raise ValueError(
                    f"kwargs missing 'timestep' tensor at step {self.step_idx}; "
                    "cannot verify scheduler alignment"
                )
            expected_sigma = self.sigmas[self.step_idx]
            try:
                ts_val = float(curr_timestep.item() if hasattr(curr_timestep, "item") else curr_timestep)
            except Exception as conv_err:
                raise ValueError(
                    f"Timestep at step {self.step_idx} is not convertible to a finite scalar: {conv_err}"
                ) from conv_err
            if not math.isfinite(ts_val) or abs(ts_val - expected_sigma) > 1e-1:
                raise ValueError(
                    f"Timestep {ts_val} does not match expected schedule sigma {expected_sigma} at step {self.step_idx}"
                )

            cond_or_uncond = kwargs.get("cond_or_uncond")
            if cond_or_uncond is not None:
                if isinstance(cond_or_uncond, (list, tuple)) and len(cond_or_uncond) > 1:
                    raise RuntimeError(
                        f"Multi-condition/CFG branching is unsupported by TeaCache: cond_or_uncond={cond_or_uncond}"
                    )

            # Bind this session to the specific route/conditioning shape it was
            # first called with. A cached output is only a valid substitute for
            # a later real forward if the surrounding conditioning manifest --
            # which keys are present, the actual latent_shapes/minimax_payload/
            # cross_attention identity, and the cond/uncond arity -- is
            # unchanged -- otherwise the cache would silently serve output
            # computed under a different route (e.g. I2V vs Ref2V), a
            # different reference-image binding, or a changed payload, even
            # though the surrounding key set looked identical. The snapshot
            # must not alias the caller's own (possibly reused/mutated-in-
            # place) containers: freezing to an immutable, decoupled tuple
            # form means a later in-place mutation of the original object
            # cannot retroactively change what this session captured.
            c = kwargs.get("c")
            c_fingerprint_keys = tuple(sorted(c.keys())) if isinstance(c, dict) else None
            fingerprint = (
                tuple(sorted(k for k in kwargs if k not in ("input", "timestep", "c"))),
                c_fingerprint_keys,
                _snapshot_for_fingerprint(c.get("latent_shapes")) if isinstance(c, dict) else None,
                _snapshot_for_fingerprint(c.get("minimax_payload")) if isinstance(c, dict) else None,
                _snapshot_for_fingerprint(c.get("cross_attention")) if isinstance(c, dict) else None,
                len(cond_or_uncond) if isinstance(cond_or_uncond, (list, tuple)) else cond_or_uncond,
            )
            if self.conditioning_fingerprint is None:
                self.conditioning_fingerprint = fingerprint
            elif self.conditioning_fingerprint != fingerprint:
                raise RuntimeError(
                    "Conditioning manifest changed mid-session: TeaCache was bound to "
                    f"{self.conditioning_fingerprint}, saw {fingerprint} at step {self.step_idx}. "
                    "A cached forward output cannot be reused across a route/conditioning change."
                )

            in_window = self.start_step <= self.step_idx < self.end_step
            should_hit = False
            rel_l1 = 0.0

            if in_window and self.last_real_input is not None and self.last_real_output is not None:
                if curr_input.shape != self.last_real_input.shape:
                    raise ValueError(
                        f"Input tensor shape mismatch with cached state: {curr_input.shape} vs {self.last_real_input.shape}"
                    )
                if curr_input.dtype != self.last_real_input.dtype:
                    raise ValueError(
                        f"Input tensor dtype mismatch with cached state: {curr_input.dtype} vs {self.last_real_input.dtype}"
                    )
                if curr_input.device != self.last_real_input.device:
                    raise ValueError(
                        f"Input tensor device mismatch with cached state: {curr_input.device} vs {self.last_real_input.device}"
                    )

                # Relative L1 calculation
                diff = (curr_input.float() - self.last_real_input.float()).abs().mean()
                norm = self.last_real_input.float().abs().mean()
                if norm == 0:
                    rel_l1 = 0.0
                else:
                    rel_l1 = (diff / norm).item()

                if not math.isfinite(rel_l1) or rel_l1 < 0:
                    raise ValueError(f"Non-finite or negative relative L1 computed: {rel_l1}")

                if self.accumulated_rel_l1 + rel_l1 < self.rel_l1_thresh:
                    should_hit = True
                    self.accumulated_rel_l1 += rel_l1

            if should_hit:
                self.is_evaluating_hit = True
                self.cache_hits_count += 1
                self.evaluations_in_current_step += 1
                if self.event_callback:
                    self.event_callback(
                        event="cache_hit",
                        stepIndex=self.step_idx,
                        step_index=self.step_idx,
                        rel_l1=rel_l1,
                        accumulated_rel_l1=self.accumulated_rel_l1,
                        thresh=self.rel_l1_thresh,
                    )
                # Output clone prevents in-place mutation of cached output
                return self.last_real_output.clone()
            else:
                self.is_evaluating_hit = False
                self.accumulated_rel_l1 = 0.0
                self.forward_calls_count += 1
                self.evaluations_in_current_step += 1
                if self.event_callback:
                    self.event_callback(
                        event="cache_miss",
                        stepIndex=self.step_idx,
                        step_index=self.step_idx,
                        rel_l1=rel_l1,
                        accumulated_rel_l1=self.accumulated_rel_l1,
                        thresh=self.rel_l1_thresh,
                    )
                c = kwargs.get("c")
                c_kwargs = c if isinstance(c, dict) else {k: v for k, v in kwargs.items() if k not in ("input", "timestep", "cond_or_uncond")}
                if curr_timestep is not None:
                    try:
                        out = apply_model(curr_input, curr_timestep, **c_kwargs)
                    except TypeError as te:
                        if "positional argument" in str(te):
                            out = apply_model(curr_input, **c_kwargs)
                        else:
                            raise
                else:
                    out = apply_model(curr_input, **c_kwargs)
                self.last_real_input = curr_input.detach().clone()
                self.last_real_output = out.detach().clone()
                return out
        finally:
            with self._lock:
                self.is_evaluating = False
                self.is_evaluating_hit = False

    def cleanup(self):
        with self._lock:
            self.last_real_input = None
            self.last_real_output = None
            self.is_active = False
            self.is_evaluating = False
            self.is_evaluating_hit = False
        with _ACTIVE_MODEL_IDS_LOCK:
            # Only release the slot if THIS session is the one that holds
            # it. A session whose set_active_session() call was itself
            # rejected (because a different session already legitimately
            # owns model_id) must not evict that other session's lock when
            # it is (correctly) cleaned up by its own caller.
            if _ACTIVE_MODEL_IDS.get(self.model_id) == self.session_id:
                del _ACTIVE_MODEL_IDS[self.model_id]


def get_active_session() -> Optional[TeaCacheSession]:
    return _ACTIVE_TEACACHE_SESSION.get()


def set_active_session(session: Optional[TeaCacheSession]) -> Any:
    if session is not None:
        with _ACTIVE_MODEL_IDS_LOCK:
            existing_owner = _ACTIVE_MODEL_IDS.get(session.model_id)
            if existing_owner is not None and existing_owner != session.session_id:
                raise RuntimeError(
                    f"A TeaCache session (session_id={existing_owner!r}) is already active for "
                    f"model_id={session.model_id!r}. Nested or re-entrant sessions on the same "
                    "model are forbidden -- the prior session was either never cleaned up (a "
                    "leaked session from a failed setup) or this call is genuinely concurrent/"
                    "re-entrant."
                )
            _ACTIVE_MODEL_IDS[session.model_id] = session.session_id
    return _ACTIVE_TEACACHE_SESSION.set(session)


def reset_active_session(token: Any):
    _ACTIVE_TEACACHE_SESSION.reset(token)
