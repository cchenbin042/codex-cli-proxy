"""Tests for request converter module."""
import pytest
from src.converter.request import (
    convert_request,
    _convert_message,
    _convert_function_call,
    _convert_function_call_output,
    _convert_input_item,
)


class TestConvertMessage:
    def test_user_message(self):
        item = {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "Hello, world!"}],
        }
        result = _convert_message(item)
        assert result == {"role": "user", "content": "Hello, world!"}

    def test_developer_maps_to_system(self):
        item = {
            "type": "message",
            "role": "developer",
            "content": [{"type": "input_text", "text": "You are an expert."}],
        }
        result = _convert_message(item)
        assert result == {"role": "system", "content": "You are an expert."}

    def test_assistant_role_preserved(self):
        item = {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "input_text", "text": "I can help with that."}],
        }
        result = _convert_message(item)
        assert result == {"role": "assistant", "content": "I can help with that."}

    def test_multiple_text_blocks_merged(self):
        item = {
            "type": "message",
            "role": "user",
            "content": [
                {"type": "input_text", "text": "First part."},
                {"type": "input_text", "text": "Second part."},
            ],
        }
        result = _convert_message(item)
        assert result == {"role": "user", "content": "First part.\nSecond part."}

    def test_null_content_uses_empty_string(self):
        item = {
            "type": "message",
            "role": "user",
            "content": None,
        }
        result = _convert_message(item)
        assert result == {"role": "user", "content": ""}

    def test_empty_content_array(self):
        item = {
            "type": "message",
            "role": "user",
            "content": [],
        }
        result = _convert_message(item)
        assert result == {"role": "user", "content": ""}


class TestConvertFunctionCall:
    def test_basic_function_call(self):
        item = {
            "type": "function_call",
            "call_id": "call_abc123",
            "name": "get_weather",
            "arguments": '{"location": "NYC"}',
        }
        result = _convert_function_call(item)
        assert result["role"] == "assistant"
        assert result["content"] is None
        assert len(result["tool_calls"]) == 1
        tc = result["tool_calls"][0]
        assert tc["id"] == "call_abc123"
        assert tc["type"] == "function"
        assert tc["function"]["name"] == "get_weather"
        assert tc["function"]["arguments"] == '{"location": "NYC"}'


class TestConvertFunctionCallOutput:
    def test_basic_output(self):
        item = {
            "type": "function_call_output",
            "call_id": "call_abc123",
            "output": "Sunny, 22C",
        }
        result = _convert_function_call_output(item)
        assert result == {
            "role": "tool",
            "tool_call_id": "call_abc123",
            "content": "Sunny, 22C",
        }


