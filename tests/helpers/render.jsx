// Renderowanie ekranów aplikacji z prawdziwym AuthProvider i routerem, na atrapie bazy.
import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../src/lib/AuthContext.jsx";

export function renderWithApp(ui, { route = "/" } = {}) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </AuthProvider>
  );
}
