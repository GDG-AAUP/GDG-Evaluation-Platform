import { tr } from "../i18n/index.js";
import { useState } from "react";
import { DirectionToggle } from "../context/DirectionContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { BranchSwitcher, useBranch } from "../context/BranchContext.jsx";
import { ratingsApi } from "../services/ratings.js";
import { useAsync } from "../hooks/useAsync.js";
import { Link } from "../router/router.jsx";
import { homeFor } from "../lib/home.js";
import AwardGallery from "../components/domain/AwardGallery.jsx";
import QuickLinks from "../components/layout/QuickLinks.jsx";
import { Async } from "../components/ui/States.jsx";
import gdgLogo from "../assets/branches/gdg-logo.png";
export default function Welcome() {
  const { user } = useAuth();
  const { branch } = useBranch();
  const [month, setMonth] = useState("");
  const state = useAsync(
    () => ratingsApi.hall(branch, month || undefined),
    [branch, month],
  );
  return (
    <div className="welcome">
      <header className="public-header">
        <Link to="/" className="community-brand">
          <img src={gdgLogo} alt="GDG AAUP" className="header-logo" />
          <span>
            GDG <b>AAUP</b>
            <small>{tr("مجتمع المطوّرين · الجامعة العربية الأمريكية")}</small>
          </span>
        </Link>
        <nav>
          <button
            onClick={() =>
              document
                .getElementById("about")
                .scrollIntoView({ behavior: "smooth" })
            }
          >
            {tr("عن المجتمع")}
          </button>
          <button
            onClick={() =>
              document
                .getElementById("news")
                .scrollIntoView({ behavior: "smooth" })
            }
          >
            {tr("الانشطة الشهرية")}
          </button>
          <DirectionToggle className="ib dir-toggle" />
          <Link
            className="btn btn-p"
            to={user ? homeFor(user.role) : "/login"}
          >
            {user ? tr("لوحتي") : tr("تسجيل الدخول")} ↗
          </Link>
        </nav>
      </header>
      <main>
        <section className="welcome-hero">
          <div>
            <span className="eyebrow">{tr("نتعلّم معًا. نبني معًا. نترك أثرًا.")}</span>
            <h1>
              {tr("شغفٌ يجمعنا.")}
              <br />
              <em>{tr("وأثرٌ يكبر بنا.")}</em>
            </h1>
            <p>
              {tr("مرحبًا بك في مجتمع GDG في الجامعة العربية الأمريكية. مساحة تجمع الفضول التقني، الإبداع وروح المبادرة في جنين ورام الله.")}
            </p>
            <BranchSwitcher />
            <div className="hero-links">
              <a className="btn btn-p" href="#/leaderboard">
              {tr("عضويتي")}
              </a>
              <button
                className="btn"
                onClick={() =>
                  document
                    .getElementById("stars")
                    .scrollIntoView({ behavior: "smooth" })
                }
              >
                {tr("تعرّف على نجومنا")}
              </button>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
          <img src={gdgLogo} alt="" className="hero-logo" />
            <span className="art-chip chip-1">{tr("نبتكر")} ✦</span>
            <span className="art-chip chip-2">{tr("نتعلّم")} ↗</span>
            <span className="art-chip chip-3">{tr("نشارك")} +</span>
            <div className="art-ring" />
          </div>
        </section>
        <Async state={state}>
          {(d) => (
            <>
              <div className="community-stats">
                <div>
                  <strong>02</strong>
                  <span>{tr("فرعان، مجتمع واحد")}</span>
                </div>
                <div>
                  <strong>04</strong>
                  <span>{tr("فرق تصنع الأثر")}</span>
                </div>
                <div>
                  <strong>{d.memberCount}</strong>
                  <span>{tr("عضو في هذا الفرع")}</span>
                </div>
                <div>
                  <strong>{d.ratedCount}</strong>
                  <span>{tr("عضو مُقيّم هذا الشهر")}</span>
                </div>
              </div>
              {d.demo && (
                <p className="demo-notice">
                  {tr("نسخة تجريبية ببيانات توضيحية محفوظة في هذا المتصفح.")}
                </p>
              )}
              <section id="stars">
                <div className="section-heading">
                  <h2>{tr("لوحة التميّز")}</h2>
                  <select
                    aria-label={tr("شهر التكريم")}
                    value={month || d.month}
                    onChange={(e) => setMonth(e.target.value)}
                  >
                    {d.months.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </select>
                </div>
                <AwardGallery data={d} />
              </section>
              <section id="news">
  <div className="section-heading">
    <div>
      <span className="eyebrow">{tr("أعمال تصنع الأثر")} ✦</span>
      <h2>{tr("لماذا هو أفضل عضو هذا الشهر؟")}</h2>

      {d.winner && (
        <p>
          {tr("تعرّف على مساهمات {name} خلال شهر {month}.", { name: "\u0001", month: d.month }).split("\u0001")[0]}
          <strong>{d.winner.name}</strong>
          {tr("تعرّف على مساهمات {name} خلال شهر {month}.", { name: "\u0001", month: d.month }).split("\u0001")[1]}
        </p>
      )}
    </div>
  </div>

  {!d.winner ? (
    <article className="card">
      <h3>{tr("بانتظار نجم الشهر")} ✦</h3>
      <p>
        {tr("ستظهر هنا أنشطة عضو الشهر بعد اختيار المنظّم له.")}
      </p>
    </article>
  ) : (d.winnerActivities || []).length > 0 ? (
    <div className="news-grid winner-activities">
      {d.winnerActivities.map((activity) => (
        <article
          className="card winner-activity-card"
          key={activity.id}
        >
          <span className="winner-activity-icon" aria-hidden="true">
            ✦
          </span>

          <h3>{activity.title}</h3>

          <p className="news-body">
            {activity.description}
          </p>
        </article>
      ))}
    </div>
  ) : (
    <article className="card">
      <h3>{tr("مساهمات {name}", { name: d.winner.name })}</h3>
      <p>{tr("لا توجد تفاصيل أنشطة مسجلة لهذا الشهر.")}</p>
    </article>
  )}
</section>
            </>
          )}
        </Async>
        <section id="about" className="about-section">
          <span className="eyebrow">{tr("أكثر من فريق")}</span>
          <h2>
            {tr("معرفة نشاركها،")}
            <br />
            {tr("وفرص نصنعها معًا.")}
          </h2>
          <p>
            {tr("يجمع مجتمع GDG AAUP أعضاءه في أربعة فرق: التقني، العلاقات العامة، التسويق، والتواصل الاجتماعي. نؤمن بأن التعلّم يصبح أجمل حين نشارك تجاربنا، وأن كل مساهمة تستحق التقدير.")}
          </p>
          <p>
            {tr("تتابع هذه المنصة مساهمات الأعضاء بتقييم شهري واضح من 15 بندًا، وتحتفي بمتصدّري الفرق وعضو الشهر.")}
          </p>
        </section>
      </main>
      <footer>
        <div className="section-heading">
          <h2>{tr("ابقَ قريبًا من المجتمع")}</h2>
          <span>{tr("GDG AAUP · جنين ورام الله")}</span>
        </div>
        <a
  href="mailto:aaupgdg@gmail.com"
  className="welcome-contact-link"
>
  {tr("تواصل معنا")}
</a>

<button
  type="button"
  className="welcome-contact-link"
  disabled
>
  <span aria-hidden="true">🔗</span>
  {tr("LinkedIn · قريبًا")}
</button>
      </footer>
    </div>
  );
}
