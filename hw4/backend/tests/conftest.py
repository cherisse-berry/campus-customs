import pytest

import audit


@pytest.fixture(autouse=True)
def audit_log(tmp_path, monkeypatch):
    """Every test writes its audit trail to a temporary file, never to output/audit_trail.json,
    and never touches a real old-format log."""
    path = tmp_path / "output" / "audit_trail.json"
    monkeypatch.setattr(audit, "AUDIT_LOG", path)
    monkeypatch.setattr(audit, "LEGACY_LOG", tmp_path / "logs" / "chat_audit.jsonl")
    return path
