"""Request converter: Codex CLI body → DeepSeek API body."""
import logging

_logger = logging.getLogger("cli-proxy")


def convert_request(body: dict, model_map: dict) -> dict:
    """Convert a Codex CLI request body into a DeepSeek-compatible format."""
    messages = []

    # instructions → system first message
    instructions = body.get("instructions")
    if instructions is None:
        instructions = "You are a helpful assistant."
    messages.append({"role": "system", "content": instructions})

    # input[] → messages[]
    for item in body.get("input", []):
        msg = _convert_input_item(item)
        if msg is not None:
            messages.append(msg)

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
            payload[ds_field] = body[codex_field]

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
