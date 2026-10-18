import { NavLink, Outlet } from "react-router-dom";
import { Icon } from "../components/Icon.jsx";

// "Wyjazdy": jedno miejsce zamiast trzech osobnych zakładek (Przejazdy, Noclegi, Moje wyjazdy).
// Przełączanie to chipy; adres zostaje czytelny (/wyjazdy/przejazdy itd.), więc działa "wstecz"
// i można wkleić link. Stare adresy (/przejazdy, /noclegi, /moje-wyjazdy) przekierowuje App.jsx.
export const HUB_TABS = [
  { to: "przejazdy", label: "Przejazdy", icon: "car" },
  { to: "noclegi", label: "Noclegi", icon: "bed" },
  { to: "moje", label: "Moje wyjazdy", icon: "route" },
];

export default function TripsHub() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <nav className="chip-row" aria-label="Wyjazdy" style={{ paddingBottom: 0 }}>
        {HUB_TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `chip ${isActive ? "is-active" : ""}`} style={{ textDecoration: "none" }}>
            <Icon name={t.icon} size={18} />
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