class TestConvertInstructions:
    def test_instructions_becomes_system_message(self):
        body = {
            "instructions": "You are a math tutor.",
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert result["messages"][0] == {
            "role": "system",
            "content": "You are a math tutor.",
        }

    def test_null_instructions_uses_default(self):
        body = {
            "instructions": None,
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert result["messages"][0] == {
            "role": "system",
            "content": "You are a helpful assistant.",
        }

    def test_missing_instructions_uses_default(self):
        body = {
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert result["messages"][0] == {
            "role": "system",
            "content": "You are a helpful assistant.",
        }

    def test_empty_input_only_system_message(self):
        body = {
            "instructions": "Be concise.",
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert len(result["messages"]) == 1
        assert result["messages"][0]["role"] == "system"


class TestTypeSkipping:
    def test_reasoning_skipped(self):
        body = {
            "instructions": "You are helpful.",
            "input": [
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hi"}]},
                {"type": "reasoning", "content": "Let me think..."},
            ],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert len(result["messages"]) == 2  # system + 1 user, reasoning skipped

    def test_unknown_type_skipped(self):
        body = {
            "instructions": "You are helpful.",
            "input": [
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hi"}]},
                {"type": "unknown_xyz", "data": "something"},
            ],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert len(result["messages"]) == 2  # system + 1 user, unknown skipped


class TestFieldPassthrough:
    def test_model_mapped(self):
        body = {
            "model": "gpt-5.5",
            "input": [],
        }
        model_map = {"gpt-5.5": "deepseek-v4-pro"}
        result = convert_request(body, model_map)
        assert result["model"] == "deepseek-v4-pro"

    def test_model_unmatched_passthrough(self):
        body = {
            "model": "unknown-model",
            "input": [],
        }
        model_map = {"gpt-5.5": "deepseek-v4-pro"}
        result = convert_request(body, model_map)
        assert result["model"] == "unknown-model"

    def test_tools_passthrough(self):
        tools = [{"type": "function", "function": {"name": "search"}}]
        body = {
            "tools": tools,
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert result["tools"] == tools

    def test_tool_choice_passthrough(self):
        body = {
            "tool_choice": "auto",
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert result["tool_choice"] == "auto"

    def test_temperature_passthrough(self):
        body = {
            "temperature": 0.7,
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert result["temperature"] == 0.7

    def test_max_output_tokens_passthrough(self):
        body = {
            "max_output_tokens": 1024,
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert result["max_tokens"] == 1024

    def test_stream_passthrough(self):
        body = {
            "stream": True,
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert result["stream"] is True

    def test_stream_false_by_default(self):
        body = {
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert result["stream"] is False

    def test_reasoning_field_dropped(self):
        body = {
            "reasoning": {"effort": "high"},
            "input": [],
        }
        model_map = {}
        result = convert_request(body, model_map)
        assert "reasoning" not in result

    def test_tools_filters_non_function_types(self):
        """Non-function tools (web_search, etc.) should be removed."""
        tools = [
            {"type": "web_search_preview"},
            {"type": "function", "function": {"name": "shell", "parameters": {}}},
            {"type": "code_interpreter"},
        ]
        body = {"tools": tools, "input": []}
        result = convert_request(body, {})
        assert len(result["tools"]) == 1
        assert result["tools"][0]["type"] == "function"

    def test_tools_all_filtered_skips_field(self):
        """When all tools are non-function, tools field should be absent."""
        tools = [{"type": "web_search_preview"}, {"type": "image_generation"}]
        body = {"tools": tools, "input": []}
        result = convert_request(body, {})
        assert "tools" not in result

    def test_flat_tools_wrapped_to_nested(self):
        """Responses API flat tools converted to nested function format."""
        tools = [
            {"type": "function", "name": "shell",
             "description": "Run a command", "parameters": {"type": "object"}},
        ]
        body = {"tools": tools, "input": []}
        result = convert_request(body, {})
        assert len(result["tools"]) == 1
        t = result["tools"][0]
        assert t["type"] == "function"
        assert t["function"]["name"] == "shell"
        assert t["function"]["description"] == "Run a command"
        assert t["function"]["parameters"] == {"type": "object"}


class TestReasoningContent:
    """Tests for reasoning_content attachment / index alignment."""

    SID = "test-session-123"

    def teardown_method(self):
        """Clean up module-level state between tests."""
        from src import store
        store._stores.pop(self.SID, None)

    def test_consecutive_assistant_items_share_reasoning(self):
        """message + function_call from the same turn share one reasoning entry."""
        from src import store

        store.get(self.SID).clear()
        store.get(self.SID).append("DeepSeek was thinking...")

        body = {
            "instructions": "Be helpful.",
            "input": [
                {"type": "message", "role": "user",
                 "content": [{"type": "input_text", "text": "Hi"}]},
                # Same turn: text + tool_call — should share one reasoning entry
                {"type": "message", "role": "assistant",
                 "content": [{"type": "input_text", "text": "Let me check."}]},
                {"type": "function_call", "call_id": "c1", "name": "search",
                 "arguments": '{"q": "x"}'},
                {"type": "function_call_output", "call_id": "c1",
                 "output": "result"},
                # Next turn: another assistant, needs own reasoning
                {"type": "message", "role": "assistant",
                 "content": [{"type": "input_text", "text": "The answer is 42."}]},
            ],
        }
        result = convert_request(body, {}, self.SID)

        # Merged assistant message (text + function_call) gets reasoning_content
        assert result["messages"][2].get("reasoning_content") == "DeepSeek was thinking..."
        assert result["messages"][2]["role"] == "assistant"
        assert result["messages"][2]["content"] == "Let me check."
        assert len(result["messages"][2]["tool_calls"]) == 1
        assert result["messages"][2]["tool_calls"][0]["function"]["name"] == "search"

        # Tool result follows (no reasoning)
        assert result["messages"][3]["role"] == "tool"

        # The second-turn assistant should NOT get reasoning (no second entry in store)
        assert "reasoning_content" not in result["messages"][4]

    def test_standalone_function_call_gets_own_reasoning(self):
        """function_call without preceding assistant message gets its own reasoning."""
        from src import store

        store.get(self.SID).clear()
        store.get(self.SID).extend(["reasoning turn 1", "reasoning turn 2"])

        body = {
            "instructions": "Be helpful.",
            "input": [
                {"type": "message", "role": "user",
                 "content": [{"type": "input_text", "text": "Search."}]},
                {"type": "function_call", "call_id": "c1", "name": "search",
                 "arguments": '{}'},
                {"type": "function_call_output", "call_id": "c1",
                 "output": "r1"},
                {"type": "function_call", "call_id": "c2", "name": "search",
                 "arguments": '{}'},
                {"type": "function_call_output", "call_id": "c2",
                 "output": "r2"},
            ],
        }
        result = convert_request(body, {}, self.SID)

        assert result["messages"][2].get("reasoning_content") == "reasoning turn 1"
        assert result["messages"][4].get("reasoning_content") == "reasoning turn 2"


class TestFullConversion:
    def test_complete_multi_turn(self):
        body = {
            "model": "gpt-5.5",
            "instructions": "You are a helpful assistant.",
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "What is the weather in NYC?"}],
                },
                {
                    "type": "function_call",
                    "call_id": "call_123",
                    "name": "get_weather",
                    "arguments": '{"location": "NYC"}',
                },
                {
                    "type": "function_call_output",
                    "call_id": "call_123",
                    "output": "Sunny, 22C",
                },
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "input_text", "text": "The weather in NYC is sunny, 22C."}],
                },
            ],
        }
        model_map = {"gpt-5.5": "deepseek-v4-pro"}
        result = convert_request(body, model_map)

        assert result["model"] == "deepseek-v4-pro"
        assert len(result["messages"]) == 5  # system + 4 input items

        # System message
        assert result["messages"][0] == {
            "role": "system",
            "content": "You are a helpful assistant.",
        }

        # User message
        assert result["messages"][1] == {
            "role": "user",
            "content": "What is the weather in NYC?",
        }

        # Function call → assistant + tool_calls
        assert result["messages"][2]["role"] == "assistant"
        assert result["messages"][2]["content"] is None
        assert result["messages"][2]["tool_calls"][0]["function"]["name"] == "get_weather"

        # Function call output → tool
        assert result["messages"][3] == {
            "role": "tool",
            "tool_call_id": "call_123",
            "content": "Sunny, 22C",
        }

        # Assistant message
        assert result["messages"][4] == {
            "role": "assistant",
            "content": "The weather in NYC is sunny, 22C.",
        }
