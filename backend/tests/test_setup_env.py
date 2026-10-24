import re

import pytest

import setup_env

SECRET_LINE = re.compile(r"^SESSION_SECRET=([0-9a-f]{64})$", re.MULTILINE)


@pytest.fixture
def env_paths(tmp_path, monkeypatch):
    example = tmp_path / ".env.example"
    example.write_text("# comment\nSESSION_SECRET=\nCOOKIE_SECURE=false\n")
    env = tmp_path / ".env"
    monkeypatch.setattr(setup_env, "EXAMPLE_FILE", example)
    monkeypatch.setattr(setup_env, "ENV_FILE", env)
    return env


def secret(env):
    return SECRET_LINE.search(env.read_text()).group(1)


def test_creates_env_with_strong_secret(env_paths, capsys):
    setup_env.main(force=False)
    text = env_paths.read_text()
    assert len(secret(env_paths)) == 64
    assert "COOKIE_SECURE=false" in text  # other settings kept
    assert secret(env_paths) not in capsys.readouterr().out  # never printed


def test_keeps_existing_secret_unless_forced(env_paths):
    setup_env.main(force=False)
    first = secret(env_paths)
    setup_env.main(force=False)
    assert secret(env_paths) == first
    setup_env.main(force=True)
    assert secret(env_paths) != first
    assert env_paths.read_text().count("SESSION_SECRET=") == 1


def test_adds_secret_to_env_without_one(env_paths):
    env_paths.write_text("COOKIE_SECURE=true\n")
    setup_env.main(force=False)
    assert "COOKIE_SECURE=true" in env_paths.read_text()
    assert len(secret(env_paths)) == 64
