"""
Contract tests for RealBackendClient.

There is no Clerk token / database here, so `FakeBackend` imitates the REAL Express routes of 02-Backend
(same paths, same query validation, same role checks, same response shapes). Each rule below was copied from
the backend source, not invented:

  /api/rankings, /archived, /options   public (mounted before clerkMiddleware); validateRankingQuery:
                                       string params, ONE id only (teamId xor campusId), no extra fields
  /api/audit                           organizer only; returns {items,total,page,pageSize}
  /api/users                           organizer only
  /api/evaluations/managers/:id/average  organizer only; {managerUserId,year,month,evaluationCount,averageScore}
  /api/points/me                       any user, last 50 entries, no filters

These tests prove the CLIENT + TOOL logic. They do NOT replace a run against the real server with a Clerk token.
"""
from datetime import date

import httpx
import pytest

from app import config
from app.backend_client import RealBackendClient
from app.tools import ToolExecutor

TODAY = date(2026, 10, 23)

CAMPUSES = [{"id": 1, "name": "Jenin"}, {"id": 2, "name": "Ramallah"}]
TEAMS = [{"id": 1, "campusId": 1, "name": "Technical", "managerId": 2},
         {"id": 2, "campusId": 1, "name": "Marketing", "managerId": 5},
         {"id": 3, "campusId": 2, "name": "Technical", "managerId": 8}]
USERS = [{"id": 1, "name": "Organizer", "email": "o@x.org", "role": "organizer", "teamId": None, "isActive": True},
         {"id": 2, "name": "سارة يوسف", "email": "s@x.org", "role": "manager", "teamId": 1, "isActive": True},
         {"id": 3, "name": "أحمد خليل", "email": "a@x.org", "role": "member", "teamId": 1, "isActive": True},
         {"id": 5, "name": "عمر ناصر", "email": "om@x.org", "role": "manager", "teamId": 2, "isActive": True},
         {"id": 8, "name": "دانا محمود", "email": "d@x.org", "role": "manager", "teamId": 3, "isActive": True}]
TOKENS = {"tok-org": 1, "tok-mgr": 2, "tok-mem": 3}

# live rankings keyed by (scope, id, year, month)
LIVE = {
    ("team", 1, 2026, 10): [{"rank": 1, "userId": 3, "fullName": "أحمد خليل", "totalPoints": 25},
                            {"rank": 1, "userId": 4, "fullName": "لينا حسن", "totalPoints": 25},
                            {"rank": 2, "userId": 2, "fullName": "سارة يوسف", "totalPoints": 10}],
    ("campus", 2, 2026, 10): [{"rank": 1, "userId": 9, "fullName": "يوسف عادل", "totalPoints": 30},
                              {"rank": 2, "userId": 10, "fullName": "مايا كمال", "totalPoints": 10}],
    # a campus board that does not list user 3 (e.g. joined the team later)
    ("campus", 1, 2026, 10): [{"rank": 1, "userId": 99, "fullName": "عضو آخر", "totalPoints": 40}],
    # a closed month with a published snapshot
    ("team", 1, 2026, 9): [{"rank": 1, "userId": 3, "fullName": "أحمد خليل", "totalPoints": 30}],
    # roster exists but nobody scored: live query returns everyone at 0 / rank 1
    ("campus", 1, 2026, 1): [{"rank": 1, "userId": 3, "fullName": "أحمد خليل", "totalPoints": 0},
                             {"rank": 1, "userId": 4, "fullName": "لينا حسن", "totalPoints": 0}],
}
ARCHIVED = {("team", 1, 2026, 9): [{"rank": 1, "userId": 3, "fullName": "أحمد خليل", "totalPoints": 31}]}
AVERAGES = {(2, 2026, 10): (3, 85.0), (5, 2026, 10): (1, 78.0)}


def err(status, code, msg):
    return httpx.Response(status, json={"error": {"code": code, "message": msg}})


