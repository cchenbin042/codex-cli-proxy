"""Base class for LLM API providers with common OpenAI-compatible logic."""

import json
import logging
from typing import AsyncGenerator

import httpx

_logger = logging.getLogger("cli-proxy")


class BaseProvider:
    """LLM API provider with OpenAI-compatible chat completions endpoint.

    Handles both streaming and non-streaming requests, with round-robin
    API key rotation for multi-key configurations.
    """

    def __init__(self, api_base: str, api_keys: list[str], provider_name: str = ""):
        self.api_base = api_base.rstrip("/")
        self.api_keys = list(api_keys) if api_keys else []
        self._key_index = 0
        self.name = provider_name

    def get_api_key(self) -> str:
        """Round-robin API key rotation. Returns "" if no keys configured."""
        if not self.api_keys:
            return ""
        key = self.api_keys[self._key_index % len(self.api_keys)]
        self._key_index += 1
        return key

    async def chat_completions(
        self, payload: dict, http_client: httpx.AsyncClient
    ) -> httpx.Response:
        """Send a non-streaming chat completion request.

        Returns the raw httpx.Response for the caller to inspect status/headers.
        """
        url = f"{self.api_base}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.get_api_key()}",
            "Content-Type": "application/json",
        }
        return await http_client.post(url, headers=headers, json=payload)

    async def stream_chat_completions(
        self, payload: dict, http_client: httpx.AsyncClient
    ) -> AsyncGenerator[str, None]:
        """Stream vendor SSE data lines (one "data: ..." per yield).

        The caller is responsible for parsing the lines and handling the
        state machine. Yields an error SSE line on upstream 4xx/5xx.
        """
        url = f"{self.api_base}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.get_api_key()}",
            "Content-Type": "application/json",
        }

        async with http_client.stream(
            "POST", url, headers=headers, json=payload
        ) as response:
            if response.status_code >= 400:
                error_body = await response.aread()
                error_text = error_body.decode("utf-8", errors="replace")[:500]
                _logger.error("%s %s error: %s", self.name, response.status_code, error_text)
                yield f"data: {json.dumps({'type': 'error', 'error': {'code': f'upstream_{response.status_code}', 'message': error_text}})}"
                return

            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    yield line


def resolve_provider(
    model: str,
    model_map: dict[str, str],
    providers: dict[str, "BaseProvider"],
    default_provider: str = "deepseek",
) -> tuple["BaseProvider", str]:
    """Resolve a model name to a (provider_instance, vendor_model_name) pair.

    Model map values use the format "provider:model", e.g.:
        "gpt-5.5": "deepseek:deepseek-v4-pro"
        "qwen3-max": "qwen:qwen-max"

    If no provider prefix is found, default_provider is used.
    If the model is not in model_map, it is passed through as-is.
    """
    mapped = model_map.get(model, model)

    if ":" in mapped:
        provider_name, vendor_model = mapped.split(":", 1)
    else:
        provider_name = default_provider
        vendor_model = mapped

    if provider_name not in providers:
        provider_name = default_provider

    return providers[provider_name], vendor_model
