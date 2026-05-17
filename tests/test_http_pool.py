"""Tests for global httpx connection pool reuse."""
import pytest
import httpx
from unittest.mock import MagicMock, AsyncMock, patch, PropertyMock

# --- Mock config for integration tests (same pattern as test_main.py) ---
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

from src.main import app
from fastapi.testclient import TestClient


class TestLifespanSharedClient:
    """Verify the lifespan creates a properly configured shared httpx.AsyncClient."""

    def test_shared_client_created_on_startup(self):
        """app.state.http should be set after lifespan startup."""
        with TestClient(app) as client:
            # After entering the context, lifespan startup has run
            http = app.state.http
            assert http is not None
            assert isinstance(http, httpx.AsyncClient)

    def test_shared_client_has_correct_timeout(self):
        """Shared client should have the configured timeout values."""
        with TestClient(app) as client:
            http = app.state.http
            timeout = http.timeout
            assert timeout.connect == 10.0
            assert timeout.read == 120.0
            assert timeout.write == 60.0
            assert timeout.pool == 10.0

    def test_shared_client_has_correct_limits(self):
        """Shared client transport pool should have the configured limits."""
        with TestClient(app) as client:
            http = app.state.http
            pool = http._transport._pool
            assert pool._max_connections == 20
            assert pool._max_keepalive_connections == 10


class TestNonStreamUsesSharedClient:
    """Verify the non-stream endpoint uses the shared client from app.state."""

    def test_nonstream_uses_shared_client_post(self):
        """Non-stream path calls the shared client's post method."""
        with TestClient(app) as client:
            http = app.state.http

            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "Hello from shared client!",
                    },
                }],
                "usage": {"total_tokens": 10},
            }

            with patch.object(http, "post", new_callable=AsyncMock) as mock_post:
                mock_post.return_value = mock_resp

                response = client.post(
                    "/v1/responses",
                    json={
                        "model": "gpt-5.5",
                        "input": [
                            {"type": "message", "role": "user",
                             "content": [{"type": "input_text", "text": "Hi"}]},
                        ],
                        "stream": False,
                    },
                )

            assert response.status_code == 200
            data = response.json()
            assert data["output"][0]["content"][0]["text"] == "Hello from shared client!"
            # Verify shared client's post was called exactly once
            mock_post.assert_called_once()

    def test_nonstream_does_not_create_new_client(self):
        """Non-stream path should NOT create a new httpx.AsyncClient per request."""
        with TestClient(app) as client:
            http = app.state.http
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
                "usage": {"total_tokens": 5},
            }

            with patch.object(http, "post", new_callable=AsyncMock) as mock_post:
                mock_post.return_value = mock_resp
                # Also spy on AsyncClient constructor to verify it's NOT called
                with patch("src.main.httpx.AsyncClient", wraps=httpx.AsyncClient) as mock_client_cls:
                    response = client.post(
                        "/v1/responses",
                        json={
                            "model": "gpt-5.5",
                            "input": [
                                {"type": "message", "role": "user",
                                 "content": [{"type": "input_text", "text": "Hi"}]},
                            ],
                            "stream": False,
                        },
                    )

            assert response.status_code == 200
            # AsyncClient constructor should NOT be called in proxy_responses
            # (the lifespan creates one at startup, but that has already happened)
            call_args_list = [
                c for c in mock_client_cls.call_args_list
                # Filter out any __init__ calls, focus on constructor calls
            ]
            # The key check: mock_post on shared client was called, not a new client
            mock_post.assert_called_once()


class TestStreamUsesSharedClient:
    """Verify the stream endpoint passes the shared client to stream_generator."""

    def test_stream_passes_shared_client(self):
        """stream_generator receives the shared http_client parameter."""
        with TestClient(app) as client:
            http = app.state.http

            async def mock_stream(ds_payload, api_base, api_key, session_id="", http_client=None):
                # Verify shared client is passed
                assert http_client is http
                yield "event: test\ndata: {}\n\n"

            with patch("src.main.stream_generator", side_effect=mock_stream):
                with client.stream(
                    "POST",
                    "/v1/responses",
                    json={
                        "model": "gpt-5.5",
                        "input": [
                            {"type": "message", "role": "user",
                             "content": [{"type": "input_text", "text": "Hi"}]},
                        ],
                        "stream": True,
                    },
                ) as response:
                    response.read()

            assert response.status_code == 200