class FakeBackend:
    def __init__(self):
        self.requests: list[httpx.Request] = []

    def user(self, req):
        auth = req.headers.get("authorization", "")
        uid = TOKENS.get(auth.removeprefix("Bearer "))
        return next((u for u in USERS if u["id"] == uid), None)

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        path, q = req.url.path, dict(req.url.params)
        if path.startswith("/api/rankings"):                                # public: no auth check
            return self.rankings(path, q)
        me = self.user(req)
        if me is None:
            return err(401, "UNAUTHENTICATED", "Authentication is required")
        if path == "/api/auth/me":
            return httpx.Response(200, json={"data": {**me, "clerkUserId": "x"}})
        if path == "/api/campuses":
            return httpx.Response(200, json={"data": CAMPUSES})
        if path == "/api/teams":
            return httpx.Response(200, json={"data": TEAMS})
        if path == "/api/audit":
            if me["role"] != "organizer":
                return err(403, "FORBIDDEN", "Organizer access is required")
            return httpx.Response(200, json={"data": {"items": [
                {"id": "7", "actorId": 1, "actorName": "Organizer", "action": "POINT_REVERSED", "entityType": "point_entries",
                 "entityId": "13", "oldValues": {"email": "secret@x.org"}, "newValues": None, "reason": "خطأ",
                 "batchId": None, "createdAt": "2026-10-16T10:00:00Z"}], "total": 1, "page": 1,
                "pageSize": int(q.get("pageSize", 25))}})
        if path == "/api/users":
            if me["role"] != "organizer":
                return err(403, "FORBIDDEN", "Organizer access is required")
            return httpx.Response(200, json={"data": USERS})
        if path.startswith("/api/evaluations/managers/") and path.endswith("/average"):
            if me["role"] != "organizer":
                return err(403, "FORBIDDEN", "Organizer access is required")
            mid = int(path.split("/")[4])
            cnt, avg = AVERAGES.get((mid, int(q["year"]), int(q["month"])), (0, None))
            return httpx.Response(200, json={"data": {"managerUserId": mid, "year": int(q["year"]), "month": int(q["month"]),
                                                      "evaluationCount": cnt, "averageScore": avg}})
        return err(404, "NOT_FOUND", "Route not found")

    def rankings(self, path, q):
        if path.endswith("/options"):
            return httpx.Response(200, json={"data": {"campuses": CAMPUSES, "teams": TEAMS}})
        scope = q.get("scope")
        allowed = {"scope", "year", "month", "teamId", "campusId"}
        if set(q) - allowed:
            return err(400, "INVALID_RANKING_QUERY", "unexpected fields")
        if scope not in ("team", "campus"):
            return err(400, "INVALID_RANKING_QUERY", "Invalid ranking scope")
        if scope == "team" and ("teamId" not in q or "campusId" in q):
            return err(400, "INVALID_RANKING_QUERY", "Invalid team ID")
        if scope == "campus" and ("campusId" not in q or "teamId" in q):
            return err(400, "INVALID_RANKING_QUERY", "Invalid campus ID")
        key = (scope, int(q["teamId"] if scope == "team" else q["campusId"]), int(q["year"]), int(q["month"]))
        table = ARCHIVED if path.endswith("/archived") else LIVE
        return httpx.Response(200, json={"data": table.get(key, [])})


@pytest.fixture
def fake():
    return FakeBackend()


def ex(fake, token="tok-mem"):
    client = RealBackendClient("http://backend", transport=httpx.MockTransport(fake))
    return ToolExecutor(client, token, TODAY)


@pytest.fixture(autouse=True)
def pin_today(monkeypatch):
    monkeypatch.setenv("MOCK_TODAY", TODAY.isoformat())


def code(res):
    return res.get("error", {}).get("code")


# ---------------------------------------------------------------- rankings
def test_team_leaderboard_current_month_uses_live_endpoint_and_flags_tie(fake):
    d = ex(fake).run("get_leaderboard", {"scope": "team", "month": 10, "year": 2026})["data"]
    assert fake.requests[-1].url.path == "/api/rankings"
    assert [e["name"] for e in d["entries"] if e["rank"] == 1] == ["أحمد خليل", "لينا حسن"]
    assert set(d["tieAtRank1"]) == {"أحمد خليل", "لينا حسن"}
    assert d["source"] == "live"


def test_ranking_query_sends_exactly_one_id(fake):
    ex(fake).run("get_leaderboard", {"scope": "team", "month": 10, "year": 2026})
    p = dict(fake.requests[-1].url.params)
    assert "teamId" in p and "campusId" not in p
    ex(fake).run("get_leaderboard", {"scope": "campus", "campus_name": "Ramallah", "month": 10, "year": 2026})
    p = dict(fake.requests[-1].url.params)
    assert "campusId" in p and "teamId" not in p


def test_campus_leaderboard_limit(fake):
    d = ex(fake).run("get_leaderboard", {"scope": "campus", "campus_name": "رام الله", "month": 10, "year": 2026, "limit": 1})["data"]
    assert [e["name"] for e in d["entries"]] == ["يوسف عادل"]


def test_past_month_prefers_archived_snapshot(fake):
    d = ex(fake).run("get_leaderboard", {"scope": "team", "month": 9, "year": 2026})["data"]
    assert d["source"] == "archived_snapshot" and d["entries"][0]["totalPoints"] == 31   # snapshot, not the live 30
    assert any(r.url.path == "/api/rankings/archived" for r in fake.requests)


