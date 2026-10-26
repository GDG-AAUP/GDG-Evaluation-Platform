import { useState } from "react";
import { tr } from "../i18n/index.js";
import { useAppData } from "../context/AppDataContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import { CAMPUS } from "../lib/constants.js";
import { monthLabel } from "../lib/format.js";
import { leaderboardApi } from "../services/index.js";
import { Badge } from "../components/ui/Badges.jsx";
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

function Rows({ rows, q }) {
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
          <span>{tr("ترتيبك العام")}</span>
          <span>{mine.rank}</span>

          <b dir="ltr">{tr("{n} نقطة", { n: Number(mine.total) })}</b>
        </div>
      )}

      {!search && rows.length > 0 && (
        <Podium rows={rows.slice(0, 3)} />
      )}

      <h3>
        {search ? tr("نتائج البحث") : tr("أفضل خمسة أعضاء في الفرعين")}
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

                <small>
                  {tr(CAMPUS[person.campus])} · {tr(person.teamsLabel)}
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

  const [selectedMonth, setSelectedMonth] = useState(null);
  const [search, setSearch] = useState("");

  const month = selectedMonth || meta?.curMonth;

  const state = useAsync(
    () =>
      month
        ? leaderboardApi.getLeaderboard({
            month,
            global: true,
          })
        : Promise.resolve(null),
    [month],
  );

  if (!meta) return <Skeleton />;

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
        title={tr("الترتيب العام")}
        subtitle={tr("أفضل الأعضاء في جميع المجموعات والفرعين حسب مجموع النقاط")}
        actions={picker}
      />

      {state.data?.archived && (
        <Banner icon="archive">
          {tr("نتائج الشهر المؤرشف")}
        </Banner>
      )}

      <div className="tsearch">
        <Icon name="search" />

        <input
          type="search"
          placeholder={tr("ابحث عن عضو من أي مجموعة أو فرع")}
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
        {(data) => <Rows rows={data.rows} q={search} />}
      </Async>

      <Note>
        {tr("الترتيب حسب مجموع نقاط العضو خلال الشهر (النقاط المضافة ونقاط الأنشطة). من لديهم نفس عدد النقاط يحصلون على نفس الترتيب، وتُعرض أسماؤهم أبجديًا. تقييم الأداء لا يؤثر في الترتيب.")}
      </Note>
    </>
  );
}