import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { BranchSwitcher, useBranch } from "../context/BranchContext.jsx";
import { ratingsApi } from "../services/ratings.js";
import { useAsync } from "../hooks/useAsync.js";
import { Link } from "../router/router.jsx";
import { HOME_BY_ROLE } from "../lib/constants.js";
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
    <div className="welcome" dir="rtl">
      <header className="public-header">
        <Link to="/" className="community-brand">
          <img src={gdgLogo} alt="GDG AAUP" className="header-logo" />
          <span>
            GDG <b>AAUP</b>
            <small>مجتمع المطوّرين · الجامعة العربية الأمريكية</small>
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
            عن المجتمع
          </button>
          <button
            onClick={() =>
              document
                .getElementById("news")
                .scrollIntoView({ behavior: "smooth" })
            }
          >
         الانشطة الشهرية
          </button>
          <Link
            className="btn btn-p"
            to={user ? HOME_BY_ROLE[user.role] : "/login"}
          >
            {user ? "لوحتي" : "تسجيل الدخول"} ↗
          </Link>
        </nav>
      </header>
      <main>
        <section className="welcome-hero">
          <div>
            <span className="eyebrow">نتعلّم معًا. نبني معًا. نترك أثرًا.</span>
            <h1>
              شغفٌ يجمعنا.
              <br />
              <em>وأثرٌ يكبر بنا.</em>
            </h1>
            <p>
              مرحبًا بك في مجتمع GDG في الجامعة العربية الأمريكية. مساحة تجمع
              الفضول التقني، الإبداع وروح المبادرة في جنين ورام الله.
            </p>
            <BranchSwitcher />
            <div className="hero-links">
              <a className="btn btn-p" href="#/leaderboard">
              عضويتي
              </a>
              <button
                className="btn"
                onClick={() =>
                  document
                    .getElementById("stars")
                    .scrollIntoView({ behavior: "smooth" })
                }
              >
                تعرّف على نجومنا
              </button>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
          <img src={gdgLogo} alt="" className="hero-logo" />
            <span className="art-chip chip-1">نبتكر ✦</span>
            <span className="art-chip chip-2">نتعلّم ↗</span>
            <span className="art-chip chip-3">نشارك +</span>
            <div className="art-ring" />
          </div>
        </section>
        <Async state={state}>
          {(d) => (
            <>
              <div className="community-stats">
                <div>
                  <strong>02</strong>
                  <span>فرعان، مجتمع واحد</span>
                </div>
                <div>
                  <strong>04</strong>
                  <span>فرق تصنع الأثر</span>
                </div>
                <div>
                  <strong>{d.memberCount}</strong>
                  <span>عضو في هذا الفرع</span>
                </div>
                <div>
                  <strong>{d.ratedCount}</strong>
                  <span>عضو مُقيّم هذا الشهر</span>
                </div>
              </div>
              {d.demo && (
                <p className="demo-notice">
                  نسخة تجريبية ببيانات توضيحية محفوظة في هذا المتصفح.
                </p>
              )}
              <section id="stars">
                <div className="section-heading">
                  <h2>لوحة التميّز</h2>
                  <select
                    aria-label="شهر التكريم"
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
      <span className="eyebrow">أعمال تصنع الأثر ✦</span>
      <h2>لماذا هو أفضل عضو هذا الشهر؟</h2>

      {d.winner && (
        <p>
          تعرّف على مساهمات <strong>{d.winner.name}</strong>
          {" "}خلال شهر {d.month}.
        </p>
      )}
    </div>
  </div>

  {!d.winner ? (
    <article className="card">
      <h3>بانتظار نجم الشهر ✦</h3>
      <p>
        ستظهر هنا أنشطة عضو الشهر بعد اختيار المنظّم له.
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
      <h3>مساهمات {d.winner.name}</h3>
      <p>لا توجد تفاصيل أنشطة مسجلة لهذا الشهر.</p>
    </article>
  )}
</section>
            </>
          )}
        </Async>
        <section id="about" className="about-section">
          <span className="eyebrow">أكثر من فريق</span>
          <h2>
            معرفة نشاركها،
            <br />
            وفرص نصنعها معًا.
          </h2>
          <p>
            يجمع مجتمع GDG AAUP أعضاءه في أربعة فرق: التقني، العلاقات العامة،
            التسويق، والتواصل الاجتماعي. نؤمن بأن التعلّم يصبح أجمل حين نشارك
            تجاربنا، وأن كل مساهمة تستحق التقدير.
          </p>
          <p>
            تتابع هذه المنصة مساهمات الأعضاء بتقييم شهري واضح من 15 بندًا،
            وتحتفي بمتصدّري الفرق وعضو الشهر.
          </p>
        </section>
      </main>
      <footer>
        <div className="section-heading">
          <h2>ابقَ قريبًا من المجتمع</h2>
          <span>GDG AAUP · جنين ورام الله</span>
        </div>
        <a
  href="https://gdg.community.dev/gdg-on-campus-arab-american-university-ramallah-state-of-palestine/"
  target="_blank"
  rel="noopener noreferrer"
  className="welcome-contact-link"
>
  <span aria-hidden="true">✉️</span>
  تواصل معنا
</a>

<button
  type="button"
  className="welcome-contact-link"
  disabled
>
  <span aria-hidden="true">🔗</span>
  قريبًا
</button>
      </footer>
    </div>
  );
}
