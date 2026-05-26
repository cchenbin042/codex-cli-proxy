"""Convert DeepSeek Chat Completions response to Codex Responses format."""

import json
import uuid
import logging
from typing import AsyncGenerator

import httpx

from src import store


_logger = logging.getLogger("cli-proxy")


def _gen_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def convert_nonstream(ds_resp: dict, session_id: str = "") -> dict:
    """Convert non-streaming DeepSeek Chat Completion to Codex Response."""
    response_id = _gen_id("resp_")
    output = []

    choices = ds_resp.get("choices", [])
    if choices:
        msg = choices[0].get("message", {})
        content = msg.get("content")
        tool_calls = msg.get("tool_calls") or []

        reasoning = msg.get("reasoning_content") or ""
        store.append(session_id, reasoning)

        if content:
            output.append({
                "id": _gen_id("item_msg_"),
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": content}],
            })

        for tc in tool_calls:
            output.append({
                "id": tc.get("id", _gen_id("call_")),
                "type": "function_call",
                "call_id": tc.get("id", ""),
                "name": tc.get("function", {}).get("name", ""),
                "arguments": tc.get("function", {}).get("arguments", ""),
            })
    else:
        output.append({
            "id": _gen_id("item_msg_"),
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": ""}],
        })

    return {
        "id": response_id,
        "object": "response",
        "status": "completed",
        "output": output,
        "usage": _map_usage(u) if (u := ds_resp.get("usage")) else _map_usage({}),
    }


async def _direct_stream_lines(
    ds_payload: dict, api_base: str, api_key: str, client: httpx.AsyncClient,
) -> AsyncGenerator[str, None]:
    """Legacy fallback: stream directly without provider abstraction."""
    async with client.stream(
        "POST", f"{api_base}/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=ds_payload,
    ) as response:
        if response.status_code >= 400:
            error_body = await response.aread()
            error_text = error_body.decode("utf-8", errors="replace")[:500]
            _logger.error("Upstream %s error: %s", response.status_code, error_text)
            yield f"data: {json.dumps({'type': 'error', 'error': {'code': f'upstream_{response.status_code}', 'message': error_text}})}"
            return
        async for line in response.aiter_lines():
            if line.startswith("data: "):
                yield line


