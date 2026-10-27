"""Tests that need NO Gemini key: permissions, ranking rules, tool safety.  Run: pytest -q"""
from datetime import date

import pytest

from app.mock_backend import MockBackend, dense_rank
from app.tools import TOOL_SPECS, ToolExecutor

TODAY = date(2026, 10, 23)


def ex(user: str) -> ToolExecutor:
    return ToolExecutor(MockBackend(), f"mock-{user}", TODAY)


def err(res):  # error code or None
    return res.get("error", {}).get("code")


# ---------- read-only by design (Q45)
def test_no_write_tools_exist():
    forbidden = ("add", "create", "delete", "update", "edit", "reverse", "set_", "remove")
    for spec in TOOL_SPECS:
        assert not spec["name"].startswith(forbidden), spec["name"]
    assert err(ex("admin").run("delete_points", {})) == "UNKNOWN_TOOL"


# ---------- identity comes from the token only
def test_bad_token_rejected():
    res = ToolExecutor(MockBackend(), "fake-token", TODAY).run("get_my_points", {})
    assert err(res) == "UNAUTHENTICATED"


def test_my_points_are_only_mine():
    res = ex("ahmad").run("get_my_points", {"month": 10, "year": 2026})
    assert res["data"]["totalPointsInPeriod"] == 25           # 20+15-10+5-5
    assert res["data"]["entriesInPeriod"] == 5


def test_my_points_no_user_id_parameter():
    for spec in TOOL_SPECS:
        if spec["name"].startswith("get_my_"):
            assert "user_id" not in spec["properties"]


def test_last_month_points():
    assert ex("ahmad").run("get_my_points", {"month": 9, "year": 2026})["data"]["totalPointsInPeriod"] == 30


# ---------- Q41 / Q43: no cross-team / cross-user leaks
def test_manager_cannot_read_other_team_member():
    assert err(ex("sara").run("get_member_points", {"member_name": "رنا"})) == "FORBIDDEN"


def test_manager_can_read_own_team_member():
    res = ex("sara").run("get_member_points", {"member_name": "أحمد", "month": 10, "year": 2026})
    assert res["data"]["totalPoints"] == 25


def test_member_cannot_read_others_points():
    assert err(ex("ahmad").run("get_member_points", {"member_name": "لينا"})) == "FORBIDDEN"


def test_member_cannot_list_team_members():
    assert err(ex("ahmad").run("get_team_members", {})) == "FORBIDDEN"


def test_manager_cannot_list_other_team_members():
    assert err(ex("sara").run("get_team_members", {"team_name": "Marketing", "campus_name": "Jenin"})) == "FORBIDDEN"


def test_manager_own_team_members():
    res = ex("sara").run("get_team_members", {})
    assert res["data"]["count"] == 2


# ---------- Q42 / evaluations restrictions
def test_audit_logs_admin_only():
    assert err(ex("sara").run("get_audit_logs", {})) == "FORBIDDEN"
    assert "logs" in ex("admin").run("get_audit_logs", {})["data"]


def test_manager_evaluations_restricted():
    assert err(ex("ahmad").run("get_manager_evaluations", {"campus_name": "Jenin"})) == "FORBIDDEN"
    res = ex("admin").run("get_manager_evaluations", {"campus_name": "Jenin", "month": 10, "year": 2026})
    assert res["data"]["managers"][0]["manager"] == "سارة يوسف"      # avg 85 > 78
    assert res["data"]["managers"][0]["average"] == 85.0
    assert res["data"]["totalEvaluations"] == 3


def test_my_evaluations_count_and_average():
    d = ex("ahmad").run("get_my_evaluations", {"month": 10, "year": 2026})["data"]
    assert d["count"] == 2 and d["average"] == 81.5


# ---------- ranking rules
def test_dense_rank_ties():
    rows = dense_rank([{"name": "a", "totalPoints": 25}, {"name": "b", "totalPoints": 25}, {"name": "c", "totalPoints": 15}])
    assert [r["rank"] for r in rows] == [1, 1, 2]


def test_team_leaderboard_tie_at_top():
    d = ex("ahmad").run("get_leaderboard", {"scope": "team", "month": 10, "year": 2026})["data"]
    top = [r for r in d["entries"] if r["rank"] == 1]
    assert {r["name"] for r in top} == {"أحمد خليل", "لينا حسن"}


def test_campus_leaderboard_other_campus_by_name():
    d = ex("ahmad").run("get_leaderboard", {"scope": "campus", "campus_name": "رام الله", "month": 10, "year": 2026, "limit": 5})["data"]
    assert d["campus"] == "Ramallah" and d["entries"][0]["name"] == "يوسف عادل"


