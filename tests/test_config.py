"""Tests for config module."""
import pytest
import tempfile
import os
from src.config import load_config, Config


class TestLoadConfig:
    def test_loads_valid_config(self, config_file):
        config = load_config(config_file)
        assert config.server_host == "127.0.0.1"
        assert config.server_port == 8317
        assert config.api_base == "https://api.deepseek.com"
        assert config.api_keys == ["sk-test123", "sk-test456"]
        assert config.model_map == {"gpt-5.5": "deepseek-v4-pro"}

    def test_missing_file_exits(self):
        with pytest.raises(SystemExit) as exc:
            load_config("/nonexistent/path.yaml")
        assert "not found" in str(exc.value)

    def test_invalid_yaml_exits(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
            f.write("server: [unclosed")
            path = f.name
        try:
            with pytest.raises(SystemExit) as exc:
                load_config(path)
            assert "Invalid YAML" in str(exc.value)
        finally:
            os.unlink(path)

    def test_empty_api_keys_exits(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
            f.write("deepseek:\n  api_keys: []\nserver:\n  host: '0.0.0.0'\n  port: 8317\nmodel_map: {}")
            path = f.name
        try:
            with pytest.raises(SystemExit) as exc:
                load_config(path)
            assert "api key" in str(exc.value).lower()
        finally:
            os.unlink(path)

    def test_only_placeholder_keys_exits(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
            f.write("deepseek:\n  api_keys:\n    - 'sk-xxx'\nserver:\n  host: '0.0.0.0'\n  port: 8317\nmodel_map: {}")
            path = f.name
        try:
            with pytest.raises(SystemExit) as exc:
                load_config(path)
            assert "api key" in str(exc.value).lower()
        finally:
            os.unlink(path)

    def test_default_values(self, config_file):
        config = load_config(config_file)
        # Default port is 8317 when not specified
        assert config.server_port == 8317

    def test_model_map_lookup(self, config_file):
        config = load_config(config_file)
        assert config.model_map.get("gpt-5.5") == "deepseek-v4-pro"
        # unmapped model returns None -> caller should use original
        assert config.model_map.get("unknown-model") is None


class TestConfigKeyRotation:
    def test_key_round_robin(self, config_file):
        config = load_config(config_file)
        assert config.get_api_key() == "sk-test123"
        assert config.get_api_key() == "sk-test456"
        assert config.get_api_key() == "sk-test123"  # wraps around

    def test_map_model_passthrough_unknown(self, config_file):
        config = load_config(config_file)
        assert config.map_model("unknown-model") == "unknown-model"
        assert config.map_model("gpt-5.5") == "deepseek-v4-pro"
