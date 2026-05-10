# Codex CLI → DeepSeek API 代理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建本地 HTTP 代理，将 Codex CLI 的 Responses API 请求转换为 DeepSeek Chat Completions API 格式并反向转换响应。

**Architecture:** 模块化包结构 — FastAPI 应用入口、配置管理、请求/响应转换器、日志模块各自独立，通过纯函数接口协作。流式响应通过 SSE 事件状态机实现。

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, httpx, PyYAML, pytest, pytest-asyncio

---

## 文件结构

```
cli-proxy/
├── config.yaml                  # 模型映射、API Key 配置
├── src/
│   ├── __init__.py              # 空文件
│   ├── main.py                  # FastAPI 应用，/v1/responses 路由
│   ├── config.py                # Config 数据类 + load_config()
│   ├── converter/
│   │   ├── __init__.py          # 空文件
│   │   ├── request.py           # convert_request() 纯函数
│   │   └── response.py          # convert_nonstream() + stream_generator()
│   └── logger.py                # log_request(), log_response()
├── tests/
│   ├── conftest.py              # 共享 fixtures
│   ├── test_config.py
│   ├── test_request.py
│   ├── test_response.py
│   └── test_main.py             # 集成测试
├── requirements.txt
└── README.md
```

各模块职责：

| 文件 | 职责 | 对外的接口 |
|------|------|-----------|
| `config.py` | 加载 config.yaml，提供 Config 数据类 | `load_config(path) -> Config` |
| `logger.py` | 请求摘要日志（模型、消息数、耗时） | `log_request()`, `log_response()` |
| `converter/request.py` | 纯函数，Responses → Chat Completions | `convert_request(body, model_map) -> dict` |
| `converter/response.py` | 非流式 JSON + 流式 SSE 事件生成 | `convert_nonstream(ds_resp) -> dict`, `stream_generator(payload, api_base, api_key)` |
| `main.py` | 应用入口，挂载路由，协调各模块 | — |

---

### Task 1: 项目脚手架

**Files:**
- Create: `requirements.txt`
- Create: `config.yaml`
- Create: `src/__init__.py`
- Create: `src/converter/__init__.py`

- [ ] **Step 1: 创建 requirements.txt**

```bash
cat > requirements.txt << 'EOF'
fastapi>=0.115.0
uvicorn[standard]>=0.34.0
httpx>=0.28.0
pyyaml>=6.0
pytest>=8.0
pytest-asyncio>=0.25.0
EOF
```

- [ ] **Step 2: 创建 config.yaml**

```bash
cat > config.yaml << 'EOF'
server:
  host: "0.0.0.0"
  port: 8317

deepseek:
  api_base: "https://api.deepseek.com"
  api_keys:
    - "sk-xxx"

model_map:
  "gpt-5.5": "deepseek-v4-pro"
  "gpt-5.4": "deepseek-v4-pro"
  "gpt-5.4-mini": "deepseek-v4-pro"
  "deepseek-v4-pro": "deepseek-v4-pro"
EOF
```

- [ ] **Step 3: 创建包占位文件**

```bash
touch src/__init__.py
touch src/converter/__init__.py
mkdir -p tests
touch tests/__init__.py
```

- [ ] **Step 4: 安装依赖**

```bash
pip install -r requirements.txt
```

- [ ] **Step 5: 验证 — 确认目录结构**

```bash
find . -type f | sort
```
Expected:
```
./config.yaml
./requirements.txt
./src/__init__.py
./src/converter/__init__.py
./tests/__init__.py
```

---

### Task 2: 配置模块 (config.py)

**Files:**
- Create: `src/config.py`
- Create: `tests/test_config.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: 编写 config.py 失败的测试 — test_load_config_valid**

```bash
cat > tests/conftest.py << 'CONFTEST'
import pytest
import tempfile
import os

@pytest.fixture
def valid_config_yaml():
    return """
server:
  host: "127.0.0.1"
  port: 8317

deepseek:
  api_base: "https://api.deepseek.com"
  api_keys:
    - "sk-test123"
    - "sk-test456"

model_map:
  "gpt-5.5": "deepseek-v4-pro"
"""

@pytest.fixture
def config_file(valid_config_yaml):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
        f.write(valid_config_yaml)
        path = f.name
    yield path
    os.unlink(path)
CONFTEST
```

```bash
cat > tests/test_config.py << 'TESTEOF'
"""Tests for config module."""
import pytest
import tempfile
import os
from src.config import load_config, Config


