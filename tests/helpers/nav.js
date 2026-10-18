// Nawigacja w nowym szkielecie aplikacji: cztery zakładki na pasku, reszta w szufladzie menu.
import { screen, within } from "@testing-library/react";

export const tabsNav = () => screen.findByRole("navigation", { name: "Główne zakładki" });

export async function openDrawer(user) {
  await user.click(await screen.findByRole("button", { name: "Menu" }));
  return screen.findByRole("complementary", { name: "Menu", hidden: false });
}

// Przejście z szuflady do ekranu o danym linku (np. "Profil i zawodnicy").
export async function viaDrawer(user, linkName, heading) {
  const drawer = await openDrawer(user);
  await user.click(within(drawer).getByRole("link", { name: linkName }));
  if (heading) await screen.findByRole("heading", { name: heading });
}

export const goProfile = (user) => viaDrawer(user, /Profil i zawodnicy/, "Profil");
