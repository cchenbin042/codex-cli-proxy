# cli-proxy

Codex CLI → DeepSeek API 协议转换代理，将 OpenAI Responses API 请求转换为 DeepSeek Chat Completions API 格式，并反向转换响应。

## 功能特性

- **请求转换** — 将 Codex CLI 的 Responses API 请求体转换为 Chat Completions 格式
- **响应转换** — 非流式 JSON 与流式 SSE 两种响应模式均支持
- **流式事件处理** — 完整实现 SSE 事件状态机（`response.created` → `delta` → `response.completed`）
- **工具调用透传** — 支持 function_call / function_call_output 的多轮工具调用循环
- **模型映射** — 通过配置文件灵活映射模型名称（如 `gpt-5.5` → `deepseek-v4-pro`）
- **多 Key 轮询** — 支持配置多个 API Key 并自动轮换
- **结构化日志** — 每次请求打印模型、消息数、耗时摘要

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Python 3.11+ |
| Web 框架 | FastAPI |
| 服务器 | uvicorn |
| HTTP 客户端 | httpx（异步、连接池复用） |
| 配置解析 | PyYAML |
| 测试 | pytest + pytest-asyncio |

## 架构

```
Codex CLI → POST /v1/responses → request.py 转换 → DeepSeek API
                                                        ↓
Codex CLI ← StreamingResponse / JSON ← response.py 转换 ←─┘
```

## 项目结构

```
cli-proxy/
├── config.yaml              # 模型映射、API Key 等配置
├── requirements.txt         # Python 依赖
├── src/
│   ├── __init__.py
│   ├── main.py              # FastAPI 应用入口，/v1/responses 路由
│   ├── config.py            # 配置加载与管理（Config 数据类）
│   ├── converter/
│   │   ├── __init__.py
│   │   ├── request.py       # 请求转换纯函数
│   │   └── response.py      # 响应转换 + SSE 流生成器
│   └── logger.py            # 结构化请求日志
├── tests/
│   └── fixtures/            # 测试用例数据
└── docs/
    └── superpowers/
        ├── specs/           # 设计文档
        └── plans/           # 实施计划
```

## 安装与运行

### 环境要求

- Python 3.11 及以上
- DeepSeek API Key

### 安装

```bash
# 克隆仓库
git clone https://github.com/cchenbin042/codex-cli-proxy.git
cd cli-proxy

# 创建虚拟环境（可选）
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# 安装依赖
pip install -r requirements.txt
```

### 配置

编辑项目根目录下的 `config.yaml`，将 `sk-xxx` 替换为你的 DeepSeek API Key：

```yaml
deepseek:
  api_keys:
    - "sk-your-actual-key-here"   # 支持多个 Key 轮询
```

模型映射可按需调整：

```yaml
model_map:
  "gpt-5.5": "deepseek-v4-pro"
  "gpt-5.4": "deepseek-v4-pro"
  "gpt-5.4-mini": "deepseek-v4-pro"
```

### 启动

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8317
```

服务启动后监听 `http://localhost:8317`。

## 使用说明

### 配置 Codex CLI

设置 Codex CLI 使用本地代理作为 API 后端：

```bash
export CODEX_API_BASE_URL="http://localhost:8317/v1"
```

或等价的环境变量，具体取决于 Codex CLI 版本。

### 健康检查

```bash
curl http://localhost:8317/health
# → {"status":"ok"}
```

### 发送测试请求

```bash
curl -X POST http://localhost:8317/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-pro",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [{"type": "input_text", "text": "你好"}]
      }
    ],
    "stream": false
  }'
```

### 运行测试

```bash
# 运行全部测试
pytest tests/ -v

# 运行单模块测试
pytest tests/test_request.py -v
pytest tests/test_response.py -v
```

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/v1/responses` | 代理入口，支持流式/非流式 |
| `GET` | `/health` | 健康检查 |

## 配置说明

所有配置均在 `config.yaml` 中：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `server.host` | string | 监听地址，默认 `0.0.0.0` |
| `server.port` | int | 监听端口，默认 `8317` |
| `deepseek.api_base` | string | DeepSeek API 地址 |
| `deepseek.api_keys` | list | API Key 列表，请求时轮询使用 |
| `model_map` | dict | Codex 模型名 → DeepSeek 模型名映射 |

## 数据流

### 请求转换 (Responses → Chat Completions)

| Codex 字段 | DeepSeek 字段 | 处理 |
|-----------|--------------|------|
| `model` | `model` | 查映射表替换 |
| `instructions` | `messages[0]` | 作为 system 角色首条消息 |
| `input[]` | `messages[1:]` | 逐条按类型转换 |
| `tools` / `tool_choice` | 同名 | 直接透传 |
| `stream` | `stream` | 直接透传 |
| `reasoning` | — | 丢弃 |

### input 类型转换

| input type | 输出 message |
|-----------|-------------|
| `message` | `{"role": "...", "content": "..."}` |
| `function_call` | `{"role": "assistant", "content": null, "tool_calls": [...]}` |
| `function_call_output` | `{"role": "tool", "tool_call_id": "...", "content": "..."}` |
| `reasoning` | 跳过 |

## 贡献指南

1. Fork 本仓库
2. 基于 `master` 创建特性分支：`git checkout -b feature/xxx`
3. 编写代码和测试，确保 `pytest tests/ -v` 全部通过
4. 提交并使用清晰的 commit message
5. 推送到你的 Fork 并提交 Pull Request

## 许可证

MIT License

Copyright (c) 2026
