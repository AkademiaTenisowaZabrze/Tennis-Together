-- Zapis zgody na regulamin i politykę prywatności przy rejestracji (audyt bezpieczeństwa 2026-10-03, F22).
--
-- Tabela `consents` dotyczy zawodnika (player_id), a zgoda na regulamin jest zgodą konta, więc zapisujemy ją
-- w `accounts`: kiedy i której wersji dokumentów dotyczyła. Konta założone przed tą migracją mają NULL
-- (zgody nie zapisano); można je poprosić o akceptację przy następnym logowaniu.

alter table accounts
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

alter table accounts
  add constraint accounts_terms_version_length check (char_length(terms_version) <= 40) not valid;
