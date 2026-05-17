"""Tests for environment variable overrides in config."""
import os
import tempfile
import pytest
from unittest.mock import patch
from src.config import load_config, Config, _apply_env_overrides


class TestEnvOverrides:
    """Environment variables should override YAML config values."""

    @pytest.fixture
    def minimal_yaml(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
            f.write("""
server:
  host: "0.0.0.0"
  port: 8317
deepseek:
  api_base: "https://api.deepseek.com"
  api_keys:
    - "sk-yaml-key"
  thinking_disabled: false
model_map:
  "gpt-5.5": "deepseek-v4-pro"
""")
            path = f.name
        yield path
        os.unlink(path)

    def test_env_api_keys_overrides_yaml(self, minimal_yaml):
        """CLI_PROXY_API_KEYS env var should override YAML api_keys."""
        with patch.dict(os.environ, {"CLI_PROXY_API_KEYS": "sk-env-key1,sk-env-key2"}):
            config = load_config(minimal_yaml)
            assert config.api_keys == ["sk-env-key1", "sk-env-key2"]

    def test_env_api_base_overrides_yaml(self, minimal_yaml):
        """CLI_PROXY_API_BASE env var should override YAML api_base."""
        with patch.dict(os.environ, {"CLI_PROXY_API_BASE": "https://custom.api.com"}):
            config = load_config(minimal_yaml)
            assert config.api_base == "https://custom.api.com"

    def test_env_thinking_disabled_true(self, minimal_yaml):
        """CLI_PROXY_THINKING_DISABLED=true should override YAML value."""
        with patch.dict(os.environ, {"CLI_PROXY_THINKING_DISABLED": "true"}):
            config = load_config(minimal_yaml)
            assert config.thinking_disabled is True

    def test_env_thinking_disabled_false(self, minimal_yaml):
        """CLI_PROXY_THINKING_DISABLED=false should override YAML value."""
        with patch.dict(os.environ, {"CLI_PROXY_THINKING_DISABLED": "false"}):
            config = load_config(minimal_yaml)
            assert config.thinking_disabled is False

    def test_env_thinking_disabled_1(self, minimal_yaml):
        """CLI_PROXY_THINKING_DISABLED=1 should be truthy."""
        with patch.dict(os.environ, {"CLI_PROXY_THINKING_DISABLED": "1"}):
            config = load_config(minimal_yaml)
            assert config.thinking_disabled is True

    def test_env_thinking_disabled_yes(self, minimal_yaml):
        """CLI_PROXY_THINKING_DISABLED=yes should be truthy."""
        with patch.dict(os.environ, {"CLI_PROXY_THINKING_DISABLED": "yes"}):
            config = load_config(minimal_yaml)
            assert config.thinking_disabled is True

    def test_env_all_overrides_simultaneously(self, minimal_yaml):
        """All three env vars applied at once should all take effect."""
        with patch.dict(os.environ, {
            "CLI_PROXY_API_KEYS": "sk-env-a,sk-env-b",
            "CLI_PROXY_API_BASE": "https://env.api.com",
            "CLI_PROXY_THINKING_DISABLED": "true",
        }):
            config = load_config(minimal_yaml)
            assert config.api_keys == ["sk-env-a", "sk-env-b"]
            assert config.api_base == "https://env.api.com"
            assert config.thinking_disabled is True

    def test_no_env_vars_preserves_yaml_values(self, minimal_yaml):
        """When no env vars are set, YAML values should be used as-is."""
        with patch.dict(os.environ, {}, clear=True):
            config = load_config(minimal_yaml)
            assert config.api_keys == ["sk-yaml-key"]
            assert config.api_base == "https://api.deepseek.com"
            assert config.thinking_disabled is False

    def test_env_api_keys_filters_placeholder(self, minimal_yaml):
        """CLI_PROXY_API_KEYS should filter out sk-xxx placeholder keys."""
        with patch.dict(os.environ, {"CLI_PROXY_API_KEYS": "sk-xxx,sk-real-key"}):
            config = load_config(minimal_yaml)
            assert config.api_keys == ["sk-real-key"]

    def test_env_api_keys_empty_string_ignored(self, minimal_yaml):
        """Empty CLI_PROXY_API_KEYS should not override."""
        with patch.dict(os.environ, {"CLI_PROXY_API_KEYS": ""}):
            config = load_config(minimal_yaml)
            assert config.api_keys == ["sk-yaml-key"]

    def test_env_api_keys_whitespace_handling(self, minimal_yaml):
        """Keys split by comma should have whitespace stripped."""
        with patch.dict(os.environ, {"CLI_PROXY_API_KEYS": " sk-a , sk-b , sk-c "}):
            config = load_config(minimal_yaml)
            assert config.api_keys == ["sk-a", "sk-b", "sk-c"]


class TestApplyEnvOverridesUnit:
    """Unit tests for _apply_env_overrides function directly."""

    def test_returns_config_unchanged_without_env(self):
        """When no env vars, config is returned as-is."""
        config = Config(
            server_host="0.0.0.0",
            server_port=8317,
            api_base="https://api.test.com",
            api_keys=["sk-key1"],
            model_map={},
            thinking_disabled=False,
        )
        with patch.dict(os.environ, {}, clear=True):
            result = _apply_env_overrides(config)
            assert result is config  # Same object returned

    def test_priority_env_over_yaml(self):
        """Env var takes priority over what's already in config."""
        config = Config(
            server_host="0.0.0.0",
            server_port=8317,
            api_base="https://yaml.api.com",
            api_keys=["sk-yaml"],
            model_map={},
            thinking_disabled=False,
        )
        with patch.dict(os.environ, {"CLI_PROXY_API_BASE": "https://env.api.com"}):
            result = _apply_env_overrides(config)
            assert result.api_base == "https://env.api.com"
            # Other fields unchanged
            assert result.api_keys == ["sk-yaml"]
            assert result.thinking_disabled is False
