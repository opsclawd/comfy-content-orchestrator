"""
MiniMax-H3 TeaCache ComfyUI Custom Node (CCO Adapted)
Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
"""

import math
from typing import Any, Dict, Tuple
try:
    from . import teacache as _teacache_mod
    from .teacache import get_active_session, SUPPORTED_THRESHOLDS
except ImportError:
    import teacache as _teacache_mod
    from teacache import get_active_session, SUPPORTED_THRESHOLDS


class CCOMiniMaxH3TeaCacheNode:
    _teacache_module = _teacache_mod

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "rel_l1_thresh": (
                    "FLOAT",
                    {"default": 0.15, "min": 0.0, "max": 0.5, "step": 0.01},
                ),
                "start_step": ("INT", {"default": 2, "min": 0, "max": 100, "step": 1}),
                "end_step": ("INT", {"default": -2, "min": -100, "max": 100, "step": 1}),
                "total_steps": ("INT", {"default": 20, "min": 1, "max": 1000, "step": 1}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    FUNCTION = "apply"
    CATEGORY = "model_patches/unet"

    def apply(
        self,
        model: Any,
        rel_l1_thresh: float,
        start_step: int,
        end_step: int,
        total_steps: int,
    ) -> Tuple[Any]:
        # Validate parameter bounds
        if isinstance(total_steps, bool) or not isinstance(total_steps, int) or total_steps != 20:
            raise ValueError(f"TeaCache requires total_steps == 20, got {total_steps}")
        if isinstance(rel_l1_thresh, bool) or not isinstance(rel_l1_thresh, (int, float)) or not math.isfinite(rel_l1_thresh):
            raise ValueError(f"rel_l1_thresh must be a finite number, got {rel_l1_thresh}")
        if round(float(rel_l1_thresh), 4) not in SUPPORTED_THRESHOLDS:
            raise ValueError(
                f"rel_l1_thresh must be one of {SUPPORTED_THRESHOLDS}, got {rel_l1_thresh}"
            )

        if isinstance(start_step, bool) or isinstance(end_step, bool) or not isinstance(start_step, int) or not isinstance(end_step, int):
            raise ValueError("start_step and end_step must be integers")
        norm_end = total_steps + end_step if end_step < 0 else end_step
        if start_step < 2 or norm_end > 18 or start_step >= norm_end:
            raise ValueError(
                f"Invalid step window [{start_step}, {norm_end}); must satisfy 2 <= start < end <= 18"
            )

        m = model.clone() if hasattr(model, "clone") else model
        opts = getattr(m, "model_options", None)
        if opts is None:
            opts = {}
            m.model_options = opts

        # Reject competing wrappers
        existing_wrapper = opts.get("model_function_wrapper")
        if existing_wrapper is not None:
            raise RuntimeError(
                "Competing model_function_wrapper already registered on model. TeaCache cannot be combined with existing wrapper."
            )

        patch_config = {
            "rel_l1_thresh": float(rel_l1_thresh),
            "start_step": int(start_step),
            "end_step": int(end_step),
            "normalized_end_step": int(norm_end),
            "total_steps": int(total_steps),
            "model_id": id(m),
        }
        opts["teacache_config"] = patch_config

        def teacache_unet_wrapper(apply_model: Any, kwargs: Dict[str, Any]) -> Any:
            session = _teacache_mod.get_active_session()
            if session is None:
                raise RuntimeError(
                    "TeaCache model wrapper called without an active execution session"
                )
            if session.model_id != patch_config["model_id"]:
                raise RuntimeError(
                    f"TeaCacheSession model_id mismatch: session bound to {session.model_id}, "
                    f"wrapper called on {patch_config['model_id']}"
                )
            if round(session.rel_l1_thresh, 4) != round(patch_config["rel_l1_thresh"], 4):
                raise RuntimeError("TeaCacheSession rel_l1_thresh does not match patched model config")
            if session.start_step != patch_config["start_step"] or session.end_step != patch_config["normalized_end_step"]:
                raise RuntimeError("TeaCacheSession step window does not match patched model config")
            if session.total_steps != patch_config["total_steps"]:
                raise RuntimeError("TeaCacheSession total_steps does not match patched model config")
            return session.evaluate(apply_model, kwargs)

        teacache_unet_wrapper._cco_teacache = True
        teacache_unet_wrapper._teacache_module = _teacache_mod
        teacache_unet_wrapper._teacache_config = patch_config

        if hasattr(m, "set_model_unet_function_wrapper"):
            m.set_model_unet_function_wrapper(teacache_unet_wrapper)
        else:
            opts["model_function_wrapper"] = teacache_unet_wrapper

        return (m,)


NODE_CLASS_MAPPINGS = {
    "CCOMiniMaxH3TeaCache": CCOMiniMaxH3TeaCacheNode,
    "MiniMaxH3TeaCache": CCOMiniMaxH3TeaCacheNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CCOMiniMaxH3TeaCache": "MiniMax-H3 TeaCache (CCO Adapted)",
    "MiniMaxH3TeaCache": "MiniMax-H3 TeaCache (Upstream Compatibility)",
}