def test_no_data_month():
    d = ex("ahmad").run("get_leaderboard", {"scope": "campus", "campus_name": "Jenin", "month": 1, "year": 2026})["data"]
    assert d["hasData"] is False and d["entries"] == []


def test_my_ranking_gap():
    d = ex("rana").run("get_my_ranking", {"scope": "team", "month": 10, "year": 2026})["data"]
    assert d["rank"] == 1 and d["gapToFirst"] == 0
    d = ex("lina").run("get_my_ranking", {"scope": "team", "month": 10, "year": 2026})["data"]
    assert d["rank"] == 1 and d["peopleSharingMyRank"] == 2


def test_ambiguous_team_needs_campus():
    assert err(ex("admin").run("get_team_members", {"team_name": "Technical"})) == "AMBIGUOUS_TEAM"


def test_unknown_team_lists_options():
    res = ex("admin").run("get_team_members", {"team_name": "Robotics", "campus_name": "Jenin"})
    assert err(res) == "TEAM_NOT_FOUND" and "Technical" in res["error"]["message"]


def test_points_awarded_by_manager():
    assert ex("sara").run("get_points_i_awarded", {"month": 10, "year": 2026})["data"]["totalAwarded"] == 55  # 20+15-10+5+25 (the reversal was done by the organizer)
    assert err(ex("ahmad").run("get_points_i_awarded", {})) == "FORBIDDEN"


def test_reversal_visible_to_manager():
    d = ex("sara").run("get_team_activity_summary", {"month": 10, "year": 2026})["data"]
    assert any(e["isReversal"] for e in d["entries"])


def test_default_month_rollover():
    e = ToolExecutor(MockBackend(), "mock-ahmad", date(2026, 1, 10))
    assert e._ym(12, None) == (12, 2025)


def test_own_evaluation_tool_descriptions_are_unambiguous():
    specs = {s["name"]: s["description"] for s in TOOL_SPECS}
    assert "manager" in specs["get_my_evaluations"].lower() and "own" in specs["get_my_evaluations"].lower()
    assert "ORGANIZER-ONLY" in specs["get_manager_evaluations"]


def test_manager_can_see_own_evaluation_average():
    d = ex("sara").run("get_my_evaluations", {"month": 10, "year": 2026})["data"]
    assert d["average"] == 85.0 and d["count"] == 2


def test_tie_at_top_is_flagged_for_the_model():
    d = ex("ahmad").run("get_leaderboard", {"scope": "team", "month": 10, "year": 2026})["data"]
    assert set(d["tieAtRank1"]) == {"أحمد خليل", "لينا حسن"} and "TIED" in d["note"]


def test_limit_never_cuts_a_tie_in_half():
    d = ex("ahmad").run("get_leaderboard", {"scope": "team", "month": 10, "year": 2026, "limit": 1})["data"]
    assert len(d["entries"]) == 2          # both members tied at rank 1


def test_evaluations_say_there_is_no_description():
    d = ex("ahmad").run("get_my_evaluations", {"month": 10, "year": 2026})["data"]
    assert "NO activity-description" in d["notes"][0]


def test_manager_calling_org_tool_gets_redirect_hint():
    res = ex("sara").run("get_manager_evaluations", {"campus_name": "Jenin", "month": 10, "year": 2026})
    assert res["error"]["code"] == "FORBIDDEN" and "get_my_evaluations" in res["error"]["message"]


# ---------- year-only questions (Maria's bug #2): "my points in 2026" must NOT silently mean "October 2026"
def test_year_only_means_whole_year_for_my_points():
    assert ex("ahmad").run("get_my_points", {"year": 2026})["data"]["totalPointsInPeriod"] == 55   # Sept 30 + Oct 25
    assert ex("ahmad").run("get_my_points", {"year": 2025})["data"]["totalPointsInPeriod"] == 0
    assert ex("ahmad").run("get_my_points", {"month": 10, "year": 2026})["data"]["totalPointsInPeriod"] == 25


def test_year_only_for_member_points_awarded_and_evaluations():
    assert ex("sara").run("get_member_points", {"member_name": "أحمد", "year": 2026})["data"]["totalPoints"] == 55
    assert ex("sara").run("get_points_i_awarded", {"year": 2026})["data"]["totalAwarded"] == 115
    d = ex("ahmad").run("get_my_evaluations", {"year": 2026})["data"]
    assert d["count"] == 2 and d["average"] == 81.5


def test_rankings_need_a_month_when_only_a_year_is_given():
    for tool, args in (("get_leaderboard", {"scope": "team", "year": 2026}), ("get_my_ranking", {"year": 2026})):
        assert err(ex("ahmad").run(tool, args)) == "MONTH_REQUIRED"


def test_no_period_still_means_current_month():
    assert ex("ahmad")._period(None, None) == (10, 2026)