class TestLoadConfig:
    def test_loads_valid_config(self, config_file):
        config = load_config(config_file)
        assert config.server_host == "127.0.0.1"
        assert config.server_port == 8317
        assert config.api_base == "https://api.deepseek.com"
        assert config.api_keys == ["sk-test123", "sk-test456"]
        assert config.model_map == {"gpt-5.5": "deepseek-v4-pro"}

    def test_missing_file_exits(self):
        with pytest.raises(SystemExit) as exc:
            load_config("/nonexistent/path.yaml")
        assert "not found" in str(exc.value)

    def test_invalid_yaml_exits(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
            f.write("server: [unclosed")
            path = f.name
        try:
            with pytest.raises(SystemExit) as exc:
                load_config(path)
            assert "Invalid YAML" in str(exc.value)
        finally:
            os.unlink(path)

    def test_empty_api_keys_exits(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
            f.write("deepseek:\n  api_keys: []\nserver:\n  host: '0.0.0.0'\n  port: 8317\nmodel_map: {}")
            path = f.name
        try:
            with pytest.raises(SystemExit) as exc:
                load_config(path)
            assert "api key" in str(exc.value).lower()
        finally:
            os.unlink(path)

    def test_only_placeholder_keys_exits(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
            f.write("deepseek:\n  api_keys:\n    - 'sk-xxx'\nserver:\n  host: '0.0.0.0'\n  port: 8317\nmodel_map: {}")
            path = f.name
        try:
            with pytest.raises(SystemExit) as exc:
                load_config(path)
            assert "api key" in str(exc.value).lower()
        finally:
            os.unlink(path)

    def test_default_values(self, config_file):
        config = load_config(config_file)
        # Default port is 8317 when not specified
        assert config.server_port == 8317

    def test_model_map_lookup(self, config_file):
        config = load_config(config_file)
        assert config.model_map.get("gpt-5.5") == "deepseek-v4-pro"
        # unmapped model returns None -> caller should use original
        assert config.model_map.get("unknown-model") is None


class TestConfigKeyRotation:
    def test_key_round_robin(self, config_file):
        config = load_config(config_file)
        assert config.get_api_key() == "sk-test123"
        assert config.get_api_key() == "sk-test456"
        assert config.get_api_key() == "sk-test123"  # wraps around

    def test_map_model_passthrough_unknown(self, config_file):
        config = load_config(config_file)
        assert config.map_model("unknown-model") == "unknown-model"
        assert config.map_model("gpt-5.5") == "deepseek-v4-pro"
TESTEOF
```

- [ ] **Step 2: 运行测试验证失败**

```bash
python -m pytest tests/test_config.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'src.config'`

- [ ] **Step 3: 实现 config.py**

```bash
cat > src/config.py << 'PYEOF'
"""Configuration loader for cli-proxy."""

from pathlib import Path
from dataclasses import dataclass, field

import yaml


@dataclass
class Config:
    server_host: str
    server_port: int
    api_base: str
    api_keys: list[str]
    model_map: dict[str, str]
    _key_index: int = field(default=0, repr=False)

    def get_api_key(self) -> str:
        key = self.api_keys[self._key_index % len(self.api_keys)]
        self._key_index += 1
        return key

    def map_model(self, model: str) -> str:
        return self.model_map.get(model, model)


def load_config(path: str = "config.yaml") -> Config:
    config_path = Path(path)
    if not config_path.exists():
        raise SystemExit(f"Config file not found: {path}")

    with open(config_path, "r", encoding="utf-8") as f:
        try:
            data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            raise SystemExit(f"Invalid YAML in config: {e}")

    if data is None:
        raise SystemExit("Config file is empty")

    deepseek = data.get("deepseek", {})
    api_keys = deepseek.get("api_keys", [])

    # Filter out placeholder keys
    valid_keys = [k for k in api_keys if k and k != "sk-xxx"]
    if not valid_keys:
        raise SystemExit(
            "No valid API key configured in config.yaml. "
            "Replace 'sk-xxx' with your actual DeepSeek API key."
        )

    server = data.get("server", {})
    return Config(
        server_host=server.get("host", "0.0.0.0"),
        server_port=server.get("port", 8317),
        api_base=deepseek.get("api_base", "https://api.deepseek.com"),
        api_keys=valid_keys,
        model_map=data.get("model_map", {}),
    )
PYEOF
```

- [ ] **Step 4: 运行测试验证通过**

```bash
python -m pytest tests/test_config.py -v
```
Expected: all 8 tests PASS

- [ ] **Step 5: 提交**

```bash
git add tests/conftest.py tests/test_config.py src/config.py
git commit -m "feat: add config module with YAML loading and key rotation"
```

---

### Task 3: 日志模块 (logger.py)

**Files:**
- Create: `src/logger.py`

日志模块简单、无外部依赖、无需单元测试（仅有副作用输出），直接实现。

- [ ] **Step 1: 实现 logger.py**

```bash
cat > src/logger.py << 'PYEOF'
"""Structured logging for the proxy."""

import time
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
_logger = logging.getLogger("cli-proxy")


def log_request(model: str, msg_count: int, stream: bool) -> None:
    mode = "stream" if stream else "non-stream"
    _logger.info("REQ → model=%s messages=%d mode=%s", model, msg_count, mode)


def log_response(model: str, elapsed_ms: int, status: str = "completed") -> None:
    _logger.info("RES ← model=%s status=%s elapsed=%dms", model, status, elapsed_ms)


def log_warning(msg: str) -> None:
    _logger.warning(msg)


def log_error(msg: str) -> None:
    _logger.error(msg)
PYEOF
```

- [ ] **Step 2: 快速验证 — Python 导入不报错**

```bash
python -c "from src.logger import log_request, log_response, log_warning, log_error; log_request('test', 3, True); log_response('test', 42)"
```

- [ ] **Step 3: 提交**

```bash
git add src/logger.py
git commit -m "feat: add logger module for request/response summary"
```

---

### Task 4: 请求转换器 (converter/request.py)

**Files:**
- Create: `src/converter/request.py`
- Create: `tests/test_request.py`

- [ ] **Step 1: 编写测试 — test_request.py**

```bash
cat > tests/test_request.py << 'TESTEOF'
"""Tests for request converter."""
import pytest
from src.converter.request import convert_request


class TestConvertMessage:
    def test_user_message(self):
        body = {"input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "hello"}
        ]}]}
        result = convert_request(body, {})
        msgs = result["messages"]
        assert msgs[0]["role"] == "system"  # instructions default
        assert msgs[1]["role"] == "user"
        assert msgs[1]["content"] == "hello"

    def test_developer_maps_to_system(self):
        body = {"input": [{"type": "message", "role": "developer", "content": [
            {"type": "input_text", "text": "You are a coder"}
        ]}]}
        result = convert_request(body, {})
        msg = result["messages"][1]
        assert msg["role"] == "system"
        assert msg["content"] == "You are a coder"

    def test_assistant_role_preserved(self):
        body = {"input": [{"type": "message", "role": "assistant", "content": [
            {"type": "input_text", "text": "I'll help"}
        ]}]}
        result = convert_request(body, {})
        assert result["messages"][1]["role"] == "assistant"

    def test_multiple_text_blocks_merged(self):
        body = {"input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "part1"},
            {"type": "input_text", "text": "part2"},
        ]}]}
        result = convert_request(body, {})
        assert result["messages"][1]["content"] == "part1\npart2"

    def test_null_content_uses_empty_string(self):
        body = {"input": [{"type": "message", "role": "user", "content": None}]}
        result = convert_request(body, {})
        assert result["messages"][1]["content"] == ""

    def test_empty_content_array(self):
        body = {"input": [{"type": "message", "role": "user", "content": []}]}
        result = convert_request(body, {})
        assert result["messages"][1]["content"] == ""


