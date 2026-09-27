import { useEffect, useState } from "react";
import { useAuth } from "../lib/AuthContext.jsx";
import { usePlayers } from "../lib/usePlayers.js";
import { useTrips } from "../lib/useTrips.js";
import { useConsents } from "../lib/useConsents.js";
import { verifyPztLogin } from "../lib/usePztPlayerSearch.js";
import { supabase } from "../lib/supabase.js";
import ErrorBox from "../components/ErrorBox.jsx";
import { inputStyle, labelStyle } from "../components/formStyles.js";
import { APP_VERSION } from "../lib/appVersion.js";
import { useWebPush } from "../lib/useWebPush.js";

const ROLE_LABELS = {
  parent: "Rodzic",
  guardian: "Opiekun",
  coach: "Trener / klub",
  player_adult: "Zawodnik (16+)",
};

const CONSENT_TYPE_LABELS = {
  terms: "Regulamin",
  data_processing: "Przetwarzanie danych",
  contact_sharing: "Udostępnianie danych kontaktowych",
  host_family_stay: "Nocleg u innej rodziny",
};

const dateFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" });

const CATEGORIES = ["U10", "U12", "U14", "U16", "U18", "Senior"];

export default function ProfilePage() {
  const [view, setView] = useState("parent"); // "parent" | "player"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1>Profil</h1>

      {/* "Szybka zmiana widoku" z docs/UX_Branding_Tennis_Together.docx —
          rodzic jednym kliknięciem przełącza się między swoim profilem
          a profilem dziecka. */}
      <div className="segmented">
        <button className={view === "parent" ? "is-active" : ""} onClick={() => setView("parent")}>
          👤 Rodzic
        </button>
        <button className={view === "player" ? "is-active" : ""} onClick={() => setView("player")}>
          🎾 Zawodnik
        </button>
      </div>

      {view === "parent" ? <ParentProfile /> : <PlayerSection />}

      <p style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center", opacity: 0.6, margin: "8px 0 0" }}>
        Tennis Together — wersja {APP_VERSION}
      </p>
    </div>
  );
}

function ParentProfile() {
  const { account, user, signOut, updateAccount } = useAuth();
  const [editing, setEditing] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(null);
  const { consents, loading: consentsLoading } = useConsents(account?.id);
  const { trips } = useTrips(account?.id);
  const today = new Date().toISOString().slice(0, 10);
  const completedTrips = trips.filter((t) => t.tournaments?.starts_on && t.tournaments.starts_on < today).length;
  const displayName = account?.full_name || user?.email || "…";

  // Zdjęcie profilowe — opcjonalne, wyłącznie "żeby się rozpoznać" przy
  // spotkaniu (nie weryfikacja tożsamości, patrz 0019_avatars.sql). Stała
  // nazwa pliku per konto (upsert) + znacznik czasu w URL-u, żeby
  // przeglądarka po podmianie zdjęcia nie pokazywała starej wersji z cache.
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !account) return;
    setAvatarError(null);
    setAvatarBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${account.id}/avatar.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      setAvatarBusy(false);
      setAvatarError("Nie udało się wgrać zdjęcia. Spróbuj ponownie.");
      return;
    }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const { error } = await updateAccount({ avatar_url: `${pub.publicUrl}?t=${Date.now()}` });
    setAvatarBusy(false);
    if (error) setAvatarError("Zdjęcie wgrane, ale nie udało się zapisać w profilu.");
  };

  if (editing) {
    return (
      <EditParentForm
        account={account}
        updateAccount={updateAccount}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
          {account?.avatar_url ? (
            <img
              src={account.avatar_url}
              alt=""
              width={48}
              height={48}
              style={{ borderRadius: "50%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <div className="avatar-circle" style={{ width: 48, height: 48, fontSize: 16 }}>
              {displayName[0]?.toUpperCase()}
            </div>
          )}
          <label
            title="Zmień zdjęcie"
            style={{
              position: "absolute",
              bottom: -2,
              right: -2,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-card-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              cursor: avatarBusy ? "default" : "pointer",
            }}
          >
            📷
            <input
              type="file"
              accept="image/*"
              capture="user"
              onChange={handleAvatarChange}
              disabled={avatarBusy}
              style={{ display: "none" }}
            />
          </label>
        </div>
        <div>
          <p style={{ margin: 0, fontWeight: 700 }}>{displayName}</p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
            {account ? ROLE_LABELS[account.role] ?? account.role : "…"}
          </p>
          {account?.verified && <span className="badge-verified">🛡️ Parent Verified</span>}
        </div>
      </div>
      {avatarBusy && <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)" }}>Wgrywam zdjęcie…</p>}
      {avatarError && <ErrorBox>{avatarError}</ErrorBox>}
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)" }}>
        Zdjęcie jest opcjonalne — pomaga innym Cię rozpoznać przy spotkaniu, to nie jest weryfikacja tożsamości.
      </p>

      <div>
        <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--color-text-muted)" }}>E-mail</p>
        <p style={{ margin: 0 }}>{user?.email}</p>
      </div>

      {account?.phone && (
        <div>
          <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--color-text-muted)" }}>Telefon</p>
          <p style={{ margin: 0 }}>{account.phone}</p>
        </div>
      )}

      {(account?.city || account?.club_name) && (
        <div style={{ display: "flex", gap: 24 }}>
          {account?.city && <Field label="Miasto" value={account.city} />}
          {account?.club_name && <Field label="Klub / akademia" value={account.club_name} />}
        </div>
      )}

      <div>
        <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--color-text-muted)" }}>Zgody</p>
        {consentsLoading ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>Wczytywanie…</p>
        ) : consents.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
            Żadna zgoda nie została jeszcze udzielona.
          </p>
        ) : (
          consents.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4, gap: 8 }}>
              <span>
                {CONSENT_TYPE_LABELS[c.consent_type] ?? c.consent_type}
                {c.players?.first_name ? ` — ${c.players.first_name}` : ""}
              </span>
              <span className={`status-pill ${c.granted ? "ok" : "muted"}`}>
                {c.granted ? "udzielona" : "wycofana"} {dateFormatter.format(new Date(c.created_at))}
              </span>
            </div>
          ))
        )}
      </div>

      <div>
        <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--color-text-muted)" }}>Historia wyjazdów</p>
        <p style={{ margin: 0 }}>
          {completedTrips === 0
            ? "Brak jeszcze zakończonych wyjazdów."
            : `${completedTrips} ${completedTrips === 1 ? "zakończony wyjazd" : "zakończone wyjazdy"}`}
        </p>
      </div>

      <WebPushSection accountId={account?.id} />

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-ghost" onClick={() => setEditing(true)}>
          Edytuj profil
        </button>
        <button className="btn-ghost" onClick={signOut}>
          Wyloguj
        </button>
      </div>
    </div>
  );
}

