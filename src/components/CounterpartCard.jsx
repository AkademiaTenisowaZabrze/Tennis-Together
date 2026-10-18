import { useEffect, useState } from "react";
import { Icon, InlineIcon, TileIcon, renderIcon } from "./Icon.jsx";
import { supabase } from "../lib/supabase.js";
import StarRating from "./StarRating.jsx";

// Pokazuje imię i (jeśli dodane) zdjęcie drugiej strony zaakceptowanego
// przejazdu/noclegu — czysto pomocniczo, "żeby się rozpoznać", patrz
// 0019_avatars.sql. `match_profile()` po stronie bazy sam pilnuje, że
// zwraca dane TYLKO gdy naprawdę jest się stroną wspólnego, zaakceptowanego
// ustalenia — tu nie trzeba tego powtarzać.
export default function CounterpartCard({ accountId }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc("match_profile", { other_account_id: accountId })
      .then(({ data }) => {
        if (cancelled) return;
        setProfile(data?.[0] ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (loading || !profile) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {profile.avatar_url ? (
        <img
          src={profile.avatar_url}
          alt=""
          width={32}
          height={32}
          style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <div className="avatar-circle" style={{ width: 32, height: 32, fontSize: 13 }}>
          {profile.full_name?.[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      <span style={{ fontSize: 13, fontWeight: 600 }}>{profile.full_name ?? "Zawodnik"}</span>
      {profile.verified && <span title="Parent Verified"><Icon name="shield" size={16} style={{ verticalAlign: "-3px" }} /></span>}
      <StarRating accountId={accountId} />
    </div>
  );
}
