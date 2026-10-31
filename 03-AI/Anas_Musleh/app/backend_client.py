from __future__ import annotations

from abc import ABC, abstractmethod

import httpx

from .errors import BackendError


class BackendClient(ABC):
    # ---- endpoints that EXIST today in 02-Backend/docs/api.md --------------------
    @abstractmethod
    def me(self, token: str) -> dict: ...
    @abstractmethod
    def list_campuses(self, token: str) -> list: ...
    @abstractmethod
    def list_teams(self, token: str, campus_id: int | None = None) -> list: ...
    @abstractmethod
    def get_team_members(self, token: str, team_id: int) -> list: ...
    @abstractmethod
    def my_points(self, token: str) -> list: ...

    # ---- endpoints that DO NOT exist yet (agreed shape = our proposal) -----------
    @abstractmethod
    def member_points(self, token: str, member_name: str, month=None, year=None) -> dict: ...
    @abstractmethod
    def points_awarded_by_me(self, token: str, month: int, year: int) -> dict: ...
    @abstractmethod
    def leaderboard(self, token: str, scope: str, campus_id: int, team_id: int | None,
                    month: int, year: int, limit: int | None) -> dict: ...
    @abstractmethod
    def my_ranking(self, token: str, scope: str, month: int, year: int) -> dict: ...
    @abstractmethod
    def my_evaluations(self, token: str, month: int | None, year: int | None, limit: int | None) -> dict: ...
    @abstractmethod
    def team_activity_summary(self, token: str, team_id: int, month: int, year: int,
                              activity_keyword: str | None) -> dict: ...
    @abstractmethod
    def manager_evaluations(self, token: str, campus_id: int, month: int, year: int,
                            manager_name: str | None) -> dict: ...
    @abstractmethod
    def audit_logs(self, token: str, limit: int) -> dict: ...


