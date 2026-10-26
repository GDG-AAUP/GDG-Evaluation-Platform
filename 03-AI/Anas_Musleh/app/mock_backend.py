"""
Fake backend with fake data, so the chatbot can be built and tested WITHOUT waiting for
the real backend. It imitates:
  * the real response shapes (see 02-Backend/docs/api.md), and
  * the permission rules (Member / Manager / Organizer), so we can test refusals too.

Endpoints marked PLANNED do not exist in the real backend yet. Their shape here is OUR
PROPOSAL and must be agreed with the Backend team (see docs/backend_requests.md).
"""
from __future__ import annotations

from datetime import datetime

from .backend_client import BackendClient
from .errors import BackendError

# ------------------------------------------------------------------ fake data
CAMPUSES = [{"id": 1, "name": "Jenin"}, {"id": 2, "name": "Ramallah"}]

TEAMS = [
    {"id": 1, "campusId": 1, "name": "Technical", "managerId": 2, "isOperational": True, "description": None},
    {"id": 2, "campusId": 1, "name": "Marketing", "managerId": 5, "isOperational": True, "description": None},
    {"id": 3, "campusId": 2, "name": "Technical", "managerId": 8, "isOperational": True, "description": None},
    {"id": 4, "campusId": 2, "name": "PR", "managerId": 11, "isOperational": True, "description": None},
]

USERS = [
    {"id": 1, "name": "مدير المنصة", "role": "organizer", "teamId": None},
    {"id": 2, "name": "سارة يوسف", "role": "manager", "teamId": 1},
    {"id": 3, "name": "أحمد خليل", "role": "member", "teamId": 1},
    {"id": 4, "name": "لينا حسن", "role": "member", "teamId": 1},
    {"id": 5, "name": "عمر ناصر", "role": "manager", "teamId": 2},
    {"id": 6, "name": "رنا سمير", "role": "member", "teamId": 2},
    {"id": 7, "name": "خالد علي", "role": "member", "teamId": 2},
    {"id": 8, "name": "دانا محمود", "role": "manager", "teamId": 3},
    {"id": 9, "name": "يوسف عادل", "role": "member", "teamId": 3},
    {"id": 10, "name": "مايا كمال", "role": "member", "teamId": 3},
    {"id": 11, "name": "هبة رائد", "role": "manager", "teamId": 4},
    {"id": 12, "name": "نور أمجد", "role": "member", "teamId": 4},
]

# fake "Bearer tokens" -> user id.  The real backend verifies Clerk tokens instead.
TOKENS = {
    "mock-admin": 1, "mock-sara": 2, "mock-ahmad": 3, "mock-lina": 4, "mock-omar": 5,
    "mock-rana": 6, "mock-dana": 8, "mock-yousef": 9,
}

# (id, user, points, activity, reason, description, effective_at, performed_by, reverses)
_P = [
    # September 2026 (a closed month)
    (1, 3, 30, "ورشة Flutter", "حضور ومشاركة", "ورشة تعريفية بـFlutter", "2026-09-10T10:00:00", 2, None),
    (2, 4, 30, "ورشة Flutter", "حضور ومشاركة", "ورشة تعريفية بـFlutter", "2026-09-10T10:00:00", 2, None),
    (3, 2, 20, "قيادة فعالية", "تنظيم فعالية الافتتاح", None, "2026-09-20T12:00:00", 1, None),
    (4, 6, 25, "ورشة تسويق", "حضور", None, "2026-09-12T10:00:00", 5, None),
    (5, 7, 35, "حملة تسويقية", "مساهمة مميزة", None, "2026-09-18T10:00:00", 5, None),
    # October 2026 (current month) - Jenin
    (10, 3, 20, "ورشة عمل", "حضور وتفاعل ممتاز", "ورشة عمل عن Git وGitHub", "2026-10-05T10:00:00", 2, None),
    (11, 3, 15, "مشاركة بفعالية", "مشاركة فعالة في النقاش", None, "2026-10-12T10:00:00", 2, None),
    (12, 3, -10, "تأخر عن اجتماع", "تأخر عن اجتماع الفريق دون إشعار", None, "2026-10-14T10:00:00", 2, None),
    (13, 3, 5, "مبادرة", "اقتراح تحسين", None, "2026-10-15T10:00:00", 2, None),
    (14, 3, -5, "مبادرة", "تصحيح: أُضيفت بالخطأ", None, "2026-10-16T10:00:00", 1, 13),   # reversal of 13
    (15, 4, 25, "ورشة عمل", "حضور وتفاعل", "ورشة عمل عن Git وGitHub", "2026-10-05T10:00:00", 2, None),
    (16, 2, 10, "تنظيم فعالية", "تنظيم ناجح", None, "2026-10-18T10:00:00", 1, None),
    (17, 6, 40, "ورشة عمل", "أداء متميز", "ورشة عمل تسويقية", "2026-10-06T10:00:00", 5, None),
    (18, 7, 15, "مشاركة", "مشاركة في الحملة", None, "2026-10-10T10:00:00", 5, None),
    (19, 5, 5, "تنظيم", "دعم الفعالية", None, "2026-10-20T10:00:00", 1, None),
    # October 2026 - Ramallah
    (20, 9, 30, "ورشة عمل", "حضور وتفاعل", None, "2026-10-07T10:00:00", 8, None),
    (21, 10, 10, "مشاركة", "مشاركة", None, "2026-10-09T10:00:00", 8, None),
    (22, 8, 12, "تنظيم", "تنظيم ورشة", None, "2026-10-19T10:00:00", 1, None),
    (23, 12, 20, "ورشة عمل", "حضور", None, "2026-10-08T10:00:00", 11, None),
]
POINTS = [dict(id=i, userId=u, points=p, activityName=a, reason=r, activityDescription=d,
               effectiveAt=e, performedBy=b, reversesEntryId=rv) for i, u, p, a, r, d, e, b, rv in _P]

