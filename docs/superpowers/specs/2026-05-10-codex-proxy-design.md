# Codex CLI → DeepSeek API 代理设计文档

## 概述

本地 HTTP 代理服务器，将 Codex CLI 的 Responses API 请求转换为 DeepSeek Chat Completions API 格式，并反向转换响应。监听 8317 端口。

## 架构

采用模块化包结构，按职责拆分：

```
cli-proxy/
├── config.yaml              # 模型映射、API Key 等配置
├── src/
│   ├── __init__.py
│   ├── main.py              # FastAPI 应用入口，路由注册
│   ├── config.py            # 配置加载与管理
│   ├── converter/
│   │   ├── __init__.py
│   │   ├── request.py       # 请求转换：Responses → Chat Completions
│   │   └── response.py      # 响应转换：Chat Completions → Responses
│   └── logger.py            # 请求摘要日志
├── tests/
│   └── fixtures/            # 测试用真实请求/响应 JSON 样例
├── requirements.txt
└── README.md
```

### 数据流

```
Codex CLI → POST /v1/responses → request.py 转换 → DeepSeek API (/v1/chat/completions)
                                                              ↓
Codex CLI ← StreamingResponse / JSON ← response.py 转换 ←─────┘
```

### 模块职责

| 模块 | 职责 | 对外接口 |
|------|------|---------|
| `main.py` | FastAPI 应用，挂载 `/v1/responses`，根据 `stream` 参数分流 | — |
| `config.py` | 加载 `config.yaml`，提供模型名映射、API Key 获取 | `load_config()` 返回配置对象 |
| `converter/request.py` | 纯函数，Codex 请求 dict → DeepSeek 请求 dict | `convert_request(body, config) -> dict` |
| `converter/response.py` | 非流式 JSON 转换 + 流式 SSE 事件生成器 | `convert_nonstream(ds_resp) -> dict` / `stream_generator(ds_payload, config)` |
| `logger.py` | 打印请求摘要（模型、消息数、流式/非流式、耗时） | `log_request()`, `log_response()` |

### 核心依赖

- Python 3.11+
- FastAPI + uvicorn（HTTP 服务）
- httpx（异步上游请求）
- PyYAML（配置解析）
- pytest + pytest-asyncio（测试）

## 请求转换：Responses → Chat Completions

### 字段映射

| Codex 字段 | DeepSeek 字段 | 处理 |
|-----------|--------------|------|
| `model` | `model` | 查 config 映射表替换，未匹配则透传 |
| `instructions` | `messages[0]` | 作为第一条 `system` 角色消息 |
| `input[]` | `messages[]` | 逐条按类型转换 |
| `tools` | `tools` | 直接透传 |
| `tool_choice` | `tool_choice` | 直接透传 |
| `stream` | `stream` | 直接透传 |
| `reasoning` | — | 丢弃 |
| `temperature` | `temperature` | 直接透传 |
| `max_output_tokens` | `max_tokens` | 直接透传 |

### input 数组转换规则

| input type | 输出 message |
|-----------|-------------|
| `message` | `{"role": "<mapped_role>", "content": "<merged_text>"}` — developer 映射为 system，content 多段用换行合并 |
| `function_call` | `{"role": "assistant", "content": null, "tool_calls": [{"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}]}` |
| `function_call_output` | `{"role": "tool", "tool_call_id": call_id, "content": output}` |
| `reasoning` | 跳过 |
| 未知 type | 跳过并记录 warning |

### 转换约束

- 纯函数，无副作用
- 未知 type 不崩溃
- content 为 null 时设为空字符串
- instructions 为 null 时 system 消息填 `"You are a helpful assistant."`
- input 为空数组时 messages 仅含 system 消息

## 响应转换：Chat Completions → Responses

### 非流式

DeepSeek Chat Completion → Codex Response：

```json
{
  "id": "resp_<uuid7>",
  "object": "response",
  "status": "completed",
  "output": [...],
  "usage": {...}
}
```

