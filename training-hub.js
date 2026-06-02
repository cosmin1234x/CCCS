// training-hub.js — animated training module cards
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function getProgress() {
    try { return JSON.parse(localStorage.getItem("mc_training_progress") || "{}"); } catch { return {}; }
  }

  function totalXp(progress) {
    return Object.values(progress).reduce((sum, p) => sum + Number(p?.xp || 0), 0);
  }

  function renderStats() {
    const progress = getProgress();
    const done = Object.keys(progress).filter((id) => progress[id]?.completed).length;
    const total = window.McModules.modules.length;
    const xp = totalXp(progress);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const statLevel = $("statLevel");
    const statXp = $("statXp");
    const statDone = $("statDone");
    const statPct = $("statPct");
    if (statLevel) statLevel.textContent = xp >= 350 ? "Pro" : xp >= 150 ? "Ready" : "Starter";
    if (statXp) statXp.textContent = xp;
    if (statDone) statDone.textContent = `${done}/${total}`;
    if (statPct) statPct.textContent = `${pct}%`;
  }

  function renderCards() {
    const box = $("trainingModules");
    if (!box || !window.McModules) return;
    const progress = getProgress();
    box.innerHTML = window.McModules.modules.map((m, i) => {
      const done = !!progress[m.id]?.completed;
      return `
        <article class="card training-module-card ${done ? "module-done" : ""}" style="animation-delay:${i * 0.06}s">
          <div class="between wrap">
            <div class="module-icon-bubble">${m.icon}</div>
            <span class="pill ${done ? "ok" : m.color}">${done ? "Completed" : m.level}</span>
          </div>
          <h3>${esc(m.title)}</h3>
          <p class="muted">${esc(m.tagline)}</p>
          <div class="progress" style="margin-top:12px"><div class="bar" style="width:${done ? 100 : 35}%"></div></div>
          <div class="between wrap" style="margin-top:12px">
            <span class="pill">⚡ ${m.xp} XP</span>
            <span class="pill">⏱️ ${m.time}</span>
          </div>
          <div class="hero-actions" style="margin-top:14px">
            <a class="btn" href="module.html?id=${m.id}">${done ? "Review" : "Start module"}</a>
            <button class="btn alt preview-module" data-id="${m.id}" type="button">Preview</button>
          </div>
        </article>
      `;
    }).join("");

    box.querySelectorAll(".preview-module").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = window.McModules.get(btn.dataset.id);
        const modal = $("modulePreviewModal");
        const title = $("previewTitle");
        const body = $("previewBody");
        const link = $("previewOpenLink");
        if (title) title.textContent = `${m.icon} ${m.title}`;
        if (body) body.innerHTML = `<p class="muted">${esc(m.tagline)}</p><div class="grid" style="margin-top:12px;">${m.sections.map((s) => `<div class="mini"><b>${esc(s.title)}</b><br><span class="muted">${esc(s.text)}</span></div>`).join("")}</div>`;
        if (link) link.href = `module.html?id=${m.id}`;
        if (modal) modal.classList.add("show");
      });
    });
  }

  function init() {
    renderStats();
    renderCards();
    $("closePreviewBtn")?.addEventListener("click", () => $("modulePreviewModal")?.classList.remove("show"));
    $("modulePreviewModal")?.addEventListener("click", (e) => {
      if (e.target.id === "modulePreviewModal") e.currentTarget.classList.remove("show");
    });
  }

  window.McTrainingHub = { init, renderCards, renderStats };
})();