class TestConvertFunctionCall:
    def test_basic_function_call(self):
        body = {"input": [{"type": "function_call", "call_id": "call_abc",
                            "name": "shell", "arguments": '{"cmd":"ls"}'}]}
        result = convert_request(body, {})
        msg = result["messages"][1]
        assert msg["role"] == "assistant"
        assert msg["content"] is None
        tc = msg["tool_calls"][0]
        assert tc["id"] == "call_abc"
        assert tc["function"]["name"] == "shell"
        assert tc["function"]["arguments"] == '{"cmd":"ls"}'


class TestConvertFunctionCallOutput:
    def test_basic_output(self):
        body = {"input": [{"type": "function_call_output", "call_id": "call_abc",
                            "output": "file1.txt"}]}
        result = convert_request(body, {})
        msg = result["messages"][1]
        assert msg["role"] == "tool"
        assert msg["tool_call_id"] == "call_abc"
        assert msg["content"] == "file1.txt"


class TestConvertInstructions:
    def test_instructions_becomes_system_message(self):
        body = {"instructions": "Be concise", "input": []}
        result = convert_request(body, {})
        assert result["messages"][0] == {"role": "system", "content": "Be concise"}

    def test_null_instructions_uses_default(self):
        body = {"instructions": None, "input": []}
        result = convert_request(body, {})
        assert result["messages"][0]["content"] == "You are a helpful assistant."

    def test_missing_instructions_uses_default(self):
        body = {"input": []}
        result = convert_request(body, {})
        assert result["messages"][0]["content"] == "You are a helpful assistant."

    def test_empty_input_only_system_message(self):
        body = {"instructions": "Hello", "input": []}
        result = convert_request(body, {})
        assert len(result["messages"]) == 1
        assert result["messages"][0]["role"] == "system"


class TestTypeSkipping:
    def test_reasoning_skipped(self):
        body = {"input": [{"type": "reasoning", "content": "let me think..."}]}
        result = convert_request(body, {})
        assert len(result["messages"]) == 1  # only system

    def test_unknown_type_skipped(self):
        body = {"input": [{"type": "unknown_future_type", "data": {}}]}
        result = convert_request(body, {})
        assert len(result["messages"]) == 1


class TestFieldPassthrough:
    def test_model_mapped(self):
        body = {"model": "gpt-5.5", "input": []}
        result = convert_request(body, {"gpt-5.5": "deepseek-v4-pro"})
        assert result["model"] == "deepseek-v4-pro"

    def test_model_unmatched_passthrough(self):
        body = {"model": "unknown-99", "input": []}
        result = convert_request(body, {})
        assert result["model"] == "unknown-99"

    def test_tools_passthrough(self):
        tools = [{"type": "function", "function": {"name": "shell", "parameters": {}}}]
        body = {"tools": tools, "input": []}
        result = convert_request(body, {})
        assert result["tools"] == tools

    def test_tool_choice_passthrough(self):
        body = {"tool_choice": "auto", "input": []}
        result = convert_request(body, {})
        assert result["tool_choice"] == "auto"

    def test_temperature_passthrough(self):
        body = {"temperature": 0.7, "input": []}
        result = convert_request(body, {})
        assert result["temperature"] == 0.7

    def test_max_output_tokens_passthrough(self):
        body = {"max_output_tokens": 4096, "input": []}
        result = convert_request(body, {})
        assert result["max_tokens"] == 4096

    def test_stream_passthrough(self):
        body = {"stream": True, "input": []}
        result = convert_request(body, {})
        assert result["stream"] is True

    def test_stream_false_by_default(self):
        body = {"input": []}
        result = convert_request(body, {})
        assert result["stream"] is False

    def test_reasoning_field_dropped(self):
        body = {"reasoning": {"effort": "high"}, "input": []}
        result = convert_request(body, {})
        assert "reasoning" not in result