class RealBackendClient(BackendClient):
    """Talks to the Node/Express backend (02-Backend). Only the existing endpoints work."""

    def __init__(self, base_url: str, timeout: float = 10.0, transport: httpx.BaseTransport | None = None):
        self.http = httpx.Client(base_url=base_url, timeout=timeout, transport=transport)

    def _get(self, token: str, path: str, params: dict | None = None):
        try:
            r = self.http.get(path, params=params, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:                        # server down, timeout...
            raise BackendError("BACKEND_UNREACHABLE", f"Backend unreachable: {exc}", 503)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code >= 400:
            err = body.get("error", {})
            raise BackendError(err.get("code", "BACKEND_ERROR"), err.get("message", "Backend error"), r.status_code)
        return body.get("data")

    @staticmethod
    def _not_yet(name: str):
        raise BackendError("NOT_IMPLEMENTED", f"'{name}' is not available in the backend yet.", 501)

    # existing endpoints
    def me(self, token): return self._get(token, "/api/auth/me")
    def list_campuses(self, token): return self._get(token, "/api/campuses")
    def list_teams(self, token, campus_id=None):
        return self._get(token, "/api/teams", {"campusId": campus_id} if campus_id else None)
    def get_team_members(self, token, team_id): return self._get(token, f"/api/teams/{team_id}/members")
    def my_points(self, token): return self._get(token, "/api/points/me")   # last 50 entries, no filters

    # ---- endpoints that now EXIST in 02-Backend/src/phase2 (wired in Phase 2) -------------------
    @staticmethod
    def _rows(rows: list) -> list[dict]:
        """Backend rows {rank,userId,fullName,totalPoints} -> the shape the tools/prompt expect."""
        return [{"rank": r["rank"], "userId": r["userId"], "name": r["fullName"], "totalPoints": r["totalPoints"]}
                for r in rows]

    def leaderboard(self, token, scope, campus_id, team_id, month, year, limit):
        """GET /api/rankings (public, live) and /api/rankings/archived (published snapshot).
        Past months: use the archived snapshot if one exists, otherwise fall back to the live calculation
        and say so (field `source`). The validator rejects unexpected fields, so only ONE id is sent."""
        from . import config
        params = {"scope": scope, "year": str(year), "month": str(month)}
        params["teamId" if scope == "team" else "campusId"] = str(team_id if scope == "team" else campus_id)
        today = config.today()
        rows, source = [], "live"
        if (year, month) < (today.year, today.month):
            rows = self._get(token, "/api/rankings/archived", params) or []
            source = "archived_snapshot"
        if not rows:
            rows, source = self._get(token, "/api/rankings", params) or [], ("live" if (year, month) >= (today.year, today.month) else "live_recalculation")
        entries = self._rows(rows)
        # the live query lists the whole roster, so a month with nobody scoring shows everyone at 0 / rank 1.
        has_data = bool(entries) if source == "archived_snapshot" else any(e["totalPoints"] != 0 for e in entries)
        if limit:
            entries = entries[:limit]
        return {"scope": scope, "campusId": campus_id, "teamId": team_id, "month": month, "year": year,
                "hasData": has_data, "source": source, "entries": entries if has_data else []}

    def my_ranking(self, token, scope, month, year):
        me = self.me(token)
        if not me.get("teamId"):
            raise BackendError("NO_TEAM", "This account has no team, so it has no personal ranking", 400)
        team = next(t for t in self.list_teams(token) if t["id"] == me["teamId"])
        board = self.leaderboard(token, scope, team["campusId"], team["id"], month, year, None)
        base = {"scope": scope, "month": month, "year": year}
        if not board["hasData"]:
            return {**base, "hasData": False}
        mine = next((e for e in board["entries"] if e["userId"] == me["id"]), None)
        if mine is None:
            return {**base, "hasData": True, "inRanking": False,
                    "note": "The user is not part of this ranking for that month."}
        top = board["entries"][0]["totalPoints"]
        return {**base, "hasData": True, "inRanking": True, "rank": mine["rank"], "totalPoints": mine["totalPoints"],
                "topPoints": top, "gapToFirst": top - mine["totalPoints"],
                "peopleSharingMyRank": sum(1 for e in board["entries"] if e["rank"] == mine["rank"]),
                "participants": len(board["entries"]), "source": board["source"]}

    def audit_logs(self, token, limit):
        """GET /api/audit (organizer only). oldValues/newValues are NOT passed to the model: they may hold
        e-mails or other personal fields the chatbot has no reason to read out."""
        data = self._get(token, "/api/audit", {"pageSize": str(limit)}) or {}
        logs = [{"action": i["action"], "entity": i["entityType"], "entityId": i["entityId"],
                 "actorUserId": i["actorId"], "actorName": i.get("actorName"), "reason": i.get("reason"),
                 "createdAt": i["createdAt"]} for i in data.get("items", [])]
        return {"logs": logs[:limit], "total": data.get("total", len(logs))}

    def manager_evaluations(self, token, campus_id, month, year, manager_name):
        """Organizer only. No 'all managers' endpoint exists, so: /api/users (organizer) -> managers of the campus
        -> /api/evaluations/managers/:id/average for each one."""
        team_campus = {t["id"]: t["campusId"] for t in self.list_teams(token)}
        users = self._get(token, "/api/users") or []
        managers = [u for u in users if u["role"] == "manager" and u.get("isActive", True)
                    and team_campus.get(u["teamId"]) == campus_id
                    and (not manager_name or manager_name.strip() in u["name"])]
        months = [month] if month else range(1, 13)      # month=None = a whole year (the average endpoint is monthly)
        rows = []
        for m in managers:
            cnt, tot = 0, 0.0
            for mo in months:
                r = self._get(token, f"/api/evaluations/managers/{m['id']}/average", {"year": str(year), "month": str(mo)})
                cnt += r["evaluationCount"]
                tot += (r["averageScore"] or 0) * r["evaluationCount"]
            rows.append({"manager": m["name"], "evaluationsCount": cnt, "average": round(tot / cnt, 2) if cnt else None})
        rows.sort(key=lambda r: (r["average"] is None, -(r["average"] or 0)))
        total = sum(r["evaluationsCount"] for r in rows)
        weighted = sum((r["average"] or 0) * r["evaluationsCount"] for r in rows)
        return {"campusId": campus_id, "month": month, "year": year, "totalEvaluations": total,
                "campusAverage": round(weighted / total, 2) if total else None, "managers": rows}

    # ---- still NOT built in the backend -> honest error, the chatbot says "not available yet" ----
    def member_points(self, token, member_name, month=None, year=None): self._not_yet("member_points")
    def points_awarded_by_me(self, token, month, year): self._not_yet("points_awarded_by_me")
    def my_evaluations(self, token, month, year, limit): self._not_yet("my_evaluations")
    def team_activity_summary(self, token, team_id, month, year, activity_keyword): self._not_yet("team_activity_summary")


def get_client() -> BackendClient:
    from . import config
    if config.BACKEND_MODE == "real":
        return RealBackendClient(config.BACKEND_URL)
    from .mock_backend import MockBackend
    return MockBackend()
