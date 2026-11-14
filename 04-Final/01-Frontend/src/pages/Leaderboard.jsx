import { useState } from "react";
import { tr } from "../i18n/index.js";
import { useAppData } from "../context/AppDataContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import { CAMPUS } from "../lib/constants.js";
import { monthLabel } from "../lib/format.js";
import { leaderboardApi } from "../services/index.js";
import { Badge, CampusBadge } from "../components/ui/Badges.jsx";
import { FilterBar, Segmented, Select } from "../components/ui/Form.jsx";
import Icon from "../components/ui/Icon.jsx";
import {
  Avatar,
  Banner,
  Card,
  Note,
  PageHeader,
} from "../components/ui/Primitives.jsx";
import {
  Async,
  EmptyState,
  Skeleton,
} from "../components/ui/States.jsx";

function Podium({ rows }) {
  const renderPerson = (person) => {
    if (!person) return null;

    return (
      <div
        key={person.userId}
        className={person.rank === 1 ? "p1" : ""}
      >
        <span className="rb">{person.rank}</span>
        <br />

        <Avatar name={person.name} photo={person.photo} />

        <div style={{ fontWeight: 500 }}>{person.name}</div>

        <b dir="ltr">{Number(person.total)}</b>

        <small>{tr("نقطة")}</small>
      </div>
    );
  };

  return (
    <div className="pod">
      {renderPerson(rows[1])}
      {renderPerson(rows[0])}
      {renderPerson(rows[2])}
    </div>
  );
}

function Rows({ rows, q, title, showCampus }) {
  const mine = rows.find((person) => person.isMe);
  const search = q.trim().toLocaleLowerCase("ar");

  const visible = search
    ? rows.filter((person) =>
        person.name.toLocaleLowerCase("ar").includes(search),
      )
    : rows.slice(0, 5);

  return (
    <>
      {mine && (
        <div className="mine">
          <span>{tr("ترتيبك")}</span>
          <span>{mine.rank}</span>

          <b dir="ltr">{tr("{n} نقطة", { n: Number(mine.total) })}</b>
        </div>
      )}

      {!search && rows.length > 0 && (
        <Podium rows={rows.slice(0, 3)} />
      )}

      <h3>
        {search ? tr("نتائج البحث") : title}
      </h3>

      <Card className="lb" style={{ padding: 4 }}>
        {visible.length === 0 ? (
          <EmptyState
            icon="search-off"
            title={tr("لا توجد نتائج")}
            text={tr("لا يوجد عضو بهذا الاسم.")}
          />
        ) : (
          visible.map((person) => (
            <div
              key={person.userId}
              className={`lr${person.isMe ? " me" : ""}`}
            >
              <span className="rk">{person.rank}</span>

              <Avatar
                name={person.name}
                photo={person.photo}
              />

              <div className="nm">
                {person.name}

                {person.isMe && (
                  <>
                    {" "}
                    <Badge tone="b">{tr("أنت")}</Badge>
                  </>
                )}

                {person.tie && (
                  <>
                    {" "}
                    <Badge tone="n" title={tr("نفس عدد النقاط")}>
                      {tr("تعادل")}
                    </Badge>
                  </>
                )}

                {showCampus && person.campus && (
                  <>
                    {" "}
                    <CampusBadge campus={person.campus} />
                  </>
                )}

                <small>
                  {[person.campus ? tr(CAMPUS[person.campus]) : "", tr(person.teamsLabel)].filter(Boolean).join(" · ")}
                </small>
              </div>

              <span className="pt" dir="ltr">
                {tr("{n} نقطة", { n: Number(person.total) })}
              </span>
            </div>
          ))
        )}
      </Card>
    </>
  );
}

