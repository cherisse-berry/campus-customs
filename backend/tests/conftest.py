import pytest

import audit


@pytest.fixture(autouse=True)
def audit_log(tmp_path, monkeypatch):
    """Every test writes its audit trail to a temporary file, never to backend/logs/."""
    path = tmp_path / "logs" / "chat_audit.jsonl"
    monkeypatch.setattr(audit, "AUDIT_LOG", path)
    return path
