# Raporty handlowca

Aplikacja do telefonów handlowca. Działa lokalnie na komputerze, bez serwera i bez konta.

**Uruchomienie:** otwórz `index.html` w Chrome lub Edge (dwuklik).
Dane zapisują się w przeglądarce na tym komputerze (menu ☰ → „Zapisz kopię” robi plik zapasowy).

- Wczytywanie portfela z Excela (menu ☰): kolumny rozpoznawane po nagłówkach (Firma, Imię, Nazwisko, Telefon, Email, Miasto, Uwagi); pozostałe kolumny są zachowane.
- Dzwonisz w poniedziałki, środy, piątki. „Nie odebrał” = ponowny telefon za tydzień, maks. 6 prób, potem propozycja rezygnacji.
- „Nie zainteresowany” = propozycja rezygnacji (potwierdzasz albo wracasz do kolejki).
- Raport do Excela: arkusze „Rozmowy” i „Portfel”.

Zasady są w `logic.js` (`CONFIG`). Testy: `npm test`.
