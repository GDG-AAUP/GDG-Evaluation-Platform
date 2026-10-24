import { api } from "./call.js";
import { http } from "./http.js";
import * as E from "./mock/ratings.js";
export const ratingsApi = {
  targets: () => api(E.targets, () => http.get("/ratings/targets")),
  detail: (userId, month) =>
    api(
      (d, a) => E.detail(d, a, { userId, month }),
      () => http.get(`/ratings/${userId}`, { month }),
    ),
  save: (body) =>
    api(
      (d, a) => E.saveRating(d, a, body),
      () => http.post("/ratings", body),
    ),
  hall: (campus, month) =>
    api(
      (d, a) => E.hall(d, a, { campus, month }),
      () => http.get("/public/hall", { campus, month }, { auth: false }),
      { public: true },
    ),
  selectWinner: (body) =>
    api(
      (d, a) => E.selectWinner(d, a, body),
      () => http.post("/awards", body),
    ),
  news: () => api(E.newsList, () => http.get("/news")),
  saveNews: (body) =>
    api(
      (d, a) => E.saveNews(d, a, body),
      () => http.post("/news", body),
    ),
organizerDashboard: (campus = "all") =>
  api(
    (db, actor) => E.organizerDashboard(db, actor, { campus }),
    () => http.get("/dashboard/ratings", { campus }),
  ),
  ledger: (filters) =>
  api(
    (db, actor) => E.ratingLedger(db, actor, filters),
    () => http.get("/ratings/ledger", filters),
  ),
  };
