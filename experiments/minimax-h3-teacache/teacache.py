"""
MiniMax-H3 TeaCache Session & Caching Engine (CCO Adapted)
Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
"""

import contextvars
import math
import sys
import threading
import uuid
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


_TENSOR_SNAPSHOT_TAG = "__tensor__"


def _snapshot_for_fingerprint(value: Any) -> Any:
    """Build an immutable, decoupled snapshot of value suitable for an
    equality-based conditioning fingerprint (compared via
    _fingerprints_equal, never raw `==`/`!=`).

    Properties that matter here, each learned from a real adversarial
    probe against an earlier version of this function:
    1. The result must not alias the caller's own mutable containers
       (dict/list). Storing a live reference means an in-place mutation
       of the ORIGINAL object after capture silently changes what the
       "old" fingerprint compares as, defeating the whole point of a
       change check.
    2. Tensor-like values (anything with .shape/.dtype -- real torch
       tensors, or the lightweight mocks used in tests) must never reach
       Python's `==`/`!=` directly: a real tensor's __eq__ returns an
       elementwise tensor, not a bool, which raises when something tries
       to use it as one (e.g. inside a tuple's own __eq__).
    3. shape/dtype/device alone is metadata, not content: two tensors with
       identical shape/dtype/device can hold completely different values
       (a different reference image, a different cross-attention
       embedding). A clone of the actual tensor is retained alongside the
       metadata so _fingerprints_equal can verify real content identity,
       not just that the metadata happens to match.
    """
    if value is None or isinstance(value, (bool, int, float, str, uuid.UUID)):
        # uuid.UUID is immutable and defines real value equality (two UUID
        # objects with the same int value compare equal via `==`, never an
        # elementwise/ambiguous result) -- safe to pass through unwrapped,
        # same as str/int/float. This matters because the pinned ComfyUI
        # core attaches a fresh uuid.UUID per forward call inside
        # transformer_options.uuids (comfy/sampler_helpers.py,
        # comfy/samplers.py); without this branch every real sampling call
        # hit the "unsupported type" fail-closed path below and TeaCache
        # could never evaluate a single step against genuine core input.
        return value
    if hasattr(value, "shape") and hasattr(value, "dtype"):
        clone = None
        try:
            if hasattr(value, "detach") and hasattr(value, "clone"):
                clone = value.detach().clone()
        except Exception:
            clone = None
        return (
            _TENSOR_SNAPSHOT_TAG,
            tuple(value.shape) if value.shape is not None else None,
            str(getattr(value, "dtype", None)),
            str(getattr(value, "device", None)),
            clone,
        )
    if isinstance(value, dict):
        return tuple(sorted((k, _snapshot_for_fingerprint(v)) for k, v in value.items()))
    if isinstance(value, (list, tuple)):
        return tuple(_snapshot_for_fingerprint(v) for v in value)
    # Anything else (an arbitrary custom object) cannot be safely frozen or
    # compared: its own __eq__ may be identity-based (silently masking an
    # in-place mutation of the same object across calls, which is exactly
    # the failure mode a prior version of this function left open for
    # "unsupported" payload values that fell through to a raw passthrough
    # here) or may raise/behave unpredictably. Fail closed rather than
    # accept an unverifiable conditioning payload.
    raise ValueError(
        f"Unsupported conditioning value type for TeaCache fingerprinting: {type(value)!r}. "
        "Only None/bool/int/float/str, dict, list/tuple, and tensor-like "
        "(shape+dtype) values are supported; add explicit handling rather "
        "than caching across an unverifiable payload."
    )


