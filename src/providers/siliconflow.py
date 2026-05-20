"""SiliconFlow provider.

Uses the OpenAI-compatible chat completions endpoint.
API doc: https://docs.siliconflow.cn/
"""

from src.providers.base import BaseProvider


class SiliconFlowProvider(BaseProvider):
    """Provider for SiliconFlow platform."""

    def __init__(self, api_base: str, api_keys: list[str]):
        super().__init__(api_base, api_keys, provider_name="SiliconFlow")
