# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

本地 HTTP 代理，将 Codex CLI 的 OpenAI Responses API 请求转换为 DeepSeek Chat Completions API 格式，并反向转换响应。监听 8317 端口。

## 常用命令

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务
uvicorn src.main:app --host 0.0.0.0 --port 8317

# 运行全部测试
pytest tests/ -v

# 运行单模块测试
pytest tests/test_request.py -v
pytest tests/test_response.py -v
pytest tests/test_config.py -v

# 健康检查
curl http://localhost:8317/health
```

## 架构

```
Codex CLI → POST /v1/responses → request.py → DeepSeek /v1/chat/completions
                                           ↓
Codex CLI ← StreamingResponse/JSON ← response.py ←── DeepSeek SSE/JSON
```

四层模块，纯函数风格，通过 FastAPI 入口协调：

| 模块 | 文件 | 职责 |
|------|------|------|
| 入口 | `src/main.py` | FastAPI 应用，挂载 `/v1/responses` 和 `/health`，根据 `stream` 分流 |
| 配置 | `src/config.py` | `Config` 数据类 + `load_config(path)` 加载 YAML，含 Key 轮询、模型映射 |
| 请求转换 | `src/converter/request.py` | 纯函数 `convert_request(body, model_map)` → Responses → Chat Completions |
| 响应转换 | `src/converter/response.py` | `convert_nonstream(ds_resp)` + 异步生成器 `stream_generator(payload, api_base, api_key)` |
| 日志 | `src/logger.py` | `log_request(model, msg_count, stream)` / `log_response(model, elapsed, status)` |

### 转换核心规则

- `instructions` → `messages[0]` 作为 `system` 角色
- `input[]` 逐条转换：`message`/`function_call`/`function_call_output` → 标准 OpenAI message
- `developer` 角色映射为 `system`，`reasoning` 类型跳过
- `tools`/`tool_choice`/`temperature`/`stream` 直接透传
- `max_output_tokens` → `max_tokens`
- 流式响应通过 SSE 状态机处理：`init → text → (optional) tool_calls → completed`

### 配置（config.yaml）

- `deepseek.api_keys` 列表，请求时轮询
- `model_map` 字典，Codex 模型名映射到 DeepSeek 模型名，未匹配则透传
- API Key 为 `sk-xxx` 占位符时启动退出

## 技术细节

- httpx AsyncClient 连接 10s / 读取 120s 超时，应用级别复用
- 流式 SSE 格式：`event: <type>\ndata: <json>\n\n`
- ID 生成使用 `uuid.uuid4().hex[:12]` 前缀格式（`resp_`、`item_msg_`、`call_`）
- 测试 fixtures 在 `tests/conftest.py`，集成测试使用 TestClient + mock httpx / mock stream_generator

# andrej-karpathy-skills 设置

echo "" >> CLAUDE.md
curl https://raw.githubusercontent.com/forrestchang/andrej-karpathy-skills/main/CLAUDE.md >> CLAUDE.md
