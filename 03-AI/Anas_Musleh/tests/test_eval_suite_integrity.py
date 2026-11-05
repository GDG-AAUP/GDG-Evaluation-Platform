from app.mock_backend import TOKENS
from app.tools import TOOL_SPECS
from evals.cases import CASES
from evals.cases_extra import CASES_EXTRA, MORE_VARIANTS
from evals.run_evals import check
from types import SimpleNamespace

ALL = CASES + CASES_EXTRA
TOOLS = {s["name"] for s in TOOL_SPECS}


def test_ids_are_unique():
    ids = [str(c["id"]) for c in ALL]
    assert len(ids) == len(set(ids))


def test_personas_exist_in_mock_backend():
    for c in ALL:
        assert f"mock-{c['persona']}" in TOKENS, c["id"]


def test_every_tool_named_exists():
    for c in ALL:
        for t in c["tools"] + c["forbid_success"]:
            assert t in TOOLS, (c["id"], t)


def test_every_case_has_two_nonempty_phrasings_and_a_pass_criterion():
    for c in ALL:
        assert c["q"].strip() and c["alt"].strip() and c["q"] != c["alt"], c["id"]
        assert c["tools"] or c["forbid_success"] or c["no_tools"] or c["review"], f"case {c['id']} checks nothing"


def test_more_variants_point_to_real_cases_and_are_new():
    ids = {c["id"]: c for c in CASES}
    for cid, vs in MORE_VARIANTS.items():
        assert cid in ids, cid
        for v in vs:
            assert v.strip() and v not in (ids[cid]["q"], ids[cid]["alt"]), (cid, v)


def test_extra_suite_covers_the_phase2_categories():
    text = " ".join(c["review"] or "" for c in CASES_EXTRA).lower()
    for word in ("decline", "ignored", "not found", "ask which campus", "reveal"):
        assert word in text, word


def turn(*calls):
    return SimpleNamespace(tool_calls=[{"name": n, "args": {}, "result": r} for n, r in calls], answer="")


def test_check_flags_a_leak_a_missing_tool_and_a_write_attempt():
    leak = dict(CASES[0], tools=[], forbid_success=["get_member_points"], no_tools=False)
    assert any("LEAK" in p for p in check(leak, turn(("get_member_points", {"data": {}}))))
    assert check(leak, turn(("get_member_points", {"error": {"code": "FORBIDDEN"}}))) == []
    need = dict(CASES[0], tools=["get_my_points"], forbid_success=[], no_tools=False)
    assert check(need, turn()) == ["missing tool: get_my_points"]
    ro = dict(CASES[0], tools=[], forbid_success=[], no_tools=True)
    assert any("read-only" in p for p in check(ro, turn(("get_my_points", {"data": {}}))))


def test_real_mode_tokens_come_from_env_by_role(monkeypatch):
    from app import config
    from evals import run_evals as r
    assert r.token_for("ahmad") == "mock-ahmad"                       # mock mode unchanged
    monkeypatch.setattr(config, "BACKEND_MODE", "real")
    monkeypatch.setenv("GDG_TOKEN_MANAGER", "m-tok")
    monkeypatch.delenv("GDG_TOKEN_MEMBER", raising=False)
    assert r.token_for("sara") == "m-tok"
    import pytest
    with pytest.raises(RuntimeError, match="GDG_TOKEN_MEMBER"):
        r.token_for("ahmad")


def test_prompt_tells_the_model_about_unarchived_months():
    from datetime import date
    from app.prompts import build_system_prompt
    assert "live_recalculation" in build_system_prompt(date(2026, 10, 23), "x", "member")
