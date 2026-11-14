from app.tools import TOOL_SPECS
from evals.cases import CASES


def test_all_45_questions_present():
    nums = {int(str(c["id"]).rstrip("b")) for c in CASES}
    assert nums == set(range(1, 46))


def test_every_expected_tool_exists():
    names = {s["name"] for s in TOOL_SPECS}
    for c in CASES:
        for t in c["tools"] + c["forbid_success"]:
            assert t in names, (c["id"], t)
