// session-tools.js — proper Firebase logout for app pages
import { auth } from "./firebase-init.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

function wireLogout() {
  const oldBtn = document.getElementById("logoutBtn");
  if (!oldBtn || oldBtn.dataset.firebaseLogout === "1") return;

  const btn = oldBtn.cloneNode(true);
  btn.dataset.firebaseLogout = "1";
  oldBtn.replaceWith(btn);

  btn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.warn("Firebase sign out failed, clearing local session anyway", err);
    }
    localStorage.removeItem("mc_session_user");
    localStorage.removeItem("mc_chat_memory");
    window.location.href = "index.html";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireLogout);
} else {
  wireLogout();
}
