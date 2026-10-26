import { tr } from "../i18n/index.js";
import { useState } from "react";
import { useBranch } from "../context/BranchContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import { ratingsApi } from "../services/ratings.js";
import { useToast } from "../context/ToastContext.jsx";
import AwardGallery from "../components/domain/AwardGallery.jsx";
import { Async } from "../components/ui/States.jsx";
import { PageHeader } from "../components/ui/Primitives.jsx";
export default function Awards() {
  const { branch } = useBranch();
  const [month, setMonth] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const state = useAsync(
    () => ratingsApi.hall(branch, month || undefined),
    [branch, month],
  );
  async function choose(userId) {
    setBusy(true);
    try {
      await ratingsApi.selectWinner({
        campus: branch,
        month: state.data.month,
        userId,
      });
      toast.success(tr("تم تكريم عضو الشهر وتحديث صفحة الترحيب"));
      state.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title={tr("نجوم الشهر")}
        subtitle={tr("اختر عضو الشهر من متصدّري الفرق. يظهر التكريم تلقائيًا في صفحة الترحيب.")}
      />
      <Async state={state}>
        {(d) => (
          <>
            <div className="fb">
              <select
                aria-label={tr("شهر التكريم")}
                value={month || d.month}
                onChange={(e) => setMonth(e.target.value)}
              >
                {d.months.map((m) => (
                  <option key={m.id}>{m.id}</option>
                ))}
              </select>
            </div>
            <AwardGallery data={d} onChoose={choose} busy={busy} />
          </>
        )}
      </Async>
    </>
  );
}
