# cli-proxy 桌面端升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 cli-proxy 从 Electron + Python FastAPI 全面重建为 Tauri 2 + Rust sidecar + React 架构，UI 对齐 cc-switch，实现托盘快速切换 Provider、预设库一键导入、用量/成本追踪、代理熔断/限流/重试、主题切换。

**Architecture:** 独立 Rust axum 代理 binary (sidecar) + Tauri 2 管理壳 + React TypeScript 前端。代理无状态，通过环境变量注入配置；Tauri 侧管理 SQLite 配置存储、用量历史、进程生命周期、系统托盘。

**Tech Stack:** Rust (axum + tokio + reqwest + rusqlite) / Tauri 2 / React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui + TanStack Query + recharts + @dnd-kit

---

## 文件结构总览

```
cli-proxy/
├── proxy/                            # 代理 Sidecar (独立 Rust binary)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                   # axum 入口, /v1/responses + /health
│       ├── config.rs                 # 从 env vars 读配置
│       ├── converter/
│       │   ├── mod.rs
│       │   ├── request.rs            # Responses API → Chat Completions
│       │   └── response.rs           # Chat Completions → Responses (SSE + JSON)
│       ├── providers/
│       │   ├── mod.rs                # Provider trait + registry + resolve_provider()
│       │   ├── deepseek.rs
│       │   ├── qwen.rs
│       │   ├── bailian.rs
│       │   ├── moonshot.rs
│       │   └── siliconflow.rs
│       ├── reliability/
│       │   ├── mod.rs
│       │   ├── circuit.rs            # Circuit breaker
│       │   ├── ratelimit.rs          # Token bucket rate limiter
│       │   ├── retry.rs              # Exponential backoff retry
│       │   └── concurrency.rs        # Semaphore concurrency control
│       ├── cache.rs                  # LRU + TTL response cache
│       ├── audit.rs                  # JSONL daily-rotating audit writer
│       ├── store.rs                  # reasoning_content session persistence
│       ├── logger.rs                 # 结构化日志
│       └── tracer.rs                 # X-Trace-Id middleware
│
├── src/                              # 前端 (React + TypeScript)
│   ├── components/
│   │   ├── ui/                       # shadcn/ui 组件
│   │   ├── dashboard/                # StatusCard, ProviderGrid, StatsCards, Charts
│   │   ├── providers/                # ProviderCard, KeyList, PresetDialog
│   │   ├── models/                   # RouteTable
│   │   ├── logs/                     # LogTable, LogToolbar
│   │   ├── settings/                 # ServerSettings, ReliabilitySettings, ThemeSettings
│   │   └── layout/                   # Sidebar, AppLayout
│   ├── hooks/                        # useProviders, useModels, useStats, useLogs
│   ├── lib/
│   │   ├── api/                      # Tauri invoke 封装（类型安全）
│   │   └── query/                    # TanStack Query 配置
│   ├── types/                        # TypeScript 类型定义
│   └── App.tsx
│
├── src-tauri/                        # Tauri 核心 (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── icons/
│   └── src/
│       ├── main.rs                   # Tauri 入口
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── provider_cmd.rs       # 供应商 CRUD + 切换
│       │   ├── model_cmd.rs          # 模型路由 CRUD
│       │   ├── settings_cmd.rs       # 设置读写
│       │   ├── stats_cmd.rs          # 用量查询
│       │   └── sidecar_cmd.rs        # 代理启停/状态
│       ├── services/
│       │   ├── mod.rs
│       │   ├── provider_svc.rs       # 供应商业务逻辑
│       │   ├── model_svc.rs          # 模型路由逻辑
│       │   ├── config_svc.rs         # 配置管理 + env 组装
│       │   ├── sidecar_mgr.rs        # 代理进程管理
│       │   └── tray_mgr.rs           # 系统托盘（含快速切换菜单）
│       ├── database/
│       │   ├── mod.rs
│       │   ├── migration.rs          # 表迁移
│       │   ├── provider_dao.rs
│       │   ├── model_dao.rs
│       │   ├── settings_dao.rs
│       │   └── usage_dao.rs
│       └── crypto/
│           ├── mod.rs
│           └── vault.rs              # ChaCha20 + keyring
│
├── package.json                      # 前端依赖
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## Phase 1: 代理核 (proxy sidecar)

独立 Rust binary，完整复刻当前 Python 代理的全部功能。

### Task 1: 初始化 Cargo 项目 + 依赖

**Files:**
- Create: `proxy/Cargo.toml`
- Create: `proxy/src/main.rs`
- Create: 所有模块占位文件

- [ ] **Step 1: 创建 Cargo.toml**

```toml
[package]
name = "cli-proxy-sidecar"
version = "1.0.0"
edition = "2021"

[dependencies]
axum = { version = "0.7", features = ["macros"] }
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
lru = "0.12"
dashmap = "6"
chrono = { version = "0.4", features = ["serde"] }
thiserror = "1"
once_cell = "1"
rand = "0.8"
tokio-stream = "0.1"
async-stream = "0.3"
futures = "0.3"
async-trait = "0.1"

[dev-dependencies]
axum-test = "15"
wiremock = "0.6"
```

- [ ] **Step 2: 创建 main.rs 骨架**

```rust
// proxy/src/main.rs
mod config;
mod converter;
mod providers;
mod reliability;
mod cache;
mod audit;
mod store;
mod logger;
mod tracer;

use axum::{routing::get, Router};
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    logger::init();
    let config = config::load_from_env();

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/responses", axum::routing::post(handle_responses))
        .with_state(config);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("proxy listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    "{\"status\": \"ok\"}"
}

// handler stub
async fn handle_responses() -> &'static str {
    "not yet implemented"
}
```

- [ ] **Step 3: 创建所有模块占位文件**

Run:
```bash
mkdir -p proxy/src/converter proxy/src/providers proxy/src/reliability
for f in config converter/mod converter/request converter/response \
  providers/mod providers/deepseek providers/qwen providers/bailian \
  providers/moonshot providers/siliconflow \
  reliability/mod reliability/circuit reliability/ratelimit \
  reliability/retry reliability/concurrency \
  cache audit store logger tracer; do
  echo "// ${f##*/}" > proxy/src/${f}.rs
done
```

- [ ] **Step 4: 编译验证**

Run: `cd proxy && cargo build`
Expected: 编译成功（有 dead_code warning，可忽略）

- [ ] **Step 5: Commit**

```bash
cd proxy && git add -A && git commit -m "chore(proxy): 初始化 Cargo 项目 + 模块骨架"
```

---

### Task 2: config.rs — 环境变量配置加载

**Files:**
- Modify: `proxy/src/config.rs`
- Modify: `proxy/src/providers/mod.rs` (Provider trait 定义)

- [ ] **Step 1: 写 config.rs**

```rust
// proxy/src/config.rs
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub model_map: HashMap<String, String>,
    pub providers: Vec<ProviderConfig>,
    pub default_provider: String,
    pub reliability: ReliabilityConfig,
    pub thinking_disabled: bool,
    pub cache_enabled: bool,
    pub cache_ttl_secs: u64,
    pub cache_max_entries: usize,
}

#[derive(Clone, Debug)]
pub struct ProviderConfig {
    pub name: String,
    pub api_base: String,
    pub api_keys: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ReliabilityConfig {
    pub retry_max: u32,
    pub retry_backoff_base: f64,
    pub circuit_threshold: u32,
    pub circuit_cooldown_secs: u64,
    pub concurrency_max: usize,
    pub concurrency_queue_timeout_secs: u64,
    pub rate_limit_per_min: u32,
    pub rate_limit_burst: u32,
}

impl Default for ReliabilityConfig {
    fn default() -> Self {
        Self {
            retry_max: 3,
            retry_backoff_base: 2.0,
            circuit_threshold: 5,
            circuit_cooldown_secs: 30,
            concurrency_max: 10,
            concurrency_queue_timeout_secs: 30,
            rate_limit_per_min: 30,
            rate_limit_burst: 30,
        }
    }
}

pub fn load_from_env() -> Config {
    let port: u16 = std::env::var("CLI_PROXY_PORT")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(8317);

    let model_map = parse_model_map(
        &std::env::var("CLI_PROXY_MODEL_MAP").unwrap_or_default()
    );

    let providers = parse_providers(
        &std::env::var("CLI_PROXY_PROVIDERS").unwrap_or_default()
    );

    let default_provider = std::env::var("CLI_PROXY_DEFAULT_PROVIDER")
        .unwrap_or_else(|_| "deepseek".to_string());

    let thinking_disabled = std::env::var("CLI_PROXY_THINKING_DISABLED")
        .map(|v| v == "1" || v == "true").unwrap_or(false);

    let cache_enabled = std::env::var("CLI_PROXY_CACHE_ENABLED")
        .map(|v| v == "1" || v == "true").unwrap_or(true);

    let cache_ttl_secs: u64 = std::env::var("CLI_PROXY_CACHE_TTL")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(300);
    let cache_max_entries: usize = std::env::var("CLI_PROXY_CACHE_MAX")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(1000);

    let reliability = ReliabilityConfig {
        retry_max: env_parse("CLI_PROXY_RETRY_MAX", 3),
        retry_backoff_base: env_parse("CLI_PROXY_RETRY_BACKOFF", 2.0),
        circuit_threshold: env_parse("CLI_PROXY_CIRCUIT_THRESHOLD", 5),
        circuit_cooldown_secs: env_parse("CLI_PROXY_CIRCUIT_COOLDOWN", 30u64),
        concurrency_max: env_parse("CLI_PROXY_CONCURRENCY_MAX", 10usize),
        concurrency_queue_timeout_secs: env_parse("CLI_PROXY_CONCURRENCY_TIMEOUT", 30u64),
        rate_limit_per_min: env_parse("CLI_PROXY_RATE_LIMIT", 30u32),
        rate_limit_burst: env_parse("CLI_PROXY_RATE_BURST", 30u32),
    };

    Config { port, model_map, providers, default_provider, reliability,
             thinking_disabled, cache_enabled, cache_ttl_secs, cache_max_entries }
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn parse_model_map(raw: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if raw.is_empty() { return map; }
    for pair in raw.split(',') {
        let parts: Vec<&str> = pair.splitn(2, '=').collect();
        if parts.len() == 2 {
            map.insert(parts[0].trim().to_string(), parts[1].trim().to_string());
        }
    }
    map
}

fn parse_providers(raw: &str) -> Vec<ProviderConfig> {
    let mut providers = Vec::new();
    if raw.is_empty() { return providers; }
    for entry in raw.split('|') {
        let parts: Vec<&str> = entry.splitn(3, ':').collect();
        if parts.len() >= 2 {
            let keys: Vec<String> = parts.get(2)
                .map(|k| k.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default();
            providers.push(ProviderConfig {
                name: parts[0].trim().to_string(),
                api_base: parts[1].trim().to_string(),
                api_keys: keys,
            });
        }
    }
    providers
}
```

- [ ] **Step 2: 写 providers/mod.rs — Provider trait + registry**

```rust
// proxy/src/providers/mod.rs
use async_trait::async_trait;
use std::collections::HashMap;
use crate::config::ProviderConfig;

pub mod deepseek;
pub mod qwen;
pub mod bailian;
pub mod moonshot;
pub mod siliconflow;

#[async_trait]
pub trait Provider: Send + Sync {
    fn name(&self) -> &str;
    fn api_base(&self) -> &str;

    async fn chat_completions(
        &self,
        payload: &serde_json::Value,
        client: &reqwest::Client,
    ) -> Result<reqwest::Response, reqwest::Error>;

    async fn stream_chat_completions(
        &self,
        payload: &serde_json::Value,
        client: &reqwest::Client,
    ) -> Result<reqwest::Response, reqwest::Error>;
}

pub fn create_providers(configs: &[ProviderConfig]) -> HashMap<String, Box<dyn Provider>> {
    let mut map: HashMap<String, Box<dyn Provider>> = HashMap::new();
    for cfg in configs {
        let provider: Box<dyn Provider> = match cfg.name.as_str() {
            "deepseek" => Box::new(deepseek::DeepSeekProvider::new(&cfg.api_base, &cfg.api_keys)),
            "qwen" => Box::new(qwen::QwenProvider::new(&cfg.api_base, &cfg.api_keys)),
            "bailian" => Box::new(bailian::BailianProvider::new(&cfg.api_base, &cfg.api_keys)),
            "moonshot" => Box::new(moonshot::MoonshotProvider::new(&cfg.api_base, &cfg.api_keys)),
            "siliconflow" => Box::new(siliconflow::SiliconFlowProvider::new(&cfg.api_base, &cfg.api_keys)),
            _ => continue,
        };
        map.insert(cfg.name.clone(), provider);
    }
    map
}

pub fn resolve_provider(
    model: &str,
    model_map: &HashMap<String, String>,
    default_provider: &str,
) -> (String, String) {
    let mapped = model_map.get(model).cloned().unwrap_or_else(|| model.to_string());
    if let Some((provider_name, vendor_model)) = mapped.split_once(':') {
        (provider_name.to_string(), vendor_model.to_string())
    } else {
        (default_provider.to_string(), mapped)
    }
}
```

- [ ] **Step 3: 编译验证**

Run: `cd proxy && cargo build`
Expected: 编译成功（dead_code warnings 可忽略）

- [ ] **Step 4: Commit**

```bash
cd proxy && git add -A && git commit -m "feat(proxy): 环境变量配置加载 + Provider trait 定义"
```

---

### Task 3: converter/request.rs — Responses API → Chat Completions 转换

**Files:**
- Modify: `proxy/src/converter/mod.rs`
- Modify: `proxy/src/converter/request.rs`

- [ ] **Step 1: 写 converter/mod.rs**

```rust
// proxy/src/converter/mod.rs
pub mod request;
pub mod response;
```

- [ ] **Step 2: 写 converter/request.rs — 完整转换逻辑**

注意：此文件需完整复刻 Python `src/converter/request.py` 的转换规则：
- `instructions` → `messages[0]` 作为 `system` 角色
- `input[]` 逐条转换：`message`/`function_call`/`function_call_output` → 标准 OpenAI message
- `developer` 角色映射为 `system`，`reasoning` 类型跳过
- `tools` 只保留 type=function，支持扁平格式包装
- `tool_choice`/`temperature`/`stream` 透传
- `max_output_tokens` → `max_tokens`
- assistant message 合并（同 role 的相邻项合并 tool_calls）
- `thinking_disabled` 时注入 `"thinking": {"type": "disabled"}`

```rust
// proxy/src/converter/request.rs
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn convert_request(
    body: &Value,
    model_map: &HashMap<String, String>,
    reasoning_store: &[String],
    thinking_disabled: bool,
) -> Value {
    let mut messages: Vec<Value> = Vec::new();

    let instructions = body.get("instructions")
        .and_then(|v| v.as_str())
        .unwrap_or("You are a helpful assistant.");
    messages.push(json!({"role": "system", "content": instructions}));

    let mut assistant_idx: usize = 0;
    let mut buf: Option<Value> = None;

    let input_items = body.get("input")
        .and_then(|v| v.as_array())
        .map(|a| a.clone())
        .unwrap_or_default();

    for item in &input_items {
        let msg = convert_input_item(item);
        if msg.is_none() { continue; }
        let msg = msg.unwrap();

        if msg.get("role").and_then(|v| v.as_str()) == Some("assistant") {
            if buf.is_none() {
                let has_reasoning = assistant_idx < reasoning_store.len()
                    && !reasoning_store[assistant_idx].is_empty();
                let mut b = json!({
                    "role": "assistant",
                    "content": msg.get("content").cloned().unwrap_or(json!("")),
                });
                if has_reasoning {
                    if let Some(obj) = b.as_object_mut() {
                        obj.insert("reasoning_content".to_string(),
                            json!(reasoning_store[assistant_idx]));
                    }
                }
                if let Some(tcs) = msg.get("tool_calls").and_then(|v| v.as_array()) {
                    if !tcs.is_empty() {
                        if let Some(obj) = b.as_object_mut() {
                            obj.insert("tool_calls".to_string(), json!(tcs));
                        }
                    }
                }
                buf = Some(b);
            } else {
                if let Some(tcs) = msg.get("tool_calls").and_then(|v| v.as_array()) {
                    if let Some(ref mut b) = buf {
                        let existing = b.get("tool_calls")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        let merged: Vec<Value> = existing.iter()
                            .chain(tcs.iter()).cloned().collect();
                        if let Some(obj) = b.as_object_mut() {
                            obj.insert("tool_calls".to_string(), json!(merged));
                        }
                    }
                }
                if let Some(content) = msg.get("content").and_then(|v| v.as_str()) {
                    if !content.is_empty() {
                        if let Some(ref mut b) = buf {
                            if let Some(obj) = b.as_object_mut() {
                                obj.insert("content".to_string(), json!(content));
                            }
                        }
                    }
                }
            }
        } else {
            if let Some(mut b) = buf.take() {
                let has_tool_calls = b.get("tool_calls")
                    .and_then(|v| v.as_array())
                    .map(|a| !a.is_empty())
                    .unwrap_or(false);
                if !has_tool_calls {
                    if let Some(obj) = b.as_object_mut() {
                        obj.remove("tool_calls");
                    }
                }
                messages.push(b);
                assistant_idx += 1;
            }
            messages.push(msg);
        }
    }

    if let Some(mut b) = buf.take() {
        let has_tool_calls = b.get("tool_calls")
            .and_then(|v| v.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false);
        if !has_tool_calls {
            if let Some(obj) = b.as_object_mut() {
                obj.remove("tool_calls");
            }
        }
        messages.push(b);
    }

    let model_name = body.get("model").and_then(|v| v.as_str()).unwrap_or("");
    let model = model_map.get(model_name).cloned().unwrap_or_else(|| model_name.to_string());

    let mut payload = json!({
        "model": model,
        "messages": messages,
        "stream": body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false),
    });

    if let Some(obj) = payload.as_object_mut() {
        if let Some(tools) = body.get("tools") {
            if let Some(tools_arr) = tools.as_array() {
                let filtered: Vec<Value> = tools_arr.iter().filter_map(|t| {
                    if t.get("type").and_then(|v| v.as_str()) != Some("function") {
                        return None;
                    }
                    if t.get("function").is_some() {
                        Some(t.clone())
                    } else {
                        Some(json!({
                            "type": "function",
                            "function": {
                                "name": t.get("name").unwrap_or(&json!("")),
                                "description": t.get("description").unwrap_or(&json!("")),
                                "parameters": t.get("parameters").unwrap_or(&json!({})),
                            }
                        }))
                    }
                }).collect();
                if !filtered.is_empty() {
                    obj.insert("tools".to_string(), json!(filtered));
                }
            }
        }

        if let Some(tc) = body.get("tool_choice") {
            obj.insert("tool_choice".to_string(), tc.clone());
        }
        if let Some(temp) = body.get("temperature") {
            obj.insert("temperature".to_string(), temp.clone());
        }
        if let Some(max_tok) = body.get("max_output_tokens") {
            obj.insert("max_tokens".to_string(), max_tok.clone());
        }
    }

    if thinking_disabled {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("thinking".to_string(), json!({"type": "disabled"}));
        }
    }

    payload
}

fn convert_input_item(item: &Value) -> Option<Value> {
    match item.get("type").and_then(|v| v.as_str()) {
        Some("message") => convert_message(item),
        Some("function_call") => convert_function_call(item),
        Some("function_call_output") => convert_function_call_output(item),
        Some("reasoning") => None,
        _ => None,
    }
}

fn convert_message(item: &Value) -> Option<Value> {
    let role = match item.get("role").and_then(|v| v.as_str()) {
        Some("developer") => "system",
        Some(r) => r,
        None => "user",
    };

    let content_blocks = item.get("content").and_then(|v| v.as_array());
    if content_blocks.is_none() {
        return Some(json!({"role": role, "content": ""}));
    }

    let parts: Vec<Value> = content_blocks.unwrap().iter()
        .filter_map(|b| convert_content_block(b))
        .collect();

    if parts.is_empty() {
        return Some(json!({"role": role, "content": ""}));
    }

    if parts.iter().all(|p| p.get("type").and_then(|v| v.as_str()) == Some("text")) {
        let text: String = parts.iter()
            .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<&str>>()
            .join("\n");
        return Some(json!({"role": role, "content": text}));
    }

    Some(json!({"role": role, "content": parts}))
}

fn convert_content_block(block: &Value) -> Option<Value> {
    match block.get("type").and_then(|v| v.as_str()) {
        Some("input_text") | Some("output_text") => Some(json!({
            "type": "text",
            "text": block.get("text").and_then(|v| v.as_str()).unwrap_or("")
        })),
        Some("input_image") => Some(json!({
            "type": "image_url",
            "image_url": {
                "url": block.get("image_url").and_then(|v| v.as_str()).unwrap_or("")
            }
        })),
        Some("input_file") => {
            let text = block.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if text.is_empty() { None } else { Some(json!({"type": "text", "text": text})) }
        }
        _ => None,
    }
}

fn convert_function_call(item: &Value) -> Option<Value> {
    Some(json!({
        "role": "assistant",
        "content": null,
        "tool_calls": [{
            "id": item.get("call_id").and_then(|v| v.as_str()).unwrap_or(""),
            "type": "function",
            "function": {
                "name": item.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                "arguments": item.get("arguments").and_then(|v| v.as_str()).unwrap_or(""),
            }
        }]
    }))
}

fn convert_function_call_output(item: &Value) -> Option<Value> {
    Some(json!({
        "role": "tool",
        "tool_call_id": item.get("call_id").and_then(|v| v.as_str()).unwrap_or(""),
        "content": item.get("output").and_then(|v| v.as_str()).unwrap_or(""),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_instructions_to_system() {
        let body = json!({
            "instructions": "You are a coder.",
            "model": "gpt-5.1",
            "input": []
        });
        let result = convert_request(&body, &HashMap::new(), &[], false);
        let msgs = result["messages"].as_array().unwrap();
        assert_eq!(msgs[0]["role"], "system");
        assert_eq!(msgs[0]["content"], "You are a coder.");
    }

    #[test]
    fn test_message_conversion() {
        let body = json!({
            "instructions": "test",
            "model": "gpt-5.1",
            "input": [{
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "hello"}]
            }]
        });
        let result = convert_request(&body, &HashMap::new(), &[], false);
        let msgs = result["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[1]["role"], "user");
        assert_eq!(msgs[1]["content"], "hello");
    }

    #[test]
    fn test_developer_remaps_to_system() {
        let body = json!({
            "model": "gpt-5.1",
            "input": [{
                "type": "message",
                "role": "developer",
                "content": [{"type": "input_text", "text": "sys msg"}]
            }]
        });
        let result = convert_request(&body, &HashMap::new(), &[], false);
        let msgs = result["messages"].as_array().unwrap();
        assert_eq!(msgs[1]["role"], "system");
    }

    #[test]
    fn test_reasoning_skipped() {
        let body = json!({
            "model": "gpt-5.1",
            "input": [
                {"type": "reasoning", "content": "think..."},
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "ok"}]}
            ]
        });
        let result = convert_request(&body, &HashMap::new(), &[], false);
        let msgs = result["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 2);
    }

    #[test]
    fn test_model_map() {
        let mut map = HashMap::new();
        map.insert("gpt-5.1".to_string(), "deepseek:deepseek-chat".to_string());
        let body = json!({"model": "gpt-5.1", "input": []});
        let result = convert_request(&body, &map, &[], false);
        assert_eq!(result["model"], "deepseek-chat");
    }

    #[test]
    fn test_max_output_tokens_to_max_tokens() {
        let body = json!({"model": "gpt-5.1", "input": [], "max_output_tokens": 4096});
        let result = convert_request(&body, &HashMap::new(), &[], false);
        assert_eq!(result["max_tokens"], 4096);
    }

    #[test]
    fn test_thinking_disabled() {
        let body = json!({"model": "gpt-5.1", "input": []});
        let result = convert_request(&body, &HashMap::new(), &[], true);
        assert_eq!(result["thinking"]["type"], "disabled");
    }

    #[test]
    fn test_function_call_merges_to_assistant() {
        let body = json!({
            "model": "gpt-5.1",
            "input": [
                {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Let me check."}]},
                {"type": "function_call", "call_id": "call_1", "name": "get_weather", "arguments": "{\"city\":\"bj\"}"},
                {"type": "function_call_output", "call_id": "call_1", "output": "sunny"},
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "thanks"}]},
            ]
        });
        let result = convert_request(&body, &HashMap::new(), &[], false);
        let msgs = result["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 4);
        let assistant = &msgs[1];
        assert_eq!(assistant["role"], "assistant");
        assert_eq!(assistant["tool_calls"].as_array().unwrap().len(), 1);
        assert_eq!(msgs[2]["role"], "tool");
        assert_eq!(msgs[2]["tool_call_id"], "call_1");
    }
}
```

- [ ] **Step 3: 跑测试**

Run: `cd proxy && cargo test -- converter::request`
Expected: 8 tests PASS

- [ ] **Step 4: Commit**

```bash
cd proxy && git add -A && git commit -m "feat(proxy): Responses→Chat Completions 请求转换器"
```

---

### Task 4: converter/response.rs — 响应转换 (非流式 + SSE 流式) + store.rs

**Files:**
- Modify: `proxy/src/converter/response.rs`
- Modify: `proxy/src/store.rs`

- [ ] **Step 1: 写 store.rs — reasoning 会话持久化**

```rust
// proxy/src/store.rs
use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;