class TestFullConversion:
    def test_complete_multi_turn(self):
        body = {
            "model": "gpt-5.5",
            "instructions": "You are a shell assistant.",
            "input": [
                {"type": "message", "role": "user", "content": [
                    {"type": "input_text", "text": "list files"}
                ]},
                {"type": "function_call", "call_id": "call_1", "name": "shell",
                 "arguments": '{"cmd":"ls"}'},
                {"type": "function_call_output", "call_id": "call_1",
                 "output": "file1.txt\nfile2.txt"},
                {"type": "message", "role": "assistant", "content": [
                    {"type": "input_text", "text": "Files listed above"}
                ]},
            ],
            "tools": [{"type": "function", "function": {
                "name": "shell",
                "description": "Run a shell command",
                "parameters": {"type": "object", "properties": {"cmd": {"type": "string"}}},
            }}],
            "tool_choice": "auto",
            "stream": True,
        }
        result = convert_request(body, {"gpt-5.5": "deepseek-v4-pro"})

        assert result["model"] == "deepseek-v4-pro"
        assert result["stream"] is True
        assert result["tool_choice"] == "auto"
        assert len(result["tools"]) == 1

        msgs = result["messages"]
        assert msgs[0] == {"role": "system", "content": "You are a shell assistant."}
        assert msgs[1] == {"role": "user", "content": "list files"}
        assert msgs[2]["role"] == "assistant"
        assert msgs[2]["tool_calls"][0]["id"] == "call_1"
        assert msgs[3] == {"role": "tool", "tool_call_id": "call_1",
                           "content": "file1.txt\nfile2.txt"}
        assert msgs[4] == {"role": "assistant", "content": "Files listed above"}
TESTEOF
```

- [ ] **Step 2: 运行测试验证失败**

```bash
python -m pytest tests/test_request.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'src.converter.request'`

- [ ] **Step 3: 实现 converter/request.py**

```bash
cat > src/converter/request.py << 'PYEOF'
"""Convert Codex Responses API request to DeepSeek Chat Completions format."""

import logging

_logger = logging.getLogger("cli-proxy")


def convert_request(body: dict, model_map: dict) -> dict:
    """
    Convert Codex Responses API request body to DeepSeek Chat Completions format.

    Pure function — no side effects, no I/O.
    """
    messages = []

    # instructions become the first system message
    instructions = body.get("instructions")
    if instructions is None:
        instructions = "You are a helpful assistant."
    messages.append({"role": "system", "content": instructions})

    # Convert input[] to messages[]
    for item in body.get("input", []):
        msg = _convert_input_item(item)
        if msg is not None:
            messages.append(msg)

    # Map model name
    model = model_map.get(body.get("model", ""), body.get("model", ""))

    payload: dict = {
        "model": model,
        "messages": messages,
        "stream": body.get("stream", False),
    }

    # Passthrough fields (Codex → DeepSeek mapping)
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
            }
        ],
    }


def _convert_function_call_output(item: dict) -> dict:
    return {
        "role": "tool",
        "tool_call_id": item.get("call_id", ""),
        "content": item.get("output", ""),
    }
PYEOF
```

- [ ] **Step 4: 运行测试验证通过**

```bash
python -m pytest tests/test_request.py -v
```
Expected: all 22 tests PASS

- [ ] **Step 5: 提交**

```bash
git add src/converter/request.py tests/test_request.py
git commit -m "feat: add request converter (Responses → Chat Completions)"
```

---

### Task 5: 响应转换器 — 非流式 (converter/response.py Part 1)

**Files:**
- Create: `src/converter/response.py`
- Create: `tests/test_response.py`

- [ ] **Step 1: 编写非流式测试 — test_response.py**

```bash
cat > tests/test_response.py << 'TESTEOF'
"""Tests for response converter."""
import json
import pytest
from src.converter.response import convert_nonstream, _sse_event, _gen_id


class TestConvertNonstream:
    def test_with_text_content(self):
        ds_resp = {
            "id": "chatcmpl-123",
            "choices": [{
                "message": {"role": "assistant", "content": "Hello from DeepSeek"},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        result = convert_nonstream(ds_resp)
        assert result["object"] == "response"
        assert result["status"] == "completed"
        assert result["usage"] == ds_resp["usage"]
        assert len(result["output"]) == 1
        output = result["output"][0]
        assert output["type"] == "message"
        assert output["role"] == "assistant"
        assert output["content"] == [{"type": "output_text", "text": "Hello from DeepSeek"}]

    def test_with_tool_calls_no_text(self):
        ds_resp = {
            "id": "chatcmpl-456",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_ds_789",
                        "type": "function",
                        "function": {"name": "shell", "arguments": '{"cmd":"ls"}'},
                    }],
                },
                "finish_reason": "tool_calls",
            }],
            "usage": None,
        }
        result = convert_nonstream(ds_resp)
        assert len(result["output"]) == 1
        output = result["output"][0]
        assert output["type"] == "function_call"
        assert output["call_id"] == "call_ds_789"
        assert output["name"] == "shell"
        assert output["arguments"] == '{"cmd":"ls"}'

    def test_with_both_text_and_tool_calls(self):
        ds_resp = {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Running command...",
                    "tool_calls": [{
                        "id": "call_x",
                        "type": "function",
                        "function": {"name": "read", "arguments": '{"file":"a.txt"}'},
                    }],
                },
                "finish_reason": "tool_calls",
            }],
            "usage": {},
        }
        result = convert_nonstream(ds_resp)
        assert len(result["output"]) == 2
        # text first
        assert result["output"][0]["type"] == "message"
        assert result["output"][0]["content"][0]["text"] == "Running command..."
        # then function call
        assert result["output"][1]["type"] == "function_call"
        assert result["output"][1]["name"] == "read"

    def test_empty_choices(self):
        ds_resp = {"choices": [], "usage": None}
        result = convert_nonstream(ds_resp)
        assert len(result["output"]) == 1
        assert result["output"][0]["type"] == "message"
        assert result["output"][0]["content"][0]["text"] == ""

    def test_multiple_tool_calls(self):
        ds_resp = {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {"id": "call_1", "type": "function",
                         "function": {"name": "shell", "arguments": '{"cmd":"ls"}'}},
                        {"id": "call_2", "type": "function",
                         "function": {"name": "read", "arguments": '{"file":"x"}'}},
                    ],
                },
            }],
            "usage": None,
        }
        result = convert_nonstream(ds_resp)
        assert len(result["output"]) == 2
        assert result["output"][0]["call_id"] == "call_1"
        assert result["output"][1]["call_id"] == "call_2"

    def test_response_id_consistent(self):
        ds_resp = {"choices": [{"message": {"content": "ok"}}], "usage": None}
        result = convert_nonstream(ds_resp)
        assert result["id"].startswith("resp_")
        assert len(result["id"]) > 5

    def test_output_items_have_unique_ids(self):
        ds_resp = {
            "choices": [{"message": {"content": "a", "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "f", "arguments": "{}"}}
            ]}}],
            "usage": None,
        }
        result = convert_nonstream(ds_resp)
        ids = [item["id"] for item in result["output"]]
        assert len(ids) == len(set(ids))  # unique


