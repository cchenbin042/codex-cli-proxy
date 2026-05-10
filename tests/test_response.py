"""Tests for response converter module."""
import pytest
from src.converter.response import convert_nonstream, stream_generator, _gen_id, _sse_event


class TestConvertNonstream:
    """Non-streaming conversion tests."""

    def test_with_text_content(self):
        """DeepSeek returns plain text, output[0] is type='message' with output_text."""
        ds_resp = {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Hello, how can I help you?",
                },
            }],
            "usage": {"total_tokens": 20},
        }
        result = convert_nonstream(ds_resp)
        assert result["object"] == "response"
        assert result["status"] == "completed"
        assert len(result["output"]) == 1
        assert result["output"][0]["type"] == "message"
        assert result["output"][0]["role"] == "assistant"
        assert result["output"][0]["content"] == [
            {"type": "output_text", "text": "Hello, how can I help you?"}
        ]

    def test_with_tool_calls_no_text(self):
        """Only tool_calls without text, output[0] is type='function_call'."""
        ds_resp = {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_abc123",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": '{"location": "NYC"}',
                        },
                    }],
                },
            }],
            "usage": {"total_tokens": 30},
        }
        result = convert_nonstream(ds_resp)
        assert len(result["output"]) == 1
        assert result["output"][0]["type"] == "function_call"
        assert result["output"][0]["call_id"] == "call_abc123"
        assert result["output"][0]["name"] == "get_weather"
        assert result["output"][0]["arguments"] == '{"location": "NYC"}'

    def test_with_both_text_and_tool_calls(self):
        """Both text and tool_calls: text output first, function_call second."""
        ds_resp = {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Let me check the weather.",
                    "tool_calls": [{
                        "id": "call_abc123",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": '{"location": "NYC"}',
                        },
                    }],
                },
            }],
        }
        result = convert_nonstream(ds_resp)
        assert len(result["output"]) == 2
        assert result["output"][0]["type"] == "message"
        assert result["output"][0]["content"][0]["text"] == "Let me check the weather."
        assert result["output"][1]["type"] == "function_call"
        assert result["output"][1]["name"] == "get_weather"

    def test_empty_choices(self):
        """Empty choices array generates a single empty text output item."""
        ds_resp = {"choices": []}
        result = convert_nonstream(ds_resp)
        assert len(result["output"]) == 1
        assert result["output"][0]["type"] == "message"
        assert result["output"][0]["role"] == "assistant"
        assert result["output"][0]["content"] == [{"type": "output_text", "text": ""}]

    def test_multiple_tool_calls(self):
        """Multiple tool_calls each generate an independent output item."""
        ds_resp = {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_001",
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "arguments": '{"location": "NYC"}',
                            },
                        },
                        {
                            "id": "call_002",
                            "type": "function",
                            "function": {
                                "name": "get_time",
                                "arguments": '{"timezone": "EST"}',
                            },
                        },
                    ],
                },
            }],
        }
        result = convert_nonstream(ds_resp)
        assert len(result["output"]) == 2
        assert result["output"][0]["type"] == "function_call"
        assert result["output"][0]["name"] == "get_weather"
        assert result["output"][1]["type"] == "function_call"
        assert result["output"][1]["name"] == "get_time"

    def test_response_id_consistent(self):
        """response_id starts with 'resp_'."""
        ds_resp = {"choices": [{"message": {"role": "assistant", "content": "Hi"}}]}
        result = convert_nonstream(ds_resp)
        assert result["id"].startswith("resp_")

    def test_output_items_have_unique_ids(self):
        """Multiple output item IDs are unique."""
        ds_resp = {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Let me help.",
                    "tool_calls": [
                        {
                            "id": "call_001",
                            "type": "function",
                            "function": {"name": "f1", "arguments": "{}"},
                        },
                        {
                            "id": "call_002",
                            "type": "function",
                            "function": {"name": "f2", "arguments": "{}"},
                        },
                    ],
                },
            }],
        }
        result = convert_nonstream(ds_resp)
        ids = [item["id"] for item in result["output"]]
        assert len(ids) == len(set(ids)), f"Duplicate ids found: {ids}"


class TestHelpers:
    """Tests for helper functions."""

    def test_gen_id(self):
        """_gen_id returns a string starting with the given prefix, unique per call."""
        id1 = _gen_id("resp_")
        id2 = _gen_id("resp_")
        assert id1.startswith("resp_")
        assert id2.startswith("resp_")
        assert id1 != id2

    def test_sse_event_format(self):
        """SSE format: starts with 'event: ...\\n', contains 'data: ', ends with '\\n\\n'."""
        event = _sse_event("response.created", {"type": "response.created", "id": "abc"})
        assert event.startswith("event: response.created\n")
        assert event.endswith("\n\n")
        assert "data: " in event