static STORE: Lazy<Mutex<HashMap<String, Vec<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn append(session_id: &str, reasoning: String) {
    if reasoning.is_empty() { return; }
    let mut store = STORE.lock().unwrap();
    store.entry(session_id.to_string()).or_default().push(reasoning);
}

pub fn get(session_id: &str) -> Vec<String> {
    let store = STORE.lock().unwrap();
    store.get(session_id).cloned().unwrap_or_default()
}

pub fn reset(session_id: &str) {
    let mut store = STORE.lock().unwrap();
    store.remove(session_id);
}
```

- [ ] **Step 2: 写 converter/response.rs — 完整响应转换**

```rust
// proxy/src/converter/response.rs
use serde_json::{json, Value};
use uuid::Uuid;
use crate::store;

fn gen_id(prefix: &str) -> String {
    format!("{}{}", prefix, &Uuid::new_v4().to_string().replace('-', "")[..12])
}

/// Convert non-streaming Chat Completion → Responses API
pub fn convert_nonstream(ds_resp: &Value, session_id: &str) -> Value {
    let response_id = gen_id("resp_");
    let mut output = Vec::new();

    if let Some(choices) = ds_resp.get("choices").and_then(|v| v.as_array()) {
        if let Some(msg) = choices.first().and_then(|c| c.get("message")) {
            let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let tool_calls = msg.get("tool_calls").and_then(|v| v.as_array());

            let reasoning = msg.get("reasoning_content").and_then(|v| v.as_str()).unwrap_or("");
            store::append(session_id, reasoning.to_string());

            if !content.is_empty() {
                output.push(json!({
                    "id": gen_id("item_msg_"),
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": content}],
                }));
            }

            if let Some(tcs) = tool_calls {
                for tc in tcs {
                    let func = tc.get("function").unwrap_or(&json!({}));
                    output.push(json!({
                        "id": tc.get("id").and_then(|v| v.as_str())
                            .unwrap_or(&gen_id("call_")),
                        "type": "function_call",
                        "call_id": tc.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                        "name": func.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                        "arguments": func.get("arguments").and_then(|v| v.as_str()).unwrap_or(""),
                    }));
                }
            }
        }
    }

    if output.is_empty() {
        output.push(json!({
            "id": gen_id("item_msg_"),
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": ""}],
        }));
    }

    json!({
        "id": response_id,
        "object": "response",
        "status": "completed",
        "output": output,
        "usage": map_usage(ds_resp.get("usage")),
    })
}

/// Stream converter: SSE state machine
/// State: init → text → (optional) tool_calls → completed
pub struct StreamConverter {
    pub response_id: String,
    pub msg_item_id: String,
    pub model: String,
    pub phase: String,
    pub text_buf: String,
    pub reasoning_buf: String,
    pub output_items: Vec<Value>,
    pub usage: Option<Value>,
    pub session_id: String,
}

impl StreamConverter {
    pub fn new(model: &str, session_id: &str) -> Self {
        Self {
            response_id: gen_id("resp_"),
            msg_item_id: gen_id("item_msg_"),
            model: model.to_string(),
            phase: "init".to_string(),
            text_buf: String::new(),
            reasoning_buf: String::new(),
            output_items: Vec::new(),
            usage: None,
            session_id: session_id.to_string(),
        }
    }

    /// Process one SSE data chunk. Returns Vec of SSE event strings to yield.
    pub fn process_chunk(&mut self, data_str: &str) -> Vec<String> {
        let mut events = Vec::new();

        if data_str.trim() == "[DONE]" {
            return self.finalize();
        }

        let chunk: Value = match serde_json::from_str(data_str) {
            Ok(v) => v,
            Err(_) => return events,
        };

        if let Some(choices) = chunk.get("choices").and_then(|v| v.as_array()) {
            if let Some(delta) = choices.first().and_then(|c| c.get("delta")) {
                if let Some(rc) = delta.get("reasoning_content").and_then(|v| v.as_str()) {
                    self.reasoning_buf.push_str(rc);
                }

                let text = delta.get("content").and_then(|v| v.as_str()).unwrap_or("");
                if !text.is_empty() && self.phase != "tool_calls" {
                    if self.phase == "init" {
                        self.phase = "text".to_string();
                        let msg_item = json!({
                            "id": self.msg_item_id,
                            "type": "message",
                            "role": "assistant",
                            "status": "in_progress",
                            "content": [],
                        });
                        self.output_items.push(msg_item.clone());
                        events.push(sse_event("response.output_item.added", &json!({
                            "type": "response.output_item.added",
                            "output_index": 0,
                            "item": msg_item,
                        })));
                        events.push(sse_event("response.content_part.added", &json!({
                            "type": "response.content_part.added",
                            "item_id": self.msg_item_id,
                            "part_index": 0,
                            "part": {"type": "output_text", "text": ""},
                        })));
                    }
                    self.text_buf.push_str(text);
                    events.push(sse_event("response.output_text.delta", &json!({
                        "type": "response.output_text.delta",
                        "item_id": self.msg_item_id,
                        "output_index": 0,
                        "content_index": 0,
                        "delta": text,
                    })));
                }

                if let Some(tcs) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                    self.phase = "tool_calls".to_string();

                    for tc in tcs {
                        let tc_type = tc.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        let func = tc.get("function").unwrap_or(&json!({}));

                        if tc_type == "function" {
                            let tool_item_id = tc.get("id").and_then(|v| v.as_str())
                                .unwrap_or(&gen_id("call_")).to_string();
                            let tool_output_idx = self.output_items.len();
                            let name = func.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            let args = func.get("arguments").and_then(|v| v.as_str()).unwrap_or("");

                            let tool_item = json!({
                                "id": tool_item_id,
                                "type": "function_call",
                                "call_id": tool_item_id,
                                "name": name,
                                "arguments": args,
                            });
                            self.output_items.push(tool_item.clone());

                            events.push(sse_event("response.output_item.added", &json!({
                                "type": "response.output_item.added",
                                "output_index": tool_output_idx,
                                "item": tool_item,
                            })));

                            if !args.is_empty() {
                                events.push(sse_event("response.function_call_arguments.delta", &json!({
                                    "type": "response.function_call_arguments.delta",
                                    "item_id": tool_item_id,
                                    "output_index": tool_output_idx,
                                    "delta": args,
                                })));
                            }
                        } else {
                            let args = func.get("arguments").and_then(|v| v.as_str()).unwrap_or("");
                            if !args.is_empty() {
                                let tool_item_id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                events.push(sse_event("response.function_call_arguments.delta", &json!({
                                    "type": "response.function_call_arguments.delta",
                                    "item_id": tool_item_id,
                                    "output_index": self.output_items.len().saturating_sub(1),
                                    "delta": args,
                                })));
                                for item in &mut self.output_items {
                                    if item["id"].as_str() == Some(&tool_item_id) {
                                        if let Some(obj) = item.as_object_mut() {
                                            let existing = obj.get("arguments")
                                                .and_then(|v| v.as_str()).unwrap_or("");
                                            obj.insert("arguments".to_string(),
                                                json!(format!("{}{}", existing, args)));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if chunk.get("usage").is_some() {
                self.usage = chunk.get("usage").cloned();
            }
        }

        events
    }

    pub fn finalize(&mut self) -> Vec<String> {
        let mut events = Vec::new();

        store::append(&self.session_id, std::mem::take(&mut self.reasoning_buf));

        for (idx, item) in self.output_items.iter_mut().enumerate() {
            if item["type"] == "message" {
                if let Some(obj) = item.as_object_mut() {
                    obj.insert("content".to_string(), json!([{"type": "output_text", "text": self.text_buf}]));
                    obj.insert("status".to_string(), json!("completed"));
                }
                events.push(sse_event("response.content_part.done", &json!({
                    "type": "response.content_part.done",
                    "item_id": item["id"],
                    "output_index": idx,
                    "content_index": 0,
                    "part": {"type": "output_text", "text": self.text_buf},
                })));
            } else if item["type"] == "function_call" {
                if let Some(obj) = item.as_object_mut() {
                    obj.insert("status".to_string(), json!("completed"));
                }
            }
            events.push(sse_event("response.output_item.done", &json!({
                "type": "response.output_item.done",
                "output_index": idx,
                "item": item.clone(),
            })));
        }

        events.push(sse_event("response.completed", &json!({
            "type": "response.completed",
            "response": {
                "id": self.response_id,
                "object": "response",
                "model": self.model,
                "status": "completed",
                "output": self.output_items,
                "usage": map_usage(self.usage.as_ref()),
            },
        })));

        events
    }
}

pub fn sse_event(event_type: &str, data: &Value) -> String {
    format!(
        "event: {}\ndata: {}\n\n",
        event_type,
        serde_json::to_string(data).unwrap_or_default()
    )
}

fn map_usage(usage: Option<&Value>) -> Value {
    let u = usage.unwrap_or(&json!({}));
    let prompt_details = u.get("prompt_tokens_details");
    let completion_details = u.get("completion_tokens_details");
    json!({
        "input_tokens": u.get("prompt_tokens").and_then(|v| v.as_i64()).unwrap_or(0),
        "input_tokens_details": {
            "cached_tokens": prompt_details
                .and_then(|v| v.get("cached_tokens"))
                .and_then(|v| v.as_i64()).unwrap_or(0),
        },
        "output_tokens": u.get("completion_tokens").and_then(|v| v.as_i64()).unwrap_or(0),
        "output_tokens_details": {
            "reasoning_tokens": completion_details
                .and_then(|v| v.get("reasoning_tokens"))
                .and_then(|v| v.as_i64()).unwrap_or(0),
        },
        "total_tokens": u.get("total_tokens").and_then(|v| v.as_i64()).unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_nonstream_basic() {
        let ds_resp = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Hello!",
                }
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        });
        let result = convert_nonstream(&ds_resp, "test_session");
        assert_eq!(result["status"], "completed");
        assert_eq!(result["object"], "response");
        let output = result["output"].as_array().unwrap();
        assert_eq!(output.len(), 1);
        assert_eq!(output[0]["type"], "message");
        assert_eq!(output[0]["content"][0]["text"], "Hello!");
    }

    #[test]
    fn test_stream_finalize_emits_completed() {
        let mut sc = StreamConverter::new("deepseek-chat", "sess1");
        let events = sc.finalize();
        assert!(events.iter().any(|e| e.contains("response.completed")));
        assert!(events.iter().any(|e| e.contains("response.output_item.done")));
    }

    #[test]
    fn test_stream_text_delta() {
        let mut sc = StreamConverter::new("deepseek-chat", "sess1");
        let events = sc.process_chunk(r#"{"choices":[{"delta":{"content":"Hello"}}]}"#);
        assert!(events.iter().any(|e| e.contains("output_text.delta")));
        assert!(events.iter().any(|e| e.contains("Hello")));
        assert_eq!(sc.phase, "text");
    }

    #[test]
    fn test_stream_tool_call() {
        let mut sc = StreamConverter::new("deepseek-chat", "sess1");
        let events = sc.process_chunk(
            r#"{"choices":[{"delta":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":"}}]}}]}"#
        );
        assert!(events.iter().any(|e| e.contains("output_item.added")));
        assert!(events.iter().any(|e| e.contains("function_call_arguments.delta")));
        assert_eq!(sc.phase, "tool_calls");
    }

    #[test]
    fn test_gen_id_prefix() {
        let id = gen_id("resp_");
        assert!(id.starts_with("resp_"));
        assert_eq!(id.len(), 17);
    }
}
```

- [ ] **Step 3: 跑测试**

Run: `cd proxy && cargo test -- converter::response`
Expected: 5 tests PASS

- [ ] **Step 4: Commit**

```bash
cd proxy && git add -A && git commit -m "feat(proxy): 响应转换器 — 非流式 + SSE状态机 + reasoning store"
```

---

### Task 5: 5 家 Provider 实现

**Files:**
- Modify: `proxy/src/providers/deepseek.rs`
- Modify: `proxy/src/providers/qwen.rs`
- Modify: `proxy/src/providers/bailian.rs`
- Modify: `proxy/src/providers/moonshot.rs`
- Modify: `proxy/src/providers/siliconflow.rs`

所有 Provider 结构相同，区别仅在于 `name()` 返回值和默认 `api_base`。使用宏减少重复。

- [ ] **Step 1: 写 deepseek.rs**

```rust
// proxy/src/providers/deepseek.rs
use async_trait::async_trait;
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct DeepSeekProvider {
    pub api_base: String,
    pub api_keys: Vec<String>,
    key_index: AtomicUsize,
}

impl DeepSeekProvider {
    pub fn new(api_base: &str, api_keys: &[String]) -> Self {
        Self {
            api_base: api_base.to_string(),
            api_keys: api_keys.to_vec(),
            key_index: AtomicUsize::new(0),
        }
    }

    fn next_key(&self) -> String {
        if self.api_keys.is_empty() { return String::new(); }
        let idx = self.key_index.fetch_add(1, Ordering::Relaxed) % self.api_keys.len();
        self.api_keys[idx].clone()
    }
}

#[async_trait]
impl super::Provider for DeepSeekProvider {
    fn name(&self) -> &str { "deepseek" }
    fn api_base(&self) -> &str { &self.api_base }

    async fn chat_completions(
        &self,
        payload: &Value,
        client: &reqwest::Client,
    ) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload)
            .send()
            .await
    }

    async fn stream_chat_completions(
        &self,
        payload: &Value,
        client: &reqwest::Client,
    ) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload)
            .send()
            .await
    }
}
```

- [ ] **Step 2: 写 qwen.rs**

```rust
// proxy/src/providers/qwen.rs
use async_trait::async_trait;
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct QwenProvider {
    pub api_base: String,
    pub api_keys: Vec<String>,
    key_index: AtomicUsize,
}

impl QwenProvider {
    pub fn new(api_base: &str, api_keys: &[String]) -> Self {
        Self {
            api_base: api_base.to_string(),
            api_keys: api_keys.to_vec(),
            key_index: AtomicUsize::new(0),
        }
    }

    fn next_key(&self) -> String {
        if self.api_keys.is_empty() { return String::new(); }
        let idx = self.key_index.fetch_add(1, Ordering::Relaxed) % self.api_keys.len();
        self.api_keys[idx].clone()
    }
}

#[async_trait]
impl super::Provider for QwenProvider {
    fn name(&self) -> &str { "qwen" }
    fn api_base(&self) -> &str { &self.api_base }

    async fn chat_completions(&self, payload: &Value, client: &reqwest::Client) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload).send().await
    }

    async fn stream_chat_completions(&self, payload: &Value, client: &reqwest::Client) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload).send().await
    }
}
```

- [ ] **Step 3: 写 bailian.rs**

```rust
// proxy/src/providers/bailian.rs
use async_trait::async_trait;
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct BailianProvider {
    pub api_base: String,
    pub api_keys: Vec<String>,
    key_index: AtomicUsize,
}

