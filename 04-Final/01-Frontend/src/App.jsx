//app.jsx
import Activities from "./pages/Activities.jsx";
import { Suspense, lazy, useEffect } from "react";
import { AppDataProvider } from "./context/AppDataContext.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { DirectionProvider } from "./context/DirectionContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { USE_MOCK } from "./config.js";
import { homeFor } from "./lib/home.js";
import { isComingSoon } from "./lib/availability.js";
import ComingSoon from "./pages/ComingSoon.jsx";
import MyPointsLedger from "./pages/MyPointsLedger.jsx";
import GivePoints from "./pages/GivePoints.jsx";
import RealEvaluations from "./pages/organizer/RealEvaluations.jsx";
import AppShell from "./components/layout/AppShell.jsx";
import { Forbidden, NotFound, Skeleton } from "./components/ui/States.jsx";
import Login from "./pages/Login.jsx";
import Welcome from "./pages/Welcome.jsx";
import { BranchProvider } from "./context/BranchContext.jsx";
import { matchPath, navigate, usePath } from "./router/router.jsx";
import { ROUTES } from "./routes.jsx";
import MyPoints from "./pages/MyPoints.jsx";
import { INVITE_ROUTE } from "./lib/invitation.js";

// Real backend only: page opened from the Clerk invitation e-mail (loaded lazily, needs Clerk).
const AcceptInvitation = lazy(() => import("./clerk/AcceptInvitation.jsx"));


function Routes() {
  const { user, ready } = useAuth();
  const path = usePath();

  // Redirects (done in an effect, never during render).
  useEffect(() => {
    if (!ready) return;
    if (path === INVITE_ROUTE) return;
    if (!user && !["/", "/login", ""].includes(path))
      navigate("/login", { replace: true });
    else if (user && path === "/login")
      navigate(homeFor(user.role), { replace: true });
  }, [ready, user, path]);

  if (!ready)
    return (
      <div style={{ padding: 24 }}>
        <Skeleton />
      </div>
    );
  if (path === INVITE_ROUTE)
    return USE_MOCK ? <NotFound /> : <Suspense fallback={null}><AcceptInvitation /></Suspense>;
  if (path === "/" || path === "") return <Welcome />;
  if (!user) return path === "/login" ? <Login /> : null;
  if (path === "/" || path === "/login") return null;

  let hit = null;
  for (const r of ROUTES) {
    const params = matchPath(r.path, path);
    if (params) {
      hit = { r, params };
      break;
    }
  }
  let body;

if (isComingSoon(path, USE_MOCK)) {
  body = <ComingSoon />;
} else if (!USE_MOCK && path === "/my-points" && ["member", "manager"].includes(user.role)) {
  body = <MyPointsLedger />;
} else if (!USE_MOCK && path === "/give-points" && ["organizer", "manager"].includes(user.role)) {
  body = <GivePoints />;
} else if (!USE_MOCK && path === "/organizer/evals" && user.role === "organizer") {
  body = <RealEvaluations />;
} else if (path === "/activities") {
  body = <Activities />;
} else if (
  path === "/my-points" &&
  ["member", "manager"].includes(user.role)
) {
  body = <MyPoints />;
} else if (!hit) {
  body = <NotFound />;
}
  else if (!hit.r.roles.includes(user.role)) body = <Forbidden />;
  else {
    const Page = hit.r.element;
    body = <Page key={path} params={hit.params} />;
  }
  return <AppShell path={path}>{body}</AppShell>;
}

export default function App() {
  return (
    <ThemeProvider>
      <DirectionProvider>
      <ToastProvider>
        <AuthProvider>
          <AppDataProvider>
            <BranchProvider>
              <Routes />
            </BranchProvider>
          </AppDataProvider>
        </AuthProvider>
      </ToastProvider>
      </DirectionProvider>
    </ThemeProvider>
  );
}
