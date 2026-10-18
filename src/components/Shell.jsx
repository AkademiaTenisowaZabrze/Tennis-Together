import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { useLayer, closeLayersThen } from "../lib/layers.js";
import { THEME_MODES, THEME_LABELS } from "../lib/theme.js";
import { APP_VERSION } from "../lib/appVersion.js";
import appIcon from "../assets/app-icon.svg";
import atzLogo from "../assets/atz-logo.png";
import pztLogo from "../assets/pzt-logo.png";

// Szkielet aplikacji wg STANDARDU DESIGNU v1: czysty ekran (przycisk menu + akcja "＋" + pływający
// pasek zakładek), reszta w szufladzie. Układ i uzasadnienie: PLAN_NOWY_WYGLAD.md.

export const SITE_URL = import.meta.env.VITE_SITE_URL || "https://akademiatenisowazabrze.github.io/Tennis-Together";

// Ikony zakładek (linie 24x24, kolor dziedziczony z tekstu).
const ICON_PATHS = {
  home: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></>,
  trophy: <><path d="M8 21h8M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" /></>,
  car: <><path d="M5 16l1.5-5a2 2 0 0 1 1.9-1.4h7.2a2 2 0 0 1 1.9 1.4L19 16" /><rect x="3" y="16" width="18" height="4" rx="1.5" /><circle cx="7.5" cy="18" r="0.6" /><circle cx="16.5" cy="18" r="0.6" /></>,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
};

function TabIcon({ name }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

// Cztery cele pod kciukiem. "Wyjazdy" zbiera dawne zakładki Przejazdy, Noclegi i Moje wyjazdy.
export const TABS = [
  { to: "/", label: "Start", icon: "home", end: true },
  { to: "/turnieje", label: "Turnieje", icon: "trophy" },
  { to: "/wyjazdy", label: "Wyjazdy", icon: "car" },
  { to: "/wiadomosci", label: "Wiadomości", icon: "chat" },
];

// Gdy piszesz w polu, klawiatura ekranowa zajmuje pół ekranu: pasek zakładek chowamy, żeby nie zabierał reszty.
const TEXT_FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]), textarea, select';

function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onIn = (e) => e.target?.matches?.(TEXT_FIELD) && setTyping(true);
    const onOut = () => setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return typing;
}

export function FloatingTabs() {
  const typing = useTyping();
  return (
    <nav className={`tabs glass${typing ? " tabs-typing" : ""}`} aria-label="Główne zakładki">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "active" : "")}>
          <TabIcon name={t.icon} />
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

// Akcja "＋" jest tylko tam, gdzie ma sens: Start i Wyjazdy.
const showsPlus = (path) => path === "/" || path.startsWith("/wyjazdy");

export const QUICK_ACTIONS = [
  { id: "trip", icon: "🎾", label: "Dodaj wyjazd na turniej", to: "/turnieje" },
  { id: "offer", icon: "🚗", label: "Dodaj ofertę przejazdu", to: "/wyjazdy/przejazdy?dodaj=oferta" },
];

export function PlusButton() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const close = () => setOpen(false);
  useLayer(open, close);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && close();
    const onDown = (e) => wrap.current && !wrap.current.contains(e.target) && close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="fab-wrap" ref={wrap}>
      <button type="button" className="fab" aria-label="Dodaj" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ＋
      </button>
      {open && (
        <div className="popmenu glass" role="menu" aria-label="Dodaj">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              onClick={() => closeLayersThen(() => navigate(a.to))}
            >
              <span aria-hidden="true">{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopActions({ onMenu, menuOpen }) {
  const { pathname } = useLocation();
  return (
    <>
      <button type="button" id="menuBtn" className="menuBtn glass" aria-label="Menu" aria-expanded={menuOpen} aria-controls="drawer" onClick={onMenu}>
        <span className="bars" />
      </button>
      {showsPlus(pathname) && <PlusButton />}
    </>
  );
}

// Link wewnątrz szuflady: najpierw zamyka szufladę (i wpis historii), potem przechodzi.
function DrawerLink({ to, className, children }) {
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        closeLayersThen(() => navigate(to));
      }}
    >
      {children}
    </Link>
  );
}

const ROLE_LABELS = { parent: "Rodzic", guardian: "Opiekun", coach: "Trener / klub", player_adult: "Zawodnik" };

