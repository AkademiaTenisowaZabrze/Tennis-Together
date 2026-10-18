import { useAccountRating } from "../lib/useRatings.js";
import { Icon, InlineIcon, TileIcon, renderIcon } from "./Icon.jsx";

// Tylko do wyświetlania — średnia ocena konta (patrz account_rating()
// w 0022_ratings.sql), jawnie publiczna, więc bezpieczna do pokazania
// PRZED dopasowaniem (np. na karcie oferty), nie tylko po spotkaniu.
export default function StarRating({ accountId }) {
  const { rating, loading } = useAccountRating(accountId);

  if (loading || !rating || !rating.count) return null;

  return (
    <span className="status-pill muted" title={`${rating.count} ${rating.count === 1 ? "ocena" : "ocen"}`}>
      <InlineIcon name="star" size={15} />{rating.avg_stars} ({rating.count})
    </span>
  );
}
