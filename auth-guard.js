// auth-guard.js — blocks app pages unless real login created a session
(function () {
  const publicPages = ["index.html", "signup.html", "", "/"];
  const path = location.pathname.split("/").pop();
  if (publicPages.includes(path)) return;

  let session = null;
  try { session = JSON.parse(localStorage.getItem("mc_session_user") || "null"); } catch {}

  const badDemoIds = new Set(["pitch-user", "test-profile", "demo-manager-001", "demo-crew-001"]);
  const badDemoNames = new Set(["presentation demo", "test profile"]);
  const isDemoSession = session && (
    badDemoIds.has(String(session.id || "")) ||
    badDemoNames.has(String(session.name || "").toLowerCase()) ||
    String(session.id || "").startsWith("demo-")
  );

  if (!session || !session.id || !session.role || isDemoSession) {
    localStorage.removeItem("mc_session_user");
    location.href = "index.html";
  }
})();