class TestHelpers:
    def test_gen_id(self):
        id1 = _gen_id("resp_")
        assert id1.startswith("resp_")
        id2 = _gen_id("item_")
        assert id2.startswith("item_")
        assert id1 != id2

    def test_sse_event_format(self):
        result = _sse_event("response.text.delta", {"type": "response.text.delta", "delta": "hi"})
        assert result.startswith("event: response.text.delta\n")
        assert "data: " in result
        assert result.endswith("\n\n")
TESTEOF
```

- [ ] **Step 2: 运行测试验证失败**

```bash
python -m pytest tests/test_response.py -v
```
Expected: FAIL

- [ ] **Step 3: 实现 converter/response.py**

```bash
cat > src/converter/response.py << 'PYEOF'
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
    """
    Stream DeepSeek SSE chunks and yield Codex-formatted SSE events.

    Implements a simple state machine:
      init → text → (optional) tool_calls → completed
    """
    response_id = _gen_id("resp_")
    msg_item_id = _gen_id("item_msg_")

    phase = "init"       # init | text | tool_calls
    tool_item_id = None
    usage = None

    # --- Initial events ---
    yield _sse_event("response.created", {
        "type": "response.created",
        "response": {
            "id": response_id,
            "object": "response",
            "status": "in_progress",
            "output": [],
        },
    })
    yield _sse_event("response.in_progress", {
        "type": "response.in_progress",
        "response_id": response_id,
    })

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=120)) as client:
        try:
            async with client.stream(
                "POST",
                f"{api_base}/v1/chat/completions",
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
                        "error": {
                            "code": f"upstream_{response.status_code}",
                            "message": error_text,
                        },
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
                    finish_reason = choices[0].get("finish_reason")

                    # ---- Text handling ----
                    text = delta.get("content") or ""
                    if text and phase != "tool_calls":
                        if phase == "init":
                            phase = "text"
                            yield _sse_event("response.output_item.added", {
                                "type": "response.output_item.added",
                                "output_index": 0,
                                "item": {
                                    "id": msg_item_id,
                                    "type": "message",
                                    "role": "assistant",
                                    "content": [],
                                },
                            })
                            yield _sse_event("response.content_part.added", {
                                "type": "response.content_part.added",
                                "item_id": msg_item_id,
                                "part_index": 0,
                                "part": {"type": "output_text", "text": ""},
                            })
                        yield _sse_event("response.output_text.delta", {
                            "type": "response.output_text.delta",
                            "item_id": msg_item_id,
                            "output_index": 0,
                            "content_index": 0,
                            "delta": text,
                        })

                    # ---- Tool calls handling ----
                    for tc in delta.get("tool_calls") or []:
                        if phase == "init":
                            phase = "tool_calls"
                        elif phase == "text":
                            phase = "tool_calls"

                        tc_type = tc.get("type")
                        if tc_type == "function":
                            # New tool call starting
                            tool_item_id = tc.get("id", _gen_id("call_"))
                            yield _sse_event("response.output_item.added", {
                                "type": "response.output_item.added",
                                "output_index": 0 if phase == "tool_calls" and not msg_item_id else 1,
                                "item": {
                                    "id": tool_item_id,
                                    "type": "function_call",
                                    "call_id": tool_item_id,
                                    "name": tc.get("name", ""),
                                    "arguments": "",
                                },
                            })
                            # Also send initial arguments delta if present
                            func = tc.get("function", {})
                            if func.get("arguments"):
                                yield _sse_event("response.function_call_arguments.delta", {
                                    "type": "response.function_call_arguments.delta",
                                    "item_id": tool_item_id,
                                    "output_index": 0 if phase == "tool_calls" else 1,
                                    "delta": func["arguments"],
                                })
                        else:
                            # Subsequent argument chunks
                            func = tc.get("function", {})
                            if func.get("arguments") and tool_item_id:
                                yield _sse_event("response.function_call_arguments.delta", {
                                    "type": "response.function_call_arguments.delta",
                                    "item_id": tool_item_id,
                                    "output_index": 0 if phase == "tool_calls" else 1,
                                    "delta": func["arguments"],
                                })

                    # Cache usage from last chunk
                    if "usage" in chunk:
                        usage = chunk["usage"]

                    # finish_reason present → stream is ending
                    if finish_reason and "usage" in chunk:
                        usage = chunk["usage"]

        except httpx.ConnectError as e:
            yield _sse_event("error", {
                "type": "error",
                "error": {"code": "upstream_unavailable", "message": str(e)},
            })
            return

    # --- Final event ---
    yield _sse_event("response.completed", {
        "type": "response.completed",
        "response": {
            "id": response_id,
            "object": "response",
            "status": "completed",
            "usage": usage,
        },
    })


def _sse_event(event_type: str, data: dict) -> str:
    """Format a single SSE event as a string."""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
PYEOF
```

- [ ] **Step 4: 运行非流式测试**

```bash
python -m pytest tests/test_response.py -v -k "not Stream"
```
Expected: all ConvertNonstream + Helpers tests PASS

- [ ] **Step 5: 提交**

```bash
git add src/converter/response.py tests/test_response.py
git commit -m "feat: add response converter with non-streaming support"
```

---

### Task 6: 响应转换器 — 流式 (converter/response.py Part 2)

**Files:**
- Modify: `tests/test_response.py` (追加流式测试)

- [ ] **Step 1: 追加流式测试到 test_response.py**

```bash
cat >> tests/test_response.py << 'TESTEOF'


class TestStreamGenerator:
    """Tests for the SSE stream generator using mocked httpx."""

    @pytest.fixture
    def ds_payload(self):
        return {
            "model": "deepseek-v4-pro",
            "messages": [{"role": "system", "content": "You are helpful."},
                         {"role": "user", "content": "hi"}],
            "stream": True,
        }

    @pytest.mark.asyncio
    async def test_text_only_stream(self, ds_payload):
        """Simulate DeepSeek returning text-only stream."""
        from unittest.mock import AsyncMock, patch, MagicMock

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.aiter_lines = AsyncMock(return_value=iter([
            'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}',
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"choices":[{"delta":{"content":" world"}}]}',
            'data: [DONE]',
        ].__aiter__()))

        mock_client = MagicMock()
        mock_client.stream = MagicMock()
        mock_client.stream.return_value.__aenter__ = AsyncMock(return_value=mock_response)
        mock_client.stream.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("src.converter.response.httpx.AsyncClient", return_value=mock_client):
            events = []
            async for event in stream_generator(ds_payload, "https://api.test.com", "sk-test"):
                events.append(event)

        # Check event sequence
        event_types = []
        for e in events:
            if e.startswith("event: "):
                lines = e.strip().split("\n")
                for line in lines:
                    if line.startswith("event: "):
                        event_types.append(line[7:])

        assert "response.created" in event_types
        assert "response.in_progress" in event_types
        assert "response.output_item.added" in event_types
        assert "response.content_part.added" in event_types
        assert "response.output_text.delta" in event_types
        assert event_types[-1] == "response.completed"

        # Verify text deltas contain the content
        deltas = [e for e in events if "response.output_text.delta" in e]
        assert len(deltas) >= 2

    @pytest.mark.asyncio
    async def test_upstream_error_stream(self, ds_payload):
        """Simulate upstream returning 500."""
        from unittest.mock import AsyncMock, patch, MagicMock

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.aread = AsyncMock(return_value=b"Internal Server Error")

        mock_client = MagicMock()
        mock_client.stream = MagicMock()
        mock_client.stream.return_value.__aenter__ = AsyncMock(return_value=mock_response)
        mock_client.stream.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("src.converter.response.httpx.AsyncClient", return_value=mock_client):
            events = []
            async for event in stream_generator(ds_payload, "https://api.test.com", "sk-test"):
                events.append(event)

        # Should have error event, no completed
        for e in events:
            if "event: error" in e:
                break
        else:
            pytest.fail("No error event found")

        # completed should NOT appear after error
        event_names = []
        for e in events:
            if e.startswith("event: "):
                for line in e.strip().split("\n"):
                    if line.startswith("event: "):
                        event_names.append(line[7:])
        assert "response.completed" not in event_names

    @pytest.mark.asyncio
    async def test_tool_call_stream(self, ds_payload):
        """Simulate DeepSeek returning a tool call delta."""
        from unittest.mock import AsyncMock, patch, MagicMock

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.aiter_lines = AsyncMock(return_value=iter([
            'data: {"choices":[{"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_ds_1","type":"function","function":{"name":"shell","arguments":""}}]}}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"ls\\"}"}}]}}]}',
            'data: {"choices":[{"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}',
            'data: [DONE]',
        ].__aiter__()))

        mock_client = MagicMock()
        mock_client.stream = MagicMock()
        mock_client.stream.return_value.__aenter__ = AsyncMock(return_value=mock_response)
        mock_client.stream.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("src.converter.response.httpx.AsyncClient", return_value=mock_client):
            events = []
            async for event in stream_generator(ds_payload, "https://api.test.com", "sk-test"):
                events.append(event)

        # Should have function_call output_item.added
        has_func_call = False
        for e in events:
            if "response.output_item.added" in e and "function_call" in e:
                has_func_call = True
                break
        assert has_func_call, "Expected function_call output_item.added event"

        # Should have arguments delta
        has_args_delta = False
        for e in events:
            if "response.function_call_arguments.delta" in e:
                has_args_delta = True
                break
        assert has_args_delta, "Expected function_call_arguments.delta event"

    @pytest.mark.asyncio
    async def test_completed_includes_usage(self, ds_payload):
        """Verify usage from last chunk appears in completed event."""
        from unittest.mock import AsyncMock, patch, MagicMock

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.aiter_lines = AsyncMock(return_value=iter([
            'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}',
            'data: [DONE]',
        ].__aiter__()))

        mock_client = MagicMock()
        mock_client.stream = MagicMock()
        mock_client.stream.return_value.__aenter__ = AsyncMock(return_value=mock_response)
        mock_client.stream.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("src.converter.response.httpx.AsyncClient", return_value=mock_client):
            events = []
            async for event in stream_generator(ds_payload, "https://api.test.com", "sk-test"):
                events.append(event)

        # Last event should be completed with usage
        last = events[-1]
        assert "response.completed" in last
        assert '"total_tokens":6' in last or '"total_tokens": 6' in last