# (id, evaluated_user, activity, date, total_score /100, comments)  evaluated_by = organizer (1)
_E = [
    (1, 3, "ورشة عمل", "2026-10-05T12:00:00", 85, "أداء ممتاز في الورشة"),
    (2, 3, "مشاركة بفعالية", "2026-10-12T12:00:00", 78, "مشاركة جيدة"),
    (3, 4, "ورشة عمل", "2026-10-05T12:00:00", 90, "تميز واضح"),
    (4, 2, "تنظيم ورشة Flutter", "2026-10-08T12:00:00", 80, "تنظيم جيد"),
    (5, 2, "إدارة الفريق", "2026-10-20T12:00:00", 90, "قيادة ممتازة"),
    (6, 2, "فعالية الافتتاح", "2026-09-15T12:00:00", 70, "يحتاج تحسين التنسيق"),
    (7, 5, "حملة تسويقية", "2026-10-11T12:00:00", 78, "جيد"),
    (8, 5, "فعالية الافتتاح", "2026-09-15T12:00:00", 82, "جيد جداً"),
    (9, 8, "ورشة تقنية", "2026-10-09T12:00:00", 88, "ممتاز"),
    (10, 8, "فعالية الافتتاح", "2026-09-16T12:00:00", 85, "ممتاز"),
    (11, 11, "حملة علاقات عامة", "2026-10-13T12:00:00", 74, "مقبول"),
]
EVALS = [dict(id=i, evaluatedUserId=u, activityName=a, activityDate=d, totalScore=s, comments=c)
         for i, u, a, d, s, c in _E]


# ------------------------------------------------------------------ helpers
def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


def _in_month(iso: str, month: int | None, year: int | None) -> bool:
    d = _dt(iso)
    return (month is None or d.month == month) and (year is None or d.year == year)


def dense_rank(rows: list[dict]) -> list[dict]:
    """Ties share a rank and the next rank is NOT skipped: 25,25,15 -> 1,1,2 (approved rule)."""
    rows = sorted(rows, key=lambda r: (-r["totalPoints"], r["name"]))
    rank, prev = 0, None
    for r in rows:
        if r["totalPoints"] != prev:
            rank += 1
            prev = r["totalPoints"]
        r["rank"] = rank
    return rows