impl BailianProvider {
    pub fn new(api_base: &str, api_keys: &[String]) -> Self {
        Self {
            api_base: api_base.to_string(),
            api_keys: api_keys.to_vec(),
            key_index: AtomicUsize::new(0),
        }
    }

    fn next_key(&self) -> String {
        if self.api_keys.is_empty() { return String::new(); }
        let idx = self.key_index.fetch_add(1, Ordering::Relaxed) % self.api_keys.len();
        self.api_keys[idx].clone()
    }
}

#[async_trait]
impl super::Provider for BailianProvider {
    fn name(&self) -> &str { "bailian" }
    fn api_base(&self) -> &str { &self.api_base }

    async fn chat_completions(&self, payload: &Value, client: &reqwest::Client) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload).send().await
    }

    async fn stream_chat_completions(&self, payload: &Value, client: &reqwest::Client) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload).send().await
    }
}
```

- [ ] **Step 4: 写 moonshot.rs**

```rust
// proxy/src/providers/moonshot.rs
use async_trait::async_trait;
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct MoonshotProvider {
    pub api_base: String,
    pub api_keys: Vec<String>,
    key_index: AtomicUsize,
}

impl MoonshotProvider {
    pub fn new(api_base: &str, api_keys: &[String]) -> Self {
        Self {
            api_base: api_base.to_string(),
            api_keys: api_keys.to_vec(),
            key_index: AtomicUsize::new(0),
        }
    }

    fn next_key(&self) -> String {
        if self.api_keys.is_empty() { return String::new(); }
        let idx = self.key_index.fetch_add(1, Ordering::Relaxed) % self.api_keys.len();
        self.api_keys[idx].clone()
    }
}

#[async_trait]
impl super::Provider for MoonshotProvider {
    fn name(&self) -> &str { "moonshot" }
    fn api_base(&self) -> &str { &self.api_base }

    async fn chat_completions(&self, payload: &Value, client: &reqwest::Client) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload).send().await
    }

    async fn stream_chat_completions(&self, payload: &Value, client: &reqwest::Client) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload).send().await
    }
}
```

- [ ] **Step 5: 写 siliconflow.rs**

```rust
// proxy/src/providers/siliconflow.rs
use async_trait::async_trait;
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct SiliconFlowProvider {
    pub api_base: String,
    pub api_keys: Vec<String>,
    key_index: AtomicUsize,
}

impl SiliconFlowProvider {
    pub fn new(api_base: &str, api_keys: &[String]) -> Self {
        Self {
            api_base: api_base.to_string(),
            api_keys: api_keys.to_vec(),
            key_index: AtomicUsize::new(0),
        }
    }

    fn next_key(&self) -> String {
        if self.api_keys.is_empty() { return String::new(); }
        let idx = self.key_index.fetch_add(1, Ordering::Relaxed) % self.api_keys.len();
        self.api_keys[idx].clone()
    }
}

#[async_trait]
impl super::Provider for SiliconFlowProvider {
    fn name(&self) -> &str { "siliconflow" }
    fn api_base(&self) -> &str { &self.api_base }

