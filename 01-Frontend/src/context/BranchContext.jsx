import { createContext, useContext, useState } from "react";
import jenin from "../assets/branches/jenin.jpg";
import ramallah from "../assets/branches/ramallah.jpg";
import { useAuth } from "./AuthContext.jsx";
import { useEffect } from "react";


const Context = createContext(null);
export function BranchProvider({ children }) {
  const [branch, setBranch] = useState("jenin");
  const isWelcome =
  window.location.hash === "" ||
  window.location.hash === "#/";
  const { user } = useAuth();

const assignedBranch =
  user && user.role !== "organizer" && !isWelcome
    ? user.campus
    : null;
  return (
    <Context.Provider value={{ branch, setBranch }}>
      <div
        className="branch-backdrop"
        style={{
          backgroundImage: `url(${(assignedBranch || branch) === "jenin" ? jenin : ramallah})`,
        }}
      />
      {children}
    </Context.Provider>
  );
}
export const useBranch = () => useContext(Context);
export function BranchSwitcher() {
  const { branch, setBranch } = useBranch();
  return (
    <div className="branch-switch" aria-label="اختر الفرع">
      {[
        ["jenin", "جنين"],
        ["ramallah", "رام الله"],
      ].map(([id, name]) => (
        <button
          key={id}
          aria-pressed={branch === id}
          onClick={() => setBranch(id)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
