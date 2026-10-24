import { api } from "./call.js";
import { http } from "./http.js";
import * as E from "./mock/ratings.js";

export const activitiesApi = {
  overview: (month) =>
    api(
      (db, actor) => E.activityOverview(db, actor, { month }),
      () => http.get("/activities", { month }),
    ),

  save: (body) =>
    api(
      (db, actor) => E.saveActivity(db, actor, body),
      () => http.post("/activities", body),
    ),
};