class TestStreamGenerator:
    """Tests for the SSE stream generator using mocked httpx."""

    @pytest.fixture
    def ds_payload(self):
        return {
            "model": "deepseek-v4-pro",
            "messages": [
                {"role": "system", "content": "You are helpful."},
                {"role": "user", "content": "hi"},
            ],
            "stream": True,
        }

    # -----------------------------------------------------------------
    # helpers
    # -----------------------------------------------------------------

    @staticmethod
    def _make_client(status_code=200, aiter_lines=None, aread_body=None):
        """Build a mocked httpx.AsyncClient for use inside stream_generator."""
        from unittest.mock import AsyncMock, MagicMock

        # --- Response mock ---
        mock_response = AsyncMock()
        mock_response.status_code = status_code
        if aiter_lines is not None:
            mock_response.aiter_lines = aiter_lines
        if aread_body is not None:
            mock_response.aread = AsyncMock(return_value=aread_body)

        # --- Stream context manager (returned by client.stream(...)) ---
        stream_ctx = MagicMock()
        stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
        stream_ctx.__aexit__ = AsyncMock(return_value=None)

        # --- Client mock ---
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.stream = MagicMock(return_value=stream_ctx)

        return mock_client

    @staticmethod
    async def _collect_events(ds_payload, mock_client):
        """Run stream_generator with a patched httpx.AsyncClient, collect all SSE strings."""
        from unittest.mock import patch

        events = []
        with patch("src.converter.response.httpx.AsyncClient", return_value=mock_client):
            async for event in stream_generator(
                ds_payload, "https://api.test.com", "sk-test"
            ):
                events.append(event)
        return events

    @staticmethod
    def _event_names(events):
        """Extract ordered 'event:' names from a list of SSE strings."""
        names = []
        for e in events:
            if e.startswith("event: "):
                for line in e.strip().split("\n"):
                    if line.startswith("event: "):
                        names.append(line[7:])
        return names

    # -----------------------------------------------------------------
    # tests
    # -----------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_text_only_stream(self, ds_payload):
        """Simulate DeepSeek returning text-only stream."""

        async def _lines():
            for line in [
                'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}',
                'data: {"choices":[{"delta":{"content":"Hello"}}]}',
                'data: {"choices":[{"delta":{"content":" world"}}]}',
                "data: [DONE]",
            ]:
                yield line

        mock_client = self._make_client(status_code=200, aiter_lines=_lines)
        events = await self._collect_events(ds_payload, mock_client)
        names = self._event_names(events)

        assert "response.created" in names
        assert "response.in_progress" in names
        assert "response.output_item.added" in names
        assert "response.content_part.added" in names
        assert "response.output_text.delta" in names
        assert names[-1] == "response.completed"

        deltas = [e for e in events if "response.output_text.delta" in e]
        assert len(deltas) >= 2

    @pytest.mark.asyncio
    async def test_upstream_error_stream(self, ds_payload):
        """Simulate upstream returning 500."""
        mock_client = self._make_client(
            status_code=500, aread_body=b"Internal Server Error"
        )
        events = await self._collect_events(ds_payload, mock_client)
        names = self._event_names(events)

        assert "error" in names, f"Expected error event, got: {names}"
        assert "response.completed" not in names

    @pytest.mark.asyncio
    async def test_tool_call_stream(self, ds_payload):
        """Simulate DeepSeek returning a tool call delta."""

        async def _lines():
            for line in [
                'data: {"choices":[{"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_ds_1","type":"function","function":{"name":"shell","arguments":""}}]}}]}',
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"ls\\"}"}}]}}]}',
                'data: {"choices":[{"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}',
                "data: [DONE]",
            ]:
                yield line

        mock_client = self._make_client(status_code=200, aiter_lines=_lines)
        events = await self._collect_events(ds_payload, mock_client)

        # function_call output_item.added
        has_func_call = any(
            "response.output_item.added" in e and "function_call" in e for e in events
        )
        assert has_func_call, "Expected function_call output_item.added event"

        # function_call_arguments.delta
        has_args_delta = any(
            "response.function_call_arguments.delta" in e for e in events
        )
        assert has_args_delta, "Expected function_call_arguments.delta event"

    @pytest.mark.asyncio
    async def test_completed_includes_usage(self, ds_payload):
        """Verify usage from last chunk appears in completed event."""

        async def _lines():
            for line in [
                'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}',
                "data: [DONE]",
            ]:
                yield line

        mock_client = self._make_client(status_code=200, aiter_lines=_lines)
        events = await self._collect_events(ds_payload, mock_client)

        last = events[-1]
        assert "response.completed" in last
        assert '"total_tokens":6' in last or '"total_tokens": 6' in last
