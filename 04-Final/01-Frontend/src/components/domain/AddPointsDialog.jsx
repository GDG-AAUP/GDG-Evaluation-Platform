import { useState } from "react";
import { useAsync } from "../../hooks/useAsync.js";
import { ratingsApi } from "../../services/ratings.js";
import {
  SCORECARD_CATEGORIES,
  validateScorecard,
} from "../../lib/scorecard.js";
import { Dialog, DialogActions } from "../ui/Dialog.jsx";
import { Button } from "../ui/Primitives.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { CAMPUS } from "../../lib/constants.js";
import { tr } from "../../i18n/index.js";
function Editor({ userId, onDone, onClose }) {
  const state = useAsync(() => ratingsApi.detail(userId), [userId]);
  return state.loading ? (
    <p>{tr("جارٍ تحميل بطاقة التقييم…")}</p>
  ) : state.error ? (
    <p role="alert">{state.error.message}</p>
  ) : (
    <Form key={userId} data={state.data} onDone={onDone} onClose={onClose} />
  );
}
function Form({ data, onDone, onClose }) {
  const [expectedRev] = useState(data.current?.rev || 0);
  const [scores, setScores] = useState(data.current?.scores || {});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const toast = useToast();
  const validation = validateScorecard(scores);
  const completed = Object.values(scores).filter(
    (x) => x !== "" && x !== null,
  ).length;
  async function save() {
    setBusy(true);
    setErr("");
    try {
      await ratingsApi.save({
        userId: data.user.id,
        month: data.month,
        scores,
        reason,
        expectedRev,
      });
      toast.success(tr("تم حفظ التقييم وتحديث الترتيب"));
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="rating-summary">
        <span>
          {tr("{month} · {done} / 15 بندًا", { month: data.month, done: completed })}
        </span>
        <strong>
          {Object.values(scores).reduce((n, v) => n + Number(v || 0), 0)}{" "}
          <small>/ 100</small>
        </strong>
      </div>
      <p className="hint">
        {tr("cat1–cat5: من 0 إلى 10. بقية البنود: من 0 إلى 5. اختر قيمة لكل بند؛ الحدود ثابتة.")}
      </p>
    <div className="scorecard-grid">
  {SCORECARD_CATEGORIES.map((category) => {
    const value = scores[category.id] ?? "";
    const empty = String(value).trim() === "";

    const invalid =
      empty ||
      !Number.isInteger(Number(value)) ||
      Number(value) < 0 ||
      Number(value) > category.max;

    const errorId = `score-error-${category.id}`;

    return (
      <label key={category.id} className="score-field">
        <span>
          {tr(category.label)} <small>/ {category.max}</small>
        </span>

        <input
          type="number"
          min={0}
          max={category.max}
          step={1}
          placeholder={`0–${category.max}`}
          value={value}
          disabled={data.locked}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) =>
            setScores((previous) => ({
              ...previous,
              [category.id]: event.target.value,
            }))
          }
        />

        {invalid && (
          <small id={errorId} className="rating-field-error">
            {empty
              ? tr("هذا البند مطلوب. أدخل عددًا من 0 إلى {max}.", { max: category.max })
              : tr("أدخل عددًا صحيحًا من 0 إلى {max} دون كسور.", { max: category.max })}
          </small>
        )}
      </label>
    );
  })}
</div>
      <label className="f">
  {tr("سبب التقييم أو التعديل — مطلوب")}

  <textarea
    value={reason}
    onChange={(event) => setReason(event.target.value)}
    disabled={data.locked}
    required
    maxLength={2000}
    rows={3}
    placeholder={tr("اكتب سبب التقييم...")}
    aria-invalid={!reason.trim()}
    aria-describedby={
      !reason.trim() ? "rating-reason-error" : undefined
    }
  />

  {!reason.trim() && (
    <small
      id="rating-reason-error"
      className="rating-field-error"
    >
      {tr("السبب مطلوب. اكتب سبب التقييم لتتمكن من الحفظ.")}
    </small>
  )}
</label>
      {data.history.length > 0 && (
        <details>
          <summary>{tr("سجل التعديلات ({n})", { n: data.history.length })}</summary>
          {data.history.map((h) => (
            <p key={h.id}>
              {tr("الإصدار {rev}", { rev: h.rev })} · {h.total}/100 · {h.actorName}
              <br />
              {h.reason}
            </p>
          ))}
        </details>
      )}
      {err && (
        <p role="alert" className="err">
          {err}
        </p>
      )}
      <DialogActions>
        <Button
          variant="primary"
          disabled={busy || data.locked || !validation.ok || !reason.trim()}
          onClick={save}
        >
          {tr("حفظ التقييم")}
        </Button>
        <Button onClick={onClose}>{tr("إلغاء")}</Button>
      </DialogActions>
    </>
  );
}
export default function AddPointsDialog({ preUserId, onDone, onClose }) {
  const state = useAsync(() => ratingsApi.targets(), []);
  const [id, setId] = useState(preUserId || "");
  return (
    <Dialog title={tr("بطاقة تقييم العضو")} onClose={onClose}>
      <label className="f">
        {tr("اختر الشخص")}
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">{tr("اختر شخصًا للتقييم")}</option>
          {[...(state.data || [])]
  .sort((a, b) => a.name.localeCompare(b.name, "ar"))
  .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {tr(CAMPUS[u.campus])} · {u.teamsLabel}
            </option>
          ))}
        </select>
      </label>
      {state.error && <p role="alert">{state.error.message}</p>}
      {id && <Editor key={id} userId={id} onDone={onDone} onClose={onClose} />}
    </Dialog>
  );
}
