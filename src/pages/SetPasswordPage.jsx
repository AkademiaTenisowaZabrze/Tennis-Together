import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../lib/AuthContext.jsx";
import ErrorBox from "../components/ErrorBox.jsx";
import PasswordInput from "../components/PasswordInput.jsx";
import { labelStyle } from "../components/formStyles.js";

// Ekran po kliknięciu linku "resetuj hasło" z maila: Supabase loguje użytkownika
// tymczasową sesją odzyskiwania, a my prosimy o nowe hasło zanim wpuścimy do apki.
export default function SetPasswordPage() {
  const { finishRecovery } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Hasło musi mieć co najmniej 8 znaków.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(
        error.message?.includes("different from the old password")
          ? "Nowe hasło musi być inne niż poprzednie."
          : error.message || "Nie udało się ustawić hasła. Spróbuj ponownie."
      );
      return;
    }
    finishRecovery();
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 32, margin: 0 }}>🎾</p>
          <h1 style={{ margin: "4px 0 0" }}>Ustaw nowe hasło</h1>
        </div>
        <div className="glass-card">
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={labelStyle}>Nowe hasło (min. 8 znaków)</label>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} />
            </div>
            {error && <ErrorBox>{error}</ErrorBox>}
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Zapisuję…" : "Zapisz hasło"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
