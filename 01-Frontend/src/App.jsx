//app.jsx
import Activities from "./pages/Activities.jsx";
import { useEffect } from "react";
import { AppDataProvider } from "./context/AppDataContext.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { HOME_BY_ROLE } from "./lib/constants.js";
import AppShell from "./components/layout/AppShell.jsx";
import { Forbidden, NotFound, Skeleton } from "./components/ui/States.jsx";
import Login from "./pages/Login.jsx";
import Welcome from "./pages/Welcome.jsx";
import { BranchProvider } from "./context/BranchContext.jsx";
import { matchPath, navigate, usePath } from "./router/router.jsx";
import { ROUTES } from "./routes.jsx";
import MyPoints from "./pages/MyPoints.jsx";


function Routes() {
  const { user, ready } = useAuth();
  const path = usePath();

  // Redirects (done in an effect, never during render).
  useEffect(() => {
    if (!ready) return;
    if (!user && !["/", "/login", ""].includes(path))
      navigate("/login", { replace: true });
    else if (user && path === "/login")
      navigate(HOME_BY_ROLE[user.role], { replace: true });
  }, [ready, user, path]);

  if (!ready)
    return (
      <div style={{ padding: 24 }}>
        <Skeleton />
      </div>
    );
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

if (path === "/activities") {
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
      <ToastProvider>
        <AuthProvider>
          <AppDataProvider>
            <BranchProvider>
              <Routes />
            </BranchProvider>
          </AppDataProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