def test_past_month_without_snapshot_falls_back_to_live_and_says_so(fake):
    d = ex(fake).run("get_leaderboard", {"scope": "campus", "campus_name": "Ramallah", "month": 8, "year": 2026})["data"]
    assert d["hasData"] is False                      # nothing in either source


def test_zero_point_roster_is_reported_as_no_data_not_a_fake_tie(fake):
    d = ex(fake).run("get_leaderboard", {"scope": "campus", "campus_name": "Jenin", "month": 1, "year": 2026})["data"]
    assert d["hasData"] is False and d["entries"] == []


def test_my_ranking_derived_from_leaderboard(fake):
    d = ex(fake, "tok-mem").run("get_my_ranking", {"scope": "team", "month": 10, "year": 2026})["data"]
    assert d["rank"] == 1 and d["gapToFirst"] == 0 and d["peopleSharingMyRank"] == 2
    d = ex(fake, "tok-mgr").run("get_my_ranking", {"scope": "team", "month": 10, "year": 2026})["data"]
    assert d["rank"] == 2 and d["gapToFirst"] == 15


def test_my_ranking_user_missing_from_roster_is_not_invented(fake):
    d = ex(fake, "tok-mem").run("get_my_ranking", {"scope": "campus", "month": 10, "year": 2026})["data"]
    assert d["hasData"] is True and d["inRanking"] is False and "rank" not in d


# ---------------------------------------------------------------- audit logs
def test_audit_logs_organizer_ok_and_hides_old_new_values(fake):
    d = ex(fake, "tok-org").run("get_audit_logs", {"limit": 5})["data"]
    assert d["logs"][0]["action"].lower().replace("_", " ") == "point reversed" and d["total"] == 1   # raw or plain, depending on apply_phase2_fixes.py
    assert "oldValues" not in d["logs"][0] and "secret@x.org" not in str(d)


@pytest.mark.parametrize("tok", ["tok-mgr", "tok-mem"])
def test_audit_logs_forbidden_for_non_organizer(fake, tok):
    assert code(ex(fake, tok).run("get_audit_logs", {})) == "FORBIDDEN"


# ---------------------------------------------------------------- manager evaluations
def test_manager_evaluations_aggregated_for_organizer(fake):
    d = ex(fake, "tok-org").run("get_manager_evaluations", {"campus_name": "Jenin", "month": 10, "year": 2026})["data"]
    assert [m["manager"] for m in d["managers"]] == ["سارة يوسف", "عمر ناصر"]    # sorted by average, Jenin only
    assert d["totalEvaluations"] == 4 and d["campusAverage"] == 83.25              # (3*85 + 1*78) / 4


def test_manager_evaluations_whole_year_loops_over_months(fake):
    d = ex(fake, "tok-org").run("get_manager_evaluations", {"campus_name": "Jenin", "year": 2026})["data"]
    assert d["month"] is None and d["totalEvaluations"] == 4 and d["managers"][0]["average"] == 85.0
    assert sum("/average" in r.url.path for r in fake.requests) == 24     # 2 managers x 12 months


def test_manager_evaluations_single_manager_filter(fake):
    d = ex(fake, "tok-org").run("get_manager_evaluations", {"campus_name": "Jenin", "month": 10, "year": 2026, "manager_name": "سارة"})["data"]
    assert len(d["managers"]) == 1 and d["managers"][0]["average"] == 85.0


def test_manager_evaluations_forbidden_for_manager_and_hint_points_to_own_tool(fake):
    res = ex(fake, "tok-mgr").run("get_manager_evaluations", {"campus_name": "Jenin"})
    assert code(res) == "FORBIDDEN" and "get_my_evaluations" in res["error"]["message"]


# ---------------------------------------------------------------- things the backend still lacks
@pytest.mark.parametrize("tool,args", [
    ("get_member_points", {"member_name": "أحمد"}),
    ("get_points_i_awarded", {}),
    ("get_my_evaluations", {}),
    ("get_team_activity_summary", {}),
])
def test_missing_endpoints_return_not_implemented(fake, tool, args):
    assert code(ex(fake, "tok-mgr").run(tool, args)) == "NOT_IMPLEMENTED"


# ---------------------------------------------------------------- failure modes
def test_bad_token_is_unauthenticated(fake):
    assert code(ex(fake, "tok-bogus").run("get_my_profile", {})) == "UNAUTHENTICATED"


def test_backend_down_is_reported_not_crashed():
    def boom(req): raise httpx.ConnectError("refused")
    client = RealBackendClient("http://backend", transport=httpx.MockTransport(boom))
    res = ToolExecutor(client, "tok-mem", TODAY).run("list_campuses", {})
    assert code(res) == "BACKEND_UNREACHABLE"
