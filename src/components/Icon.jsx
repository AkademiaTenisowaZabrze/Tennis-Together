import { ICONS_A, ICONS_B } from "./icons.js";

/**
 * Ikona z zestawu aplikacji (patrz icons.js). Kolor z currentColor.
 * variant "A" = pełna bryła (domyślnie), "B" = kontur.
 * Bez `title` ikona jest ozdobna (aria-hidden); z `title` ma nazwę dla czytników ekranu.
 */
export function Icon({ name, size = 22, variant = "A", title, style, className }) {
  const d = (variant === "B" ? ICONS_B : ICONS_A)[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
      className={className}
      style={{ flexShrink: 0, ...style }}
    >
      {title && <title>{title}</title>}
      <path fillRule="evenodd" d={d} />
    </svg>
  );
}

/** Ikona w tekście: 16-18 px, wyrównana do linii bazowej. */
export function InlineIcon({ name, size = 17, style, ...rest }) {
  return <Icon name={name} size={size} className="inline-icon" style={style} {...rest} />;
}

/** Mini ikona aplikacji: miętowy kafelek z grafitowym znakiem (koncepcja C), używana na ekranie Start. */
export function TileIcon({ name, size = 40, tile = "#8EE3C8", fg = "#1F2933", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ flexShrink: 0, ...style }}>
      <rect width="24" height="24" rx="5.25" fill={tile} />
      <g transform="translate(4.56 4.56) scale(0.62)">
        <path fill={fg} fillRule="evenodd" d={ICONS_A[name]} />
      </g>
    </svg>
  );
}

/** Przyjmuje klucz ikony ("car") albo zwykły tekst/emoji i zwraca odpowiedni element (dla pól `icon` w komponentach). */
export function renderIcon(icon, size = 20) {
  return typeof icon === "string" && ICONS_A[icon] ? <Icon name={icon} size={size} /> : icon;
}

export const ICON_NAMES = Object.keys(ICONS_A);
