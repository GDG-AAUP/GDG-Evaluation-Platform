"""
Tools = the ONLY actions the model may request. All of them are READ-ONLY.
There is deliberately no tool that writes, edits or deletes anything (Q45).

Safety design (important - this is what the supervisor will ask about):
  * The Bearer token lives here, in the executor. The model never sees it.
  * No tool takes a `user_id` for "my ..." questions: identity comes from the token only.
  * Every call goes to the backend, which decides what this token may read (403 otherwise).
  * Errors are returned to the model as data, so it can explain them instead of guessing.
"""
from __future__ import annotations

from datetime import date, datetime

from .backend_client import BackendClient
from .errors import BackendError

MONTH = {"type": "integer", "description": "Month number 1-12. Compute it from today's date for 'this month'/'last month'. "
                                           "OMIT it when the user names only a year (then pass just the year = the whole year)."}
YEAR = {"type": "integer", "description": "4-digit year. Compute it from today's date."}
CAMPUS = {"type": "string", "description": "Campus name: Jenin or Ramallah. Omit to use the user's own campus."}
TEAM = {"type": "string", "description": "Team name exactly as returned by list_teams (e.g. Technical). Omit to use the user's own team."}

TOOL_SPECS = [
    {"name": "get_my_profile",
     "description": "Who is the current user: name, role (member/manager/organizer) and team. Use for 'which team am I in?'.",
     "properties": {}, "required": []},
    {"name": "get_my_points",
     "description": "The CURRENT USER's own point entries (points, activity name, reason, date) and their total for the period. "
                    "Use for own balance, own history, own deductions, own reversals, own recent activities.",
     "properties": {"month": MONTH, "year": YEAR,
                    "start_date": {"type": "string", "description": "Range start, YYYY-MM-DD (inclusive)."},
                    "end_date": {"type": "string", "description": "Range end, YYYY-MM-DD (inclusive)."},
                    "limit": {"type": "integer", "description": "Max entries to return (default 10, max 50). Newest first."}},
     "required": []},
    {"name": "get_member_points",
     "description": "Total points of ONE named member for a month. Managers: own team only. Organizers: anyone. Members: not allowed.",
     "properties": {"member_name": {"type": "string", "description": "Member's name or part of it."}, "month": MONTH, "year": YEAR},
     "required": ["member_name"]},
    {"name": "get_points_i_awarded",
     "description": "Total points the CURRENT manager/organizer awarded (as the actor) in a month.",
     "properties": {"month": MONTH, "year": YEAR}, "required": []},
    {"name": "get_leaderboard",
     "description": "Monthly ranking (dense ranking, ties share a rank) of a team or a campus. Month-only points, never lifetime.",
     "properties": {"scope": {"type": "string", "description": "'team' or 'campus'."},
                    "campus_name": CAMPUS, "team_name": TEAM, "month": MONTH, "year": YEAR,
                    "limit": {"type": "integer", "description": "Return only the first N rows (e.g. 3, 5)."}},
     "required": ["scope"]},
    {"name": "get_my_ranking",
     "description": "The CURRENT USER's own rank, points, gap to first place and how many share their rank, in their team or campus.",
     "properties": {"scope": {"type": "string", "description": "'team' (default) or 'campus'."}, "month": MONTH, "year": YEAR},
     "required": []},
    {"name": "get_my_evaluations",
     "description": "The CURRENT USER's own performance evaluations: activity name, date, score /100, comments, plus count and average for the period. "
                    "Use this for ANY question about the user's own evaluation, INCLUDING a manager asking about their own evaluation result "
                    "('my evaluation as a manager', 'how did my evaluation change').",
     "properties": {"month": MONTH, "year": YEAR, "limit": {"type": "integer", "description": "Max rows (newest first)."}},
     "required": []},
    {"name": "list_campuses", "description": "List the campuses.", "properties": {}, "required": []},
    {"name": "list_teams", "description": "List teams, optionally of one campus.",
     "properties": {"campus_name": CAMPUS}, "required": []},
    {"name": "get_team_members",
     "description": "Active members of a team (the manager is not in this list). Managers: own team only. Organizers: any team.",
     "properties": {"team_name": TEAM, "campus_name": CAMPUS}, "required": []},
    {"name": "get_team_activity_summary",
     "description": "Point entries of a team in a month (member, points, activity, reason, reversal flag). Manager of that team / organizer only. "
                    "Use for team activities, 'who got points for a workshop', reversed entries.",
     "properties": {"team_name": TEAM, "campus_name": CAMPUS, "month": MONTH, "year": YEAR,
                    "activity_keyword": {"type": "string", "description": "Filter by activity name/description (e.g. ورشة)."}},
     "required": []},
    {"name": "get_manager_evaluations",
     "description": "ORGANIZER-ONLY overview of ALL managers of a campus for a month: per-manager average and count, campus average and total count. "
                    "Never use it for the user's own evaluation (use get_my_evaluations for that).",
     "properties": {"campus_name": CAMPUS, "month": MONTH, "year": YEAR,
                    "manager_name": {"type": "string", "description": "Optional: one manager."}},
     "required": []},
    {"name": "get_audit_logs", "description": "Admin audit log entries. Organizer only.",
     "properties": {"limit": {"type": "integer", "description": "Max rows (default 10)."}}, "required": []},
]

