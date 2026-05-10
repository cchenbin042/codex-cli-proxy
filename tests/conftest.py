import pytest
import tempfile
import os


@pytest.fixture
def valid_config_yaml():
    return """
server:
  host: "127.0.0.1"
  port: 8317

deepseek:
  api_base: "https://api.deepseek.com"
  api_keys:
    - "sk-test123"
    - "sk-test456"

model_map:
  "gpt-5.5": "deepseek-v4-pro"
"""


@pytest.fixture
def config_file(valid_config_yaml):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
        f.write(valid_config_yaml)
        path = f.name
    yield path
    os.unlink(path)