function WebPushSection({ accountId }) {
  const { permission, busy, error, enable, available } = useWebPush(accountId);
  // W aplikacji na telefonie powiadomienia włączają się same, a w przeglądarce
  // bez skonfigurowanego Firebase (firebaseWebConfig.js) ta sekcja się nie pokazuje.
  if (!available) return null;
  return (
    <div>
      <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--color-text-muted)" }}>Powiadomienia w przeglądarce</p>
      {permission === "granted" ? (
        <p style={{ margin: 0, fontSize: 13 }}>Włączone. Dostaniesz powiadomienie o nowych ofertach na Twoje turnieje.</p>
      ) : permission === "denied" ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
          Zablokowane w ustawieniach przeglądarki. Odblokuj je przy ikonie kłódki obok adresu strony.
        </p>
      ) : (
        <button className="btn-ghost" onClick={enable} disabled={busy}>
          {busy ? "Włączam…" : "Włącz powiadomienia"}
        </button>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}

function EditParentForm({ account, updateAccount, onDone, onCancel }) {
  const [fullName, setFullName] = useState(account?.full_name ?? "");
  const [phone, setPhone] = useState(account?.phone ?? "");
  const [city, setCity] = useState(account?.city ?? "");
  const [clubName, setClubName] = useState(account?.club_name ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError("Imię i nazwisko nie może być puste.");
      return;
    }

    setBusy(true);
    const { error } = await updateAccount({
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      city: city.trim() || null,
      club_name: clubName.trim() || null,
    });
    setBusy(false);

    if (error) {
      setError(error.message || "Nie udało się zapisać zmian.");
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontWeight: 700 }}>Edytuj profil</p>

      <div>
        <label style={labelStyle}>Imię i nazwisko</label>
        <input style={inputStyle} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Telefon (opcjonalnie)</label>
        <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="np. 600 000 000" />
      </div>
      <div>
        <label style={labelStyle}>Miasto (opcjonalnie)</label>
        <input style={inputStyle} value={city} onChange={(e) => setCity(e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Klub / akademia (opcjonalnie)</label>
        <input style={inputStyle} value={clubName} onChange={(e) => setClubName(e.target.value)} />
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "Zapisuję…" : "Zapisz"}
        </button>
        <button className="btn-ghost" type="button" onClick={onCancel}>
          Anuluj
        </button>
      </div>
    </form>
  );
}