_STRIP = ("team", "فريق", "campus", "حرم", "الحرم")
_ALIASES = {"جنين": "jenin", "رام الله": "ramallah", "رام_الله": "ramallah",
            "تكنيكال": "technical", "التقني": "technical", "تقني": "technical", "التقنية": "technical",
            "تسويق": "marketing", "التسويق": "marketing", "علاقات عامة": "pr", "العلاقات العامة": "pr"}


def _norm(s: str) -> str:
    s = (s or "").strip().lower()
    for w in _STRIP:
        s = s.replace(w, " ")
    s = " ".join(s.split())
    return _ALIASES.get(s, s)


def _bad(msg: str):
    raise BackendError("BAD_ARGUMENTS", msg, 400)


class ToolExecutor:
    def __init__(self, client: BackendClient, token: str, today: date):
        self.client, self.token, self.today = client, token, today
        self._me: dict | None = None

    # ------------------------------------------------------------ entry point
    def run(self, name: str, args: dict | None) -> dict:
        handler = getattr(self, f"t_{name}", None)
        if handler is None:
            return {"error": {"code": "UNKNOWN_TOOL", "message": f"No tool named {name}. The assistant is read-only."}}
        try:
            return {"data": handler(**(args or {}))}
        except BackendError as e:
            return e.to_dict()
        except TypeError as e:
            return {"error": {"code": "BAD_ARGUMENTS", "message": str(e)}}

    # ------------------------------------------------------------ helpers
    def me(self) -> dict:
        if self._me is None:
            self._me = self.client.me(self.token)
        return self._me

    def _ym(self, month, year) -> tuple[int, int]:
        month = int(month) if month is not None else self.today.month
        if not 1 <= month <= 12:
            _bad("month must be 1-12")
        if year is None:
            year = self.today.year if month <= self.today.month else self.today.year - 1
        return month, int(year)

    def _period(self, month, year) -> tuple[int | None, int]:
        """Flexible period for points/evaluations.
        nothing given -> the current month | only a year -> the WHOLE year (month None) | month given -> that month."""
        if month is None and year is not None:
            return None, int(year)
        return self._ym(month, year)

    def _ym_required(self, month, year) -> tuple[int, int]:
        """Rankings are monthly: a bare year is ambiguous, so make the model ask the user for the month."""
        if month is None and year is not None:
            raise BackendError("MONTH_REQUIRED", f"Rankings are monthly. Ask the user which month of {int(year)}.", 400)
        return self._ym(month, year)

    def _campus(self, name: str | None) -> dict:
        campuses = self.client.list_campuses(self.token)
        if not name:
            me = self.me()
            if not me.get("teamId"):
                raise BackendError("CAMPUS_REQUIRED", "Please specify the campus (Jenin or Ramallah).", 400)
            team = next(t for t in self.client.list_teams(self.token) if t["id"] == me["teamId"])
            return next(c for c in campuses if c["id"] == team["campusId"])
        hit = [c for c in campuses if _norm(c["name"]) == _norm(name) or _norm(name) in _norm(c["name"])]
        if not hit:
            raise BackendError("CAMPUS_NOT_FOUND", "Unknown campus. Available: " + ", ".join(c["name"] for c in campuses), 404)
        return hit[0]

    def _team(self, team_name: str | None, campus_name: str | None) -> dict:
        if not team_name:
            me = self.me()
            if not me.get("teamId"):
                raise BackendError("TEAM_REQUIRED", "Please specify the team and campus.", 400)
            return next(t for t in self.client.list_teams(self.token) if t["id"] == me["teamId"])
        campus = self._campus(campus_name) if campus_name else None
        teams = self.client.list_teams(self.token, campus["id"] if campus else None)
        hit = [t for t in teams if _norm(t["name"]) == _norm(team_name)]
        if not hit:
            raise BackendError("TEAM_NOT_FOUND", "Unknown team. Available: " + ", ".join(t["name"] for t in teams), 404)
        if len(hit) > 1:
            raise BackendError("AMBIGUOUS_TEAM", "That team exists in more than one campus. Ask the user which campus.", 409)
        return hit[0]

    @staticmethod
    def _date_of(iso: str) -> date:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).date()

    # ------------------------------------------------------------ tools
    def t_get_my_profile(self):
        me = self.me()
        out = {"name": me["name"], "role": me["role"], "teamId": me.get("teamId")}
        if me.get("teamId"):
            team = next((t for t in self.client.list_teams(self.token) if t["id"] == me["teamId"]), None)
            if team:
                out["team"] = team["name"]
                out["campus"] = self._campus(None)["name"]
        return out

    def t_get_my_points(self, month=None, year=None, start_date=None, end_date=None, limit=10):
        entries = self.client.my_points(self.token)
        raw_count = len(entries)
        if month is not None or year is not None:
            m, y = self._period(month, year)
            entries = [e for e in entries if (d := self._date_of(e["effectiveAt"])).year == y and (m is None or d.month == m)]
        if start_date:
            entries = [e for e in entries if self._date_of(e["effectiveAt"]) >= date.fromisoformat(start_date)]
        if end_date:
            entries = [e for e in entries if self._date_of(e["effectiveAt"]) <= date.fromisoformat(end_date)]
        limit = max(1, min(int(limit or 10), 50))
        notes = []
        if raw_count >= 50:
            notes.append("The backend returns only the latest 50 entries; older entries may be missing from this result.")
        if entries and "reversesEntryId" not in entries[0]:
            notes.append("The backend does not yet say whether an entry is a reversal or was reversed.")
        if entries and "activityDescription" not in entries[0]:
            notes.append("Activity descriptions are not provided by the backend yet.")
        return {"totalPointsInPeriod": sum(e["points"] for e in entries), "entriesInPeriod": len(entries),
                "entries": entries[:limit], "notes": notes}

    def t_get_member_points(self, member_name, month=None, year=None):
        m, y = self._period(month, year)
        return self.client.member_points(self.token, member_name, m, y)

    def t_get_points_i_awarded(self, month=None, year=None):
        m, y = self._period(month, year)
        return self.client.points_awarded_by_me(self.token, m, y)

    def t_get_leaderboard(self, scope, campus_name=None, team_name=None, month=None, year=None, limit=None):
        scope = (scope or "").lower()
        if scope not in ("team", "campus"):
            _bad("scope must be 'team' or 'campus'")
        m, y = self._ym_required(month, year)
        team = self._team(team_name, campus_name) if scope == "team" else None
        campus = self._campus(campus_name) if scope == "campus" else next(
            c for c in self.client.list_campuses(self.token) if c["id"] == team["campusId"])
        res = self.client.leaderboard(self.token, scope, campus["id"], team["id"] if team else None, m, y, None)
        entries = res.get("entries") or []
        top = [e["name"] for e in entries if e.get("rank") == 1]
        if len(top) > 1:                      # a tie at the top must never be reported as a single winner
            res["tieAtRank1"] = top
            res["note"] = f"{len(top)} members are TIED at rank 1: " + ", ".join(top) + ". Mention ALL of them."
        if limit and len(entries) > int(limit):
            cutoff = entries[int(limit) - 1]["rank"]      # keep everyone who shares the cut-off rank
            res["entries"] = [e for e in entries if e["rank"] <= cutoff]
        res["campus"] = campus["name"]
        if team:
            res["team"] = team["name"]
        return res

    def t_get_my_ranking(self, scope="team", month=None, year=None):
        m, y = self._ym_required(month, year)
        return self.client.my_ranking(self.token, (scope or "team").lower(), m, y)

    def t_get_my_evaluations(self, month=None, year=None, limit=None):
        m, y = (self._period(month, year) if (month is not None or year is not None) else (None, None))
        res = self.client.my_evaluations(self.token, m, y, int(limit) if limit else None)
        res["notes"] = ["Evaluations have NO activity-description field: only activityName and comments exist. "
                        "If asked for a description, say it is not available and give the activity name and comments, labeled correctly."]
        return res

    def t_list_campuses(self):
        return self.client.list_campuses(self.token)

    def t_list_teams(self, campus_name=None):
        campus = self._campus(campus_name) if campus_name else None
        return self.client.list_teams(self.token, campus["id"] if campus else None)

    def t_get_team_members(self, team_name=None, campus_name=None):
        team = self._team(team_name, campus_name)
        members = self.client.get_team_members(self.token, team["id"])
        return {"team": team["name"], "count": len(members), "members": members,
                "note": "Active members only; the team manager is not included in this list."}

    def t_get_team_activity_summary(self, team_name=None, campus_name=None, month=None, year=None, activity_keyword=None):
        team = self._team(team_name, campus_name)
        m, y = self._period(month, year)
        res = self.client.team_activity_summary(self.token, team["id"], m, y, activity_keyword)
        res["team"] = team["name"]
        return res

    def t_get_manager_evaluations(self, campus_name=None, month=None, year=None, manager_name=None):
        campus = self._campus(campus_name)
        m, y = self._period(month, year)
        try:
            res = self.client.manager_evaluations(self.token, campus["id"], m, y, manager_name)
        except BackendError as e:
            if e.code == "FORBIDDEN":
                raise BackendError("FORBIDDEN", e.message + " (If the user is asking about THEIR OWN evaluation, "
                                   "call get_my_evaluations instead.)", e.status)
            raise
        res["campus"] = campus["name"]
        return res

    def t_get_audit_logs(self, limit=10):
        return self.client.audit_logs(self.token, max(1, min(int(limit or 10), 50)))
