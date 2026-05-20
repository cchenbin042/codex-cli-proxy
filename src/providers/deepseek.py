"""DeepSeek Chat Completions provider."""

from src.providers.base import BaseProvider


class DeepSeekProvider(BaseProvider):
    """Provider for DeepSeek API (https://api.deepseek.com)."""

    def __init__(self, api_base: str, api_keys: list[str]):
        super().__init__(api_base, api_keys, provider_name="DeepSeek")
