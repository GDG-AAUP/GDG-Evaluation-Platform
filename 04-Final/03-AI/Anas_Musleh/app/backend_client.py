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
    @abstractmethod
    def my_points_summary(self, token: str, month: int | None, year: int | None) -> dict: ...

    # ---- read-only chatbot data endpoints (GET /api/assistant/data/*) ------------
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
    """Talks to the Node/Express backend (02-Backend), always as the signed-in user."""

    def __init__(self, base_url: str, timeout: float = 10.0):
        self.http = httpx.Client(base_url=base_url, timeout=timeout)

    def _get(self, token: str, path: str, params: dict | None = None):
        try:
            clean = {k: v for k, v in (params or {}).items() if v is not None}
            r = self.http.get(path, params=clean, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:                        # server down, timeout...
            raise BackendError("BACKEND_UNREACHABLE", f"Backend unreachable: {exc}", 503)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code >= 400:
            err = body.get("error", {})
            raise BackendError(err.get("code", "BACKEND_ERROR"), err.get("message", "Backend error"), r.status_code)
        return body.get("data")

    def me(self, token): return self._get(token, "/api/auth/me")
    def list_campuses(self, token): return self._get(token, "/api/campuses")
    def list_teams(self, token, campus_id=None):
        return self._get(token, "/api/teams", {"campusId": campus_id} if campus_id else None)
    def get_team_members(self, token, team_id): return self._get(token, f"/api/teams/{team_id}/members")
    def my_points(self, token): return self._get(token, "/api/points/me", {"limit": 500})

    def _data(self, token, name, **params): return self._get(token, f"/api/assistant/data/{name}", params)

    def my_points_summary(self, token, month, year):
        return self._data(token, "my-points-summary", month=month, year=year)

    def member_points(self, token, member_name, month=None, year=None):
        return self._data(token, "member-points", memberName=member_name, month=month, year=year)

    def points_awarded_by_me(self, token, month, year):
        return self._data(token, "points-awarded", month=month, year=year)

    def leaderboard(self, token, scope, campus_id, team_id, month, year, limit):
        # A team board is identified by the team alone; the backend rejects sending both IDs ambiguously.
        return self._data(token, "leaderboard", scope=scope, campusId=None if scope == "team" else campus_id,
                          teamId=team_id, month=month, year=year, limit=limit)

    def my_ranking(self, token, scope, month, year):
        return self._data(token, "my-ranking", scope=scope, month=month, year=year)

    def my_evaluations(self, token, month, year, limit):
        return self._data(token, "my-evaluations", month=month, year=year, limit=limit)

    def team_activity_summary(self, token, team_id, month, year, activity_keyword):
        return self._data(token, "team-activity", teamId=team_id, month=month, year=year, activity=activity_keyword)

    def manager_evaluations(self, token, campus_id, month, year, manager_name):
        return self._data(token, "manager-evaluations", campusId=campus_id, month=month, year=year,
                          managerName=manager_name)

    def audit_logs(self, token, limit): return self._data(token, "audit-logs", limit=limit)


def get_client() -> BackendClient:
    from . import config
    if config.BACKEND_MODE == "real":
        return RealBackendClient(config.BACKEND_URL)
    from .mock_backend import MockBackend
    return MockBackend()