def _fingerprints_equal(a: Any, b: Any) -> bool:
    """Recursively compare two _snapshot_for_fingerprint() outputs.

    Never applies Python's `==` to a real tensor-like value directly --
    only to the extracted shape/dtype/device metadata (always plain
    tuples/strings by construction) and, for the actual retained clones,
    via .equal() (which real torch tensors define to return a plain
    bool) rather than `==`.
    """
    if (
        isinstance(a, tuple)
        and isinstance(b, tuple)
        and len(a) == 5
        and len(b) == 5
        and a[0] == _TENSOR_SNAPSHOT_TAG
        and b[0] == _TENSOR_SNAPSHOT_TAG
    ):
        if a[1] != b[1] or a[2] != b[2] or a[3] != b[3]:
            return False
        old_clone, new_clone = a[4], b[4]
        if old_clone is not None and new_clone is not None:
            equal_fn = getattr(old_clone, "equal", None)
            if callable(equal_fn):
                try:
                    return bool(equal_fn(new_clone))
                except Exception:
                    return False
        # Content cannot be verified -- cloning was unavailable on either
        # side, or a clone exists but exposes no .equal(). Treating "same
        # object reference" as proof of "unchanged" is NOT safe here: the
        # caller may hand back the literal same mutable tensor-like object
        # on every call while mutating its contents in place between
        # calls, which a reference-identity check cannot see at all. With
        # no way to verify content, the only fail-closed answer is to
        # always treat this as a change -- a session relying on
        # unverifiable tensor content for more than one evaluate() call is
        # exactly the scenario this must refuse to silently trust.
        return False
    if isinstance(a, tuple) and isinstance(b, tuple):
        if len(a) != len(b):
            return False
        return all(_fingerprints_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, tuple) or isinstance(b, tuple):
        return False
    return a == b


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
            # every key and value in `c` that is actually part of the
            # conditioning identity, not just a hand-picked subset -- plus the
            # cond/uncond arity, is unchanged -- otherwise the cache would
            # silently serve output computed under a different route (e.g.
            # I2V vs Ref2V), a different reference-image binding, or a
            # changed payload on some key this session happened not to
            # special-case.
            #
            # transformer_options.sigmas is the ONE field excluded from the
            # fingerprint, not the whole of transformer_options: at the
            # pinned ComfyUI core revision, comfy/samplers.py inserts the
            # CURRENT TIMESTEP's schedule state into c.transformer_options.
            # sigmas on every step before ever calling this
            # model_function_wrapper -- standard scheduler progress
            # plumbing, not conditioning identity, and EXPECTED to differ
            # on every real step. Everything else under transformer_options
            # (patches, and any other key) is still fingerprinted normally.
            # sigmas itself is not merely ignored, though: it is validated
            # against this session's own pinned schedule below, so a
            # contradictory/forged value is still rejected even though it
            # isn't part of the equality fingerprint.
            c = kwargs.get("c")
            c_identity: Optional[Dict[str, Any]] = None
            if isinstance(c, dict):
                c_identity = dict(c)
                raw_transformer_options = c.get("transformer_options")
                if isinstance(raw_transformer_options, dict):
                    reported_sigmas = raw_transformer_options.get("sigmas")
                    if reported_sigmas is not None:
                        # Whatever shape the real core passes (a bare
                        # current-step value or a schedule array), its
                        # OWN current entry must agree with this session's
                        # pinned schedule at the current step -- the same
                        # tolerance already used for the top-level
                        # `timestep` kwarg. This catches a forged/
                        # contradictory value (e.g. a probe-injected
                        # sigmas=[999]) without presuming an exact,
                        # unverified array shape/length for the real
                        # per-step payload.
                        first_reported = (
                            reported_sigmas[0]
                            if isinstance(reported_sigmas, (list, tuple)) and reported_sigmas
                            else reported_sigmas
                        )
                        expected_current_sigma = (
                            self.sigmas[self.step_idx] if self.sigmas else None
                        )
                        try:
                            first_reported_val = float(first_reported)
                        except (TypeError, ValueError):
                            first_reported_val = None
                        if (
                            expected_current_sigma is None
                            or first_reported_val is None
                            or not math.isfinite(first_reported_val)
                            or abs(first_reported_val - expected_current_sigma) > 1e-1
                        ):
                            raise ValueError(
                                f"transformer_options.sigmas at step {self.step_idx} "
                                f"(observed {first_reported!r}) does not match this session's "
                                f"pinned schedule (expected ~{expected_current_sigma}) -- "
                                "contradictory per-step scheduler metadata cannot be silently "
                                "accepted."
                            )
                    c_identity["transformer_options"] = {
                        k: v for k, v in raw_transformer_options.items() if k != "sigmas"
                    }
            fingerprint = (
                tuple(sorted(k for k in kwargs if k not in ("input", "timestep", "c"))),
                _snapshot_for_fingerprint(c_identity) if c_identity is not None else None,
                len(cond_or_uncond) if isinstance(cond_or_uncond, (list, tuple)) else cond_or_uncond,
            )
            if self.conditioning_fingerprint is None:
                self.conditioning_fingerprint = fingerprint
            elif not _fingerprints_equal(self.conditioning_fingerprint, fingerprint):
                raise RuntimeError(
                    "Conditioning manifest changed mid-session: TeaCache was bound to a "
                    f"different conditioning shape/content than seen at step {self.step_idx}. "
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