TESTEOF
```

- [ ] **Step 2: 运行流式测试**

```bash
python -m pytest tests/test_response.py -v -k "Stream"
```
Expected: 4 tests PASS

- [ ] **Step 3: 运行全部 response 测试**

```bash
python -m pytest tests/test_response.py -v
```
Expected: all 14 tests PASS

- [ ] **Step 4: 提交**

```bash
git add tests/test_response.py
git commit -m "feat: add streaming SSE response converter with tests"
```

---

### Task 7: FastAPI 应用入口 + 集成测试 (main.py)

**Files:**
- Create: `src/main.py`
- Create: `tests/test_main.py`

- [ ] **Step 1: 编写集成测试 — test_main.py**

```bash
cat > tests/test_main.py << 'TESTEOF'
"""Integration tests for the FastAPI application."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

# Must be imported after mocking config to avoid file-not-found
from src.main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestNonStreamEndpoint:
    def test_basic_nonstream_conversion(self, client):
        """Integration: valid request returns converted response."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"role": "assistant", "content": "Hello"}}],
            "usage": {"total_tokens": 15},
        }

        with patch("src.main.httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_resp

            response = client.post("/v1/responses", json={
                "model": "gpt-5.5",
                "instructions": "You are helpful.",
                "input": [
                    {"type": "message", "role": "user",
                     "content": [{"type": "input_text", "text": "hi"}]}
                ],
                "stream": False,
            })

        assert response.status_code == 200
        data = response.json()
        assert data["object"] == "response"
        assert data["status"] == "completed"
        assert len(data["output"]) == 1
        assert data["output"][0]["type"] == "message"
        assert data["output"][0]["content"][0]["text"] == "Hello"
        assert data["usage"]["total_tokens"] == 15

    def test_upstream_connection_error(self, client):
        """Integration: upstream unavailable returns 502."""
        import httpx

        with patch("src.main.httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.ConnectError("Connection refused")

            response = client.post("/v1/responses", json={
                "model": "deepseek-v4-pro",
                "input": [{"type": "message", "role": "user",
                           "content": [{"type": "input_text", "text": "test"}]}],
                "stream": False,
            })

        assert response.status_code == 502
        data = response.json()
        assert data["type"] == "error"
        assert data["error"]["code"] == "upstream_unavailable"

    def test_upstream_400_error(self, client):
        """Integration: upstream 4xx returns matching status."""
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.text = "Bad request from upstream"

        with patch("src.main.httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_resp

            response = client.post("/v1/responses", json={
                "model": "deepseek-v4-pro",
                "input": [],
                "stream": False,
            })

        assert response.status_code == 400
        data = response.json()
        assert data["type"] == "error"

    def test_invalid_json_body(self, client):
        """Integration: non-JSON body returns 400."""
        response = client.post("/v1/responses", content="not json",
                               headers={"Content-Type": "text/plain"})
        assert response.status_code == 400
        data = response.json()
        assert data["error"]["code"] == "invalid_request"


class TestStreamEndpoint:
    @pytest.mark.asyncio
    async def test_stream_response_media_type(self, client):
        """Integration: stream request returns text/event-stream."""
        from src.converter.response import _sse_event

        async def mock_event_stream(ds_payload, api_base, api_key):
            yield _sse_event("response.created", {"type": "response.created", "response": {"id": "resp_1"}})
            yield _sse_event("response.output_text.delta", {"type": "response.output_text.delta", "delta": "hi"})
            yield _sse_event("response.completed", {"type": "response.completed"})

        with patch("src.main.stream_generator", side_effect=mock_event_stream):
            with client.stream("POST", "/v1/responses", json={
                "model": "deepseek-v4-pro",
                "input": [{"type": "message", "role": "user",
                           "content": [{"type": "input_text", "text": "hi"}]}],
                "stream": True,
            }) as response:
                assert response.status_code == 200
                assert "text/event-stream" in response.headers.get("content-type", "")

    def test_stream_request_passes_stream_flag(self, client):
        """Integration: stream request passes stream=True to converter."""
        async def fake_generator(ds_payload, api_base, api_key):
            assert ds_payload["stream"] is True
            assert ds_payload["model"] == "deepseek-v4-pro"
            yield "event: response.completed\ndata: {}\n\n"

        with patch("src.main.stream_generator", side_effect=fake_generator):
            response = client.post("/v1/responses", json={
                "model": "deepseek-v4-pro",
                "input": [{"type": "message", "role": "user",
                           "content": [{"type": "input_text", "text": "hi"}]}],
                "stream": True,
            })

        assert response.status_code == 200
TESTEOF
```

- [ ] **Step 2: 运行集成测试验证失败**

```bash
python -m pytest tests/test_main.py -v
```
Expected: FAIL — module not found or config file missing

- [ ] **Step 3: 实现 main.py**

```bash
cat > src/main.py << 'PYEOF'
"""FastAPI application entry point for cli-proxy."""

import time
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .config import load_config, Config
from .converter.request import convert_request
from .converter.response import convert_nonstream, stream_generator
from .logger import log_request, log_response, log_error

config: Config = load_config()
app = FastAPI(title="cli-proxy", version="0.1.0")


@app.post("/v1/responses")
async def proxy_responses(request: Request):
    """Proxy Codex Responses API requests to DeepSeek Chat Completions."""
    # Parse request body
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={
                "type": "error",
                "error": {"code": "invalid_request", "message": "Request body is not valid JSON"},
            },
        )

    model = body.get("model", "unknown")
    msg_count = len(body.get("input", []))
    stream = body.get("stream", False)

    log_request(model, msg_count, stream)
    start = time.time()

    # Convert request
    try:
        ds_payload = convert_request(body, config.model_map)
    except Exception as e:
        log_error(f"Request conversion failed: {e}")
        return JSONResponse(
            status_code=400,
            content={
                "type": "error",
                "error": {"code": "conversion_error", "message": str(e)},
            },
        )

    api_key = config.get_api_key()

    if stream:
        return StreamingResponse(
            stream_generator(ds_payload, config.api_base, api_key),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Non-streaming
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10, read=120)
        ) as client:
            resp = await client.post(
                f"{config.api_base}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=ds_payload,
            )
    except httpx.ConnectError as e:
        elapsed = int((time.time() - start) * 1000)
        log_response(model, elapsed, "upstream_unavailable")
        return JSONResponse(
            status_code=502,
            content={
                "type": "error",
                "error": {"code": "upstream_unavailable", "message": str(e)},
            },
        )

    elapsed = int((time.time() - start) * 1000)

    if resp.status_code >= 400:
        log_response(model, elapsed, f"upstream_{resp.status_code}")
        return JSONResponse(
            status_code=resp.status_code,
            content={
                "type": "error",
                "error": {
                    "code": f"upstream_{resp.status_code}",
                    "message": resp.text[:500],
                },
            },
        )

    try:
        codex_resp = convert_nonstream(resp.json())
    except Exception as e:
        log_error(f"Response conversion failed: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "type": "error",
                "error": {"code": "conversion_error", "message": str(e)},
            },
        )

    log_response(model, elapsed, "completed")
    return codex_resp


