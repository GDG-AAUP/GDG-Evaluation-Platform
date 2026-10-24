import { useState } from "react";
import { ratingsApi } from "../services/ratings.js";
import { useAsync } from "../hooks/useAsync.js";
import { useToast } from "../context/ToastContext.jsx";
import { PageHeader, Card, Button } from "../components/ui/Primitives.jsx";
import { Async } from "../components/ui/States.jsx";
const blank = { title: "", body: "", status: "draft" };
export default function News() {
  const state = useAsync(() => ratingsApi.news(), []);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await ratingsApi.saveNews(form);
      setForm(blank);
      toast.success("تم حفظ الخبر");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="أخبار المجتمع"
        subtitle="الأخبار المنشورة تظهر تلقائيًا في صفحة الترحيب."
      />
      <Card>
        <form onSubmit={save}>
          <label className="f">
            عنوان الخبر
            <input
              required
              maxLength={160}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="f">
            نص الخبر
            <textarea
              required
              maxLength={3000}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
          <label className="f">
            الحالة
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="draft">مسودة</option>
              <option value="published">منشور</option>
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            حفظ الخبر
          </Button>{" "}
          <Button onClick={() => setForm(blank)}>خبر جديد</Button>
        </form>
      </Card>
      <Async state={state}>
        {(rows) =>
          rows.map((n) => (
            <Card key={n.id}>
              <h3>{n.title}</h3>
              <p>
                {n.status === "published" ? "منشور" : "مسودة"} · {n.date}
              </p>
              <Button onClick={() => setForm({ ...n })}>تعديل</Button>
            </Card>
          ))
        }
      </Async>
    </>
  );
}