export default function Leaderboard() {
  const { meta } = useAppData();
  const { user } = useAuth() || {};

  const [selectedMonth, setSelectedMonth] = useState(null);
  const [search, setSearch] = useState("");
  // Every role sees every board: both campuses together ('all'), one campus, or one of its teams.
  const [campus, setCampus] = useState(CAMPUS[user?.campus] ? user.campus : "all");
  const [teamId, setTeamId] = useState("");

  const month = selectedMonth || meta?.curMonth;

  const state = useAsync(
    () =>
      month
        ? leaderboardApi.getLeaderboard({
            month,
            campus,
            teamId: teamId || undefined,
          })
        : Promise.resolve(null),
    [month, campus, teamId],
  );

  if (!meta) return <Skeleton />;

  const both = campus === "all";
  const teams = both ? [] : meta.teams.filter((t) => t.campus === campus && t.status !== "deleted");
  const team = teams.find((t) => t.id === teamId);
  const boardTitle = team
    ? tr("أفضل خمسة في فريق {team}", { team: tr(team.name) })
    : both
      ? tr("أفضل خمسة في الحرمين معًا")
      : tr("أفضل خمسة في حرم {campus}", { campus: tr(CAMPUS[campus]) });

  const months = meta.months;
  const monthIndex = months.findIndex(
    (item) => item.id === month,
  );

  function stepMonth(direction) {
    const next = months[monthIndex + direction];

    if (next) {
      setSelectedMonth(next.id);
    }
  }

  const picker = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <button
        type="button"
        className="ib"
        aria-label={tr("الشهر السابق")}
        disabled={monthIndex <= 0}
        onClick={() => stepMonth(-1)}
      >
        <Icon name="chevron-right" />
      </button>

      <b style={{ minWidth: 120, textAlign: "center" }}>
        {monthLabel(month)}
      </b>

      <button
        type="button"
        className="ib"
        aria-label={tr("الشهر التالي")}
        disabled={
          monthIndex < 0 || monthIndex >= months.length - 1
        }
        onClick={() => stepMonth(1)}
      >
        <Icon name="chevron-left" />
      </button>
    </div>
  );

  return (
    <>
      <PageHeader
        title={tr("الترتيب الشهري")}
        subtitle={tr("ترتيب الحرمين معًا أو كل حرم وكل فريق على حدة حسب نقاط الشهر")}
        actions={picker}
      />

      {state.data?.archived && (
        <Banner icon="archive">
          {tr("نتائج الشهر المؤرشف")}
        </Banner>
      )}

      <Segmented
        style={{ marginBottom: 10 }}
        value={campus}
        onChange={(v) => { setCampus(v); setTeamId(""); }}
        options={[
          ["all", tr("كلا الحرمين (الكل)")],
          ...Object.entries(CAMPUS).map(([v, l]) => [v, tr("حرم {campus}", { campus: tr(l) })]),
        ]}
      />
      {!both && (
        <FilterBar>
          <Select
            label={tr("الفريق")}
            value={teamId}
            onChange={setTeamId}
            options={[["", tr("ترتيب الحرم كاملًا")], ...teams.map((t) => [t.id, tr(t.name)])]}
          />
        </FilterBar>
      )}

      <div className="tsearch">
        <Icon name="search" />

        <input
          type="search"
          placeholder={tr("ابحث عن اسم في هذا الترتيب")}
          aria-label={tr("ابحث عن عضو")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <Async
        state={state}
        isEmpty={(data) => data.rows.length === 0}
        empty={
          <EmptyState
            icon="trophy"
            title={tr("لا توجد نقاط لهذا الشهر")}
            text={tr("ستظهر الأسماء عند تسجيل نقاط للأعضاء.")}
          />
        }
      >
        {(data) => <Rows rows={data.rows} q={search} title={boardTitle} showCampus={both} />}
      </Async>

      <Note>
        {tr("الترتيب حسب مجموع نقاط العضو خلال الشهر (النقاط المضافة ونقاط الأنشطة). من لديهم نفس عدد النقاط يحصلون على نفس الترتيب (1، 1، 2)، وتُعرض أسماؤهم أبجديًا. يظهر المدير مع أعضاء فريقه. «كلا الحرمين» يرتّب الجميع معًا حسب نقاط الشهر مع شارة الحرم لكل اسم، ويمكن عرض كل حرم وكل فريق على حدة. تقييم الأداء لا يؤثر في الترتيب.")}
      </Note>
    </>
  );
}