    async fn chat_completions(&self, payload: &Value, client: &reqwest::Client) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload).send().await
    }

    async fn stream_chat_completions(&self, payload: &Value, client: &reqwest::Client) -> Result<reqwest::Response, reqwest::Error> {
        let url = format!("{}/v1/chat/completions", self.api_base);
        client.post(&url)
            .header("Authorization", format!("Bearer {}", self.next_key()))
            .header("Content-Type", "application/json")
            .json(payload).send().await
    }
}
```

- [ ] **Step 6: 编译 + 测试**

Run: `cd proxy && cargo build && cargo test`
Expected: 编译通过，所有已有测试 PASS

- [ ] **Step 7: Commit**

```bash
cd proxy && git add -A && git commit -m "feat(proxy): 5家Provider实现 — DeepSeek/Qwen/Bailian/Moonshot/SiliconFlow"
```

---

### Task 6: 可靠性层 — Circuit Breaker + Rate Limiter + Retry + Concurrency

**Files:**
- Modify: `proxy/src/reliability/mod.rs`
- Modify: `proxy/src/reliability/circuit.rs`
- Modify: `proxy/src/reliability/ratelimit.rs`
- Modify: `proxy/src/reliability/retry.rs`
- Modify: `proxy/src/reliability/concurrency.rs`

- [ ] **Step 1: 写 reliability/mod.rs**

```rust
// proxy/src/reliability/mod.rs
pub mod circuit;
pub mod ratelimit;
pub mod retry;
pub mod concurrency;
```

- [ ] **Step 2: 写 circuit.rs — 熔断器**

```rust
// proxy/src/reliability/circuit.rs
use std::sync::atomic::{AtomicU32, AtomicI64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub struct CircuitBreaker {
    failure_threshold: u32,
    cooldown: Duration,
    failures: AtomicU32,
    last_failure_time: AtomicI64,
}

impl CircuitBreaker {
    pub fn new(failure_threshold: u32, cooldown_secs: u64) -> Self {
        Self {
            failure_threshold,
            cooldown: Duration::from_secs(cooldown_secs),
            failures: AtomicU32::new(0),
            last_failure_time: AtomicI64::new(0),
        }
    }

    pub fn allow(&self) -> bool {
        let failures = self.failures.load(Ordering::Acquire);
        if failures < self.failure_threshold {
            return true;
        }
        let last = self.last_failure_time.load(Ordering::Acquire);
        if last == 0 { return true; }
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let elapsed = Duration::from_millis((now_ms - last) as u64);
        elapsed >= self.cooldown
    }

    pub fn record_success(&self) {
        self.failures.store(0, Ordering::Release);
    }

    pub fn record_failure(&self) {
        self.failures.fetch_add(1, Ordering::Release);
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.last_failure_time.store(now_ms, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    #[test]
    fn test_breaker_allows_initially() {
        let cb = CircuitBreaker::new(5, 30);
        assert!(cb.allow());
    }

    #[test]
    fn test_breaker_trips_after_threshold() {
        let cb = CircuitBreaker::new(3, 30);
        for _ in 0..3 { cb.record_failure(); }
        assert!(!cb.allow());
    }

    #[test]
    fn test_breaker_resets_on_success() {
        let cb = CircuitBreaker::new(3, 30);
        for _ in 0..3 { cb.record_failure(); }
        cb.record_success();
        assert!(cb.allow());
    }
}
```

- [ ] **Step 3: 写 ratelimit.rs — 令牌桶**

```rust
// proxy/src/reliability/ratelimit.rs
use std::sync::Mutex;
use std::time::Instant;

pub struct TokenBucket {
    rate: f64,
    burst: u32,
    tokens: Mutex<f64>,
    last_refill: Mutex<Instant>,
}

impl TokenBucket {
    pub fn new(per_minute: u32, burst: u32) -> Self {
        Self {
            rate: per_minute as f64 / 60.0,
            burst,
            tokens: Mutex::new(burst as f64),
            last_refill: Mutex::new(Instant::now()),
        }
    }

    pub fn allow(&self) -> bool {
        let mut tokens = self.tokens.lock().unwrap();
        let mut last = self.last_refill.lock().unwrap();

        let elapsed = last.elapsed().as_secs_f64();
        *tokens = (*tokens + elapsed * self.rate).min(self.burst as f64);
        *last = Instant::now();

        if *tokens >= 1.0 {
            *tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_bucket_allows() {
        let tb = TokenBucket::new(60, 10);
        assert!(tb.allow());
    }

    #[test]
    fn test_token_bucket_depletes() {
        let tb = TokenBucket::new(60, 3);
        for _ in 0..3 { assert!(tb.allow()); }
        assert!(!tb.allow());
    }
}
```

- [ ] **Step 4: 写 retry.rs — 指数退避重试**

```rust
// proxy/src/reliability/retry.rs
use std::time::Duration;
use rand::Rng;

pub fn retry_delay(attempt: u32, backoff_base: f64) -> Duration {
    let base = backoff_base.powi(attempt as i32);
    let jitter: f64 = rand::thread_rng().gen_range(0.0..1.0);
    Duration::from_secs_f64(base + jitter)
}

pub async fn retry_async<F, Fut, T, E>(
    max_retries: u32,
    backoff_base: f64,
    mut f: F,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let mut attempt = 0u32;
    loop {
        match f().await {
            Ok(val) => return Ok(val),
            Err(err) => {
                attempt += 1;
                if attempt > max_retries {
                    return Err(err);
                }
                tokio::time::sleep(retry_delay(attempt, backoff_base)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retry_delay_increases() {
        let d1 = retry_delay(1, 2.0);
        let d2 = retry_delay(2, 2.0);
        assert!(d2 > d1);
    }
}
```

- [ ] **Step 5: 写 concurrency.rs — 信号量并发控制**

```rust
// proxy/src/reliability/concurrency.rs
use std::sync::Arc;
use tokio::sync::Semaphore;
use std::time::Duration;

pub struct ConcurrencyLimiter {
    semaphore: Arc<Semaphore>,
    queue_timeout: Duration,
}

impl ConcurrencyLimiter {
    pub fn new(max_concurrent: usize, queue_timeout_secs: u64) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            queue_timeout: Duration::from_secs(queue_timeout_secs),
        }
    }

    pub async fn acquire(&self) -> Result<tokio::sync::OwnedSemaphorePermit, ()> {
        match tokio::time::timeout(
            self.queue_timeout,
            self.semaphore.clone().acquire_owned(),
        ).await {
            Ok(Ok(permit)) => Ok(permit),
            _ => Err(()),
        }
    }
}
```

- [ ] **Step 6: 跑测试**

Run: `cd proxy && cargo test -- reliability`
Expected: 6 tests PASS

- [ ] **Step 7: Commit**

```bash
cd proxy && git add -A && git commit -m "feat(proxy): 可靠性层 — 熔断/限流/重试/并发控制"
```

---

### Task 7: logger + tracer + cache + audit

**Files:**
- Modify: `proxy/src/logger.rs`
- Modify: `proxy/src/tracer.rs`
- Modify: `proxy/src/cache.rs`
- Modify: `proxy/src/audit.rs`

- [ ] **Step 1: 写 logger.rs**

```rust
// proxy/src/logger.rs
use tracing_subscriber::{fmt, EnvFilter};

pub fn init() {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info"))
        )
        .with_target(false)
        .init();
}
```

- [ ] **Step 2: 写 tracer.rs**

```rust
// proxy/src/tracer.rs
use axum::{
    extract::Request,
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

pub async fn trace_middleware(mut req: Request, next: Next) -> Response {
    let trace_id = req.headers()
        .get("x-trace-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    tracing::info!(trace_id = %trace_id, "{} {}", req.method(), req.uri());
    let response = next.run(req).await;
    response
}

pub fn generate_trace_id() -> String {
    Uuid::new_v4().to_string()
}
```

- [ ] **Step 3: 写 cache.rs — LRU + TTL**

```rust
// proxy/src/cache.rs
use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::Mutex;
use std::time::Instant;
use serde_json::Value;

pub struct Cache {
    inner: Mutex<LruCache<String, CacheEntry>>,
    ttl_secs: u64,
}

struct CacheEntry {
    value: Value,
    created: Instant,
}

impl Cache {
    pub fn new(max_entries: usize, ttl_secs: u64) -> Self {
        Self {
            inner: Mutex::new(LruCache::new(
                NonZeroUsize::new(max_entries.max(1)).unwrap()
            )),
            ttl_secs,
        }
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        let mut cache = self.inner.lock().unwrap();
        if let Some(entry) = cache.get(key) {
            if entry.created.elapsed().as_secs() < self.ttl_secs {
                return Some(entry.value.clone());
            }
            cache.pop(key);
        }
        None
    }

    pub fn set(&self, key: String, value: Value) {
        let mut cache = self.inner.lock().unwrap();
        cache.put(key, CacheEntry { value, created: Instant::now() });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_hit() {
        let cache = Cache::new(10, 300);
        cache.set("k1".into(), json!({"data": "v1"}));
        assert_eq!(cache.get("k1").unwrap()["data"], "v1");
    }

    #[test]
    fn test_cache_miss() {
        let cache = Cache::new(10, 300);
        assert!(cache.get("nonexistent").is_none());
    }
}
```

- [ ] **Step 4: 写 audit.rs — JSONL 每日轮转**

```rust
// proxy/src/audit.rs
use chrono::Local;
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use std::path::PathBuf;

pub struct AuditWriter {
    dir: PathBuf,
    mu: Mutex<()>,
}

impl AuditWriter {
    pub fn new(dir: PathBuf) -> Self {
        std::fs::create_dir_all(&dir).ok();
        Self { dir, mu: Mutex::new(()) }
    }

    pub fn write(&self, entry: &Value) {
        let _lock = self.mu.lock().unwrap();
        let today = Local::now().format("%Y-%m-%d").to_string();
        let path = self.dir.join(format!("audit-{}.jsonl", today));

        if let Ok(mut file) = OpenOptions::new()
            .create(true).append(true).open(&path)
        {
            let line = serde_json::to_string(entry).unwrap_or_default();
            writeln!(file, "{}", line).ok();
        }
    }
}
```

- [ ] **Step 5: 跑测试**

Run: `cd proxy && cargo test -- cache`
Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
cd proxy && git add -A && git commit -m "feat(proxy): 日志/追踪/缓存/审计 — 辅助模块"
```

---

### Task 8: main.rs — 组装 axum 入口 + 完整请求生命周期

**Files:**
- Modify: `proxy/src/main.rs`

- [ ] **Step 1: 重写 main.rs — 完整入口**

```rust
// proxy/src/main.rs
mod config;
mod converter;
mod providers;
mod reliability;
mod cache;
mod audit;
mod store;
mod logger;
mod tracer;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response, Sse},
    routing::{get, post},
    Json, Router,
};
use config::Config;
use converter::request::convert_request;
use converter::response::{convert_nonstream, StreamConverter};
use providers::{create_providers, resolve_provider, Provider};
use reliability::circuit::CircuitBreaker;
use reliability::ratelimit::TokenBucket;
use reliability::retry::retry_async;
use reliability::concurrency::ConcurrencyLimiter;
use cache::Cache;
use audit::AuditWriter;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use tokio_stream::StreamExt;

struct AppState {
    config: Config,
    providers: HashMap<String, Box<dyn Provider>>,
    breakers: HashMap<String, CircuitBreaker>,
    rate_limiter: TokenBucket,
    concurrency: ConcurrencyLimiter,
    cache: Cache,
    audit: AuditWriter,
    http_client: reqwest::Client,
}

#[tokio::main]
async fn main() {
    logger::init();

    let config = config::load_from_env();
    let providers = create_providers(&config.providers);

    let mut breakers = HashMap::new();
    for p in config.providers.iter() {
        breakers.insert(p.name.clone(), CircuitBreaker::new(
            config.reliability.circuit_threshold,
            config.reliability.circuit_cooldown_secs,
        ));
    }

    let state = Arc::new(AppState {
        breakers,
        providers,
        rate_limiter: TokenBucket::new(
            config.reliability.rate_limit_per_min,
            config.reliability.rate_limit_burst,
        ),
        concurrency: ConcurrencyLimiter::new(
            config.reliability.concurrency_max,
            config.reliability.concurrency_queue_timeout_secs,
        ),
        cache: Cache::new(config.cache_max_entries, config.cache_ttl_secs),
        audit: AuditWriter::new(std::path::PathBuf::from("audit_logs")),
        http_client: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build().unwrap(),
        config,
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/responses", post(handle_responses))
        .layer(axum::middleware::from_fn(tracer::trace_middleware))
        .with_state(state);

    let port = std::env::var("CLI_PROXY_PORT")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(8317u16);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("proxy listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> Json<Value> {
    Json(json!({"status": "ok"}))
}

async fn handle_responses(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, String)> {
    let start = Instant::now();
    let model_name = body.get("model").and_then(|v| v.as_str()).unwrap_or("?").to_string();
    let session_id = headers.get("x-session-id")
        .and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let stream = body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);

    if !state.rate_limiter.allow() {
        return Err((StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded".into()));
    }

    let (provider_name, vendor_model) = resolve_provider(
        &model_name, &state.config.model_map, &state.config.default_provider,
    );

    if let Some(breaker) = state.breakers.get(&provider_name) {
        if !breaker.allow() {
            return Err((StatusCode::SERVICE_UNAVAILABLE, "circuit breaker open".into()));
        }
    }

    let _permit = state.concurrency.acquire().await
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "too many concurrent requests".into()))?;

    let provider = state.providers.get(&provider_name)
        .ok_or_else(|| (StatusCode::BAD_REQUEST,
            format!("unknown provider: {}", provider_name)))?;

    let reasoning_store = store::get(&session_id);
    let mut chat_payload = convert_request(
        &body, &state.config.model_map, &reasoning_store,
        state.config.thinking_disabled,
    );
    if let Some(obj) = chat_payload.as_object_mut() {
        obj.insert("model".to_string(), json!(vendor_model));
    }

    let msg_count = chat_payload["messages"].as_array().map(|a| a.len()).unwrap_or(0);
    tracing::info!("Request: model={}, messages={}, stream={}", model_name, msg_count, stream);

    if stream {
        handle_stream(state, provider, &chat_payload, &model_name, &provider_name, &session_id, start).await
    } else {
        handle_nonstream(state, provider, &chat_payload, &model_name, &provider_name, &session_id, start).await
    }
}

async fn handle_nonstream(
    state: Arc<AppState>,
    provider: &Box<dyn Provider>,
    payload: &Value,
    model_name: &str,
    provider_name: &str,
    session_id: &str,
    start: Instant,
) -> Result<Response, (StatusCode, String)> {
    let cache_key = serde_json::to_string(payload).unwrap_or_default();
    if let Some(cached) = state.cache.get(&cache_key) {
        tracing::info!("Response: model={}, elapsed={}ms, status=cache_hit", model_name, start.elapsed().as_millis());
        return Ok(Json(cached).into_response());
    }

    let result = retry_async(
        state.config.reliability.retry_max,
        state.config.reliability.retry_backoff_base,
        || async {
            provider.chat_completions(payload, &state.http_client).await
        },
    ).await;

    let response = result.map_err(|e| (StatusCode::BAD_GATEWAY, format!("upstream error: {e}")))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if status.is_success() {
        let ds_resp: Value = serde_json::from_str(&body).unwrap_or(json!({}));
        let codex_resp = convert_nonstream(&ds_resp, session_id);

        state.cache.set(cache_key, codex_resp.clone());

        let elapsed = start.elapsed().as_millis();
        tracing::info!("Response: model={}, elapsed={}ms, status=upstream_ok", model_name, elapsed);
        state.audit.write(&json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "model": model_name,
            "provider": provider_name,
            "stream": false,
            "status": "success",
            "elapsed_ms": elapsed,
        }));
        if let Some(breaker) = state.breakers.get(provider_name) {
            breaker.record_success();
        }

        Ok(Json(codex_resp).into_response())
    } else {
        let elapsed = start.elapsed().as_millis();
        tracing::error!("Response: model={}, elapsed={}ms, status=upstream_{}", model_name, status.as_u16());
        state.audit.write(&json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "model": model_name,
            "provider": provider_name,
            "stream": false,
            "status": format!("error_{}", status.as_u16()),
            "elapsed_ms": elapsed,
        }));
        if let Some(breaker) = state.breakers.get(provider_name) {
            breaker.record_failure();
        }
        Err((StatusCode::BAD_GATEWAY, body))
    }
}

async fn handle_stream(
    state: Arc<AppState>,
    provider: &Box<dyn Provider>,
    payload: &Value,
    model_name: &str,
    provider_name: &str,
    session_id: &str,
    start: Instant,
) -> Result<Response, (StatusCode, String)> {
    let response = provider.stream_chat_completions(payload, &state.http_client).await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("upstream error: {e}")))?;

    let status = response.status();
    if !status.is_success() {
        if let Some(breaker) = state.breakers.get(provider_name) {
            breaker.record_failure();
        }
        let body = response.text().await.unwrap_or_default();
        return Err((StatusCode::BAD_GATEWAY, body));
    }

    if let Some(breaker) = state.breakers.get(provider_name) {
        breaker.record_success();
    }

    let model = model_name.to_string();
    let sid = session_id.to_string();
    let pn = provider_name.to_string();

    let stream = async_stream::stream! {
        let mut converter = StreamConverter::new(&model, &sid);

        yield Ok::<_, axum::Error>(axum::response::sse::Event::default()
            .event("response.created")
            .data(serde_json::to_string(&json!({
                "type": "response.created",
                "response": {
                    "id": converter.response_id,
                    "object": "response",
                    "model": model,
                    "status": "in_progress",
                    "output": [],
                    "usage": null,
                }
            })).unwrap_or_default()));

        yield Ok(axum::response::sse::Event::default()
            .event("response.in_progress")
            .data(serde_json::to_string(&json!({
                "type": "response.in_progress",
                "response_id": converter.response_id,
            })).unwrap_or_default()));

        let mut byte_stream = response.bytes_stream();
        let mut line_buf = String::new();

        while let Some(chunk) = futures::StreamExt::next(&mut byte_stream).await {
            if let Ok(chunk) = chunk {
                let text = String::from_utf8_lossy(&chunk);
                for ch in text.chars() {
                    if ch == '\n' {
                        if line_buf.starts_with("data: ") {
                            let data = &line_buf[6..].trim().to_string();
                            if data == "[DONE]" {
                                let events = converter.finalize();
                                for evt in events {
                                    if let Some((event_type, data_str)) = parse_sse(&evt) {
                                        yield Ok(axum::response::sse::Event::default()
                                            .event(event_type)
                                            .data(data_str));
                                    }
                                }
                                break;
                            }
                            let events = converter.process_chunk(data);
                            for evt in events {
                                if let Some((event_type, data_str)) = parse_sse(&evt) {
                                    yield Ok(axum::response::sse::Event::default()
                                        .event(event_type)
                                        .data(data_str));
                                }
                            }
                        }
                        line_buf.clear();
                    } else if ch != '\r' {
                        line_buf.push(ch);
                    }
                }
            }
        }

        let elapsed = start.elapsed().as_millis();
        tracing::info!("Response: model={}, elapsed={}ms, status=upstream_ok stream", model);
    };

    Ok(Sse::new(stream).into_response())
}

fn parse_sse(sse: &str) -> Option<(String, String)> {
    let mut event = String::new();
    let mut data = String::new();
    for line in sse.lines() {
        if let Some(v) = line.strip_prefix("event: ") {
            event = v.to_string();
        } else if let Some(v) = line.strip_prefix("data: ") {
            data = v.to_string();
        }
    }
    if !event.is_empty() && !data.is_empty() {
        Some((event, data))
    } else {
        None
    }
}
```

- [ ] **Step 2: 编译验证**

Run: `cd proxy && cargo build`
Expected: 编译成功

- [ ] **Step 3: 跑全部测试**

Run: `cd proxy && cargo test`
Expected: 所有测试 PASS

- [ ] **Step 4: 手动验证 health endpoint**

```bash
# Terminal 1
export CLI_PROXY_PROVIDERS="deepseek:https://api.deepseek.com:sk-test"
export CLI_PROXY_MODEL_MAP="gpt-5.1=deepseek:deepseek-chat"
cd proxy && cargo run

# Terminal 2
curl http://localhost:8317/health
# Expected: {"status":"ok"}
```

- [ ] **Step 5: Commit**

```bash
cd proxy && git add -A && git commit -m "feat(proxy): axum 入口组装 — 完整请求生命周期 (熔断/限流/重试/缓存/审计)"
```

---

## Phase 2: Tauri 壳

### Task 9: 初始化 Tauri 2 项目 + SQLite

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/database/mod.rs`
- Create: `src-tauri/src/database/migration.rs`

- [ ] **Step 1: 用 create-tauri-app 创建项目**

```bash
npm create tauri-app@latest cli-proxy-tauri -- --template react-ts
# 将生成的 src-tauri/ 目录迁移到当前项目根目录
```

- [ ] **Step 2: 写 Cargo.toml**

```toml
[package]
name = "cli-proxy"
version = "1.0.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-process = "2"
tauri-plugin-updater = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
tokio = { version = "1", features = ["full"] }
chrono = { version = "0.4", features = ["serde"] }
thiserror = "1"
keyring = "3"
chacha20poly1305 = "0.10"
rand = "0.8"
hex = "0.4"
dirs = "5"
once_cell = "1"
uuid = { version = "1", features = ["v4"] }

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

- [ ] **Step 3: 写 tauri.conf.json**

```json
{
  "productName": "cli-proxy",
  "version": "1.0.0",
  "identifier": "io.cli-proxy.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "cli-proxy",
        "width": 1100,
        "height": 750,
        "minWidth": 720,
        "minHeight": 500,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": ["icons/icon.png"],
    "resources": {
      "proxy/target/release/cli-proxy-sidecar.exe": "sidecar/cli-proxy-sidecar.exe"
    }
  }
}
```

- [ ] **Step 4: 写 database/mod.rs + migration.rs**

```rust
// src-tauri/src/database/mod.rs
pub mod migration;
pub mod provider_dao;
pub mod model_dao;
pub mod settings_dao;
pub mod usage_dao;

use rusqlite::Connection;
use std::path::PathBuf;

pub fn get_db_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".cli-proxy")
        .join("cli-proxy.db")
}

pub fn init_database() -> Result<Connection, rusqlite::Error> {
    let path = get_db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(&path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    migration::run_migrations(&conn)?;
    Ok(conn)
}
```

```rust
// src-tauri/src/database/migration.rs
use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            api_base TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            is_default INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            config_json TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            key_hash TEXT NOT NULL,
            key_prefix TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS model_routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codex_model TEXT NOT NULL UNIQUE,
            provider_id TEXT NOT NULL REFERENCES providers(id),
            vendor_model TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS usage_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            provider_id TEXT NOT NULL,
            model TEXT NOT NULL,
            request_type TEXT NOT NULL DEFAULT 'chat',
            status TEXT NOT NULL,
            latency_ms INTEGER,
            token_prompt INTEGER DEFAULT 0,
            token_completion INTEGER DEFAULT 0,
            token_total INTEGER DEFAULT 0,
            trace_id TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_log(timestamp);
        CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_log(provider_id);

        -- Default provider
        INSERT OR IGNORE INTO providers (id, name, api_base, is_default, sort_order)
        VALUES ('deepseek', 'DeepSeek', 'https://api.deepseek.com', 1, 0);

        -- Default settings
        INSERT OR IGNORE INTO settings (key, value) VALUES ('port', '8317');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('retry_max', '3');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('retry_backoff', '2.0');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('circuit_threshold', '5');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('circuit_cooldown', '30');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('concurrency_max', '10');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('rate_limit', '30');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('cache_enabled', 'true');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('cache_ttl', '300');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'dark');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('language', 'zh');
    ")?;
    Ok(())
}
```

- [ ] **Step 5: 编译验证**

Run: `cd src-tauri && cargo build`
Expected: 编译成功

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(tauri): 初始化 Tauri 2 项目 + SQLite 迁移"
```

---

### Task 10: Crypto + Vault — Key 加密存储

**Files:**
- Create: `src-tauri/src/crypto/mod.rs`
- Create: `src-tauri/src/crypto/vault.rs`

- [ ] **Step 1: 写 crypto/mod.rs**

```rust
// src-tauri/src/crypto/mod.rs
pub mod vault;
```

- [ ] **Step 2: 写 vault.rs**

```rust
// src-tauri/src/crypto/vault.rs
use chacha20poly1305::{
    ChaCha20Poly1305, Key, Nonce,
    aead::{Aead, KeyInit, OsRng},
};
use rand::RngCore;

const MASTER_KEY_SERVICE: &str = "cli-proxy";
const MASTER_KEY_USER: &str = "master";

pub struct Vault {
    cipher_key: Key,
}

impl Vault {
    pub fn new() -> Result<Self, String> {
        let key_bytes = Self::load_or_create_master_key()?;
        let key = Key::from_slice(&key_bytes).clone();
        Ok(Self { cipher_key: key })
    }

    fn load_or_create_master_key() -> Result<Vec<u8>, String> {
        let kr = keyring::Entry::new(MASTER_KEY_SERVICE, MASTER_KEY_USER)
            .map_err(|e| format!("keyring error: {e}"))?;

        match kr.get_password() {
            Ok(hex_key) => {
                hex::decode(&hex_key).map_err(|e| format!("hex decode: {e}"))
            }
            Err(_) => {
                let mut key = vec![0u8; 32];
                OsRng.fill_bytes(&mut key);
                let hex_key = hex::encode(&key);
                kr.set_password(&hex_key).map_err(|e| format!("keyring save: {e}"))?;
                Ok(key)
            }
        }
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String, String> {
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let cipher = ChaCha20Poly1305::new(&self.cipher_key);
        let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| format!("encrypt: {e}"))?;

        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ciphertext);
        Ok(hex::encode(&combined))
    }

    pub fn decrypt(&self, encrypted_hex: &str) -> Result<String, String> {
        let combined = hex::decode(encrypted_hex).map_err(|e| format!("hex decode: {e}"))?;
        if combined.len() < 12 {
            return Err("invalid ciphertext".into());
        }
        let nonce = Nonce::from_slice(&combined[..12]);
        let ciphertext = &combined[12..];
        let cipher = ChaCha20Poly1305::new(&self.cipher_key);
        let plaintext = cipher.decrypt(nonce, ciphertext)
            .map_err(|e| format!("decrypt: {e}"))?;
        String::from_utf8(plaintext).map_err(|e| format!("utf8: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let vault = Vault::new().unwrap();
        let plain = "sk-test-key-12345";
        let encrypted = vault.encrypt(plain).unwrap();
        let decrypted = vault.decrypt(&encrypted).unwrap();
        assert_eq!(plain, decrypted);
    }

    #[test]
    fn test_different_ciphertexts() {
        let vault = Vault::new().unwrap();
        let c1 = vault.encrypt("test").unwrap();
        let c2 = vault.encrypt("test").unwrap();
        assert_ne!(c1, c2);
    }
}
```

- [ ] **Step 3: 编译 + 测试**

Run: `cd src-tauri && cargo test -- crypto`
Expected: 2 tests PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(tauri): ChaCha20 加密 + OS keyring 密钥管理"
```

---

### Task 11: DAO 层 — providers + model_routes + settings + usage_log CRUD

**Files:**
- Create: `src-tauri/src/database/provider_dao.rs`
- Create: `src-tauri/src/database/model_dao.rs`
- Create: `src-tauri/src/database/settings_dao.rs`
- Create: `src-tauri/src/database/usage_dao.rs`

- [ ] **Step 1: 写 provider_dao.rs — 供应商 + API Key 数据访问**

```rust
// src-tauri/src/database/provider_dao.rs
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderRow {
    pub id: String,
    pub name: String,
    pub api_base: String,
    pub enabled: bool,
    pub is_default: bool,
    pub sort_order: i32,
    pub config_json: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiKeyRow {
    pub id: i64,
    pub provider_id: String,
    pub key_hash: String,
    pub key_prefix: String,
    pub sort_order: i32,
}

pub fn list_providers(conn: &Connection) -> Vec<ProviderRow> {
    let mut stmt = conn.prepare(
        "SELECT id, name, api_base, enabled, is_default, sort_order, config_json
         FROM providers ORDER BY sort_order ASC, id ASC"
    ).unwrap();
    stmt.query_map([], |row| {
        Ok(ProviderRow {
            id: row.get(0)?,
            name: row.get(1)?,
            api_base: row.get(2)?,
            enabled: row.get::<_, i32>(3)? != 0,
            is_default: row.get::<_, i32>(4)? != 0,
            sort_order: row.get(5)?,
            config_json: row.get(6)?,
        })
    }).unwrap().filter_map(|r| r.ok()).collect()
}

pub fn upsert_provider(conn: &Connection, p: &ProviderRow) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO providers (id, name, api_base, enabled, is_default, sort_order, config_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, api_base=excluded.api_base,
           enabled=excluded.enabled, is_default=excluded.is_default,
           sort_order=excluded.sort_order, config_json=excluded.config_json,
           updated_at=datetime('now')",
        rusqlite::params![p.id, p.name, p.api_base, p.enabled as i32, p.is_default as i32, p.sort_order, p.config_json],
    )?;
    Ok(())
}

pub fn delete_provider(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM api_keys WHERE provider_id=?1", [id])?;
    conn.execute("DELETE FROM providers WHERE id=?1", [id])?;
    Ok(())
}

pub fn set_default_provider(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("UPDATE providers SET is_default=0 WHERE is_default=1", [])?;
    conn.execute("UPDATE providers SET is_default=1, enabled=1 WHERE id=?1", [id])?;
    Ok(())
}

pub fn list_api_keys(conn: &Connection, provider_id: &str) -> Vec<ApiKeyRow> {
    let mut stmt = conn.prepare(
        "SELECT id, provider_id, key_hash, key_prefix, sort_order
         FROM api_keys WHERE provider_id=?1 ORDER BY sort_order ASC"
    ).unwrap();
    stmt.query_map([provider_id], |row| {
        Ok(ApiKeyRow {
            id: row.get(0)?,
            provider_id: row.get(1)?,
            key_hash: row.get(2)?,
            key_prefix: row.get(3)?,
            sort_order: row.get(4)?,
        })
    }).unwrap().filter_map(|r| r.ok()).collect()
}

pub fn add_api_key(conn: &Connection, provider_id: &str, key_hash: &str, key_prefix: &str) -> Result<(), rusqlite::Error> {
    let max_order: i32 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM api_keys WHERE provider_id=?1",
        [provider_id], |row| row.get(0),
    ).unwrap_or(-1);
    conn.execute(
        "INSERT INTO api_keys (provider_id, key_hash, key_prefix, sort_order) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![provider_id, key_hash, key_prefix, max_order + 1],
    )?;
    Ok(())
}

pub fn remove_api_key(conn: &Connection, key_id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM api_keys WHERE id=?1", [key_id])?;
    Ok(())
}

pub fn clear_api_keys(conn: &Connection, provider_id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM api_keys WHERE provider_id=?1", [provider_id])?;
    Ok(())
}
```

- [ ] **Step 2: 写 model_dao.rs — 模型路由映射**

```rust
// src-tauri/src/database/model_dao.rs
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelRouteRow {
    pub id: i64,
    pub codex_model: String,
    pub provider_id: String,
    pub vendor_model: String,
}

pub fn list_routes(conn: &Connection) -> Vec<ModelRouteRow> {
    let mut stmt = conn.prepare(
        "SELECT id, codex_model, provider_id, vendor_model FROM model_routes ORDER BY id"
    ).unwrap();
    stmt.query_map([], |row| {
        Ok(ModelRouteRow {
            id: row.get(0)?,
            codex_model: row.get(1)?,
            provider_id: row.get(2)?,
            vendor_model: row.get(3)?,
        })
    }).unwrap().filter_map(|r| r.ok()).collect()
}

pub fn upsert_route(conn: &Connection, codex_model: &str, provider_id: &str, vendor_model: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO model_routes (codex_model, provider_id, vendor_model)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(codex_model) DO UPDATE SET
           provider_id=excluded.provider_id, vendor_model=excluded.vendor_model",
        rusqlite::params![codex_model, provider_id, vendor_model],
    )?;
    Ok(())
}

pub fn delete_route(conn: &Connection, codex_model: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM model_routes WHERE codex_model=?1", [codex_model])?;
    Ok(())
}
```

- [ ] **Step 3: 写 settings_dao.rs — KV 设置**

```rust
// src-tauri/src/database/settings_dao.rs
use rusqlite::Connection;
use std::collections::HashMap;

pub fn get_all(conn: &Connection) -> HashMap<String, String> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings").unwrap();
    stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).unwrap().filter_map(|r| r.ok()).collect()
}

pub fn get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        [key],
        |row| row.get(0),
    ).ok()
}

pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [key, value],
    )?;
    Ok(())
}
```

- [ ] **Step 4: 写 usage_dao.rs — 用量统计**

```rust
// src-tauri/src/database/usage_dao.rs
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageSummary {
    pub total_requests: i64,
    pub cache_hits: i64,
    pub errors: i64,
    pub avg_latency_ms: f64,
    pub total_prompt_tokens: i64,
    pub total_completion_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HourlyTrend {
    pub hour: String,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderUsage {
    pub provider_id: String,
    pub count: i64,
    pub total_tokens: i64,
}

pub fn get_today_summary(conn: &Connection) -> UsageSummary {
    conn.query_row(
        "SELECT COUNT(*),
                SUM(CASE WHEN status='cache_hit' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status LIKE 'error%' OR status LIKE 'upstream_5%' OR status='upstream_unavailable' THEN 1 ELSE 0 END),
                COALESCE(AVG(latency_ms), 0),
                COALESCE(SUM(token_prompt), 0),
                COALESCE(SUM(token_completion), 0)
         FROM usage_log WHERE date(timestamp)=date('now')",
        [],
        |row| {
            Ok(UsageSummary {
                total_requests: row.get(0)?,
                cache_hits: row.get(1)?,
                errors: row.get(2)?,
                avg_latency_ms: row.get(3)?,
                total_prompt_tokens: row.get(4)?,
                total_completion_tokens: row.get(5)?,
            })
        },
    ).unwrap_or(UsageSummary {
        total_requests: 0, cache_hits: 0, errors: 0,
        avg_latency_ms: 0.0, total_prompt_tokens: 0, total_completion_tokens: 0,
    })
}

pub fn get_hourly_trend(conn: &Connection) -> Vec<HourlyTrend> {
    let mut stmt = conn.prepare(
        "SELECT strftime('%H', timestamp) as hour, COUNT(*) as cnt
         FROM usage_log WHERE date(timestamp)=date('now')
         GROUP BY hour ORDER BY hour"
    ).unwrap();
    stmt.query_map([], |row| {
        Ok(HourlyTrend {
            hour: row.get(0)?,
            count: row.get(1)?,
        })
    }).unwrap().filter_map(|r| r.ok()).collect()
}

pub fn get_provider_distribution(conn: &Connection) -> Vec<ProviderUsage> {
    let mut stmt = conn.prepare(
        "SELECT provider_id, COUNT(*), COALESCE(SUM(token_total), 0)
         FROM usage_log WHERE date(timestamp)=date('now')
         GROUP BY provider_id ORDER BY COUNT(*) DESC"
    ).unwrap();
    stmt.query_map([], |row| {
        Ok(ProviderUsage {
            provider_id: row.get(0)?,
            count: row.get(1)?,
            total_tokens: row.get(2)?,
        })
    }).unwrap().filter_map(|r| r.ok()).collect()
}

pub fn insert_log(
    conn: &Connection,
    provider_id: &str,
    model: &str,
    status: &str,
    latency_ms: i64,
    token_prompt: i64,
    token_completion: i64,
    token_total: i64,
    trace_id: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO usage_log (provider_id, model, status, latency_ms, token_prompt, token_completion, token_total, trace_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![provider_id, model, status, latency_ms, token_prompt, token_completion, token_total, trace_id],
    )?;
    Ok(())
}
```

- [ ] **Step 5: 编译 + 测试**

Run: `cd src-tauri && cargo build`
Expected: 编译成功

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(tauri): DAO层 — providers/model_routes/settings/usage_log CRUD"
```

---

### Task 12: Services + Commands + main.rs 入口

**Files:**
- Create: `src-tauri/src/services/mod.rs`
- Create: `src-tauri/src/services/provider_svc.rs`
- Create: `src-tauri/src/services/model_svc.rs`
- Create: `src-tauri/src/services/config_svc.rs`
- Create: `src-tauri/src/services/sidecar_mgr.rs`
- Create: `src-tauri/src/services/tray_mgr.rs`
- Create: `src-tauri/src/commands/mod.rs` 及所有 command 文件
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 写 provider_svc.rs — 供应商业务逻辑（含 Key 加密/解密）**

```rust
// src-tauri/src/services/provider_svc.rs
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use crate::crypto::vault::Vault;
use crate::database::provider_dao;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderWithKeys {
    pub id: String,
    pub name: String,
    pub api_base: String,
    pub enabled: bool,
    pub is_default: bool,
    pub sort_order: i32,
    pub config_json: String,
    pub api_keys: Vec<String>,
    pub key_prefixes: Vec<String>,
}

pub fn get_all_providers(conn: &Connection, vault: &Vault) -> Result<Vec<ProviderWithKeys>, String> {
    let providers = provider_dao::list_providers(conn);
    providers.into_iter().map(|p| {
        let keys_rows = provider_dao::list_api_keys(conn, &p.id);
        let decrypted_keys: Vec<String> = keys_rows.iter()
            .map(|k| vault.decrypt(&k.key_hash).unwrap_or_else(|_| String::new()))
            .collect();
        let prefixes: Vec<String> = keys_rows.iter()
            .map(|k| k.key_prefix.clone())
            .collect();
        Ok(ProviderWithKeys {
            id: p.id,
            name: p.name,
            api_base: p.api_base,
            enabled: p.enabled,
            is_default: p.is_default,
            sort_order: p.sort_order,
            config_json: p.config_json,
            api_keys: decrypted_keys,
            key_prefixes: prefixes,
        })
    }).collect()
}

pub fn save_provider(
    conn: &Connection,
    vault: &Vault,
    id: &str,
    name: &str,
    api_base: &str,
    enabled: bool,
    is_default: bool,
    sort_order: i32,
    api_keys: &[String],
) -> Result<(), String> {
    // Upsert provider
    provider_dao::upsert_provider(conn, &provider_dao::ProviderRow {
        id: id.to_string(),
        name: name.to_string(),
        api_base: api_base.to_string(),
        enabled,
        is_default,
        sort_order,
        config_json: "{}".to_string(),
    }).map_err(|e| e.to_string())?;

    // Replace all keys: clear existing + insert new
    provider_dao::clear_api_keys(conn, id).map_err(|e| e.to_string())?;
    for key in api_keys {
        if key.trim().is_empty() { continue; }
        let key_hash = vault.encrypt(key.trim())?;
        let prefix = if key.len() > 8 { &key[..8] } else { key };
        provider_dao::add_api_key(conn, id, &key_hash, prefix)
            .map_err(|e| e.to_string())?;
    }

    if is_default {
        provider_dao::set_default_provider(conn, id).map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn delete_provider(conn: &Connection, id: &str) -> Result<(), String> {
    provider_dao::delete_provider(conn, id).map_err(|e| e.to_string())
}

pub fn set_default(conn: &Connection, id: &str) -> Result<(), String> {
    provider_dao::set_default_provider(conn, id).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: 写 model_svc.rs — 模型路由服务**

```rust
// src-tauri/src/services/model_svc.rs
use rusqlite::Connection;
use crate::database::model_dao;

pub fn get_all_routes(conn: &Connection) -> Result<Vec<model_dao::ModelRouteRow>, String> {
    Ok(model_dao::list_routes(conn))
}

pub fn save_route(conn: &Connection, codex_model: &str, provider_id: &str, vendor_model: &str) -> Result<(), String> {
    model_dao::upsert_route(conn, codex_model, provider_id, vendor_model).map_err(|e| e.to_string())
}

pub fn delete_route(conn: &Connection, codex_model: &str) -> Result<(), String> {
    model_dao::delete_route(conn, codex_model).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: 写 config_svc.rs — 组装环境变量给 sidecar**

```rust
// src-tauri/src/services/config_svc.rs
use rusqlite::Connection;
use crate::crypto::vault::Vault;
use crate::database::{provider_dao, model_dao, settings_dao};

pub fn build_env_for_sidecar(conn: &Connection, vault: &Vault) -> Result<Vec<(String, String)>, String> {
    let settings = settings_dao::get_all(conn);

    let port = settings.get("port").cloned().unwrap_or_else(|| "8317".to_string());
    let cache_enabled = settings.get("cache_enabled").cloned().unwrap_or_else(|| "true".to_string());
    let cache_ttl = settings.get("cache_ttl").cloned().unwrap_or_else(|| "300".to_string());
    let cache_max = settings.get("cache_max").cloned().unwrap_or_else(|| "1000".to_string());
    let retry_max = settings.get("retry_max").cloned().unwrap_or_else(|| "3".to_string());
    let retry_backoff = settings.get("retry_backoff").cloned().unwrap_or_else(|| "2.0".to_string());
    let circuit_threshold = settings.get("circuit_threshold").cloned().unwrap_or_else(|| "5".to_string());
    let circuit_cooldown = settings.get("circuit_cooldown").cloned().unwrap_or_else(|| "30".to_string());
    let concurrency_max = settings.get("concurrency_max").cloned().unwrap_or_else(|| "10".to_string());
    let rate_limit = settings.get("rate_limit").cloned().unwrap_or_else(|| "30".to_string());
    let thinking_disabled = settings.get("thinking_disabled").cloned().unwrap_or_else(|| "false".to_string());

    let mut env = vec![
        ("CLI_PROXY_PORT".into(), port),
        ("CLI_PROXY_CACHE_ENABLED".into(), cache_enabled),
        ("CLI_PROXY_CACHE_TTL".into(), cache_ttl),
        ("CLI_PROXY_CACHE_MAX".into(), cache_max),
        ("CLI_PROXY_RETRY_MAX".into(), retry_max),
        ("CLI_PROXY_RETRY_BACKOFF".into(), retry_backoff),
        ("CLI_PROXY_CIRCUIT_THRESHOLD".into(), circuit_threshold),
        ("CLI_PROXY_CIRCUIT_COOLDOWN".into(), circuit_cooldown),
        ("CLI_PROXY_CONCURRENCY_MAX".into(), concurrency_max),
        ("CLI_PROXY_RATE_LIMIT".into(), rate_limit),
        ("CLI_PROXY_THINKING_DISABLED".into(), thinking_disabled),
    ];

    // Build providers string
    let providers = provider_dao::list_providers(conn);
    let mut provider_strs = Vec::new();
    for p in &providers {
        if !p.enabled { continue; }
        let keys = provider_dao::list_api_keys(conn, &p.id);
        let decrypted: Vec<String> = keys.iter()
            .map(|k| vault.decrypt(&k.key_hash).unwrap_or_default())
            .filter(|k| !k.is_empty())
            .collect();
        if decrypted.is_empty() { continue; }
        provider_strs.push(format!("{}:{}:{}", p.id, p.api_base, decrypted.join(",")));
    }
    env.push(("CLI_PROXY_PROVIDERS".into(), provider_strs.join("|")));

    // Build model_map string
    let routes = model_dao::list_routes(conn);
    let map_str = routes.iter()
        .map(|r| format!("{}={}:{}", r.codex_model, r.provider_id, r.vendor_model))
        .collect::<Vec<_>>().join(",");
    env.push(("CLI_PROXY_MODEL_MAP".into(), map_str));

    // Default provider
    let default = providers.iter().find(|p| p.is_default)
        .map(|p| p.id.clone())
        .unwrap_or_else(|| "deepseek".to_string());
    env.push(("CLI_PROXY_DEFAULT_PROVIDER".into(), default));

    Ok(env)
}
```

- [ ] **Step 4: 写 sidecar_mgr.rs — 代理进程管理**

```rust
// src-tauri/src/services/sidecar_mgr.rs
use std::process::Stdio;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct SidecarManager {
    child: Arc<Mutex<Option<tokio::process::Child>>>,
    crash_count: Arc<Mutex<u32>>,
    is_quitting: Arc<Mutex<bool>>,
    pub max_crash_retries: u32,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            crash_count: Arc::new(Mutex::new(0)),
            is_quitting: Arc::new(Mutex::new(false)),
            max_crash_retries: 3,
        }
    }

    pub async fn start(&self, env: Vec<(String, String)>) -> Result<(), String> {
        let mut cmd = tokio::process::Command::new("./proxy/target/release/cli-proxy-sidecar");
        for (k, v) in &env { cmd.env(k, v); }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.kill_on_drop(true);

        let child = cmd.spawn().map_err(|e| format!("spawn sidecar: {e}"))?;
        *self.child.lock().await = Some(child);
        *self.crash_count.lock().await = 0;

        self.wait_for_healthy().await
    }

    pub async fn stop(&self) -> Result<(), String> {
        *self.is_quitting.lock().await = true;
        if let Some(mut child) = self.child.lock().await.take() {
            child.kill().await.map_err(|e| format!("kill sidecar: {e}"))?;
        }
        Ok(())
    }

    pub async fn restart(&self, env: Vec<(String, String)>) -> Result<(), String> {
        self.stop().await?;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        self.start(env).await
    }

    pub async fn is_running(&self) -> bool {
        if let Some(ref mut child) = *self.child.lock().await {
            match child.try_wait() {
                Ok(Some(_)) => false,
                Ok(None) => true,
                Err(_) => false,
            }
        } else {
            false
        }
    }

    async fn wait_for_healthy(&self) -> Result<(), String> {
        let port = std::env::var("CLI_PROXY_PORT").unwrap_or_else(|_| "8317".to_string());
        let url = format!("http://127.0.0.1:{}/health", port);

        for _ in 0..30 {
            if *self.is_quitting.lock().await { return Err("shutting down".into()); }
            match reqwest::get(&url).await {
                Ok(resp) if resp.status().is_success() => return Ok(()),
                _ => tokio::time::sleep(std::time::Duration::from_millis(500)).await,
            }
        }
        Err("Health check timed out after 15s".into())
    }
}
```

- [ ] **Step 5: 写 tray_mgr.rs — 系统托盘（含快速切换）**

```rust
// src-tauri/src/services/tray_mgr.rs
use tauri::{
    AppHandle, Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    Runtime,
};
use rusqlite::Connection;
use crate::crypto::vault::Vault;
use crate::services::{provider_svc, sidecar_mgr::SidecarManager, config_svc};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct TrayState {
    pub tray_handle: Arc<Mutex<Option<tauri::tray::TrayIcon>>>,
}

pub fn setup_tray<R: Runtime>(
    app: &AppHandle<R>,
    db: Arc<Mutex<Connection>>,
    vault: Arc<Vault>,
    sidecar: Arc<SidecarManager>,
) -> Result<(), Box<dyn std::error::Error>> {
    let providers = {
        let conn = db.lock().unwrap();
        provider_svc::get_all_providers(&conn, &vault).unwrap_or_default()
    };

    let mut menu = MenuBuilder::new(app);

    // Quick switch section: one item per provider
    for p in &providers {
        let label = if p.is_default {
            format!("✓ {} ({})", p.name, p.id)
        } else {
            format!("  {} ({})", p.name, p.id)
        };
        let p_id = p.id.clone();
        let db_clone = db.clone();
        let vault_clone = vault.clone();
        let sidecar_clone = sidecar.clone();

        let item = MenuItemBuilder::with_id(&p.id, label)
            .build(app)?;

        item.set_selected(p.is_default);
        // On click: set this provider as default, restart sidecar
        let item_id = p_id.clone();
        menu = menu.item(&item);

        // Note: click handler is registered via Tauri's on_menu_event in main.rs
    }

    menu = menu.separator();

    // Status section
    let status_label = if providers.iter().any(|p| p.is_default && p.enabled) {
        "代理运行中"
    } else {
        "代理已停止"
    };
    menu = menu.text("status", status_label);

    menu = menu.separator();

    menu = menu.item(
        &MenuItemBuilder::with_id("toggle_proxy", "启动/停止代理").build(app)?
    );
    menu = menu.item(
        &MenuItemBuilder::with_id("show_window", "打开面板").build(app)?
    );

    menu = menu.separator();

    menu = menu.item(
        &MenuItemBuilder::with_id("auto_launch", "开机自启").build(app)?
    );
    menu = menu.item(
        &MenuItemBuilder::with_id("quit", "退出").build(app)?
    );

    let tray = TrayIconBuilder::new()
        .menu(&menu.build()?)
        .tooltip("cli-proxy")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                // Show window on double click
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
```

- [ ] **Step 6: 写 commands（Tauri 命令层）**

```rust
// src-tauri/src/commands/mod.rs
pub mod provider_cmd;
pub mod model_cmd;
pub mod settings_cmd;
pub mod stats_cmd;
pub mod sidecar_cmd;
```

```rust
// src-tauri/src/commands/provider_cmd.rs
use rusqlite::Connection;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::State;
use crate::crypto::vault::Vault;
use crate::services::{provider_svc, sidecar_mgr::SidecarManager, config_svc};
use crate::AppState;

#[tauri::command]
pub fn get_providers(state: State<'_, AppState>) -> Result<Vec<provider_svc::ProviderWithKeys>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    provider_svc::get_all_providers(&conn, &state.vault)
}

#[tauri::command]
pub async fn save_provider(
    state: State<'_, AppState>,
    id: String,
    name: String,
    api_base: String,
    enabled: bool,
    is_default: bool,
    sort_order: i32,
    api_keys: Vec<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    provider_svc::save_provider(&conn, &state.vault, &id, &name, &api_base, enabled, is_default, sort_order, &api_keys)?;
    drop(conn);

    let env = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        config_svc::build_env_for_sidecar(&conn, &state.vault)?
    };
    state.sidecar.restart(env).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_provider(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    provider_svc::delete_provider(&conn, &id)?;
    drop(conn);

    let env = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        config_svc::build_env_for_sidecar(&conn, &state.vault)?
    };
    state.sidecar.restart(env).await?;
    Ok(())
}

#[tauri::command]
pub async fn set_default_provider(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    provider_svc::set_default(&conn, &id)?;
    drop(conn);

    let env = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        config_svc::build_env_for_sidecar(&conn, &state.vault)?
    };
    state.sidecar.restart(env).await?;
    Ok(())
}
```

```rust
// src-tauri/src/commands/model_cmd.rs
use tauri::State;
use crate::services::{model_svc, sidecar_mgr::SidecarManager, config_svc};
use crate::AppState;

#[tauri::command]
pub fn get_model_routes(state: State<'_, AppState>) -> Result<Vec<crate::database::model_dao::ModelRouteRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    model_svc::get_all_routes(&conn)
}

#[tauri::command]
pub async fn save_model_route(
    state: State<'_, AppState>,
    codex_model: String,
    provider_id: String,
    vendor_model: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    model_svc::save_route(&conn, &codex_model, &provider_id, &vendor_model)?;
    drop(conn);

    let env = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        config_svc::build_env_for_sidecar(&conn, &state.vault)?
    };
    state.sidecar.restart(env).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_model_route(state: State<'_, AppState>, codex_model: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    model_svc::delete_route(&conn, &codex_model)?;
    drop(conn);

    let env = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        config_svc::build_env_for_sidecar(&conn, &state.vault)?
    };
    state.sidecar.restart(env).await?;
    Ok(())
}
```

```rust
// src-tauri/src/commands/settings_cmd.rs
use tauri::State;
use std::collections::HashMap;
use crate::services::{sidecar_mgr::SidecarManager, config_svc};
use crate::AppState;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::database::settings_dao::get_all(&conn))
}

#[tauri::command]
pub async fn update_settings(state: State<'_, AppState>, settings: HashMap<String, String>) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        for (key, value) in &settings {
            crate::database::settings_dao::set(&conn, key, value).map_err(|e| e.to_string())?;
        }
    }

    let env = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        config_svc::build_env_for_sidecar(&conn, &state.vault)?
    };
    state.sidecar.restart(env).await?;
    Ok(())
}
```

```rust
// src-tauri/src/commands/stats_cmd.rs
use tauri::State;
use crate::AppState;
use crate::database::usage_dao;

#[tauri::command]
pub fn get_usage_summary(state: State<'_, AppState>) -> Result<usage_dao::UsageSummary, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(usage_dao::get_today_summary(&conn))
}

#[tauri::command]
pub fn get_hourly_trend(state: State<'_, AppState>) -> Result<Vec<usage_dao::HourlyTrend>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(usage_dao::get_hourly_trend(&conn))
}

#[tauri::command]
pub fn get_provider_distribution(state: State<'_, AppState>) -> Result<Vec<usage_dao::ProviderUsage>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(usage_dao::get_provider_distribution(&conn))
}
```

```rust
// src-tauri/src/commands/sidecar_cmd.rs
use tauri::State;
use crate::services::{sidecar_mgr::SidecarManager, config_svc};
use crate::AppState;

#[tauri::command]
pub async fn start_proxy(state: State<'_, AppState>) -> Result<(), String> {
    let env = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        config_svc::build_env_for_sidecar(&conn, &state.vault)?
    };
    state.sidecar.start(env).await
}

#[tauri::command]
pub async fn stop_proxy(state: State<'_, AppState>) -> Result<(), String> {
    state.sidecar.stop().await
}

#[tauri::command]
pub async fn restart_proxy(state: State<'_, AppState>) -> Result<(), String> {
    let env = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        config_svc::build_env_for_sidecar(&conn, &state.vault)?
    };
    state.sidecar.restart(env).await
}

#[tauri::command]
pub async fn get_proxy_status(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.sidecar.is_running().await)
}
```

- [ ] **Step 7: 写 main.rs — Tauri 入口**

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod services;
mod database;
mod crypto;

use crypto::vault::Vault;
use database::migration;
use services::sidecar_mgr::SidecarManager;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    db: Arc<Mutex<rusqlite::Connection>>,
    vault: Arc<Vault>,
    sidecar: Arc<SidecarManager>,
}

fn main() {
    let db_path = database::get_db_path();
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
    migration::run_migrations(&conn).unwrap();

    let vault = Arc::new(Vault::new().unwrap());
    let sidecar = Arc::new(SidecarManager::new());
    let db = Arc::new(Mutex::new(conn));

    tauri::Builder::default()
        .manage(AppState {
            db: db.clone(),
            vault: vault.clone(),
            sidecar: sidecar.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            commands::provider_cmd::get_providers,
            commands::provider_cmd::save_provider,
            commands::provider_cmd::delete_provider,
            commands::provider_cmd::set_default_provider,
            commands::model_cmd::get_model_routes,
            commands::model_cmd::save_model_route,
            commands::model_cmd::delete_model_route,
            commands::settings_cmd::get_settings,
            commands::settings_cmd::update_settings,
            commands::stats_cmd::get_usage_summary,
            commands::stats_cmd::get_hourly_trend,
            commands::stats_cmd::get_provider_distribution,
            commands::sidecar_cmd::start_proxy,
            commands::sidecar_cmd::stop_proxy,
            commands::sidecar_cmd::restart_proxy,
            commands::sidecar_cmd::get_proxy_status,
        ])
        .setup(|app| {
            // Setup tray (deferred — accessed via app handle)
            let _app_handle = app.handle().clone();
            // Tray setup is done after the app is fully initialized
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 8: 编译**

Run: `cd src-tauri && cargo build`
Expected: 编译成功

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(tauri): Services + Commands + main.rs — 完整配置管理 + Sidecar + Tray"
```

---

## Phase 3: 前端 (React + Tailwind + shadcn/ui)

### Task 13: Vite + React + Tailwind + shadcn 初始化

**Files:**
- Modify: `package.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.cjs`
- Create: `tsconfig.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`

- [ ] **Step 1: 配置 package.json 依赖**

Run:
```bash
npm create vite@latest . -- --template react-ts
npm install tailwindcss @tailwindcss/vite recharts @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @tanstack/react-query @tauri-apps/api lucide-react class-variance-authority clsx tailwind-merge
npm install -D @types/react @types/react-dom
```

- [ ] **Step 2: 写 vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

- [ ] **Step 3: 写 tailwind.config.ts**

```typescript
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{html,js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0f",
        surface: "#12121a",
        "surface-2": "#1a1a26",
        border: "#2a2a3a",
        "text-primary": "#e0e0e8",
        "text-dim": "#8888a0",
        accent: "#6c8cff",
        green: "#34d399",
        orange: "#f59e0b",
        red: "#f87171",
      },
    },
  },
} satisfies Config;
```

- [ ] **Step 4: 写 src/index.css**

```css
@import "tailwindcss";

@theme {
  --color-bg: #0a0a0f;
  --color-surface: #12121a;
  --color-surface-2: #1a1a26;
  --color-border: #2a2a3a;
  --color-text-primary: #e0e0e8;
  --color-text-dim: #8888a0;
  --color-accent: #6c8cff;
  --color-green: #34d399;
  --color-orange: #f59e0b;
  --color-red: #f87171;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
  background: var(--color-bg);
  color: var(--color-text-primary);
  margin: 0;
  overflow: hidden;
  height: 100vh;
}
```

- [ ] **Step 5: 写 App.tsx + main.tsx**

```typescript
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, retry: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
```

```typescript
// src/App.tsx
import { useState } from "react";
import Sidebar from "./components/layout/Sidebar";
import DashboardPage from "./components/dashboard/DashboardPage";
import ProvidersPage from "./components/providers/ProvidersPage";
import ModelsPage from "./components/models/ModelsPage";
import LogsPage from "./components/logs/LogsPage";
import SettingsPage from "./components/settings/SettingsPage";

export type TabId = "dashboard" | "providers" | "models" | "logs" | "settings";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");

  return (
    <div className="flex h-screen">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 overflow-y-auto p-8">
        {activeTab === "dashboard" && <DashboardPage />}
        {activeTab === "providers" && <ProvidersPage />}
        {activeTab === "models" && <ModelsPage />}
        {activeTab === "logs" && <LogsPage />}
        {activeTab === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
```

- [ ] **Step 6: 编译验证**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(frontend): Vite + React + Tailwind + shadcn 初始化"
```

---

### Task 14: Layout 组件 — Sidebar + StatusFooter

**Files:**
- Create: `src/components/layout/Sidebar.tsx`
- Create: `src/components/layout/StatusFooter.tsx`
- Create: `src/lib/api/tauri.ts`

- [ ] **Step 1: 写 API 封装层**

```typescript
// src/lib/api/tauri.ts
import { invoke } from "@tauri-apps/api/core";

// ── Types ──
export interface ProviderWithKeys {
  id: string;
  name: string;
  api_base: string;
  enabled: boolean;
  is_default: boolean;
  sort_order: number;
  config_json: string;
  api_keys: string[];
  key_prefixes: string[];
}

export interface ModelRouteRow {
  id: number;
  codex_model: string;
  provider_id: string;
  vendor_model: string;
}

export interface UsageSummary {
  total_requests: number;
  cache_hits: number;
  errors: number;
  avg_latency_ms: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
}

export interface HourlyTrend {
  hour: string;
  count: number;
}

export interface ProviderUsage {
  provider_id: string;
  count: number;
  total_tokens: number;
}

export interface BackendInfo {
  status: "stopped" | "starting" | "running" | "stopping" | "error";
  port: number;
}

// ── Provider API ──
export const getProviders = () => invoke<ProviderWithKeys[]>("get_providers");

export const saveProvider = (params: {
  id: string;
  name: string;
  api_base: string;
  enabled: boolean;
  is_default: boolean;
  sort_order: number;
  api_keys: string[];
}) => invoke<void>("save_provider", params);

export const deleteProvider = (id: string) => invoke<void>("delete_provider", { id });

export const setDefaultProvider = (id: string) =>
  invoke<void>("set_default_provider", { id });

// ── Model API ──
export const getModelRoutes = () => invoke<ModelRouteRow[]>("get_model_routes");

export const saveModelRoute = (codex_model: string, provider_id: string, vendor_model: string) =>
  invoke<void>("save_model_route", { codex_model, provider_id, vendor_model });

export const deleteModelRoute = (codex_model: string) =>
  invoke<void>("delete_model_route", { codex_model });

// ── Settings API ──
export const getSettings = () => invoke<Record<string, string>>("get_settings");

export const updateSettings = (settings: Record<string, string>) =>
  invoke<void>("update_settings", { settings });

// ── Stats API ──
export const getUsageSummary = () => invoke<UsageSummary>("get_usage_summary");

export const getHourlyTrend = () => invoke<HourlyTrend[]>("get_hourly_trend");

export const getProviderDistribution = () => invoke<ProviderUsage[]>("get_provider_distribution");

// ── Proxy API ──
export const startProxy = () => invoke<void>("start_proxy");

export const stopProxy = () => invoke<void>("stop_proxy");

export const restartProxy = () => invoke<void>("restart_proxy");

export const getProxyStatus = () => invoke<boolean>("get_proxy_status");
```

- [ ] **Step 2: 写 Sidebar 组件**

```typescript
// src/components/layout/Sidebar.tsx
import { TabId } from "../../App";
import StatusFooter from "./StatusFooter";

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const NAV_ITEMS: { id: TabId; icon: string; label: string }[] = [
  { id: "dashboard", icon: "◉", label: "仪表盘" },
  { id: "providers", icon: "⊞", label: "提供商" },
  { id: "models", icon: "⚙", label: "模型路由" },
  { id: "logs", icon: "☰", label: "请求日志" },
  { id: "settings", icon: "⚒", label: "设置" },
];

export default function Sidebar({ activeTab, onTabChange }: Props) {
  return (
    <nav className="w-[200px] min-w-[200px] bg-surface border-r border-border flex flex-col select-none">
      {/* Brand */}
      <div className="px-[18px] py-5 flex items-center gap-2.5 border-b border-border">
        <span className="w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_8px_rgba(108,140,255,0.5)]" />
        <span className="font-bold text-[1.05em] text-white">cli-proxy</span>
      </div>

      {/* Nav Items */}
      <ul className="list-none px-2 py-3 flex-1">
        {NAV_ITEMS.map((item) => (
          <li
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm mb-0.5 transition-colors ${
              activeTab === item.id
                ? "bg-accent/10 text-accent"
                : "text-text-dim hover:bg-surface-2 hover:text-text-primary"
            }`}
          >
            <span className="text-[1.1em] w-5 text-center">{item.icon}</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>

      <StatusFooter />
    </nav>
  );
}
```

- [ ] **Step 3: 写 StatusFooter**

```typescript
// src/components/layout/StatusFooter.tsx
import { useEffect, useState } from "react";
import { getProxyStatus } from "../../lib/api/tauri";

export default function StatusFooter() {
  const [status, setStatus] = useState<string>("stopped");

  useEffect(() => {
    const poll = async () => {
      try {
        const running = await getProxyStatus();
        setStatus(running ? "running" : "stopped");
      } catch {
        setStatus("error");
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  const labels: Record<string, string> = {
    running: "运行中",
    stopped: "已停止",
    starting: "启动中...",
    stopping: "停止中...",
    error: "错误",
  };

  return (
    <div className="px-[18px] py-3.5 border-t border-border flex items-center gap-2 text-[0.82em] text-text-dim">
      <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${
        status === "running" ? "bg-green shadow-[0_0_6px_rgba(52,211,153,0.5)]" :
        status === "error" ? "bg-red shadow-[0_0_6px_rgba(248,113,113,0.5)]" :
        status === "starting" || status === "stopping" ? "bg-orange animate-pulse" :
        "bg-[#555]"
      }`} />
      {labels[status] || status}
    </div>
  );
}
```

- [ ] **Step 4: 编译**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(frontend): Sidebar + StatusFooter + Tauri API 封装"
```

---

### Task 15: Dashboard Page — 状态卡片 + 供应商网格 + 统计 + 图表

**Files:**
- Create: `src/components/dashboard/DashboardPage.tsx`
- Create: `src/components/dashboard/StatusCard.tsx`
- Create: `src/components/dashboard/ProviderGrid.tsx`
- Create: `src/components/dashboard/StatsCards.tsx`
- Create: `src/components/dashboard/Charts.tsx`
- Create: `src/hooks/useProviders.ts`
- Create: `src/hooks/useStats.ts`

- [ ] **Step 1: 写 hooks/useProviders.ts**

```typescript
// src/hooks/useProviders.ts
import { useQuery } from "@tanstack/react-query";
import { getProviders, ProviderWithKeys } from "../lib/api/tauri";

export function useProviders() {
  return useQuery<ProviderWithKeys[]>({
    queryKey: ["providers"],
    queryFn: getProviders,
    refetchInterval: 5000,
    initialData: [],
  });
}
```

- [ ] **Step 2: 写 hooks/useStats.ts**

```typescript
// src/hooks/useStats.ts
import { useQuery } from "@tanstack/react-query";
import { getUsageSummary, getHourlyTrend, getProviderDistribution } from "../lib/api/tauri";

export function useUsageSummary() {
  return useQuery({ queryKey: ["usage-summary"], queryFn: getUsageSummary, refetchInterval: 5000 });
}

export function useHourlyTrend() {
  return useQuery({ queryKey: ["hourly-trend"], queryFn: getHourlyTrend, refetchInterval: 30000 });
}

export function useProviderDistribution() {
  return useQuery({ queryKey: ["provider-distribution"], queryFn: getProviderDistribution, refetchInterval: 30000 });
}
```

- [ ] **Step 3: 写 StatusCard**

```typescript
// src/components/dashboard/StatusCard.tsx
import { useState } from "react";
import { startProxy, stopProxy, restartProxy } from "../../lib/api/tauri";

interface Props {
  status: string;
  port?: number;
  uptime?: number;
}

export default function StatusCard({ status, port, uptime }: Props) {
  const [loading, setLoading] = useState(false);
  const isRunning = status === "running";
  const isBusy = status === "starting" || status === "stopping";

  const labels: Record<string, string> = {
    running: "代理运行中",
    stopped: "代理已停止",
    starting: "正在启动...",
    stopping: "正在停止...",
    error: "代理异常",
  };

  const doAction = async (action: () => Promise<void>) => {
    setLoading(true);
    try { await action(); } catch (e: any) { alert(e); }
    setLoading(false);
  };

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className={`w-3.5 h-3.5 rounded-full ${
            isRunning ? "bg-green shadow-[0_0_6px_rgba(52,211,153,0.5)]" :
            status === "error" ? "bg-red" :
            isBusy ? "bg-orange animate-pulse" : "bg-[#555]"
          }`} />
          <div>
            <div className="text-[1.1em] font-semibold">{labels[status] || status}</div>
            <div className="text-text-dim text-sm flex gap-5 flex-wrap">
              <span>端口: {port || "—"}</span>
              <span>运行时间: {uptime ? formatUptime(uptime) : "—"}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <>
              <button disabled={isBusy || loading} className="px-4 py-2 rounded-md border border-red/30 text-red bg-surface-2 hover:bg-red/10 disabled:opacity-40" onClick={() => doAction(stopProxy)}>停止</button>
              <button disabled={isBusy || loading} className="px-4 py-2 rounded-md border border-border bg-surface-2 text-text-primary hover:bg-border disabled:opacity-40" onClick={() => doAction(restartProxy)}>重启</button>
            </>
          ) : (
            <button disabled={isBusy || loading} className="px-4 py-2 rounded-md border border-accent bg-accent text-white hover:opacity-90 disabled:opacity-40" onClick={() => doAction(startProxy)}>启动</button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatUptime(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s % 60}s`;
}
```

- [ ] **Step 4: 写 ProviderGrid**

```typescript
// src/components/dashboard/ProviderGrid.tsx
import { useProviders } from "../../hooks/useProviders";

export default function ProviderGrid() {
  const { data: providers } = useProviders();
  const list = providers ?? [];

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <h3 className="text-xs uppercase tracking-wider font-bold text-text-dim mb-3.5">供应商状态</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {(list.length === 0 ? PLACEHOLDER_PROVIDERS : list).map((p) => (
          <div key={p.id} className="bg-surface-2 border border-border rounded-[10px] p-4">
            <div className="font-semibold mb-2">{p.name}</div>
            <div className={`text-sm flex items-center gap-1.5 ${
              p.enabled ? "text-green" : "text-text-dim"
            }`}>
              <span className={`w-2 h-2 rounded-full ${p.enabled ? "bg-green" : "bg-[#555]"}`} />
              {p.enabled ? "已启用" : "未配置"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const PLACEHOLDER_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", enabled: false },
  { id: "siliconflow", name: "SiliconFlow", enabled: false },
  { id: "qwen", name: "通义千问", enabled: false },
  { id: "bailian", name: "阿里百炼", enabled: false },
  { id: "moonshot", name: "Moonshot", enabled: false },
];
```

- [ ] **Step 5: 写 StatsCards**

```typescript
// src/components/dashboard/StatsCards.tsx
import { useUsageSummary } from "../../hooks/useStats";

export default function StatsCards() {
  const { data } = useUsageSummary();
  const s = data ?? { total_requests: 0, cache_hits: 0, errors: 0, total_prompt_tokens: 0, total_completion_tokens: 0 };

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <h3 className="text-xs uppercase tracking-wider font-bold text-text-dim mb-3.5">今日统计</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        <StatItem value={s.total_requests} label="请求总数" />
        <StatItem value={s.cache_hits} label="缓存命中" />
        <StatItem value={s.errors} label="错误" color="text-red" />
        <StatItem value={formatTokens(s.total_prompt_tokens + s.total_completion_tokens)} label="Token 消耗" />
      </div>
    </div>
  );
}

function StatItem({ value, label, color }: { value: number | string; label: string; color?: string }) {
  return (
    <div className="bg-surface-2 border border-border rounded-[10px] p-4 text-center">
      <div className={`text-[1.8em] font-extrabold ${color || "text-accent"}`}>{value}</div>
      <div className="text-xs text-text-dim mt-1">{label}</div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
```

- [ ] **Step 6: 写 Charts**

```typescript
// src/components/dashboard/Charts.tsx
import { useHourlyTrend, useProviderDistribution } from "../../hooks/useStats";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["#6c8cff", "#34d399", "#f59e0b", "#f87171", "#a78bfa"];

export function RequestTrendChart() {
  const { data } = useHourlyTrend();
  const trend = data ?? [];

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mb-4 flex-1 min-w-[300px]">
      <h3 className="text-xs uppercase tracking-wider font-bold text-text-dim mb-3.5">24h 请求趋势</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={trend}>
          <XAxis dataKey="hour" stroke="#8888a0" fontSize={12} />
          <YAxis stroke="#8888a0" fontSize={12} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#1a1a26", border: "1px solid #2a2a3a", borderRadius: 8 }}
            labelStyle={{ color: "#e0e0e8" }}
          />
          <Bar dataKey="count" fill="#6c8cff" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProviderUsageChart() {
  const { data } = useProviderDistribution();
  const dist = (data ?? []).map((d) => ({ name: d.provider_id, value: d.count }));

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mb-4 flex-1 min-w-[300px]">
      <h3 className="text-xs uppercase tracking-wider font-bold text-text-dim mb-3.5">供应商分布</h3>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={dist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
            {dist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: "#1a1a26", border: "1px solid #2a2a3a", borderRadius: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 7: 组装 DashboardPage**

```typescript
// src/components/dashboard/DashboardPage.tsx
import { useState, useEffect } from "react";
import { getProxyStatus } from "../../lib/api/tauri";
import StatusCard from "./StatusCard";
import ProviderGrid from "./ProviderGrid";
import StatsCards from "./StatsCards";
import { RequestTrendChart, ProviderUsageChart } from "./Charts";

export default function DashboardPage() {
  const [status, setStatus] = useState("stopped");
  const [port, setPort] = useState(8317);

  useEffect(() => {
    const poll = async () => {
      try {
        const running = await getProxyStatus();
        setStatus(running ? "running" : "stopped");
      } catch { setStatus("error"); }
    };
    poll();
    const i = setInterval(poll, 3000);
    return () => clearInterval(i);
  }, []);

  return (
    <div>
      <div className="mb-6"><h2 className="text-[1.4em] font-bold text-white">仪表盘</h2></div>
      <StatusCard status={status} port={port} />
      <StatsCards />
      <div className="flex gap-4 flex-wrap">
        <RequestTrendChart />
        <ProviderUsageChart />
      </div>
      <ProviderGrid />
    </div>
  );
}
```

- [ ] **Step 8: 编译**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(frontend): 仪表盘 — 状态卡片/供应商网格/统计/趋势图/饼图"
```

---

### Task 16: Providers Page — 供应商管理 + 预设导入

**Files:**
- Create: `src/components/providers/ProvidersPage.tsx`
- Create: `src/components/providers/ProviderCard.tsx`
- Create: `src/components/providers/PresetDialog.tsx`

- [ ] **Step 1: 写 ProviderCard**

```typescript
// src/components/providers/ProviderCard.tsx
import { useState } from "react";
import { ProviderWithKeys, saveProvider, deleteProvider, setDefaultProvider } from "../../lib/api/tauri";

interface Props {
  provider: ProviderWithKeys & { _isNew?: boolean };
  onSaved: () => void;
}

const PRESET_PROVIDERS: Record<string, { name: string; api_base: string }> = {
  deepseek: { name: "DeepSeek", api_base: "https://api.deepseek.com" },
  siliconflow: { name: "SiliconFlow (硅基流动)", api_base: "https://api.siliconflow.cn" },
  qwen: { name: "通义千问 (DashScope)", api_base: "https://dashscope.aliyuncs.com/compatible-mode" },
  bailian: { name: "阿里百炼", api_base: "https://dashscope.aliyuncs.com/compatible-mode" },
  moonshot: { name: "Moonshot (Kimi)", api_base: "https://api.moonshot.cn" },
};

export default function ProviderCard({ provider, onSaved }: Props) {
  const [expanded, setExpanded] = useState(!!provider._isNew);
  const [name, setName] = useState(provider.name);
  const [apiBase, setApiBase] = useState(provider.api_base);
  const [keys, setKeys] = useState<string[]>(provider.api_keys.length > 0 ? provider.api_keys : [""]);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProvider({
        id: provider.id,
        name,
        api_base: apiBase,
        enabled: keys.some((k) => k.trim()),
        is_default: provider.is_default,
        sort_order: provider.sort_order,
        api_keys: keys.filter((k) => k.trim()),
      });
      onSaved();
    } catch (e: any) { alert(String(e)); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirm(`删除供应商 "${name}"?`)) return;
    try { await deleteProvider(provider.id); onSaved(); } catch (e: any) { alert(String(e)); }
  };

  const handleSetDefault = async () => {
    try { await setDefaultProvider(provider.id); onSaved(); } catch (e: any) { alert(String(e)); }
  };

  return (
    <div className="bg-surface border border-border rounded-[10px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <span className="font-bold text-[1.05em]">{name}</span>
          <span className="text-text-dim text-sm">({provider.id})</span>
          {provider.is_default && <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded">默认</span>}
          {provider.enabled && <span className="text-xs bg-green/20 text-green px-2 py-0.5 rounded">已启用</span>}
        </div>
        <span className="text-text-dim">{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded form */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4 flex flex-col gap-3.5">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase text-text-dim tracking-wider">供应商名称</label>
            <input className="px-3 py-2 rounded-md border border-border bg-bg text-text-primary text-sm focus:border-accent outline-none" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase text-text-dim tracking-wider">API Base URL</label>
            <input className="px-3 py-2 rounded-md border border-border bg-bg text-text-primary text-sm focus:border-accent outline-none" value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase text-text-dim tracking-wider">API Keys</label>
            {keys.map((k, i) => (
              <div key={i} className="flex gap-1.5 items-center">
                <input type="password" className="flex-1 px-3 py-2 rounded-md border border-border bg-bg text-text-primary text-sm focus:border-accent outline-none" value={k} onChange={(e) => {
                  const next = [...keys]; next[i] = e.target.value; setKeys(next);
                }} placeholder="sk-..." />
                <button className="px-2 py-1 text-xs border border-border rounded bg-surface-2 text-text-dim hover:bg-border" onClick={() => {
                  const input = document.querySelector(`input[data-key-index="${i}"]`) as HTMLInputElement;
                  if (input) input.type = input.type === "password" ? "text" : "password";
                }}>👁</button>
                <button className="px-2 py-1 text-xs border border-red/30 rounded text-red hover:bg-red/10" onClick={() => setKeys(keys.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="text-xs text-accent hover:underline self-start mt-1" onClick={() => setKeys([...keys, ""])}>+ 添加 Key</button>
          </div>

          <div className="flex gap-2 mt-2">
            <button disabled={saving} className="px-4 py-2 rounded-md bg-accent text-white text-sm hover:opacity-90 disabled:opacity-40" onClick={handleSave}>保存</button>
            {!provider.is_default && <button className="px-4 py-2 rounded-md border border-border bg-surface-2 text-sm text-text-primary hover:bg-border" onClick={handleSetDefault}>设为默认</button>}
            <button className="px-4 py-2 rounded-md border border-red/30 text-red text-sm hover:bg-red/10 ml-auto" onClick={handleDelete}>删除</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写 PresetDialog**

```typescript
// src/components/providers/PresetDialog.tsx
import { useState } from "react";
import { saveProvider } from "../../lib/api/tauri";

const PRESETS = [
  { id: "deepseek", name: "DeepSeek", api_base: "https://api.deepseek.com", description: "DeepSeek 官方 API" },
  { id: "siliconflow", name: "SiliconFlow (硅基流动)", api_base: "https://api.siliconflow.cn", description: "硅基流动 API 平台" },
  { id: "qwen", name: "通义千问 (DashScope)", api_base: "https://dashscope.aliyuncs.com/compatible-mode", description: "阿里云 DashScope" },
  { id: "bailian", name: "阿里百炼", api_base: "https://dashscope.aliyuncs.com/compatible-mode", description: "阿里百炼平台" },
  { id: "moonshot", name: "Moonshot (Kimi)", api_base: "https://api.moonshot.cn", description: "月之暗面 Kimi" },
  { id: "openai", name: "OpenAI", api_base: "https://api.openai.com", description: "OpenAI 官方 API" },
  { id: "azure", name: "Azure OpenAI", api_base: "https://YOUR_RESOURCE.openai.azure.com", description: "Azure OpenAI 服务" },
  { id: "groq", name: "Groq", api_base: "https://api.groq.com", description: "Groq 高速推理" },
  { id: "together", name: "Together AI", api_base: "https://api.together.xyz", description: "Together AI 平台" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function PresetDialog({ open, onClose, onImported }: Props) {
  const [importing, setImporting] = useState<string | null>(null);

  if (!open) return null;

  const handleImport = async (preset: typeof PRESETS[0]) => {
    setImporting(preset.id);
    try {
      await saveProvider({
        id: preset.id,
        name: preset.name,
        api_base: preset.api_base,
        enabled: false,
        is_default: false,
        sort_order: 0,
        api_keys: [],
      });
      onImported();
      onClose();
    } catch (e: any) { alert(String(e)); }
    setImporting(null);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl p-6 w-[600px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">导入预设供应商</h3>
          <button onClick={onClose} className="text-text-dim hover:text-text-primary text-xl">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {PRESETS.map((p) => (
            <div key={p.id} className="bg-surface-2 border border-border rounded-lg p-4 flex flex-col gap-2">
              <div className="font-semibold">{p.name}</div>
              <div className="text-xs text-text-dim">{p.description}</div>
              <button
                disabled={importing === p.id}
                className="mt-auto px-3 py-1.5 text-xs rounded-md bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40"
                onClick={() => handleImport(p)}
              >
                {importing === p.id ? "导入中..." : "一键导入"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 组装 ProvidersPage**

```typescript
// src/components/providers/ProvidersPage.tsx
import { useState } from "react";
import { useProviders } from "../../hooks/useProviders";
import ProviderCard from "./ProviderCard";
import PresetDialog from "./PresetDialog";

export default function ProvidersPage() {
  const { data, refetch } = useProviders();
  const [showPreset, setShowPreset] = useState(false);
  const providers = data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-[1.4em] font-bold text-white">提供商管理</h2>
        <button onClick={() => setShowPreset(true)} className="px-4 py-2 rounded-md bg-accent/20 text-accent text-sm hover:bg-accent/30">
          + 导入预设
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} onSaved={refetch} />
        ))}
        {providers.length === 0 && (
          <div className="text-text-dim text-center py-10">暂无供应商，点击"导入预设"开始配置</div>
        )}
      </div>

      <PresetDialog open={showPreset} onClose={() => setShowPreset(false)} onImported={refetch} />
    </div>
  );
}
```

- [ ] **Step 4: 编译**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(frontend): 供应商管理 — ProviderCard + 预设导入弹窗"
```

---

### Task 17: Models + Logs + Settings Pages

**Files:**
- Create: `src/components/models/ModelsPage.tsx`
- Create: `src/components/logs/LogsPage.tsx`
- Create: `src/components/settings/SettingsPage.tsx`

- [ ] **Step 1: 写 ModelsPage — 模型路由表**

```typescript
// src/components/models/ModelsPage.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getModelRoutes, getProviders, saveModelRoute, deleteModelRoute, ModelRouteRow } from "../../lib/api/tauri";

export default function ModelsPage() {
  const { data: routes, refetch } = useQuery({ queryKey: ["model-routes"], queryFn: getModelRoutes, initialData: [] });
  const { data: providers } = useQuery({ queryKey: ["providers"], queryFn: getProviders, initialData: [] });
  const [newCodex, setNewCodex] = useState("");
  const [newProvider, setNewProvider] = useState("deepseek");
  const [newVendor, setNewVendor] = useState("");

  const add = async () => {
    if (!newCodex.trim() || !newVendor.trim()) return;
    try {
      await saveModelRoute(newCodex.trim(), newProvider, newVendor.trim());
      setNewCodex(""); setNewVendor("");
      refetch();
    } catch (e: any) { alert(String(e)); }
  };

  const remove = async (codex: string) => {
    try { await deleteModelRoute(codex); refetch(); } catch (e: any) { alert(String(e)); }
  };

  return (
    <div>
      <div className="mb-6"><h2 className="text-[1.4em] font-bold text-white">模型路由</h2></div>

      <div className="bg-surface border border-border rounded-[10px] overflow-hidden mb-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-xs uppercase text-text-dim tracking-wider border-b border-border">Codex 模型名</th>
              <th className="text-left px-3 py-2 text-xs uppercase text-text-dim tracking-wider border-b border-border">供应商</th>
              <th className="text-left px-3 py-2 text-xs uppercase text-text-dim tracking-wider border-b border-border">上游模型名</th>
              <th className="w-16 px-3 py-2 text-xs uppercase text-text-dim tracking-wider border-b border-border"></th>
            </tr>
          </thead>
          <tbody>
            {(routes as ModelRouteRow[]).map((r) => (
              <tr key={r.codex_model} className="border-b border-border">
                <td className="px-3 py-1.5">{r.codex_model}</td>
                <td className="px-3 py-1.5">{r.provider_id}</td>
                <td className="px-3 py-1.5">{r.vendor_model}</td>
                <td className="px-3 py-1.5">
                  <button onClick={() => remove(r.codex_model)} className="text-red hover:underline text-xs">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface border border-border rounded-[10px] p-4 flex gap-3 items-end flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase text-text-dim">Codex 模型名</label>
          <input className="px-3 py-2 rounded-md border border-border bg-bg text-sm w-40" value={newCodex} onChange={(e) => setNewCodex(e.target.value)} placeholder="如 gpt-5.5" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase text-text-dim">供应商</label>
          <select className="px-3 py-2 rounded-md border border-border bg-bg text-sm" value={newProvider} onChange={(e) => setNewProvider(e.target.value)}>
            {providers!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase text-text-dim">上游模型名</label>
          <input className="px-3 py-2 rounded-md border border-border bg-bg text-sm w-48" value={newVendor} onChange={(e) => setNewVendor(e.target.value)} placeholder="如 deepseek-v4-pro" />
        </div>
        <button onClick={add} className="px-4 py-2 rounded-md bg-accent text-white text-sm hover:opacity-90">添加映射</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 SettingsPage**

```typescript
// src/components/settings/SettingsPage.tsx
import { useState, useEffect } from "react";
import { getSettings, updateSettings } from "../../lib/api/tauri";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { getSettings().then(setSettings).catch(() => {}); }, []);

  const setVal = (key: string, value: string) => setSettings((s) => ({ ...s, [key]: value }));

  const save = async () => {
    setSaving(true);
    try { await updateSettings(settings); } catch (e: any) { alert(String(e)); }
    setSaving(false);
  };

  return (
    <div>
      <div className="mb-6"><h2 className="text-[1.4em] font-bold text-white">设置</h2></div>

      {/* Server */}
      <Section title="服务器">
        <FormField label="监听端口" hint="修改后自动重启生效">
          <input type="number" className="input" value={settings.port || "8317"} onChange={(e) => setVal("port", e.target.value)} />
        </FormField>
      </Section>

      {/* Retry */}
      <Section title="重试策略">
        <FormField label="最大重试次数" hint="上游 5xx / 连接错误的自动重试次数">
          <input type="number" className="input" value={settings.retry_max || "3"} onChange={(e) => setVal("retry_max", e.target.value)} />
        </FormField>
        <FormField label="退避基数 (秒)" hint="指数退避 = 基数^n + 随机抖动">
          <input type="number" className="input" step="0.5" value={settings.retry_backoff || "2.0"} onChange={(e) => setVal("retry_backoff", e.target.value)} />
        </FormField>
      </Section>

      {/* Circuit Breaker */}
      <Section title="熔断器">
        <FormField label="失败阈值" hint="连续失败 N 次触发熔断">
          <input type="number" className="input" value={settings.circuit_threshold || "5"} onChange={(e) => setVal("circuit_threshold", e.target.value)} />
        </FormField>
        <FormField label="冷却时间 (秒)" hint="熔断后等待冷却再尝试恢复">
          <input type="number" className="input" value={settings.circuit_cooldown || "30"} onChange={(e) => setVal("circuit_cooldown", e.target.value)} />
        </FormField>
      </Section>

      {/* Concurrency */}
      <Section title="并发控制">
        <FormField label="最大并发数" hint="同时处理的上游请求数上限">
          <input type="number" className="input" value={settings.concurrency_max || "10"} onChange={(e) => setVal("concurrency_max", e.target.value)} />
        </FormField>
      </Section>

      {/* Theme */}
      <Section title="外观">
        <FormField label="主题">
          <select className="input" value={settings.theme || "dark"} onChange={(e) => setVal("theme", e.target.value)}>
            <option value="dark">暗色</option>
            <option value="light">亮色</option>
            <option value="system">跟随系统</option>
          </select>
        </FormField>
        <FormField label="语言">
          <select className="input" value={settings.language || "zh"} onChange={(e) => setVal("language", e.target.value)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </FormField>
      </Section>

      <div className="text-right mt-4">
        <button disabled={saving} onClick={save} className="px-6 py-2.5 rounded-md bg-accent text-white text-sm hover:opacity-90 disabled:opacity-40">保存设置</button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mb-4">
      <h3 className="text-xs uppercase tracking-wider font-bold text-text-dim mb-3.5">{title}</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">{children}</div>
    </div>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase text-text-dim tracking-wider">{label}</label>
      {children}
      {hint && <span className="text-xs text-text-dim mt-0.5">{hint}</span>}
    </div>
  );
}
```

- [ ] **Step 3: 写 LogsPage**

```typescript
// src/components/logs/LogsPage.tsx
import { useState, useEffect, useRef } from "react";
import { getProxyStatus } from "../../lib/api/tauri";

interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  source: string;
}

const MAX_ENTRIES = 2000;

export default function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen for log entries from the proxy sidecar (forwarded via Tauri events or polling)
  useEffect(() => {
    // In production, use Tauri event listener for proxy stdout
    // For now, show a placeholder until Tauri event bridge is wired
    const timer = setInterval(() => {
      // Placeholder: in real impl, entries come from Tauri events
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const filtered = entries.filter((e) => {
    if (levelFilter !== "ALL" && e.level !== levelFilter) return false;
    if (filter && !e.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="mb-6"><h2 className="text-[1.4em] font-bold text-white">请求日志</h2></div>

      <div className="bg-surface border border-border rounded-[10px] px-4 py-3 mb-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-dim">{entries.length} 条日志</span>
            <select className="px-2 py-1 rounded border border-border bg-bg text-sm" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
              <option value="ALL">全部</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input className="w-[200px] px-2 py-1 rounded border border-border bg-bg text-sm" placeholder="搜索日志..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="px-2 py-1 text-xs border border-border rounded bg-surface-2 text-text-dim" onClick={() => setPaused(!paused)}>{paused ? "▶ 继续" : "⏸ 暂停"}</button>
            <button className="px-2 py-1 text-xs border border-border rounded bg-surface-2 text-text-dim" onClick={() => setEntries([])}>清空</button>
          </div>
        </div>
      </div>

      <div ref={containerRef} className="bg-surface border border-border rounded-[10px] overflow-hidden" style={{ maxHeight: "calc(100vh - 240px)" }}>
        <div className="overflow-y-auto font-mono text-xs" style={{ maxHeight: "calc(100vh - 240px)" }}>
          {filtered.length === 0 ? (
            <div className="text-center text-text-dim py-10">暂无日志。发送请求后此处将显示实时日志。</div>
          ) : (
            filtered.map((e, i) => (
              <div key={i} className={`flex gap-3 px-3 py-1.5 border-b border-border ${
                e.level === "ERROR" ? "text-red" : e.level === "WARN" ? "text-orange" : ""
              }`}>
                <span className="text-text-dim whitespace-nowrap">{new Date(e.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                <span className="font-semibold w-11">{e.level}</span>
                <span className="flex-1 break-all">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 编译**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(frontend): 模型路由 + 设置 + 日志面板"
```

---

## Phase 4: 包装

### Task 18: 系统托盘增强 — 动态菜单 + 快速切换

**Files:**
- Modify: `src-tauri/src/services/tray_mgr.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 重写 tray_mgr.rs — 动态重建托盘菜单**

```rust
// src-tauri/src/services/tray_mgr.rs
use tauri::{
    AppHandle, Manager, Runtime,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};
use rusqlite::Connection;
use crate::crypto::vault::Vault;
use crate::services::{provider_svc, sidecar_mgr::SidecarManager, config_svc};
use std::sync::Arc;
use tokio::sync::Mutex;

pub fn rebuild_tray<R: Runtime>(
    app: &AppHandle<R>,
    db: &Arc<Mutex<Connection>>,
    vault: &Arc<Vault>,
    sidecar: &Arc<SidecarManager>,
) -> Result<(), Box<dyn std::error::Error>> {
    let providers = {
        let conn = db.lock().unwrap();
        provider_svc::get_all_providers(&conn, vault).unwrap_or_default()
    };

    let is_running = {
        let rt = tokio::runtime::Handle::current();
        rt.block_on(sidecar.is_running())
    };

    let mut menu = MenuBuilder::new(app);

    // Status header
    menu = menu.text("status", if is_running {
        format!("代理运行中 (端口: {})", std::env::var("CLI_PROXY_PORT").unwrap_or("8317".into()))
    } else {
        "代理已停止".into()
    });

    menu = menu.separator();

    // Provider quick-switch section
    if is_running && !providers.is_empty() {
        for p in &providers {
            let label = if p.is_default {
                format!("✓ {} ({})", p.name, p.id)
            } else {
                format!("  {} ({})", p.name, p.id)
            };
            let item = MenuItemBuilder::with_id(&format!("switch_{}", p.id), label).build(app)?;
            item.set_enabled(p.enabled);
            menu = menu.item(&item);
        }
        menu = menu.separator();
    }

    // Actions
    let toggle_label = if is_running { "停止代理" } else { "启动代理" };
    menu = menu.item(&MenuItemBuilder::with_id("toggle_proxy", toggle_label).build(app)?);
    menu = menu.item(&MenuItemBuilder::with_id("show_window", "打开面板").build(app)?);

    menu = menu.separator();
    menu = menu.item(&MenuItemBuilder::with_id("quit", "退出").build(app)?);

    // Remove old tray and create new one (or update menu)
    // Tauri 2 doesn't support dynamic menu updates in place — we rebuild
    let _ = app.remove_tray_by_id("main-tray");

    let _tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu.build()?)
        .tooltip("cli-proxy")
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "toggle_proxy" => { /* toggle proxy */ }
                "show_window" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "quit" => { app.exit(0); }
                id if id.starts_with("switch_") => {
                    let provider_id = id.strip_prefix("switch_").unwrap();
                    // Switch to this provider
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
```

- [ ] **Step 2: 在 main.rs setup 中初始化 tray**

在 `src-tauri/src/main.rs` 的 `setup` 闭包中添加托盘初始化逻辑，并在配置变更事件中调用 `rebuild_tray`。

- [ ] **Step 3: 编译**

Run: `cd src-tauri && cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(tauri): 托盘快速切换 — 动态菜单 + Provider切换"
```

---

### Task 19: 开机自启 + 自动更新 + 打包配置

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/services/auto_launch.rs`

- [ ] **Step 1: 写 auto_launch.rs**

```rust
// src-tauri/src/services/auto_launch.rs
use tauri::Manager;

pub fn set_auto_launch(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe_path.to_string_lossy().to_string();
        let status = if enabled {
            Command::new("reg").args(["add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v", "cli-proxy", "/t", "REG_SZ",
                "/d", &format!(r#""{}" --minimized"#, exe),
                "/f",
            ]).status().map_err(|e| e.to_string())?
        } else {
            Command::new("reg").args(["delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v", "cli-proxy", "/f",
            ]).status().map_err(|e| e.to_string())?
        };
        if status.success() { Ok(()) } else { Err("registry operation failed".into()) }
    }

    #[cfg(target_os = "macos")]
    {
        // Use launchd or Tauri's built-in mechanism
        Ok(())
    }
}

pub fn is_auto_launch_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("reg").args(["query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v", "cli-proxy",
        ]).output().map(|o| o.status.success()).unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    { false }
}
```

- [ ] **Step 2: 更新 tauri.conf.json 打包配置**

```json
{
  "productName": "cli-proxy",
  "version": "1.0.0",
  "identifier": "io.cli-proxy.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "cli-proxy",
        "width": 1100,
        "height": 750,
        "minWidth": 720,
        "minHeight": 500,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": ["icons/icon.png"],
    "resources": {
      "proxy/target/release/cli-proxy-sidecar.exe": "sidecar/"
    },
    "windows": {
      "nsis": {
        "installMode": "currentUser",
        "installerIcon": "icons/icon.ico",
        "oneClick": false,
        "allowToChangeInstallationDirectory": true,
        "createDesktopShortcut": true
      }
    }
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/cchenbin042/cli-proxy/releases/latest/download/latest.json"
      ],
      "pubkey": "PLACEHOLDER_PUBLIC_KEY"
    }
  }
}
```

- [ ] **Step 3: 编译 + 测试打包**

Run:
```bash
cd src-tauri && cargo build --release
npm run tauri build
```
Expected: 生成 `src-tauri/target/release/bundle/nsis/cli-proxy_1.0.0_x64-setup.exe`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(tauri): 开机自启 + 自动更新 + NSIS 打包配置"
```

---

### Task 20: 端到端联调 + CI/CD

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: 写 GitHub Actions 发布流水线**

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - uses: dtolnay/rust-toolchain@stable
      - name: Build proxy sidecar
        run: cargo build --release --manifest-path proxy/Cargo.toml
      - name: Install frontend deps
        run: npm ci
      - name: Build Tauri app
        run: npm run tauri build
      - uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: src-tauri/target/release/bundle/nsis/*.exe

  create-release:
    needs: build-windows
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { name: windows-installer }
      - uses: softprops/action-gh-release@v1
        with:
          files: "*.exe"
          draft: true
          generate_release_notes: true
```

- [ ] **Step 2: 本地端到端测试清单**

```
[ ] 启动应用 → 托盘图标出现
[ ] 仪表盘显示代理状态（已停止）
[ ] 点击"启动"→ 代理启动 → 健康检查通过 → 左侧状态变绿
[ ] curl http://localhost:8317/health → {"status":"ok"}
[ ] 发送非流式请求 → 格式转换正确 → 审计日志写入
[ ] 发送流式请求 → SSE 事件正确 → reasoning 持久化
[ ] 供应商页面 → 添加 Key → 保存 → 代理自动重启
[ ] 模型路由页面 → 添加映射 → 保存
[ ] 设置页面 → 修改端口/重试参数 → 保存
[ ] 托盘右键 → 显示供应商列表 → 快速切换生效
[ ] 仪表盘统计卡片更新、图表渲染
[ ] 日志面板实时显示代理输出
[ ] 窗口关闭 → 隐藏到托盘
[ ] 托盘点击"退出"→ 代理停止 → 应用退出
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ci: GitHub Actions 发布流水线 + E2E 测试清单"
```

---

## 执行顺序总结

| Phase | Tasks | 产出 | 可独立验证 |
|-------|-------|------|-----------|
| P1 代理核 | 1-8 | 独立可运行的 Rust proxy binary | `cargo test` + `curl /health` |
| P2 Tauri 壳 | 9-12 | Tauri 桌面 app，可启停代理 | `cargo run` + SQLite 验证 |
| P3 前端 | 13-17 | React UI 所有面板，通过 Tauri invoke 通信 | 浏览器 `npm run dev` 调试 |
| P4 包装 | 18-20 | 托盘菜单 + 打包 + CI/CD | 安装器运行端到端测试 |
