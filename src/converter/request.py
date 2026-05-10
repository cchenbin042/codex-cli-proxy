"""Request converter: Codex CLI body → DeepSeek API body."""
import logging

from src import store

_logger = logging.getLogger("cli-proxy")


def convert_request(body: dict, model_map: dict, session_id: str = "",
                     thinking_disabled: bool = False) -> dict:
    """Convert a Codex CLI request body into a DeepSeek-compatible format."""

    reasoning_store = store.get(session_id)

    messages = []

    # instructions → system first message
    instructions = body.get("instructions")
    if instructions is None:
        instructions = "You are a helpful assistant."
    messages.append({"role": "system", "content": instructions})

    # input[] → messages[]
    # Consecutive assistant items (message + function_calls from one turn) are
    # merged into a single DeepSeek message with combined tool_calls.
    assistant_idx = 0
    buf = None  # buffered assistant message being built
    for item in body.get("input", []):
        msg = _convert_input_item(item)
        if msg is None:
            continue

        if msg.get("role") == "assistant":
            if buf is None:
                buf = {"role": "assistant", "content": msg.get("content", ""), "tool_calls": []}
                has_r = assistant_idx < len(reasoning_store) and reasoning_store[assistant_idx]
                if has_r:
                    buf["reasoning_content"] = reasoning_store[assistant_idx]
                _logger.debug("assistant turn=%d has_reasoning=%s store_len=%d session=%s",
                              assistant_idx, bool(has_r), len(reasoning_store), session_id)
            # Merge tool_calls from function_call items
            for tc in msg.get("tool_calls") or []:
                buf["tool_calls"].append(tc)
            # If this is a message item with non-empty content, use it
            if msg.get("content"):
                buf["content"] = msg["content"]
        else:
            if buf is not None:
                if not buf["tool_calls"]:
                    del buf["tool_calls"]
                if not buf["content"] and "tool_calls" not in buf:
                    buf["content"] = ""
                messages.append(buf)
                buf = None
                assistant_idx += 1
            messages.append(msg)

    if buf is not None:
        if not buf["tool_calls"]:
            del buf["tool_calls"]
        if not buf["content"] and "tool_calls" not in buf:
            buf["content"] = ""
        messages.append(buf)
        assistant_idx += 1

    _logger.debug("convert_request: %d messages, %d assistant_turns, store_len=%d session=%s",
                  len(messages), assistant_idx, len(reasoning_store), session_id)

    # New conversation detected (Codex reused session_id for a fresh window):
    # no assistant turns but store has stale entries — reset it.
    if assistant_idx == 0 and reasoning_store:
        store.reset(session_id)
        reasoning_store = store.get(session_id)

    # model mapping
    model_name = body.get("model", "")
    model = model_map.get(model_name, model_name)

    payload = {
        "model": model,
        "messages": messages,
        "stream": body.get("stream", False),
    }

    # passthrough fields
    for codex_field, ds_field in [
        ("tools", "tools"),
        ("tool_choice", "tool_choice"),
        ("temperature", "temperature"),
        ("max_output_tokens", "max_tokens"),
    ]:
        if codex_field in body:
            value = body[codex_field]
            # Filter tools: only keep function-type tools (DeepSeek doesn't support
            # web_search, code_interpreter, or other non-function tool types)
            if codex_field == "tools" and isinstance(value, list):
                _logger.info("Tools before filter: %s", [t.get("type") for t in value])
                filtered = []
                for t in value:
                    if t.get("type") == "function":
                        # Codex Responses API sends flat tools: {type, name, description, parameters}
                        # DeepSeek needs nested: {type, function: {name, description, parameters}}
                        if "function" not in t:
                            filtered.append({
                                "type": "function",
                                "function": {
                                    "name": t.get("name", ""),
                                    "description": t.get("description", ""),
                                    "parameters": t.get("parameters", {}),
                                },
                            })
                        else:
                            filtered.append(t)
                value = filtered
                _logger.info("Tools after filter: %d", len(value))
                if not value:
                    continue  # skip empty tools array
            payload[ds_field] = value

    if thinking_disabled:
        payload["thinking"] = {"type": "disabled"}

    return payload


def _convert_input_item(item: dict) -> dict | None:
    item_type = item.get("type")
    if item_type == "message":
        return _convert_message(item)
    elif item_type == "function_call":
        return _convert_function_call(item)
    elif item_type == "function_call_output":
        return _convert_function_call_output(item)
    elif item_type == "reasoning":
        return None
    else:
        if item_type is not None:
            _logger.warning("Unknown input type '%s', skipping", item_type)
        return None


def _convert_message(item: dict) -> dict:
    role = item.get("role", "user")
    if role == "developer":
        role = "system"

    content_blocks = item.get("content")
    if content_blocks is None:
        content = ""
    else:
        parts = []
        for block in content_blocks:
            if isinstance(block, dict) and block.get("type") == "input_text":
                text = block.get("text", "")
                if text:
                    parts.append(text)
        content = "\n".join(parts)

    return {"role": role, "content": content}


def _convert_function_call(item: dict) -> dict:
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": item.get("call_id", ""),
                "type": "function",
                "function": {
                    "name": item.get("name", ""),
                    "arguments": item.get("arguments", ""),
                },
            },
        ],
    }


def _convert_function_call_output(item: dict) -> dict:
    return {
        "role": "tool",
        "tool_call_id": item.get("call_id", ""),
        "content": item.get("output", ""),
    }