output 构建：
- `choices[0].message.content` 有值 → 生成 `type: "message"` 输出项
- `choices[0].message.tool_calls` 有值 → 生成 `type: "function_call"` 输出项
- 同时有文本和工具调用时，先文本后工具调用
- 空 choices → 生成空文本输出项

### 流式（SSE）

DeepSeek SSE 流 → Codex 事件序列，状态机如下：

```
收到首个 chunk（含 role）:
  → response.created
  → response.in_progress
  → response.output_item.added (type: "message")
  → response.content_part.added (type: "output_text")

收到 delta.content 有值:
  → response.output_text.delta

收到首个 tool_calls delta（index 首次出现）:
  → response.output_item.added (type: "function_call")
  → response.function_call_arguments.delta（后续增量同此事件）

收到 finish_reason / [DONE]:
  → response.completed（附 usage）
  → 关闭流
```

SSE 格式：每个事件独占两行（event: + data:），以两个换行结束。结束标志 `[DONE]` 不转发给 Codex。

### 流式关键处理

| 场景 | 处理 |
|------|------|
| 同时有文本+工具调用 | 先发文本 item，结束后再发 function_call item |
| DeepSeek 最后 chunk 含 usage | 缓存，在 `response.completed` 中带上 |
| 流结束未收到 usage | `response.completed` 中 usage 填 null |
| chunk 解析异常 | 跳过该 chunk，记录 warning，不中断流 |

## 错误处理

| 错误类型 | 处理 |
|---------|------|
| 配置错误（Key 为空、yaml 格式错） | 启动时立即退出，打印原因 |
| 上游连接错误（不可达/超时） | 返回 Codex 格式 `{"type":"error","error":{"code":"upstream_unavailable","message":"..."}}` |
| 上游业务错误（4xx/5xx） | 透传为 Codex 格式错误事件 |
| 请求体非 JSON | 返回 `{"type":"error","error":{"code":"invalid_request","message":"..."}}` |
| 流式 chunk 异常 | 跳过，记录 warning，不中断流 |

### 超时配置

- httpx 客户端：连接 10s，读取 120s（流式长连接）
- 不设重试，失败由 Codex 决定重试
- 单个 httpx AsyncClient 实例，应用级别复用

## 配置设计（config.yaml）

```yaml
server:
  host: "0.0.0.0"
  port: 8317

deepseek:
  api_base: "https://api.deepseek.com"
  api_keys:
    - "sk-xxx"
  # 多 Key 时轮询使用

model_map:
  "gpt-5.5": "deepseek-v4-pro"
  "gpt-5.4": "deepseek-v4-pro"
  "gpt-5.4-mini": "deepseek-v4-pro"
  "deepseek-v4-pro": "deepseek-v4-pro"
```

## 测试策略

### 单元测试

| 模块 | 内容 | 工具 |
|------|------|------|
| `request.py` | 各 input type 转换、空/null 边界、未知 type 跳过 | pytest |
| `response.py`（非流式） | 有/无 tool_calls 转换、usage 透传 | pytest |
| `response.py`（流式） | 模拟 SSE chunk 序列，验证事件类型和顺序 | pytest + mock |
| `config.py` | 正常加载、缺失文件、格式错误 | pytest |

### 集成测试

- TestClient + mock httpx 上游，端到端验证请求/响应
- 流式集成：验证事件流从 `response.created` 到 `response.completed` 完整

### 不做

- 不测试 DeepSeek 真实 API（需 Key）
- 不做性能压测

## 边界情况清单

- `instructions` 为 null → system 消息使用默认值
- `input` 为空数组 → messages 仅含 system 消息
- `content` 为 null → 设为空字符串
- `tool_calls` 中字段为 null → 保留 null，由上游处理
- 同时出现文本和工具调用 → 先文本后工具调用
- 空 choices → 生成空文本输出项，正常结束
