"""Integration tests for FastAPI application entry point."""
import pytest
import httpx
from unittest.mock import MagicMock, AsyncMock, patch

# --- Mock config for integration tests ---
# Must run at import time (before importing src.main)
# so load_config() doesn't fail looking for config.yaml
from src.config import Config

test_config = Config(
    server_host="127.0.0.1",
    server_port=8317,
    api_base="https://api.deepseek.com",
    api_keys=["sk-test-mock-key"],
    model_map={"gpt-5.5": "deepseek-v4-pro"},
)

import src.config as config_mod
config_mod.load_config = MagicMock(return_value=test_config)

# Now safe to import the app
from src.main import app
from src.converter.response import _sse_event

from fastapi.testclient import TestClient

client = TestClient(app)


class TestNonStreamEndpoint:
    """Non-streaming endpoint tests."""

    def test_basic_nonstream_conversion(self):
        """Full non-streaming request with valid response structure."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Hello from DeepSeek!",
                },
            }],
            "usage": {"total_tokens": 15},
        }

        with patch("src.main.httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_resp

            response = client.post(
                "/v1/responses",
                json={
                    "model": "gpt-5.5",
                    "input": [
                        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hi"}]},
                    ],
                    "stream": False,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["object"] == "response"
        assert data["status"] == "completed"
        assert len(data["output"]) == 1
        assert data["output"][0]["type"] == "message"
        assert data["output"][0]["content"][0]["text"] == "Hello from DeepSeek!"

    def test_upstream_connection_error(self):
        """httpx.ConnectError returns 502 with upstream_unavailable."""
        with patch("src.main.httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.ConnectError("Connection refused")

            response = client.post(
                "/v1/responses",
                json={
                    "model": "gpt-5.5",
                    "input": [
                        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hi"}]},
                    ],
                },
            )

        assert response.status_code == 502
        data = response.json()
        assert data["type"] == "error"
        assert data["error"]["code"] == "upstream_unavailable"

    def test_upstream_400_error(self):
        """Upstream 4xx error is passed through."""
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.text = "Bad request from upstream"

        with patch("src.main.httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_resp

            response = client.post(
                "/v1/responses",
                json={
                    "model": "gpt-5.5",
                    "input": [
                        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hi"}]},
                    ],
                },
            )

        assert response.status_code == 400
        data = response.json()
        assert data["type"] == "error"
        assert data["error"]["code"] == "upstream_400"

    def test_invalid_json_body(self):
        """Invalid JSON body returns 400."""
        response = client.post(
            "/v1/responses",
            content=b"not valid json {",
            headers={"Content-Type": "application/json"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["type"] == "error"
        assert data["error"]["code"] == "invalid_request"


class TestStreamEndpoint:
    """Streaming endpoint tests."""

    def test_stream_response_media_type(self):
        """Stream response has content-type text/event-stream."""

        async def mock_event_stream(ds_payload, api_base, api_key, session_id=""):
            yield _sse_event("response.created", {"type": "response.created"})
            yield _sse_event("response.completed", {"type": "response.completed"})

        with patch("src.main.stream_generator", side_effect=mock_event_stream):
            with client.stream(
                "POST",
                "/v1/responses",
                json={
                    "model": "gpt-5.5",
                    "input": [
                        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hi"}]},
                    ],
                    "stream": True,
                },
            ) as response:
                content_type = response.headers.get("content-type", "")
                assert "text/event-stream" in content_type

    def test_stream_request_passes_stream_flag(self):
        """Verify stream=True is passed in the converted payload."""

        async def mock_event_stream(ds_payload, api_base, api_key, session_id=""):
            # Verify the stream flag is in the DeepSeek payload
            assert ds_payload["stream"] is True
            yield _sse_event("response.created", {"type": "response.created"})
            yield _sse_event("response.completed", {"type": "response.completed"})

        with patch("src.main.stream_generator", side_effect=mock_event_stream):
            with client.stream(
                "POST",
                "/v1/responses",
                json={
                    "model": "gpt-5.5",
                    "input": [
                        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hi"}]},
                    ],
                    "stream": True,
                },
            ) as response:
                # Consume the stream to trigger the generator
                response.read()
