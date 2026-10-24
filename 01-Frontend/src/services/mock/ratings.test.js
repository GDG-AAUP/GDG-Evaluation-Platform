import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "./seed.js";
import * as R from "./ratings.js";
import * as E from "./engine.js";
import { closeMonth } from "./engineAdmin.js";
import { rankRows, scoreOf } from "./helpers.js";
import {
  SCORECARD_CATEGORIES,
  validateScorecard,
} from "../../lib/scorecard.js";
import { migrateDb } from "./db.js";
const setup = () => {
  const d = createSeed();
  return {
    d,
    o: d.users.find((u) => u.id === "o1"),
    m: d.users.find((u) => u.id === "m1"),
    u: d.users.find((u) => u.id === "u1"),
  };
};
const scores = (max = true) =>
  Object.fromEntries(SCORECARD_CATEGORIES.map((c) => [c.id, max ? c.max : 0]));
const status = (fn, n) => assert.throws(fn, (e) => e.status === n);
test("15 immutable categories: complete integer range 0–100; reject blank, extra, negative, decimal and over limit", () => {
  assert.equal(SCORECARD_CATEGORIES.length, 15);
  assert.ok(Object.isFrozen(SCORECARD_CATEGORIES));
  assert.equal(validateScorecard(scores()).total, 100);
  assert.equal(validateScorecard(scores(false)).total, 0);
  for (const change of [
    { cat1: -1 },
    { cat1: 11 },
    { cat6: 6 },
    { cat6: 1.5 },
    { cat1: "" },
    { cat1: null },
    { cat1: true },
    { cat99: 0 },
  ])
    assert.equal(validateScorecard({ ...scores(), ...change }).ok, false);
  const partial = scores();
  delete partial.cat5;
  assert.equal(validateScorecard(partial).ok, false);
});
test("strict rating permissions: organizers both branches except self, managers only own branch/team members, members read only", () => {
  const { d, o, m, u } = setup();
  const ids = R.targets(d, o).map((x) => x.id);
  assert.ok(ids.includes("o2") && ids.includes("m8") && ids.includes("u25"));
  assert.ok(!ids.includes("o1") && !ids.includes("u31"));
  const own = R.targets(d, m);
  assert.ok(
    own.length > 0 &&
      own.every((x) => x.campus === "jenin" && x.role === "member"),
  );
  assert.ok(!own.some((x) => ["u7", "u25", "m1"].includes(x.id)));
  for (const [actor, id] of [
    [o, "o1"],
    [m, "u7"],
    [m, "u25"],
    [m, "m2"],
    [u, "u2"],
  ])
    status(
      () =>
        R.saveRating(d, actor, {
          userId: id,
          scores: scores(),
          reason: "test",
        }),
      403,
    );
  status(() => R.targets(d, u), 403);
  assert.equal(R.detail(d, u, { userId: u.id }).user.id, u.id);
  status(() => R.detail(d, u, { userId: "u2" }), 403);
});
test("revisions replace monthly score, never accumulate, preserve history, stale save rejected and charts use latest", () => {
  const { d, o } = setup();
  const previous = R.detail(d, o, { userId: "u2" }).current;
  R.saveRating(d, o, {
    userId: "u2",
    scores: scores(),
    reason: "first",
    expectedRev: previous.rev,
  });
  assert.equal(scoreOf(d, "u2", d.curMonth), 100);
  status(
    () =>
      R.saveRating(d, o, {
        userId: "u2",
        scores: scores(false),
        reason: "stale",
        expectedRev: previous.rev,
      }),
    409,
  );
  const before = E.orgOverview(d, o).pointsAdded;
  R.saveRating(d, o, {
    userId: "u2",
    scores: scores(false),
    reason: "revision",
  });
  assert.equal(scoreOf(d, "u2", d.curMonth), 0);
  assert.equal(E.orgOverview(d, o).pointsAdded, before - 100);
  assert.equal(R.detail(d, o, { userId: "u2" }).history.length, 3);
  assert.equal(rankRows(d, d.curMonth).find((r) => r.userId === "u2").total, 0);
});
test("four branch leaders, authorized winner, safe public payload, stale award after rank change", () => {
  const { d, o, m } = setup();
  R.saveRating(d, o, { userId: "u2", scores: scores(), reason: "winner" });
  let h = R.hall(d, null, { campus: "jenin" });
  assert.equal(h.groups.length, 4);
  status(() => R.selectWinner(d, m, { campus: "jenin", userId: "u2" }), 403);
  status(() => R.selectWinner(d, o, { campus: "ramallah", userId: "u2" }), 400);
  R.selectWinner(d, o, { campus: "jenin", userId: "u2" });
  h = R.hall(d, null, { campus: "jenin" });
  assert.equal(h.winner.userId, "u2");
  assert.equal(R.hall(d, null, { campus: "ramallah" }).winner, null);
  const raw = JSON.stringify(h);
  assert.ok(!raw.includes("@gdg.ps") && !raw.includes("123456"));
  R.saveRating(d, o, {
    userId: "u2",
    scores: scores(false),
    reason: "corrected",
  });
  h = R.hall(d, null, { campus: "jenin" });
  assert.equal(h.winner, null);
  assert.equal(h.stale, true);
});
test("month archive freezes score/award, new month unrated, old ratings locked", () => {
  const { d, o } = setup();
  const month = d.curMonth;
  const leader = R.hall(d, null, { campus: "jenin" }).groups[0].leader;
  R.selectWinner(d, o, { campus: "jenin", userId: leader.id });
  closeMonth(d, o);
  assert.equal(
    R.hall(d, null, { campus: "jenin", month }).winner.userId,
    leader.id,
  );
  assert.equal(R.hall(d, null, { campus: "jenin" }).ratedCount, 0);
  status(
    () =>
      R.saveRating(d, o, {
        userId: "u2",
        month,
        scores: scores(),
        reason: "locked",
      }),
    409,
  );
});
test("news draft/public separation and organizer restriction; photo validation", () => {
  const { d, o, u } = setup();
  const n = R.saveNews(d, o, { title: "خبر", body: "نص", status: "draft" });
  assert.equal(R.hall(d, null, {}).news.length, 0);
  R.saveNews(d, o, { ...n, status: "published" });
  assert.equal(R.hall(d, null, {}).news[0].title, "خبر");
  status(
    () => R.saveNews(d, u, { title: "x", body: "y", status: "published" }),
    403,
  );
  status(() => R.validatePhoto("https://bad.example/photo.jpg"), 400);
  assert.equal(R.validatePhoto(null), null);
});
test("v1 migration preserves original ledger, evaluations and snapshots without fabricated ratings", () => {
  const { d } = setup();
  d.v = 1;
  delete d.scorecards;
  delete d.awards;
  delete d.news;
  const entries = JSON.stringify(d.entries),
    evals = JSON.stringify(d.evals),
    rows = JSON.stringify(d.snaps["2026-09"].rows);
  migrateDb(d);
  assert.equal(d.v, 2);
  assert.equal(d.scorecards.length, 0);
  assert.equal(JSON.stringify(d.entries), entries);
  assert.equal(JSON.stringify(d.evals), evals);
  assert.equal(JSON.stringify(d.snaps["2026-09"].rows), rows);
});

test("closing month freezes live winner score and never resurrects a stale winner", () => {
  const { d, o } = setup();
  R.saveRating(d, o, { userId: "u2", scores: scores(), reason: "first" });
  R.selectWinner(d, o, { campus: "jenin", userId: "u2" });
  const revised = { ...scores(), cat15: 4 };
  R.saveRating(d, o, { userId: "u2", scores: revised, reason: "change" });
  const month = d.curMonth;
  closeMonth(d, o);
  assert.equal(R.hall(d, null, { campus: "jenin", month }).winner.total, 99);
  const other = setup();
  R.saveRating(other.d, other.o, {
    userId: "u2",
    scores: scores(),
    reason: "first",
  });
  R.selectWinner(other.d, other.o, { campus: "jenin", userId: "u2" });
  R.saveRating(other.d, other.o, {
    userId: "u2",
    scores: scores(false),
    reason: "correction",
  });
  closeMonth(other.d, other.o);
  assert.equal(R.hall(other.d, null, { campus: "jenin", month }).winner, null);
});
