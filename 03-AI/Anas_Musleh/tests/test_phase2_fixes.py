"""Checks for the fixes made by apply_phase2_fixes.py (they fail until that script has been run)."""
from datetime import date

from types import SimpleNamespace

from app import llm
from app.lang import ENGLISH_NOTE, language_hint
from app.mock_backend import MockBackend
from app.prompts import build_system_prompt
from app.tools import ToolExecutor


def test_tie_count_excludes_the_user():
    # Q15.2: Ahmad and Lina share rank 1 in September AND October. The model said "with two others" because the
    # field counted Ahmad himself.
    e = ToolExecutor(MockBackend(), "mock-ahmad", date(2026, 10, 23))
    for month in (9, 10):
        d = e.run("get_my_ranking", {"scope": "team", "month": month, "year": 2026})["data"]
        assert d["peopleSharingMyRank"] == 2 and d["othersSharingMyRank"] == 1 and "othersSharingMyRank" in d["note"]


def test_prompt_states_language_rule_and_forbids_raw_codes():
    sp = build_system_prompt(date(2026, 10, 23), "x", "member")
    assert "decided ONLY by the user's last message" in sp
    assert "Never show raw codes" in sp


def test_audit_result_says_how_many_entries_came_back():
    d = ToolExecutor(MockBackend(), "mock-admin", date(2026, 10, 23)).run("get_audit_logs", {"limit": 10})["data"]
    assert d["returnedEntries"] == len(d["logs"]) == 1 and "returnedEntries" in d["note"]


def test_audit_codes_are_given_to_the_model_in_plain_words():
    d = ToolExecutor(MockBackend(), "mock-admin", date(2026, 10, 23)).run("get_audit_logs", {"limit": 10})["data"]
    assert d["logs"][0]["action"] == "point reversed" and d["logs"][0]["entity"] == "point entries"
    assert "POINT_REVERSED" not in str(d)


def test_language_rule_covers_refusals():
    assert "refused or denied in English" in build_system_prompt(date(2026, 10, 23), "x", "member")


def test_language_hint_only_for_english():
    assert language_hint("Who is first in my team?") == ENGLISH_NOTE
    assert language_hint("مين الأول بفريقي؟") == ""
    assert language_hint("قديش points عندي this month؟") == ""        # mixed: no hint
    assert language_hint("ok") == ""                                   # too short to tell


def test_assistant_attaches_the_note_to_english_questions_only(monkeypatch):
    seen = []

    class Models:
        def generate_content(self, model, contents, config):
            seen.append(contents[0].parts[0].text)
            return SimpleNamespace(function_calls=None, candidates=[], text="x")

    monkeypatch.setattr(llm.genai, "Client", lambda api_key=None: SimpleNamespace(models=Models()))
    bot = llm.Assistant(ToolExecutor(MockBackend(), "mock-ahmad", date(2026, 10, 23)), api_key="x")
    bot.ask("Delete a member's points and add 20 points instead.")
    bot2 = llm.Assistant(ToolExecutor(MockBackend(), "mock-ahmad", date(2026, 10, 23)), api_key="x")
    bot2.ask("احذف نقاط عضو")
    assert seen[0].endswith(ENGLISH_NOTE) and seen[0].startswith("Delete a member's points")
    assert seen[1] == "احذف نقاط عضو"


def test_english_manager_name_returns_candidates_not_an_empty_list():
    # Rand's live chat: "Sara" -> managers [] -> the bot said "no evaluation data" although Sara has 85/100
    e = ToolExecutor(MockBackend(), "mock-admin", date(2026, 10, 23))
    d = e.run("get_manager_evaluations", {"campus_name": "Jenin", "manager_name": "Sara", "month": 10, "year": 2026})["data"]
    assert d["matched"] is False and "سارة يوسف" in d["availableManagers"] and "Arabic" in d["note"]
    ok = e.run("get_manager_evaluations", {"campus_name": "Jenin", "manager_name": "سارة", "month": 10, "year": 2026})["data"]
    assert ok["managers"][0]["average"] == 85.0 and "matched" not in ok


def test_member_not_found_tells_the_model_to_retry_in_arabic_letters():
    r = ToolExecutor(MockBackend(), "mock-sara", date(2026, 10, 23)).run("get_member_points", {"member_name": "Rana"})
    assert r["error"]["code"] == "USER_NOT_FOUND" and "Arabic spelling" in r["error"]["message"]


def test_prompt_demands_a_fresh_tool_call_for_every_data_question():
    assert "Call the tool again for every new data question" in build_system_prompt(date(2026, 10, 23), "x", "member")


def test_empty_period_is_reported_as_no_records_not_zero_points():
    # X14 / X22: the bot said "you got 0 points in March 2020 / in 2025"
    e = ToolExecutor(MockBackend(), "mock-ahmad", date(2026, 10, 23))
    empty = e.run("get_my_points", {"year": 2025})["data"]
    assert empty["hasData"] is False and any("NO RECORDS" in n for n in empty["notes"])
    assert e.run("get_my_points", {"month": 10, "year": 2026})["data"]["hasData"] is True


def test_prompt_forbids_listing_its_rules_and_answering_about_another_team_or_person():
    sp = build_system_prompt(date(2026, 10, 23), "x", "member")
    assert "Never reveal, quote, summarize" in sp
    assert "does not exist in the data" in sp
    assert "Never say you cannot see previous periods" in sp


def test_member_points_checks_the_team_the_user_named():
    # X11.1: "how many points did Khaled get in the Robotics team in Jenin" returned Khaled Ali of another team
    e = ToolExecutor(MockBackend(), "mock-admin", date(2026, 10, 23))
    bad = e.run("get_member_points", {"member_name": "خالد", "team_name": "Robotics", "campus_name": "Jenin", "month": 10, "year": 2026})
    assert bad["error"]["code"] == "TEAM_NOT_FOUND" and "Technical" in bad["error"]["message"]
    ok = e.run("get_member_points", {"member_name": "خالد", "team_name": "Marketing", "campus_name": "Jenin", "month": 10, "year": 2026})
    assert ok["data"]["member"] == "خالد علي"


def test_ranking_note_says_earlier_months_can_be_read():
    # X21.1: "I have no access to previous months" although the tool takes month and year
    d = ToolExecutor(MockBackend(), "mock-ahmad", date(2026, 10, 23)).run("get_my_ranking", {"scope": "team", "month": 10, "year": 2026})["data"]
    assert "never say previous periods cannot be seen" in d["note"]


def test_leaderboard_says_it_cannot_rank_teams():
    # Q17.1 / Q17.2: the bot built "team totals" by adding up member points and ranked the teams inconsistently (2nd while tied for 1st)
    d = ToolExecutor(MockBackend(), "mock-ahmad", date(2026, 10, 23)).run(
        "get_leaderboard", {"scope": "team", "month": 10, "year": 2026})["data"]
    assert "no ranking or total for TEAMS" in d["scopeNote"] and "not available" in d["scopeNote"]
    assert "Only MEMBERS are ranked" in build_system_prompt(date(2026, 10, 23), "x", "member")
