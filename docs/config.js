// Wspólna konfiguracja stron z docs/ — JEDYNE miejsce z adresem Supabase.
// Klucz "publishable" jest z definicji publiczny (RLS chroni dane, nie
// tajność klucza). Przy przeniesieniu projektu Supabase zmień tylko tutaj.
// Repozytorium (owner/repo) wyliczamy z adresu strony GitHub Pages
// (owner.github.io/repo), więc przeniesienie repo na inne konto nie wymaga
// żadnych zmian; stała niżej to tylko awaryjny fallback (np. podgląd lokalny).
(function () {
  var host = location.hostname;
  var repo = "pmesznik/Tennis-Together";
  if (host.endsWith(".github.io")) {
    var name = location.pathname.split("/")[1];
    if (name) repo = host.split(".")[0] + "/" + name;
  }
  window.TT_CONFIG = {
    supabaseUrl: "https://jrabxtiranllayerhutm.supabase.co",
    supabaseAnonKey: "sb_publishable_8-yxyMhoEEq-kHx2opU0Pg_QylogBur",
    repo: repo,
    apkUrl: "https://github.com/" + repo + "/releases/download/debug-latest/tennis-together-debug-latest.apk",
  };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("a[data-tt-apk]").forEach(function (a) {
      a.href = window.TT_CONFIG.apkUrl;
    });
  });
})();