class MockBackend(BackendClient):
    # ---------------- identity & permissions (the real backend does this part) ----
    def _actor(self, token: str) -> dict:
        uid = TOKENS.get(token)
        if uid is None:
            raise BackendError("UNAUTHENTICATED", "Authentication is required", 401)
        return next(u for u in USERS if u["id"] == uid)

    @staticmethod
    def _forbid(msg="You do not have access to this data"):
        raise BackendError("FORBIDDEN", msg, 403)

    def _team(self, team_id): return next((t for t in TEAMS if t["id"] == team_id), None)
    def _user(self, uid): return next((u for u in USERS if u["id"] == uid), None)

    def _campus_of_user(self, u):
        t = self._team(u["teamId"]) if u["teamId"] else None
        return t["campusId"] if t else None

    def _find_person(self, name: str) -> list[dict]:
        n = name.strip()
        return [u for u in USERS if n and n in u["name"]]

    def _points_of(self, uid, month=None, year=None):
        return [p for p in POINTS if p["userId"] == uid and _in_month(p["effectiveAt"], month, year)]

    # ---------------- EXISTING endpoints (shapes copied from the real backend) -----
    def me(self, token):
        return dict(self._actor(token))

    def list_campuses(self, token):
        self._actor(token)
        return [dict(c) for c in CAMPUSES]

    def list_teams(self, token, campus_id=None):
        self._actor(token)
        return [dict(t) for t in TEAMS if campus_id is None or t["campusId"] == campus_id]

    def get_team_members(self, token, team_id):
        a = self._actor(token)
        team = self._team(team_id)
        if not team:
            raise BackendError("TEAM_NOT_FOUND", "Team not found", 404)
        if not (a["role"] == "organizer" or (a["role"] == "manager" and a["teamId"] == team_id)):
            self._forbid()
        # real backend returns active MEMBERS only (the manager is not in this list)
        return [{"id": u["id"], "name": u["name"], "teamId": u["teamId"]}
                for u in USERS if u["teamId"] == team_id and u["role"] == "member"]

    def my_points(self, token):
        a = self._actor(token)
        rows = sorted(self._points_of(a["id"]), key=lambda p: (p["effectiveAt"], p["id"]), reverse=True)[:50]
        # real backend returns: id, points, activityName, reason, effectiveAt.
        # PLANNED extra fields (mock only): activityDescription, reversesEntryId.
        return [{"id": str(p["id"]), "points": p["points"], "activityName": p["activityName"],
                 "reason": p["reason"], "effectiveAt": p["effectiveAt"],
                 "activityDescription": p["activityDescription"], "reversesEntryId": p["reversesEntryId"]}
                for p in rows]

    # ---------------- PLANNED endpoints ------------------------------------------
    def member_points(self, token, member_name, month=None, year=None):
        a = self._actor(token)
        if a["role"] == "member":
            self._forbid("Members can only view their own points")
        matches = self._find_person(member_name)
        if not matches:
            raise BackendError("USER_NOT_FOUND", "No member with that name", 404)
        if len(matches) > 1:
            names = ", ".join(m["name"] for m in matches)
            raise BackendError("AMBIGUOUS_NAME", f"More than one match: {names}", 409)
        t = matches[0]
        if a["role"] == "manager" and t["teamId"] != a["teamId"]:
            self._forbid("Managers can only view members of their own team")
        pts = self._points_of(t["id"], month, year)
        return {"member": t["name"], "month": month, "year": year,
                "totalPoints": sum(p["points"] for p in pts), "entriesCount": len(pts)}

    def points_awarded_by_me(self, token, month, year):
        a = self._actor(token)
        if a["role"] == "member":
            self._forbid()
        mine = [p for p in POINTS if p["performedBy"] == a["id"] and _in_month(p["effectiveAt"], month, year)]
        return {"month": month, "year": year, "totalAwarded": sum(p["points"] for p in mine),
                "entriesCount": len(mine)}

    def _board(self, scope, campus_id, team_id, month, year):
        if scope == "team":
            people = [u for u in USERS if u["teamId"] == team_id]
        else:
            people = [u for u in USERS if self._campus_of_user(u) == campus_id]
        rows = [{"userId": u["id"], "name": u["name"],
                 "totalPoints": sum(p["points"] for p in self._points_of(u["id"], month, year))} for u in people]
        has_data = any(p["userId"] in {u["id"] for u in people} and _in_month(p["effectiveAt"], month, year)
                       for p in POINTS)
        return dense_rank(rows), has_data

    def leaderboard(self, token, scope, campus_id, team_id, month, year, limit):
        self._actor(token)   # ASSUMPTION (pending approval): any logged-in user may see leaderboards
        if scope not in ("team", "campus"):
            raise BackendError("INVALID_SCOPE", "scope must be 'team' or 'campus'", 400)
        if scope == "team" and not team_id:
            raise BackendError("INVALID_REQUEST", "team_id is required for scope=team", 400)
        rows, has_data = self._board(scope, campus_id, team_id, month, year)
        if limit:
            rows = rows[:limit]
        return {"scope": scope, "campusId": campus_id, "teamId": team_id, "month": month, "year": year,
                "hasData": has_data, "entries": rows if has_data else []}

    def my_ranking(self, token, scope, month, year):
        a = self._actor(token)
        if not a["teamId"]:
            raise BackendError("NO_TEAM", "This account has no team, so it has no personal ranking", 400)
        campus_id = self._campus_of_user(a)
        rows, has_data = self._board(scope, campus_id, a["teamId"], month, year)
        if not has_data:
            return {"scope": scope, "month": month, "year": year, "hasData": False}
        me = next(r for r in rows if r["userId"] == a["id"])
        top = rows[0]["totalPoints"]
        return {"scope": scope, "month": month, "year": year, "hasData": True, "rank": me["rank"],
                "totalPoints": me["totalPoints"], "topPoints": top, "gapToFirst": top - me["totalPoints"],
                "peopleSharingMyRank": sum(1 for r in rows if r["rank"] == me["rank"]),
                "participants": len(rows)}

    def my_evaluations(self, token, month, year, limit):
        a = self._actor(token)
        ev = sorted([e for e in EVALS if e["evaluatedUserId"] == a["id"] and _in_month(e["activityDate"], month, year)],
                    key=lambda e: e["activityDate"], reverse=True)
        out = ev[:limit] if limit else ev
        avg = round(sum(e["totalScore"] for e in ev) / len(ev), 2) if ev else None
        return {"month": month, "year": year, "count": len(ev), "average": avg,
                "evaluations": [{"activityName": e["activityName"], "activityDate": e["activityDate"],
                                 "totalScore": e["totalScore"], "maxScore": 100, "comments": e["comments"]}
                                for e in out]}

    def team_activity_summary(self, token, team_id, month, year, activity_keyword):
        a = self._actor(token)
        if a["role"] == "member" or (a["role"] == "manager" and a["teamId"] != team_id):
            self._forbid("Only the team's manager or an organizer can view this")
        ids = {u["id"]: u["name"] for u in USERS if u["teamId"] == team_id}
        rows = [p for p in POINTS if p["userId"] in ids and _in_month(p["effectiveAt"], month, year)
                and (not activity_keyword or activity_keyword in p["activityName"]
                     or activity_keyword in (p["activityDescription"] or ""))]
        return {"teamId": team_id, "month": month, "year": year, "entries": [
            {"member": ids[p["userId"]], "points": p["points"], "activityName": p["activityName"],
             "reason": p["reason"], "effectiveAt": p["effectiveAt"],
             "isReversal": p["reversesEntryId"] is not None, "reversesEntryId": p["reversesEntryId"]}
            for p in sorted(rows, key=lambda p: p["effectiveAt"])]}

    def manager_evaluations(self, token, campus_id, month, year, manager_name):
        a = self._actor(token)
        # ASSUMPTION (pending approval): organizer-only; a manager may see only their own via my_evaluations.
        if a["role"] != "organizer":
            self._forbid("Manager evaluations are restricted")
        managers = [u for u in USERS if u["role"] == "manager" and self._campus_of_user(u) == campus_id
                    and (not manager_name or manager_name in u["name"])]
        rows = []
        for m in managers:
            ev = [e for e in EVALS if e["evaluatedUserId"] == m["id"] and _in_month(e["activityDate"], month, year)]
            rows.append({"manager": m["name"], "evaluationsCount": len(ev),
                         "average": round(sum(e["totalScore"] for e in ev) / len(ev), 2) if ev else None})
        rows.sort(key=lambda r: (r["average"] is None, -(r["average"] or 0)))
        scored = [r["average"] for r in rows if r["average"] is not None]
        return {"campusId": campus_id, "month": month, "year": year,
                "totalEvaluations": sum(r["evaluationsCount"] for r in rows),
                "campusAverage": round(sum(scored) / len(scored), 2) if scored else None, "managers": rows}

    def audit_logs(self, token, limit):
        a = self._actor(token)
        if a["role"] != "organizer":
            self._forbid("Audit logs are for organizers only")
        sample = [{"action": "POINT_REVERSED", "entity": "point_entries", "entityId": "13", "actorUserId": 1,
                   "reason": "تصحيح: أُضيفت بالخطأ", "createdAt": "2026-10-16T10:00:00"}]
        return {"logs": sample[:limit]}