async def stream_generator(
    ds_payload: dict, api_base: str = "", api_key: str = "", session_id: str = "",
    http_client: httpx.AsyncClient | None = None,
    provider=None,
) -> AsyncGenerator[str, None]:
    """Stream DeepSeek SSE chunks and yield Codex-formatted SSE events.
    State machine: init → text → (optional) tool_calls → completed

    If `provider` is given, uses provider.stream_chat_completions() for the
    upstream call. Otherwise falls back to direct httpx streaming (legacy path).
    """
    response_id = _gen_id("resp_")
    msg_item_id = _gen_id("item_msg_")

    model = ds_payload.get("model", "")
    phase = "init"
    tool_item_id = None
    tool_output_idx = 0
    usage = None
    output_items = []
    text_buf = ""
    reasoning_buf = ""

    # Initial events
    yield _sse_event("response.created", {
        "type": "response.created",
        "response": {
            "id": response_id, "object": "response", "model": model,
            "status": "in_progress", "output": [], "usage": None,
        },
    })
    yield _sse_event("response.in_progress", {
        "type": "response.in_progress", "response_id": response_id,
    })

    _owns_client = http_client is None
    _client = http_client or httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10.0, read=120.0, write=60.0, pool=10.0)
    )
    try:
        if provider is not None:
            _lines = provider.stream_chat_completions(ds_payload, _client)
        else:
            _lines = _direct_stream_lines(ds_payload, api_base, api_key, _client)

        async for line in _lines:
            if not line.startswith("data: "):
                continue
            data_str = line[6:]
            if data_str.strip() == "[DONE]":
                break

            try:
                chunk = json.loads(data_str)
            except json.JSONDecodeError:
                _logger.warning("Failed to parse SSE chunk: %s", data_str[:100])
                continue

            # Handle error events from provider
            if chunk.get("type") == "error":
                yield _sse_event("error", chunk.get("error", {}))
                return

            choices = chunk.get("choices", [])
            if not choices:
                continue

            delta = choices[0].get("delta", {})
            reasoning_chunk = delta.get("reasoning_content") or ""
            if reasoning_chunk:
                reasoning_buf += reasoning_chunk

            # Text handling
            text = delta.get("content") or ""
            if text and phase != "tool_calls":
                if phase == "init":
                    phase = "text"
                    msg_item = {
                        "id": msg_item_id, "type": "message",
                        "role": "assistant", "status": "in_progress", "content": [],
                    }
                    output_items.append(msg_item)
                    yield _sse_event("response.output_item.added", {
                        "type": "response.output_item.added",
                        "output_index": 0,
                        "item": msg_item,
                    })
                    yield _sse_event("response.content_part.added", {
                        "type": "response.content_part.added",
                        "item_id": msg_item_id, "part_index": 0,
                        "part": {"type": "output_text", "text": ""},
                    })
                text_buf += text
                yield _sse_event("response.output_text.delta", {
                    "type": "response.output_text.delta",
                    "item_id": msg_item_id, "output_index": 0,
                    "content_index": 0, "delta": text,
                })

            # Tool calls handling
            for tc in delta.get("tool_calls") or []:
                if phase in ("init", "text"):
                    phase = "tool_calls"

                tc_type = tc.get("type")
                if tc_type == "function":
                    tool_item_id = tc.get("id", _gen_id("call_"))
                    tool_output_idx = len(output_items)
                    func_info = tc.get("function", {})
                    tool_item = {
                        "id": tool_item_id, "type": "function_call",
                        "call_id": tool_item_id,
                        "name": func_info.get("name", ""), "arguments": "",
                    }
                    output_items.append(tool_item)
                    yield _sse_event("response.output_item.added", {
                        "type": "response.output_item.added",
                        "output_index": tool_output_idx,
                        "item": tool_item,
                    })
                    if func_info.get("arguments"):
                        output_items[tool_output_idx]["arguments"] += func_info["arguments"]
                        yield _sse_event("response.function_call_arguments.delta", {
                            "type": "response.function_call_arguments.delta",
                            "item_id": tool_item_id, "output_index": tool_output_idx,
                            "delta": func_info["arguments"],
                        })
                else:
                    func = tc.get("function", {})
                    if func.get("arguments") and tool_item_id:
                        # Accumulate arguments in the matching output item
                        for item in output_items:
                            if item.get("id") == tool_item_id:
                                item["arguments"] += func["arguments"]
                                break
                        yield _sse_event("response.function_call_arguments.delta", {
                            "type": "response.function_call_arguments.delta",
                            "item_id": tool_item_id, "output_index": tool_output_idx,
                            "delta": func["arguments"],
                        })

            if "usage" in chunk:
                usage = chunk["usage"]

    except httpx.ConnectError as e:
        yield _sse_event("error", {
            "type": "error",
            "error": {"code": "upstream_unavailable", "message": str(e)},
        })
        return
    finally:
        if _owns_client:
            await _client.aclose()

    # Store reasoning_content on success
    store.append(session_id, reasoning_buf)

    # Log stream summary at DEBUG level (contains model output / tool parameters)
    if reasoning_buf:
        _logger.debug("DeepSeek -> reasoning: %s", reasoning_buf[:200])
    if text_buf:
        _logger.debug("DeepSeek -> content: %s", text_buf[:500])
    for item in output_items:
        if item["type"] == "function_call":
            _logger.debug("DeepSeek -> tool_call: %s(%s)",
                         item.get("name", "?"), item.get("arguments", "")[:300])

    # Finalize output items: emit content_part.done + output_item.done
    for idx, item in enumerate(output_items):
        if item["type"] == "message":
            item["content"] = [{"type": "output_text", "text": text_buf}]
            item["status"] = "completed"
            yield _sse_event("response.content_part.done", {
                "type": "response.content_part.done",
                "item_id": item["id"], "output_index": idx,
                "content_index": 0,
                "part": {"type": "output_text", "text": text_buf},
            })
        elif item["type"] == "function_call":
            item["status"] = "completed"
        yield _sse_event("response.output_item.done", {
            "type": "response.output_item.done",
            "output_index": idx,
            "item": item,
        })

    # Final event
    yield _sse_event("response.completed", {
        "type": "response.completed",
        "response": {
            "id": response_id, "object": "response", "model": model,
            "status": "completed",
            "output": output_items,
            "usage": _map_usage(usage) if usage else _map_usage({}),
        },
    })


def _sse_event(event_type: str, data: dict) -> str:
    """Format a single SSE event as a string."""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _map_usage(usage: dict) -> dict:
    """Map DeepSeek usage field names to Codex Responses API format."""
    prompt_details = usage.get("prompt_tokens_details") or {}
    completion_details = usage.get("completion_tokens_details") or {}
    mapped = {
        "input_tokens": usage.get("prompt_tokens", 0),
        "input_tokens_details": {
            "cached_tokens": prompt_details.get("cached_tokens", 0),
        },
        "output_tokens": usage.get("completion_tokens", 0),
        "output_tokens_details": {
            "reasoning_tokens": completion_details.get("reasoning_tokens", 0),
        },
        "total_tokens": usage.get("total_tokens", 0),
    }
    _logger.debug("_map_usage: in=%s out=%s", usage, mapped)
    return mapped
