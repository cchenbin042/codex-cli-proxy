"""Bailian (Alibaba Cloud Bailian) provider.

Uses the OpenAI-compatible chat completions endpoint.
API doc: https://help.aliyun.com/zh/model-studio/bailian
"""

from src.providers.base import BaseProvider


class BailianProvider(BaseProvider):
    """Provider for Alibaba Cloud Bailian platform."""

    def __init__(self, api_base: str, api_keys: list[str]):
        super().__init__(api_base, api_keys, provider_name="Bailian")
