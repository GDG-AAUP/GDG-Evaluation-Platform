import { tr } from "../i18n/index.js";
import { Link } from "../router/router.jsx";
import { Card } from "../components/ui/Primitives.jsx";
import { EmptyState } from "../components/ui/States.jsx";
import { homeFor } from "../lib/home.js";
import { useAuth } from "../context/AuthContext.jsx";

/** Shown (real backend only) for pages whose endpoints the backend has not built yet. */
export default function ComingSoon() {
  const { user } = useAuth();
  return (
    <Card>
      <EmptyState
        icon="history"
        title={tr("هذه الصفحة غير متاحة بعد مع الخادم الحقيقي")}
        text={tr("ستعمل فور جهوزية خدمتها في الباك إند.")}
        action={<Link to={homeFor(user.role)} className="btn btn-p">{tr("العودة إلى الصفحة الرئيسية")}</Link>}
      />
    </Card>
  );
}