function PlayerSection() {
  const { account } = useAuth();
  const { players, loading, error, addPlayer, updatePlayer } = usePlayers(account?.id);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState("view"); // "view" | "add" | "edit"

  // Gdy lista się wczyta, domyślnie pokaż pierwszego zawodnika; gdy nikogo
  // jeszcze nie ma, od razu pokaż formularz dodawania zamiast pustej karty.
  useEffect(() => {
    if (loading) return;
    if (players.length === 0) {
      setMode("add");
      setSelectedId(null);
    } else if (!selectedId || !players.some((p) => p.id === selectedId)) {
      setSelectedId(players[0].id);
      setMode("view");
    }
  }, [players, loading, selectedId]);

  if (!account) {
    return <p style={{ color: "var(--color-text-muted)" }}>Wczytywanie konta…</p>;
  }

  if (loading) {
    return <p style={{ color: "var(--color-text-muted)" }}>Wczytywanie zawodników…</p>;
  }

  const selected = players.find((p) => p.id === selectedId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <ErrorBox>Nie udało się wczytać zawodników: {error}</ErrorBox>}

      {players.length > 0 && (
        <div className="chip-row">
          {players.map((p) => (
            <button
              key={p.id}
              className={`chip ${selectedId === p.id && mode !== "add" ? "is-active" : ""}`}
              onClick={() => {
                setSelectedId(p.id);
                setMode("view");
              }}
            >
              {p.first_name}
            </button>
          ))}
          <button className={`chip ${mode === "add" ? "is-active" : ""}`} onClick={() => setMode("add")}>
            + Dodaj zawodnika
          </button>
        </div>
      )}

      {mode === "add" ? (
        <PlayerForm
          onSubmit={addPlayer}
          onDone={(player) => {
            setSelectedId(player.id);
            setMode("view");
          }}
          onCancel={players.length > 0 ? () => setMode("view") : undefined}
          submitLabel="Dodaj zawodnika"
          busyLabel="Dodaję…"
          title="Dodaj zawodnika"
        />
      ) : mode === "edit" && selected ? (
        <PlayerForm
          initial={selected}
          onSubmit={(fields) => updatePlayer(selected.id, fields)}
          onDone={() => setMode("view")}
          onCancel={() => setMode("view")}
          submitLabel="Zapisz"
          busyLabel="Zapisuję…"
          title="Edytuj profil zawodnika"
        />
      ) : selected ? (
        <PlayerCard player={selected} onEdit={() => setMode("edit")} />
      ) : null}
    </div>
  );
}

function PlayerCard({ player: p, onEdit }) {
  return (
    <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="avatar-circle" style={{ width: 48, height: 48, fontSize: 16 }}>
          {p.first_name[0]?.toUpperCase()}
        </div>
        <div>
          <p style={{ margin: 0, fontWeight: 700 }}>
            {p.first_name} {p.last_name}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
            {p.category ? `${p.category} · ` : ""}rocznik {p.birth_year}
          </p>
        </div>
      </div>

      {p.pzt_verified && (
        <span className="badge-verified">🎾 Zweryfikowany zawodnik PZT ({p.pzt_login})</span>
      )}

      {p.club_name && <Field label="Klub / akademia" value={p.club_name} />}
      {p.city && <Field label="Miasto" value={p.city} />}
      {p.ranking_te != null && <Field label="Ranking Tennis Europe" value={`#${p.ranking_te}`} />}

      <button className="btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onEdit}>
        Edytuj profil zawodnika
      </button>
    </div>
  );
}

