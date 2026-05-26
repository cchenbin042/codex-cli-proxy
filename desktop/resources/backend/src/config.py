"""Configuration loader for cli-proxy."""

import os
from pathlib import Path
from dataclasses import dataclass, field

import yaml


@dataclass
class RetryConfig:
    max_retries: int = 3
    backoff_base: float = 2.0


@dataclass
class CircuitBreakerConfig:
    failure_threshold: int = 5
    cooldown_seconds: float = 30.0


@dataclass
class ConcurrencyConfig:
    max_concurrent: int = 10
    queue_timeout: float = 30.0


@dataclass
class RateLimitConfig:
    requests_per_minute: int = 30
    burst_size: int = 30


@dataclass
class ReliabilityConfig:
    retry: RetryConfig = field(default_factory=RetryConfig)
    circuit_breaker: CircuitBreakerConfig = field(default_factory=CircuitBreakerConfig)
    concurrency: ConcurrencyConfig = field(default_factory=ConcurrencyConfig)
    rate_limit: RateLimitConfig = field(default_factory=RateLimitConfig)


@dataclass
class ProviderConfig:
    api_base: str
    api_keys: list[str]
    _key_index: int = field(default=0, repr=False)

    def get_api_key(self) -> str:
        key = self.api_keys[self._key_index % len(self.api_keys)]
        self._key_index += 1
        return key


@dataclass
class Config:
    server_host: str
    server_port: int
    api_base: str
    api_keys: list[str]
    model_map: dict[str, str]
    thinking_disabled: bool = False
    reliability: ReliabilityConfig = field(default_factory=ReliabilityConfig)
    providers: dict[str, ProviderConfig] = field(default_factory=dict)
    _key_index: int = field(default=0, repr=False)

    def get_api_key(self) -> str:
        key = self.api_keys[self._key_index % len(self.api_keys)]
        self._key_index += 1
        return key

    def map_model(self, model: str) -> str:
        return self.model_map.get(model, model)

    def get_provider_name(self, model: str) -> str:
        """Extract provider name from model_map value (format: 'provider:model')."""
        mapped = self.model_map.get(model, model)
        if ":" in mapped:
            return mapped.split(":", 1)[0]
        return "deepseek"

    def get_provider_model(self, model: str) -> str:
        """Extract vendor model name from model_map value (format: 'provider:model')."""
        mapped = self.model_map.get(model, model)
        if ":" in mapped:
            return mapped.split(":", 1)[1]
        return mapped


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

    reliability_data = data.get("reliability", {})
    retry_data = reliability_data.get("retry", {})
    cb_data = reliability_data.get("circuit_breaker", {})
    concurrency_data = reliability_data.get("concurrency", {})
    rl_data = reliability_data.get("rate_limit", {})

    retry_cfg = RetryConfig(
        max_retries=retry_data.get("max_retries", 3),
        backoff_base=retry_data.get("backoff_base", 2.0),
    )
    cb_cfg = CircuitBreakerConfig(
        failure_threshold=cb_data.get("failure_threshold", 5),
        cooldown_seconds=cb_data.get("cooldown_seconds", 30.0),
    )
    concurrency_cfg = ConcurrencyConfig(
        max_concurrent=concurrency_data.get("max_concurrent", 10),
        queue_timeout=concurrency_data.get("queue_timeout", 30.0),
    )
    rl_cfg = RateLimitConfig(
        requests_per_minute=rl_data.get("requests_per_minute", 30),
        burst_size=rl_data.get("burst_size", 30),
    )

    # Parse provider-specific configurations
    providers: dict[str, ProviderConfig] = {}
    providers_data = data.get("providers", {})
    for pname, pdata in providers_data.items():
        pkeys = pdata.get("api_keys", [])
        pvalid_keys = [k for k in pkeys if k and k != "sk-xxx"]
        if not pvalid_keys:
            continue
        providers[pname] = ProviderConfig(
            api_base=pdata.get("api_base", "https://api.deepseek.com"),
            api_keys=pvalid_keys,
        )

    server = data.get("server", {})
    config = Config(
        server_host=server.get("host", "0.0.0.0"),
        server_port=server.get("port", 8317),
        api_base=deepseek.get("api_base", "https://api.deepseek.com"),
        api_keys=valid_keys,
        model_map=data.get("model_map", {}),
        thinking_disabled=deepseek.get("thinking_disabled", False),
        reliability=ReliabilityConfig(
            retry=retry_cfg,
            circuit_breaker=cb_cfg,
            concurrency=concurrency_cfg,
            rate_limit=rl_cfg,
        ),
        providers=providers,
    )
    return _apply_env_overrides(config)


def _apply_env_overrides(config: Config) -> Config:
    """Apply environment variable overrides to the config.

    Supported env vars (priority: env > YAML > default):
      - CLI_PROXY_API_KEYS (comma-separated, overrides deepseek.api_keys)
      - CLI_PROXY_API_BASE (overrides deepseek.api_base)
      - CLI_PROXY_THINKING_DISABLED (accepts "true"/"1"/"yes" vs others)
    """
    if env_keys := os.environ.get("CLI_PROXY_API_KEYS"):
        api_keys = [k.strip() for k in env_keys.split(",") if k.strip()]
        valid_keys = [k for k in api_keys if k and k != "sk-xxx"]
        if valid_keys:
            config.api_keys = valid_keys

    if env_base := os.environ.get("CLI_PROXY_API_BASE"):
        config.api_base = env_base

    if env_thinking := os.environ.get("CLI_PROXY_THINKING_DISABLED"):
        config.thinking_disabled = env_thinking.lower() in ("true", "1", "yes")

    return config
