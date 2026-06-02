// auth-guard.js — blocks app pages unless real login created a session
(function () {
  const publicPages = ["index.html", "signup.html", "", "/"];
  const path = location.pathname.split("/").pop();
  if (publicPages.includes(path)) return;

  let session = null;
  try { session = JSON.parse(localStorage.getItem("mc_session_user") || "null"); } catch {}

  if (!session || !session.id || !session.role) {
    localStorage.removeItem("mc_session_user");
    location.href = "index.html";
  }
})();
