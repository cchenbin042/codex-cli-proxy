"""Configuration loader for cli-proxy."""

import os
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
    thinking_disabled: bool = False
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
    config = Config(
        server_host=server.get("host", "0.0.0.0"),
        server_port=server.get("port", 8317),
        api_base=deepseek.get("api_base", "https://api.deepseek.com"),
        api_keys=valid_keys,
        model_map=data.get("model_map", {}),
        thinking_disabled=deepseek.get("thinking_disabled", False),
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
