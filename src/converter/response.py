"""Convert DeepSeek Chat Completions response to Codex Responses format."""

import json
import uuid
import logging
from typing import AsyncGenerator

import httpx



_logger = logging.getLogger("cli-proxy")


def _gen_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def convert_nonstream(ds_resp: dict) -> dict:
    """Convert non-streaming DeepSeek Chat Completion to Codex Response."""
    response_id = _gen_id("resp_")
    output = []

    choices = ds_resp.get("choices", [])
    if choices:
        msg = choices[0].get("message", {})
        content = msg.get("content")
        tool_calls = msg.get("tool_calls") or []

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
        "usage": ds_resp.get("usage"),
    }


async def stream_generator(
    ds_payload: dict, api_base: str, api_key: str
) -> AsyncGenerator[str, None]:
    """Stream DeepSeek SSE chunks and yield Codex-formatted SSE events.
    State machine: init → text → (optional) tool_calls → completed
    """
    response_id = _gen_id("resp_")
    msg_item_id = _gen_id("item_msg_")

    phase = "init"
    tool_item_id = None
    usage = None

    # Initial events
    yield _sse_event("response.created", {
        "type": "response.created",
        "response": {
            "id": response_id, "object": "response",
            "status": "in_progress", "output": [],
        },
    })
    yield _sse_event("response.in_progress", {
        "type": "response.in_progress", "response_id": response_id,
    })

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=120.0, write=60.0, pool=10.0)) as client:
        try:
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
                    yield _sse_event("error", {
                        "type": "error",
                        "error": {"code": f"upstream_{response.status_code}", "message": error_text},
                    })
                    return

                async for line in response.aiter_lines():
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

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})

                    # Text handling
                    text = delta.get("content") or ""
                    if text and phase != "tool_calls":
                        if phase == "init":
                            phase = "text"
                            yield _sse_event("response.output_item.added", {
                                "type": "response.output_item.added",
                                "output_index": 0,
                                "item": {
                                    "id": msg_item_id, "type": "message",
                                    "role": "assistant", "content": [],
                                },
                            })
                            yield _sse_event("response.content_part.added", {
                                "type": "response.content_part.added",
                                "item_id": msg_item_id, "part_index": 0,
                                "part": {"type": "output_text", "text": ""},
                            })
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
                            output_idx = 1 if phase == "tool_calls" else 0
                            yield _sse_event("response.output_item.added", {
                                "type": "response.output_item.added",
                                "output_index": output_idx,
                                "item": {
                                    "id": tool_item_id, "type": "function_call",
                                    "call_id": tool_item_id,
                                    "name": tc.get("name", ""), "arguments": "",
                                },
                            })
                            func = tc.get("function", {})
                            if func.get("arguments"):
                                yield _sse_event("response.function_call_arguments.delta", {
                                    "type": "response.function_call_arguments.delta",
                                    "item_id": tool_item_id, "output_index": output_idx,
                                    "delta": func["arguments"],
                                })
                        else:
                            func = tc.get("function", {})
                            if func.get("arguments") and tool_item_id:
                                yield _sse_event("response.function_call_arguments.delta", {
                                    "type": "response.function_call_arguments.delta",
                                    "item_id": tool_item_id, "output_index": 1,
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

    # Final event
    yield _sse_event("response.completed", {
        "type": "response.completed",
        "response": {
            "id": response_id, "object": "response",
            "status": "completed", "usage": usage,
        },
    })


def _sse_event(event_type: str, data: dict) -> str:
    """Format a single SSE event as a string."""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
