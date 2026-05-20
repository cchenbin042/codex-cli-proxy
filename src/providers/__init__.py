"""Provider abstraction layer for multi-vendor LLM API support.

Each provider implements the BaseProvider protocol, handling both
streaming and non-streaming chat completions in its vendor-specific format.
"""

from src.providers.base import BaseProvider, resolve_provider
from src.providers.deepseek import DeepSeekProvider
from src.providers.qwen import QwenProvider
from src.providers.moonshot import MoonshotProvider
from src.providers.bailian import BailianProvider
from src.providers.siliconflow import SiliconFlowProvider

__all__ = [
    "BaseProvider",
    "resolve_provider",
    "DeepSeekProvider",
    "QwenProvider",
    "MoonshotProvider",
    "BailianProvider",
    "SiliconFlowProvider",
]
