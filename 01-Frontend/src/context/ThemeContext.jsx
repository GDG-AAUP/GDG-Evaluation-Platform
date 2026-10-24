import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const Ctx = createContext(null);
const KEY = "gdg-theme-preference";

function readPreference() {
  try {
    const saved = localStorage.getItem(KEY);

    if (saved === "dark" || saved === "light") {
      return saved;
    }
  } catch {}

  return "system";
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readPreference);

  const [systemTheme, setSystemTheme] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
  );

  // Follow changes to the device's theme.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const update = () => {
      setSystemTheme(media.matches ? "dark" : "light");
    };

    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  const theme = preference === "system" ? systemTheme : preference;

  // Apply the selected theme.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  // Remember only an explicit user choice.
  useEffect(() => {
    try {
      if (preference === "system") {
        localStorage.removeItem(KEY);
      } else {
        localStorage.setItem(KEY, preference);
      }
    } catch {}
  }, [preference]);

  const toggle = useCallback(() => {
    setPreference((current) => {
      const active = current === "system" ? systemTheme : current;
      return active === "dark" ? "light" : "dark";
    });
  }, [systemTheme]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
