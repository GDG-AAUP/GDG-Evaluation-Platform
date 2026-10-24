import { Avatar, Button } from "../ui/Primitives.jsx";
export default function AwardGallery({ data, onChoose, busy }) {
  return (
    <>
      <section className="winner-card">
        <div className="winner-copy">
          <span className="eyebrow">نجوم المجتمع · {data.month}</span>
          <h2>أثرٌ يستحقّ الاحتفاء.</h2>
          <p>عضو الشهر في GDG AAUP — تكريم للشغف والعمل وروح الفريق.</p>
          {data.winner ? (
            <>
              <span className="award-tag">✦ عضو الشهر</span>
              <h3>{data.winner.name}</h3>
              <p>
               {data.winner.teamName} · {Number(data.winner.total).toFixed(2)}%
              </p>
            </>
          ) : (
            <>
              <h3>من سيكون نجم هذا الشهر؟</h3>
              <p>
                {data.stale
                  ? "تغيّر متصدّرو الفرق. بانتظار تحديث اختيار المنظّم."
                  : "بانتظار اختيار المنظّم من متصدّري الفرق الأربعة."}
              </p>
            </>
          )}
        </div>
        <div className="winner-portrait">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="spark s1">✦</span>
          <span className="spark s2">✧</span>
          {data.winner ? (
            <Avatar name={data.winner.name} photo={data.winner.photo} />
          ) : (
            <svg
              className="trophy-art"
              width="150"
              height="170"
              viewBox="0 0 150 170"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="gold" x2="1" y2="1">
                  <stop stopColor="#fff1b5" />
                  <stop offset="1" stopColor="#d79e2c" />
                </linearGradient>
              </defs>
              <path
                d="M42 30H20v18c0 24 15 33 34 34M108 30h22v18c0 24-15 33-34 34"
                fill="none"
                stroke="#e1b44f"
                strokeWidth="10"
              />
              <path
                d="M38 18h74v43c0 26-15 43-37 43S38 87 38 61Z"
                fill="url(#gold)"
              />
              <path
                d="M69 100h12v32H69zM49 130h52v10H49zM38 140h74v14H38z"
                fill="url(#gold)"
              />
              <path
                d="m75 36 7 14 16 2-12 12 3 16-14-8-14 8 3-16-12-12 16-2Z"
                fill="#b88121"
              />
            </svg>
          )}
          <span className="portrait-caption">نجم هذا الشهر</span>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">كل فريق، قصة نجاح</span>
          <h2>متصدّرو المجموعات</h2>
        </div>
        <span className="hint">أعلى نسبة في تقييم الأنشطة</span>
      </div>
      <div className="finalist-grid">
        {data.groups.map((g, i) => (
          <article className={"finalist tone-" + i} key={g.teamId}>
            <span className="group-number">0{i + 1}</span>
            <span className="eyebrow">{g.name}</span>
            {g.leader ? (
              <>
                <Avatar name={g.leader.name} photo={g.leader.photo} />
                <h3>{g.leader.name}</h3>
                <div className="score-track">
                  <span style={{ width: g.leader.total + "%" }} />
                </div>
                <p>
                  <strong>{Number(g.leader.total).toFixed(2)}%</strong>
                </p>
                {onChoose && (
                  <Button
                    variant="primary"
                    disabled={busy || data.winner?.userId === g.leader.id}
                    onClick={() => onChoose(g.leader.id)}
                  >
                    {data.winner?.userId === g.leader.id
                      ? "✓ عضو الشهر"
                      : "اختيار عضو الشهر"}
                  </Button>
                )}
              </>
            ) : (
              <p>لم يُسجّل أنشطة لهذا الفريق بعد.</p>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
