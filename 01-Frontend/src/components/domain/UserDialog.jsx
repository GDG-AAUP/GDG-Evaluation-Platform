import { useState } from "react";
import { useAppData, usePolicies } from "../../context/AppDataContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { CAMPUS, ROLE_LABEL } from "../../lib/constants.js";
import { usersApi } from "../../services/index.js";
import { Dialog, DialogActions } from "../ui/Dialog.jsx";
import { Field, Select } from "../ui/Form.jsx";
import { Button } from "../ui/Primitives.jsx";

const genPassword = () => {
  const ch = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(
    { length: 8 },
    () => ch[Math.floor(Math.random() * ch.length)],
  ).join("");
};

/**
 * Add / edit a member, manager or organizer.
 * kind: 'member' | 'manager' | 'user' (organizer picks the role himself).
 * A Manager acting here is locked to "Member in my team".
 */
export default function UserDialog({
  user: x,
  kind = "member",
  onDone,
  onClose,
}) {
  const { user: me } = useAuth();
  const { meta } = useAppData();
  const { membersInMultipleTeams } = usePolicies();
  const toast = useToast();
  const isMgrActor = me.role === "manager";
  const fixedTeam = isMgrActor ? me.teams[0] : null;

  const [f, setF] = useState(() => ({
    name: x ? x.name : "",
    email: x ? x.email : "",
    campus: x ? x.campus : fixedTeam ? me.campus : "jenin",
    role: x ? x.role : kind === "manager" ? "manager" : "member",
    teams: x ? [...x.teams] : fixedTeam ? [fixedTeam] : [],
    password: "",
    photo: x?.photo || null,
  }));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k, v) => {
    setF((s) => ({ ...s, [k]: v }));
    setErr("");
  };
  const roleLocked = isMgrActor || kind !== "user" || (x && x.id === me.id);
  const campusTeams = (meta ? meta.teams : []).filter(
    (t) => t.campus === f.campus,
  );
  const multi = f.role === "manager" || membersInMultipleTeams;

  const changeCampus = (v) => setF((s) => ({ ...s, campus: v, teams: [] }));
  const changeRole = (v) => setF((s) => ({ ...s, role: v, teams: [] }));
  const toggleTeam = (id) =>
    set(
      "teams",
      f.teams.includes(id) ? f.teams.filter((t) => t !== id) : [...f.teams, id],
    );

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const body = {
        photo: f.photo,
        name: f.name,
        email: f.email,
        campus: f.campus,
        role: f.role,
        teams: f.role === "organizer" ? [] : f.teams,
      };
      if (x) await usersApi.updateUser(x.id, body);
      else await usersApi.createUser({ ...body, password: f.password });
      toast.success(x ? "تم حفظ التعديلات" : "تمت الإضافة");
      onDone && onDone();
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const title = x
    ? `تعديل بيانات ${f.role === "manager" ? "المدير" : "العضو"}`
    : f.role === "manager"
      ? "إضافة مدير"
      : "إضافة عضو";

  return (
    <Dialog title={title} onClose={onClose}>
      <PhotoInput
        value={f.photo}
        onChange={(v) => set("photo", v)}
        onError={setErr}
      />
      <Field label="الاسم الكامل">
        {(id) => (
          <input
            id={id}
            type="text"
            value={f.name}
            placeholder="مثال: سارة أحمد"
            onChange={(e) => set("name", e.target.value)}
          />
        )}
      </Field>
      <Field label="البريد الإلكتروني">
        {(id) => (
          <input
            id={id}
            type="email"
            dir="ltr"
            style={{ textAlign: "start" }}
            value={f.email}
            placeholder="name@gdg.ps"
            onChange={(e) => set("email", e.target.value)}
          />
        )}
      </Field>
      <div className="row2">
        <Field label="الحرم">
          {(id) => (
            <Select
              id={id}
              value={f.campus}
              disabled={!!fixedTeam}
              onChange={changeCampus}
              options={Object.entries(CAMPUS)}
            />
          )}
        </Field>
        <Field label="الدور">
          {(id) => (
            <Select
              id={id}
              value={f.role}
              disabled={roleLocked}
              onChange={changeRole}
              options={Object.entries(ROLE_LABEL).map(([v, l]) => [v, l])}
            />
          )}
        </Field>
      </div>
      <div className="f">
        <label>الفريق</label>
        {f.role === "organizer" ? (
          <p className="hint">المنظّم لا يتبع فريقًا محددًا.</p>
        ) : fixedTeam ? (
          <select disabled aria-label="الفريق">
            <option>
              {(campusTeams.find((t) => t.id === fixedTeam) || {}).name}
            </option>
          </select>
        ) : multi ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {campusTeams.map((t) => (
              <label
                key={t.id}
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  fontSize: 14,
                  color: "var(--tx)",
                }}
              >
                <input
                  type="checkbox"
                  checked={f.teams.includes(t.id)}
                  onChange={() => toggleTeam(t.id)}
                />
                {t.name}
              </label>
            ))}
          </div>
        ) : (
          <Select
            label="الفريق"
            value={f.teams[0] || ""}
            onChange={(v) => set("teams", v ? [v] : [])}
            options={[
              ["", "اختر الفريق"],
              ...campusTeams.map((t) => [t.id, t.name]),
            ]}
          />
        )}
      </div>
      {!x && (
        <Field label="كلمة مرور مؤقتة">
          {(id) => (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id={id}
                type="text"
                dir="ltr"
                style={{ textAlign: "start" }}
                placeholder="6 أحرف على الأقل"
                value={f.password}
                onChange={(e) => set("password", e.target.value)}
              />
              <Button onClick={() => set("password", genPassword())}>
                توليد
              </Button>
            </div>
          )}
        </Field>
      )}
      {fixedTeam && (
        <p className="hint">يُضاف العضو إلى فريقك فقط بدور Member.</p>
      )}
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
      <DialogActions>
        <Button variant="primary" onClick={save} disabled={busy}>
          {x ? "حفظ" : "إضافة"}
        </Button>
        <Button onClick={onClose}>إلغاء</Button>
      </DialogActions>
    </Dialog>
  );
}

function PhotoInput({ value, onChange, onError }) {
  const [working, setWorking] = useState(false);
  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5000000
    ) {
      onError("اختر صورة JPG أو PNG أو WebP أصغر من 5 ميغابايت.");
      return;
    }
    setWorking(true);
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 320;
      const ctx = canvas.getContext("2d");
      const size = Math.min(img.width, img.height);
      ctx.drawImage(
        img,
        (img.width - size) / 2,
        (img.height - size) / 2,
        size,
        size,
        0,
        0,
        320,
        320,
      );
      const data = canvas.toDataURL("image/jpeg", 0.75);
      if (data.length > 180000) throw Error("الصورة كبيرة؛ اختر صورة أبسط.");
      onChange(data);
    } catch (e) {
      onError(e.message || "تعذّر قراءة الصورة");
    } finally {
      URL.revokeObjectURL(url);
      setWorking(false);
    }
  }
  return (
    <div className="f">
      <label>
        صورة العضو
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={upload}
          disabled={working}
        />
      </label>
      {value && (
        <>
          <img className="photo-preview" src={value} alt="معاينة صورة العضو" />
          <Button onClick={() => onChange(null)}>إزالة الصورة</Button>
        </>
      )}
      {working && <p>جارٍ تجهيز الصورة…</p>}
    </div>
  );
}
