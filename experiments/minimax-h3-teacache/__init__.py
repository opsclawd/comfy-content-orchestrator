"""
MiniMax-H3 TeaCache ComfyUI Custom Node Package (CCO Adapted)
Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
"""

try:
    from . import teacache as _teacache_mod
    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, CCOMiniMaxH3TeaCacheNode
    from .teacache import (
        TeaCacheSession,
        get_active_session,
        set_active_session,
        reset_active_session,
        SUPPORTED_THRESHOLDS,
    )
except ImportError:
    import teacache as _teacache_mod
    from nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, CCOMiniMaxH3TeaCacheNode
    from teacache import (
        TeaCacheSession,
        get_active_session,
        set_active_session,
        reset_active_session,
        SUPPORTED_THRESHOLDS,
    )

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "CCOMiniMaxH3TeaCacheNode",
    "TeaCacheSession",
    "get_active_session",
    "set_active_session",
    "reset_active_session",
    "SUPPORTED_THRESHOLDS",
]
