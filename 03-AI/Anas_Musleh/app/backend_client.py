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

    def __init__(self, base_url: str, timeout: float = 10.0):
        self.http = httpx.Client(base_url=base_url, timeout=timeout)

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

    # not built yet -> honest error, the chatbot will tell the user "not available yet"
    def member_points(self, token, member_name, month=None, year=None): self._not_yet("member_points")
    def points_awarded_by_me(self, token, month, year): self._not_yet("points_awarded_by_me")
    def leaderboard(self, token, scope, campus_id, team_id, month, year, limit): self._not_yet("leaderboard")
    def my_ranking(self, token, scope, month, year): self._not_yet("my_ranking")
    def my_evaluations(self, token, month, year, limit): self._not_yet("my_evaluations")
    def team_activity_summary(self, token, team_id, month, year, activity_keyword): self._not_yet("team_activity_summary")
    def manager_evaluations(self, token, campus_id, month, year, manager_name): self._not_yet("manager_evaluations")
    def audit_logs(self, token, limit): self._not_yet("audit_logs")


def get_client() -> BackendClient:
    from . import config
    if config.BACKEND_MODE == "real":
        return RealBackendClient(config.BACKEND_URL)
    from .mock_backend import MockBackend
    return MockBackend()
