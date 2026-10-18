import { useCallback, useEffect, useRef, useState, createContext, useContext } from "react";
import { Icon, InlineIcon, TileIcon, renderIcon } from "./Icon.jsx";

// Komponenty bazowe nowego wyglądu (STANDARD DESIGNU v1, część 4).

/** Karta z ikoną i tytułem: <Section icon="user" title="Zawodnicy">…</Section> */
export function Section({ icon, title, children, ...rest }) {
  return (
    <section className="sec" {...rest}>
      {title && (
        <h2 className="sec-h" style={{ margin: "2px 0 8px" }}>
          {icon && (
            <span className="ic" aria-hidden="true">
              {renderIcon(icon)}
            </span>
          )}
          <span>{title}</span>
        </h2>
      )}
      {children}
    </section>
  );
}

const SECTIONS_KEY = "tennis-together-sections";

function readSections() {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY)) ?? {};
  } catch {
    return {};
  }
}

/**
 * Sekcja rozwijana (domyślnie zwinięta). `id` jest kluczem, pod którym zapamiętujemy
 * otwarcie lub zwinięcie, żeby użytkownik nie otwierał jej od nowa za każdym razem.
 */
export function Collapsible({ id, icon, title, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(() => {
    const saved = readSections();
    return id in saved ? Boolean(saved[id]) : defaultOpen;
  });
  const onToggle = (e) => {
    const next = e.currentTarget.open;
    setOpen(next);
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...readSections(), [id]: next }));
    } catch {
      // tryb prywatny: stan działa do końca sesji
    }
  };
  return (
    <details className="sec" data-sec={id} open={open} onToggle={onToggle}>
      <summary>
        {icon && (
          <span className="ic" aria-hidden="true">
            {renderIcon(icon)}
          </span>
        )}
        <span>
          {title}
          {summary && <span className="st">{summary}</span>}
        </span>
      </summary>
      <div className="sec-body">{children}</div>
    </details>
  );
}

/** Wiersz listy: nazwa + podpis, akcje po prawej (children). */
export function ListItem({ title, subtitle, children, ...rest }) {
  return (
    <div className="item" {...rest}>
      <div className="name">
        {title}
        {subtitle && <small>{subtitle}</small>}
      </div>
      {children}
    </div>
  );
}

/** Stan pusty: jedno zdanie i (opcjonalnie) następny krok. */
export function EmptyState({ icon = "route", children, action }) {
  return (
    <div className="empty">
      <div className="ic" aria-hidden="true">
        {renderIcon(icon)}
      </div>
      <p>{children}</p>
      {action}
    </div>
  );
}

// ── Powiadomienia (toast) ────────────────────────────────────────────────
const ToastContext = createContext(null);
export const TOAST_MS = 7000;

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((text, kind = "") => {
    clearTimeout(timer.current);
    setToast({ text, kind, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status" aria-live="polite" key={toast.id}>
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast("Zapisano", "ok")`: sukces/błąd tylko kolorem tekstu, bez ikon kolorowych. */
export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? (() => {});
}
