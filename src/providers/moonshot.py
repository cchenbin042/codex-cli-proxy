"""Moonshot (Kimi) provider.

Uses the OpenAI-compatible chat completions endpoint.
API doc: https://platform.moonshot.cn/docs/
"""

from src.providers.base import BaseProvider


class MoonshotProvider(BaseProvider):
    """Provider for Moonshot / Kimi API."""

    def __init__(self, api_base: str, api_keys: list[str]):
        super().__init__(api_base, api_keys, provider_name="Moonshot")