// Wspólny formularz dodawania i edycji zawodnika — te same pola, różni się
// tylko wartościami startowymi i etykietami.
function PlayerForm({ initial, onSubmit, onDone, onCancel, submitLabel, busyLabel, title }) {
  const { account } = useAuth();
  const [firstName, setFirstName] = useState(initial?.first_name ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? "");
  const [birthYear, setBirthYear] = useState(initial?.birth_year ?? "");
  const [category, setCategory] = useState(initial?.category ?? "U12");
  const [clubName, setClubName] = useState(initial?.club_name ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [pztLogin, setPztLogin] = useState(initial?.pzt_login ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Weryfikacja PZT (PLAN.md, "z kim ja właściwie jadę") — potwierdzona
  // TYLKO dla aktualnie wpisanych imienia/nazwiska/loginu. Zmiana
  // któregokolwiek z nich unieważnia wcześniejszą weryfikację, żeby nie
  // dało się np. zweryfikować loginem dziecka, a potem podmienić dane na
  // czyjeś inne bez ponownego sprawdzenia.
  const [pztCheck, setPztCheck] = useState(
    initial?.pzt_verified ? { status: "ok", pztName: null } : { status: "idle", pztName: null }
  );
  const invalidatePztCheck = () => setPztCheck({ status: "idle", pztName: null });

  const handleVerifyPzt = async () => {
    const login = pztLogin.trim();
    if (!login) return;
    setPztCheck({ status: "checking", pztName: null });
    try {
      const result = await verifyPztLogin(login, firstName.trim(), lastName.trim());
      if (!result.found) {
        setPztCheck({ status: "not-found", pztName: null });
      } else if (result.matches) {
        setPztCheck({ status: "ok", pztName: result.pztName });
      } else {
        setPztCheck({ status: "mismatch", pztName: result.pztName });
      }
    } catch {
      setPztCheck({ status: "error", pztName: null });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const year = Number(birthYear);
    if (!year || year < 1990 || year > new Date().getFullYear()) {
      setError("Podaj poprawny rok urodzenia.");
      return;
    }

    setBusy(true);
    const { data, error } = await onSubmit({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      birth_year: year,
      category,
      club_name: clubName.trim() || null,
      city: city.trim() || null,
      pzt_login: pztLogin.trim() || null,
      pzt_verified: pztCheck.status === "ok" && !!pztLogin.trim(),
      pzt_verified_at: pztCheck.status === "ok" && pztLogin.trim() ? new Date().toISOString() : null,
    });
    setBusy(false);

    if (error) {
      setError(error.message || "Nie udało się zapisać. Spróbuj ponownie.");
      return;
    }
    onDone(data);
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontWeight: 700 }}>{title}</p>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Imię</label>
          <input
            style={inputStyle}
            required
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              invalidatePztCheck();
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Nazwisko</label>
          <input
            style={inputStyle}
            required
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              invalidatePztCheck();
            }}
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Rok urodzenia</label>
        <input
          style={inputStyle}
          type="number"
          required
          min="1990"
          max={new Date().getFullYear()}
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
        />
      </div>

      <div>
        <label style={labelStyle}>Kategoria wiekowa</label>
        <div className="chip-row">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${category === c ? "is-active" : ""}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={labelStyle}>Klub / akademia (opcjonalnie)</label>
        <input style={inputStyle} value={clubName} onChange={(e) => setClubName(e.target.value)} />
      </div>

      <div>
        <label style={labelStyle}>Miasto (opcjonalnie)</label>
        <input style={inputStyle} value={city} onChange={(e) => setCity(e.target.value)} />
      </div>

      <div>
        <label style={labelStyle}>Login PZT (opcjonalnie — potwierdza, że to prawdziwy zawodnik)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={pztLogin}
            onChange={(e) => {
              setPztLogin(e.target.value);
              invalidatePztCheck();
            }}
            placeholder="np. BAZ2368226"
          />
          <button
            type="button"
            className="btn-ghost"
            onClick={handleVerifyPzt}
            disabled={!pztLogin.trim() || pztCheck.status === "checking"}
          >
            {pztCheck.status === "checking" ? "Sprawdzam…" : "Zweryfikuj"}
          </button>
        </div>
        {pztCheck.status === "ok" && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-verified)" }}>
            ✅ Zgadza się z PZT{pztCheck.pztName ? ` (${pztCheck.pztName})` : ""}.
          </p>
        )}
        {pztCheck.status === "mismatch" && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-secondary)" }}>
            ⚠️ Portal PZT ma pod tym loginem inne imię i nazwisko: „{pztCheck.pztName}". Sprawdź login.
          </p>
        )}
        {pztCheck.status === "not-found" && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-secondary)" }}>
            ⚠️ Nie znaleziono takiego loginu w bazie PZT.
          </p>
        )}
        {pztCheck.status === "error" && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
            Nie udało się połączyć z bazą PZT — spróbuj ponownie za chwilę.
          </p>
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" type="submit" disabled={busy || !account}>
          {busy ? busyLabel : submitLabel}
        </button>
        {onCancel && (
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Anuluj
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--color-text-muted)" }}>{label}</p>
      <p style={{ margin: 0 }}>{value}</p>
    </div>
  );
}
