"""Qwen (Tongyi Qianwen / DashScope) provider.

Uses the OpenAI-compatible chat completions endpoint.
API doc: https://help.aliyun.com/zh/model-studio/
"""

from src.providers.base import BaseProvider


class QwenProvider(BaseProvider):
    """Provider for Alibaba Cloud DashScope (Qwen series)."""

    def __init__(self, api_base: str, api_keys: list[str]):
        super().__init__(api_base, api_keys, provider_name="Qwen")