@app.get("/health")
async def health():
    return {"status": "ok"}
PYEOF
```

- [ ] **Step 4: 运行集成测试**

因为 `main.py` 在 import 时会执行 `load_config()`，需要先提供有效的配置。确保 `config.yaml` 中有有效 API key，或临时修改测试 `conftest.py` 来 mock 配置。

```bash
cat >> tests/conftest.py << 'CONFTEST2'

# --- Mock config for integration tests ---
# Must run at import time (before test_main imports src.main)
# so load_config() doesn't fail looking for config.yaml
from unittest.mock import MagicMock
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
CONFTEST2
```

```bash
python -m pytest tests/test_main.py -v
```
Expected: all 6 tests PASS

- [ ] **Step 5: 提交**

```bash
git add src/main.py tests/test_main.py tests/conftest.py
git commit -m "feat: add FastAPI app entry point with integration tests"
```

---

### Task 8: README 与最终验证

**Files:**
- Create: `README.md`

- [ ] **Step 1: 编写 README.md**

```bash
cat > README.md << 'EOF'
# cli-proxy

Codex CLI → DeepSeek API 协议转换代理。

将 Codex CLI 的 OpenAI Responses API 请求转换为 DeepSeek Chat Completions API，并反向转换响应。

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置 API Key

编辑 `config.yaml`，将 `sk-xxx` 替换为你的 DeepSeek API Key：

