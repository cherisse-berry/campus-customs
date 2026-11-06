import os
import sys
from pathlib import Path

HW6 = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HW6))
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

DATA = HW6 / "data"
if not (DATA / "shop_handbook.md").exists():
    import pytest

    pytest.skip("hw6/data/ is missing: unzip the assignment's data.zip into hw6/", allow_module_level=True)
