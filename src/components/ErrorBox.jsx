export default function ErrorBox({ children }) {
  // role="alert": czytnik ekranu odczyta błąd od razu; kolor nie jest jedynym nośnikiem informacji (tekst + ramka)
  return (
    <p
      role="alert"
      style={{
        margin: 0,
        fontSize: 13,
        color: "var(--err)",
        background: "color-mix(in srgb, var(--err) 11%, var(--surface))",
        border: "1px solid color-mix(in srgb, var(--err) 35%, transparent)",
        borderRadius: 12,
        padding: "8px 12px",
      }}
    >
      {children}
    </p>
  );
}
