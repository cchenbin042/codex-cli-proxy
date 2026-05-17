# codex-cli-proxy

Codex CLI/Desktop → DeepSeek API 协议转换代理。将 OpenAI Responses API 请求转换为 DeepSeek Chat Completions API 格式，并反向转换响应。监听 8317 端口。

## 架构

```
Codex CLI/Desktop → POST /v1/responses → request.py → DeepSeek /v1/chat/completions
                                                 ↓
Codex CLI/Desktop ← StreamingResponse/JSON ← response.py ←── DeepSeek SSE/JSON
                                                 ↑
                                            store.py（reasoning 持久化）
```

四层模块，纯函数风格，通过 FastAPI 入口协调：

| 模块 | 文件 | 职责 |
|------|------|------|
| 入口 | `src/main.py` | FastAPI 应用，挂载 `/v1/responses` 和 `/health`，按 `session_id` 透传 |
| 配置 | `src/config.py` | `Config` 数据类 + `load_config(path)`，含 Key 轮询、模型映射、思考开关 |
| 请求转换 | `src/converter/request.py` | `convert_request(body, model_map, session_id, thinking_disabled)` |
| 响应转换 | `src/converter/response.py` | `convert_nonstream(ds_resp, session_id)` + 异步生成器 `stream_generator(payload, api_base, api_key, session_id)` |
| 状态持久化 | `src/store.py` | 按 `session_id` 索引的 reasoning_store，启动加载/追加写盘 |
| 日志 | `src/logger.py` | 双向日志：用户对话摘要 + DeepSeek 响应 + Codex 转换结果 |

## 安装与运行

```bash
# 安装依赖
pip install -r requirements.txt

# 配置 API Key（编辑 config.yaml）
# deepseek.api_keys 下替换 sk-xxx 为真实 key

# 启动
uvicorn src.main:app --host 0.0.0.0 --port 8317

# 健康检查
curl http://localhost:8317/health

# 运行测试
pytest tests/ -v
```

## Codex CLI 接入配置

让 Codex CLI 通过 cli-proxy 代理访问 DeepSeek API：

### 方式一：环境变量（推荐）

```bash
# 将 Codex CLI 的 API 地址指向本地代理
export CODEX_API_BASE_URL="http://127.0.0.1:8317/v1"

# 代理会忽略 API Key 内容（使用 config.yaml 中配置的 DeepSeek Key），
# 但仍需设置一个非空值以通过 Codex CLI 校验
export CODEX_API_KEY="sk-proxy"
```

### 方式二：Codex CLI 配置文件

编辑 `~/.codex/config.toml`（或项目级 `.codex.toml`）：

```toml
[api]
base_url = "http://127.0.0.1:8317/v1"
api_key = "sk-proxy"

[model]
# 模型名会按 config.yaml 中的 model_map 映射到 DeepSeek 模型
default = "gpt-5.5"
```

### 验证

```bash
# 1. 启动代理
uvicorn src.main:app --host 0.0.0.0 --port 8317

# 2. 验证代理健康状态
curl http://localhost:8317/health
# → {"status":"ok"}

# 3. 使用 Codex CLI，观察代理日志输出
codex "你好，请用 Python 写一个 hello world"
```

> **原理：** Codex CLI 将请求发到代理的 `/v1/responses`，代理转换为 DeepSeek Chat Completions 格式后向上游请求，再将响应转换回 Codex 兼容格式返回。

## 配置说明（config.yaml）

```yaml
server:
  host: "0.0.0.0"
  port: 8317

deepseek:
  api_base: "https://api.deepseek.com"
  api_keys:
    - "sk-xxx"                    # 替换为真实 Key
  thinking_disabled: true         # 关闭 DeepSeek 思考模式，加速响应

model_map:
  "gpt-5.5": "deepseek-v4-pro"
  "gpt-5.4": "deepseek-v4-pro"
  "deepseek-v4-pro": "deepseek-v4-pro"
```

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `server.host` | string | 监听地址，默认 `0.0.0.0` |
| `server.port` | int | 监听端口，默认 `8317` |
| `deepseek.api_base` | string | DeepSeek API 地址 |
| `deepseek.api_keys` | list | API Key 列表，请求时轮询 |
| `deepseek.thinking_disabled` | bool | 关闭 DeepSeek 思考模式（默认 false） |
| `model_map` | dict | Codex 模型名 → DeepSeek 模型名映射 |

