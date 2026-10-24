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
    monkeypatch.setattr(setup_env, "OLD_ENV_FILE", tmp_path / "backend" / ".env")
    return env


def secret(env):
    return SECRET_LINE.search(env.read_text()).group(1)


def test_creates_env_with_strong_secret(env_paths, capsys):
    setup_env.main([])
    text = env_paths.read_text()
    assert len(secret(env_paths)) == 64
    assert "COOKIE_SECURE=false" in text  # other settings kept
    assert secret(env_paths) not in capsys.readouterr().out  # never printed


def test_keeps_existing_secret_unless_forced(env_paths):
    setup_env.main([])
    first = secret(env_paths)
    setup_env.main([])
    assert secret(env_paths) == first
    setup_env.main(["--force"])
    assert secret(env_paths) != first
    assert env_paths.read_text().count("SESSION_SECRET=") == 1


def test_adds_secret_to_env_without_one(env_paths):
    env_paths.write_text("COOKIE_SECURE=true\n")
    setup_env.main([])
    assert "COOKIE_SECURE=true" in env_paths.read_text()
    assert len(secret(env_paths)) == 64


def test_api_key_is_saved_from_hidden_prompt(env_paths, monkeypatch, capsys):
    real_ask = setup_env.ask_api_key
    monkeypatch.setattr(setup_env, "ask_api_key", lambda text: real_ask(text, prompt=lambda _: "  sk-ant-test-123  "))
    setup_env.main(["--api-key"])
    assert "ANTHROPIC_API_KEY=sk-ant-test-123\n" in env_paths.read_text()
    assert "sk-ant-test-123" not in capsys.readouterr().out
    first_secret = secret(env_paths)

    # Pressing Enter keeps the existing key; the session secret is untouched.
    monkeypatch.setattr(setup_env, "ask_api_key", lambda text: real_ask(text, prompt=lambda _: ""))
    setup_env.main(["--api-key"])
    assert "ANTHROPIC_API_KEY=sk-ant-test-123\n" in env_paths.read_text()
    assert secret(env_paths) == first_secret


def test_key_with_special_characters_is_written_literally(env_paths):
    text = setup_env.set_value("ANTHROPIC_API_KEY=\n", "ANTHROPIC_API_KEY", r"sk-ant-a\1b$c")
    assert text == "ANTHROPIC_API_KEY=sk-ant-a\\1b$c\n"


def test_files_are_in_the_hw4_folder():
    hw4 = setup_env.HERE.parent
    assert setup_env.ENV_FILE == hw4 / ".env" and setup_env.EXAMPLE_FILE == hw4 / ".env.example"
    assert setup_env.EXAMPLE_FILE.exists()


def test_old_backend_env_is_moved_and_kept(env_paths):
    old = setup_env.OLD_ENV_FILE
    old.parent.mkdir()
    old.write_text("SESSION_SECRET=" + "a" * 64 + "\nANTHROPIC_API_KEY=sk-ant-old\n")
    setup_env.main([])
    assert not old.exists()
    text = env_paths.read_text()
    assert secret(env_paths) == "a" * 64 and "ANTHROPIC_API_KEY=sk-ant-old" in text


def test_example_has_only_placeholders():
    text = setup_env.EXAMPLE_FILE.read_text()
    for name in ("SESSION_SECRET", "ANTHROPIC_API_KEY"):
        assert setup_env.get_value(text, name) == ""
    assert "sk-ant-" not in text
