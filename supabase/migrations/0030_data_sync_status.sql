-- Znacznik "kiedy ostatnio serwer sam zaktualizował dane" — pokazywany
-- użytkownikowi jako baner na Start ("Dane zaktualizowano dziś o HH:MM").
-- Bez tego apka nie miała jak odróżnić "dane są świeże, bo cron poszedł
-- godzinę temu" od "cron nie działał od tygodnia" — jeden wiersz na
-- źródło danych, nadpisywany przy każdym udanym uruchomieniu workflow.

create table data_sync_status (
  key text primary key, -- np. 'tournaments_otk', 'tournament_entries_pzt'
  last_synced_at timestamptz not null,
  last_count int
);

alter table data_sync_status enable row level security;

-- Tylko odczyt — zapisuje wyłącznie service_role (GitHub Actions), które
-- i tak omija RLS, więc nie potrzeba tu żadnej polityki insert/update.
create policy "Każdy zalogowany widzi status synchronizacji"
  on data_sync_status for select
  to authenticated
  using (true);
