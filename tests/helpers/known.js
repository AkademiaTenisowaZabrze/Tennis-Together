// Znane, jeszcze niezałatane luki. Test opisuje ZACHOWANIE BEZPIECZNE i dziś
// zawodzi, dlatego jest oznaczony it.fails: pakiet przechodzi, a luka jest
// widoczna w raporcie. Gdy luka zostanie naprawiona, test zacznie przechodzić,
// Vitest zgłosi błąd "Expect test to fail", a Ty zamieniasz itKnown na it.
// Spis luk i ich opis: tests/KNOWN_ISSUES.md
//
// Podgląd prawdziwych błędów znanych luk (sprawdzenie, że zawodzą przez
// naruszoną asercję, a nie przez błąd w teście):
//   TT_SHOW_KNOWN=1 npx vitest run
import { it } from "vitest";

export function itKnown(id, name, fn, timeout) {
  if (process.env.TT_SHOW_KNOWN) return it(`[ZNANA LUKA ${id}] ${name}`, fn, timeout);
  return it.fails(`[ZNANA LUKA ${id}] ${name}`, fn, timeout);
}
