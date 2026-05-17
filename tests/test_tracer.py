"""Tests for trace ID middleware and logging integration."""
import pytest
import logging
import io
from unittest.mock import patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from src.tracer import generate_trace_id, get_trace_id, TraceMiddleware, _trace_id_ctx


class TestGenerateTraceId:
    """Tests for trace_id generation."""

    def test_format_starts_with_tr(self):
        """Trace ID should start with 'tr_' prefix."""
        tid = generate_trace_id()
        assert tid.startswith("tr_")

    def test_total_length_is_27(self):
        """Trace ID format: 'tr_' (3) + 24 hex chars = 27 total."""
        tid = generate_trace_id()
        assert len(tid) == 27

    def test_hex_part_is_lowercase_hex(self):
        """The random part should be lowercase hexadecimal."""
        tid = generate_trace_id()
        hex_part = tid[3:]
        assert len(hex_part) == 24
        assert all(c in "0123456789abcdef" for c in hex_part)

    def test_unique_on_each_call(self):
        """Each call should produce a different trace_id."""
        ids = {generate_trace_id() for _ in range(100)}
        assert len(ids) == 100


class TestContextVar:
    """Tests for the contextvar-based trace_id propagation."""

    def test_default_is_empty_string(self):
        """Without being set, get_trace_id() returns empty string."""
        _trace_id_ctx.set("")
        assert get_trace_id() == ""

    def test_set_and_get(self):
        """After setting the contextvar, get_trace_id() returns the value."""
        test_id = "tr_test1234567890abcdef012345"
        _trace_id_ctx.set(test_id)
        assert get_trace_id() == test_id
        _trace_id_ctx.set("")  # Cleanup


class TestTraceMiddleware:
    """Tests for the TraceMiddleware (integration via TestClient)."""

    def test_generates_trace_id_when_no_header(self):
        """When X-Trace-Id header is absent, middleware generates one."""
        test_app = FastAPI()
        test_app.add_middleware(TraceMiddleware)

        @test_app.get("/test")
        async def test_route(request: Request):
            return {"trace_id": request.state.trace_id}

        with TestClient(test_app) as client:
            response = client.get("/test")
            assert response.status_code == 200
            data = response.json()
            assert data["trace_id"].startswith("tr_")
            assert len(data["trace_id"]) == 27

    def test_reuses_trace_id_from_request_header(self):
        """When X-Trace-Id header is present, it should be reused."""
        test_app = FastAPI()
        test_app.add_middleware(TraceMiddleware)

        @test_app.get("/test")
        async def test_route(request: Request):
            return {"trace_id": request.state.trace_id}

        custom_id = "tr_custom1234567890abcdef012345"
        with TestClient(test_app) as client:
            response = client.get("/test", headers={"X-Trace-Id": custom_id})
            assert response.status_code == 200
            data = response.json()
            assert data["trace_id"] == custom_id

    def test_adds_x_trace_id_to_response(self):
        """Response should include X-Trace-Id header."""
        test_app = FastAPI()
        test_app.add_middleware(TraceMiddleware)

        @test_app.get("/test")
        async def test_route(request: Request):
            return {"ok": True}

        with TestClient(test_app) as client:
            response = client.get("/test")
            assert "X-Trace-Id" in response.headers
            assert response.headers["X-Trace-Id"].startswith("tr_")

    def test_response_x_trace_id_matches_request_state(self):
        """X-Trace-Id in response should match request.state.trace_id."""
        test_app = FastAPI()
        test_app.add_middleware(TraceMiddleware)

        @test_app.get("/test")
        async def test_route(request: Request):
            return {"trace_id": request.state.trace_id}

        with TestClient(test_app) as client:
            response = client.get("/test")
            assert response.headers["X-Trace-Id"] == response.json()["trace_id"]

    def test_trace_id_in_contextvar_during_request(self):
        """The contextvar should be set with the trace_id during request handling."""
        test_app = FastAPI()
        test_app.add_middleware(TraceMiddleware)

        @test_app.get("/test")
        async def test_route(request: Request):
            ctx_trace_id = get_trace_id()
            return {"state_trace_id": request.state.trace_id, "ctx_trace_id": ctx_trace_id}

        with TestClient(test_app) as client:
            response = client.get("/test")
            data = response.json()
            assert data["state_trace_id"] == data["ctx_trace_id"]
            assert data["ctx_trace_id"].startswith("tr_")

    def test_trace_id_integrated_with_logging(self):
        """Log output should include the trace_id when middleware is active."""
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)

        test_logger = logging.getLogger("cli-proxy-tracer-test")
        test_logger.setLevel(logging.DEBUG)
        test_logger.addHandler(handler)
        test_logger.propagate = False

        test_app = FastAPI()
        test_app.add_middleware(TraceMiddleware)

        @test_app.get("/test")
        async def test_route(request: Request):
            from src.logger import _log_with_trace
            _log_with_trace(test_logger, "Processing request")
            return {"ok": True}

        with TestClient(test_app) as client:
            response = client.get("/test", headers={"X-Trace-Id": "tr_test1234567890abcdef012345"})

        log_output = stream.getvalue()
        assert "tr_test1234567890abcdef012345" in log_output
        assert "Processing request" in log_output


class TestTraceMiddlewareMountedInMain:
    """Verify TraceMiddleware is mounted in the actual cli-proxy app."""

    def test_proxy_app_has_trace_middleware(self):
        """The main app should produce X-Trace-Id headers."""
        from src.config import Config

        test_cfg = Config(
            server_host="127.0.0.1",
            server_port=8317,
            api_base="https://api.deepseek.com",
            api_keys=["sk-test-key"],
            model_map={},
        )

        with patch("src.config.load_config", return_value=test_cfg):
            import importlib
            import src.main as main_mod
            importlib.reload(main_mod)
            app = main_mod.app

            with TestClient(app) as client:
                response = client.get("/health")
                assert "X-Trace-Id" in response.headers
                assert response.headers["X-Trace-Id"].startswith("tr_")
