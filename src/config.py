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