```yaml
deepseek:
  api_keys:
    - "sk-your-actual-key"
```

### 3. 启动代理

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8317
```

### 4. 配置 Codex CLI

设置 Codex 使用本地代理：

```bash
export CODEX_API_BASE_URL="http://localhost:8317/v1"
```

## 模型映射

默认映射（可在 `config.yaml` 中修改）：

| Codex 模型 | DeepSeek 模型 |
|-----------|--------------|
| gpt-5.5 | deepseek-v4-pro |
| gpt-5.4 | deepseek-v4-pro |
| gpt-5.4-mini | deepseek-v4-pro |

## 运行测试

```bash
pytest tests/ -v
```

## 架构

```
Codex CLI → POST /v1/responses → request.py 转换 → DeepSeek API
                                                          ↓
Codex CLI ← StreamingResponse / JSON ← response.py 转换 ←─┘
```
EOF
```

- [ ] **Step 2: 运行全部测试**

```bash
python -m pytest tests/ -v
```

- [ ] **Step 3: 启动服务验证**

```bash
# 在另一个终端启动
uvicorn src.main:app --host 127.0.0.1 --port 8317 &

# 验证健康检查
curl http://127.0.0.1:8317/health

# 发送测试请求
curl -X POST http://127.0.0.1:8317/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-pro","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}],"stream":false}'
```

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```