export function Drawer({ open, onClose, account, mode, setMode, signOut }) {
  const ref = useRef(null);
  useLayer(open, onClose);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Zamknięta szuflada nie jest dostępna dla klawiatury ani czytnika ekranu (inert).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [open]);

  // Przesunięcie palcem w lewo o więcej niż 80 px zamyka szufladę.
  const touchStart = useRef(null);
  const onTouchStart = (e) => (touchStart.current = e.touches[0].clientX);
  const onTouchEnd = (e) => {
    if (touchStart.current != null && touchStart.current - e.changedTouches[0].clientX > 80) onClose();
    touchStart.current = null;
  };

  const name = account?.full_name || "Moje konto";

  return (
    <>
      <div id="drawerScrim" className={open ? "open" : ""} hidden={!open} onClick={onClose} />
      <aside
        id="drawer"
        ref={ref}
        className={`glass ${open ? "open" : ""}`}
        aria-label="Menu"
        aria-hidden={!open}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="dr-head">
          <DrawerLink to="/profil" className="dr-account">
            <span className="avatar-circle" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{name}</strong>
              <small>
                {ROLE_LABELS[account?.role] ?? "Konto"}
                {account?.verified ? " · 🛡 Parent Verified" : ""}
              </small>
            </span>
          </DrawerLink>
          <button type="button" className="ico" aria-label="Zamknij menu" onClick={onClose}>✕</button>
        </div>

        <div className="dr-body">
          <div>
            <h5>Szybkie akcje</h5>
            <div className="tiles">
              {QUICK_ACTIONS.map((a) => (
                <DrawerLink key={a.id} to={a.to} className="tile">
                  <i aria-hidden="true">{a.icon}</i>
                  {a.label}
                </DrawerLink>
              ))}
            </div>
          </div>

          <div>
            <h5>Moje</h5>
            <DrawerLink to="/wyjazdy/moje" className="dr-link"><span className="ic" aria-hidden="true">🧳</span>Moje wyjazdy</DrawerLink>
            <DrawerLink to="/profil" className="dr-link"><span className="ic" aria-hidden="true">👤</span>Profil i zawodnicy</DrawerLink>
            {account?.role === "coach" && (
              <DrawerLink to="/klub" className="dr-link">
                <span className="ic" aria-hidden="true">🏆</span>Mój klub
              </DrawerLink>
            )}
          </div>

          <div>
            <h5>Pomoc</h5>
            <a className="dr-link" href={`${SITE_URL}/dokumentacja.html`} target="_blank" rel="noopener noreferrer"><span className="ic" aria-hidden="true">📖</span>Jak to działa</a>
            <a className="dr-link" href={`${SITE_URL}/testerzy.html`} target="_blank" rel="noopener noreferrer"><span className="ic" aria-hidden="true">🐞</span>Zgłoś błąd</a>
            <a className="dr-link" href={`${SITE_URL}/regulamin.html`} target="_blank" rel="noopener noreferrer"><span className="ic" aria-hidden="true">📄</span>Regulamin</a>
            <a className="dr-link" href={`${SITE_URL}/polityka-prywatnosci.html`} target="_blank" rel="noopener noreferrer"><span className="ic" aria-hidden="true">🔒</span>Polityka prywatności</a>
          </div>

          <div>
            <h5>Wygląd</h5>
            <div className="chips" role="group" aria-label="Motyw">
              {THEME_MODES.map((m) => (
                <button key={m} type="button" className={`chip ${mode === m ? "is-active" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {THEME_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <button type="button" className="btn-ghost btn-block" onClick={() => closeLayersThen(signOut)}>Wyloguj</button>
          </div>

          <div className="dr-foot">
            <img src={appIcon} alt="" width={28} height={28} style={{ borderRadius: 8 }} />
            <span>Tennis Together · wersja {APP_VERSION}</span>
            <span className="partners">
              <a href="https://www.akademiatenisowazabrze.pl/" target="_blank" rel="noopener noreferrer"><img src={atzLogo} alt="Akademia Tenisowa Zabrze" height={26} /></a>
              <a href="https://www.pzt.pl/" target="_blank" rel="noopener noreferrer"><img src={pztLogo} alt="Polski Związek Tenisowy" height={26} /></a>
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