## 请求转换规则

### 消息转换

| Codex input type | DeepSeek message |
|-----------------|-----------------|
| `message` (user/assistant) | `{"role": "...", "content": "..."}` |
| `message` (developer) | `{"role": "system", "content": "..."}` |
| `function_call` | 合并到上一条 assistant 的 `tool_calls[]` 中 |
| `function_call_output` | `{"role": "tool", "tool_call_id": "...", "content": "..."}` |
| `reasoning` | 跳过 |

同一轮连续的 `message(assistant)` + `function_call` 项合并为一条 DeepSeek assistant 消息，所有 tool_calls 聚合在一起。

### 字段映射

| Codex 字段 | DeepSeek 字段 | 处理 |
|-----------|--------------|------|
| `instructions` | `messages[0]` | 作为 system 角色 |
| `model` | `model` | 查 model_map 替换，未匹配则透传 |
| `tools` / `tool_choice` | 同名 | 过滤非 function 工具，扁平 tools 包装为嵌套格式 |
| `temperature` / `stream` | 同名 | 直接透传 |
| `max_output_tokens` | `max_tokens` | 重命名 |
| `reasoning` | — | 丢弃 |
| — | `thinking` | `thinking_disabled=true` 时注入 `{"type": "disabled"}` |

### reasoning_content 处理

- 每条成功的 DeepSeek 响应提取 `reasoning_content`，按 `session_id` 存入 `reasoning_store`
- 后续请求中的 assistant 消息自动附加对应的 `reasoning_content`
- store 持久化到 `reasoning_stores.json`，proxy 重启后自动恢复
- 检测到新对话（assistant 轮次为 0 但 store 非空）时自动重置

### 工具过滤

DeepSeek 不支持 `web_search`、`code_interpreter` 等非 function 工具，proxy 自动过滤，仅保留 function 类型。

## 响应转换规则

### 流式 (SSE)

状态机流程：`init → text → (optional) tool_calls → completed`

| SSE Event | 说明 |
|-----------|------|
| `response.created` | 创建响应 |
| `response.in_progress` | 开始处理 |
| `response.output_item.added` | 新增输出项（message 或 function_call） |
| `response.content_part.added` | 新增内容片段 |
| `response.output_text.delta` | 文本增量 |
| `response.function_call_arguments.delta` | 工具调用参数增量 |
| `response.content_part.done` | 内容片段完成 |
| `response.output_item.done` | 输出项完成 |
| `response.completed` | 响应完成 |

### 非流式

直接返回完整的 Codex Responses API 格式 JSON，包含 `id`、`object`、`status`、`output`、`usage`。

## 技术细节

| 项目 | 说明 |
|------|------|
| HTTP 客户端 | httpx AsyncClient，连接 10s / 读取 120s / 写入 60s 超时 |
| 流式 SSE 格式 | `event: <type>\ndata: <json>\n\n` |
| ID 生成 | `uuid.uuid4().hex[:12]` 带前缀（`resp_`、`item_msg_`、`call_`） |
| API Key 轮询 | 每次请求取下一个 key，循环使用 |
| reasoning 持久化 | 按 session_id 索引，JSON 文件存储，追加后即时写盘 |

## 日志示例

```
Request: model=deepseek-v4-pro, messages=7, stream=True
  [user] 帮我用node.js+HTML实现用户注册...
  [tool_call] shell({"command":"ls"})
  [tool_result] {"files":["test.py"]}
DeepSeek -> tool_call: write_file({"path":"C:\\...","content":"..."})
DeepSeek -> usage: prompt=15814 completion=380 total=16194 reasoning=0
Codex <- message: 好的，我先创建项目文件...
Response: model=deepseek-v4-pro, elapsed=3241ms, status=completed
```
