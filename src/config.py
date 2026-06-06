"""Configuration loader for cli-proxy."""

import json
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
    default_model: str = ""
    _key_index: int = field(default=0, repr=False)

    def get_api_key(self) -> str:
        if not self.api_keys:
            return ""
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
        if not self.api_keys:
            return ""
        key = self.api_keys[self._key_index % len(self.api_keys)]
        self._key_index += 1
        return key

    def map_model(self, model: str) -> str:
        return self.model_map.get(model, model)

    @staticmethod
    def normalize_model_name(model: str) -> str:
        """Normalize a model name for the upstream provider.

        Handles HuggingFace-style names (org/Model-Name) by extracting the
        last segment and lowercasing it.  Simple names pass through as-is.

        >>> Config.normalize_model_name("deepseek-ai/DeepSeek-V4-Pro")
        'deepseek-v4-pro'
        >>> Config.normalize_model_name("gpt-5.5")
        'gpt-5.5'
        """
        if "/" in model:
            model = model.rsplit("/", 1)[-1]
        return model.lower()

    def get_provider_name(self, model: str) -> str:
        """Extract provider name from model_map value (format: 'provider:model').

        Falls back to __default__ mapping if the model is not found, and finally
        to "deepseek" if nothing else matches.
        """
        mapped = self.model_map.get(model, model)
        if ":" in mapped:
            return mapped.split(":", 1)[0]
        if model in self.model_map:
            # Model is in map with a bare value (no provider prefix) → use deepseek
            return "deepseek"
        # Model not in map — check __default__ fallback
        default_mapped = self.model_map.get("__default__", "")
        if isinstance(default_mapped, str) and ":" in default_mapped:
            return default_mapped.split(":", 1)[0]
        if isinstance(default_mapped, str) and default_mapped:
            if default_mapped in self.providers:
                return default_mapped
            return "deepseek"
        return "deepseek"

    def get_provider_model(self, model: str) -> str:
        """Extract vendor model name from model_map value (format: 'provider:model').

        For models not in the map, normalizes the name (handling HuggingFace
        org/model format) so it's more likely to be accepted upstream.
        Falls back to __default__ if configured.
        """
        mapped = self.model_map.get(model, model)
        if ":" in mapped:
            return mapped.split(":", 1)[1]
        if model in self.model_map:
            # Model is in map with a bare value → use the mapped value directly
            return mapped
        # Model not in map — check __default__ fallback first
        default_mapped = self.model_map.get("__default__", "")
        if isinstance(default_mapped, str) and ":" in default_mapped:
            return default_mapped.split(":", 1)[1]
        if isinstance(default_mapped, str) and default_mapped:
            if default_mapped in self.providers:
                return self.normalize_model_name(model)
            return default_mapped
        # No __default__ — normalize dynamically (handles HF-style names)
        return self.normalize_model_name(model)


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

    # Filter out placeholder keys — warn but don't exit (let UI handle)
    PLACEHOLDER = frozenset({"sk-xxx", "***"})
    valid_keys = [k for k in api_keys if k and k not in PLACEHOLDER]
    if not valid_keys:
        print(
            "[WARNING] No valid API key configured in config.yaml. "
            "Replace 'sk-xxx' with your actual API key(s), then restart the proxy. "
            "See: https://platform.deepseek.com/api_keys",
            flush=True,
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

    # Parse provider-specific configurations.
    # Always create provider entries (even with empty keys) to preserve api_base
    # for later env-var injection in _apply_env_overrides.
    providers: dict[str, ProviderConfig] = {}
    providers_data = data.get("providers", {})
    for pname, pdata in providers_data.items():
        pkeys = pdata.get("api_keys", [])
        pvalid_keys = [k for k in pkeys if k and k not in PLACEHOLDER]
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
      - CLI_PROXY_<NAME>_API_KEYS (overrides providers.<name>.api_keys)
      - CLI_PROXY_MODEL_MAP (JSON object, merges into model_map)
    """
    if env_keys := os.environ.get("CLI_PROXY_API_KEYS"):
        api_keys = [k.strip() for k in env_keys.split(",") if k.strip()]
        valid_keys = [k for k in api_keys if k and k != "sk-xxx" and k != "***"]
        if valid_keys:
            config.api_keys = valid_keys

    if env_base := os.environ.get("CLI_PROXY_API_BASE"):
        config.api_base = env_base

    if env_thinking := os.environ.get("CLI_PROXY_THINKING_DISABLED"):
        config.thinking_disabled = env_thinking.lower() in ("true", "1", "yes")

    # Merge model_map from desktop (JSON-encoded, overrides bundled config.yaml)
    if env_model_map := os.environ.get("CLI_PROXY_MODEL_MAP"):
        try:
            desktop_map = json.loads(env_model_map)
            if isinstance(desktop_map, dict):
                # Desktop model_map takes priority over bundled YAML
                config.model_map = {**config.model_map, **desktop_map}
        except json.JSONDecodeError:
            pass

    # Apply provider-specific env var overrides (e.g. CLI_PROXY_SILICONFLOW_API_KEYS)
    for env_key, env_val in os.environ.items():
        if not env_key.startswith("CLI_PROXY_"):
            continue
        if env_key in ("CLI_PROXY_API_KEYS", "CLI_PROXY_MODEL_MAP", "CLI_PROXY_THINKING_DISABLED"):
            continue  # already handled above
        if env_key.endswith("_DEFAULT_MODEL"):
            pname = env_key[len("CLI_PROXY_"):-len("_DEFAULT_MODEL")].lower()
            if pname in config.providers:
                config.providers[pname].default_model = env_val
            continue
        if not env_key.endswith("_API_KEYS"):
            continue
        pname = env_key[len("CLI_PROXY_"):-len("_API_KEYS")].lower()
        pkeys = [k.strip() for k in env_val.split(",") if k.strip()]
        pvalid = [k for k in pkeys if k and k != "sk-xxx" and k != "***"]
        if not pvalid:
            continue
        if pname in config.providers:
            config.providers[pname].api_keys = pvalid
        else:
            config.providers[pname] = ProviderConfig(
                api_base=config.api_base,
                api_keys=pvalid,
            )

    return config
