// Wspólne style pól formularzy (AuthPage, dodawanie zawodnika, ...), żeby nie
// duplikować tych samych obiektów w każdym pliku. Wg standardu: pola 16 px (iOS nie
// powiększa strony przy fokusie), min. 46 px wysokości, etykieta ZAWSZE nad polem.
export const inputStyle = {
  width: "100%",
  minHeight: "var(--touch)",
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 16,
};

export const labelStyle = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--muted)",
  marginBottom: 4,
  display: "block",
};
