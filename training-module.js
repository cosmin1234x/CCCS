// training-module.js — renders individual training modules
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function getModuleId() {
    const params = new URLSearchParams(location.search);
    return params.get("id") || document.body.dataset.module || "first-shift";
  }

  function getProgress() {
    try { return JSON.parse(localStorage.getItem("mc_training_progress") || "{}"); } catch { return {}; }
  }

  function saveProgress(progress) {
    localStorage.setItem("mc_training_progress", JSON.stringify(progress));
  }

  function toast(msg) {
    if (window.McPitch?.toast) return window.McPitch.toast(msg);
    const t = $("toast");
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2200);
  }

  function markComplete(module) {
    const progress = getProgress();
    progress[module.id] = { completed: true, xp: module.xp, completedAt: Date.now() };
    saveProgress(progress);
    toast(`Completed ${module.title} +${module.xp} XP`);
    renderProgress(module);
    launchConfetti();
  }

  function renderProgress(module) {
    const progress = getProgress();
    const done = !!progress[module.id]?.completed;
    const label = $("moduleProgressLabel");
    const bar = $("moduleProgressBar");
    const btn = $("completeModuleBtn");
    if (label) label.textContent = done ? "Completed" : "In progress";
    if (bar) bar.style.width = done ? "100%" : "35%";
    if (btn) {
      btn.textContent = done ? "✅ Completed" : `Complete module +${module.xp} XP`;
      btn.disabled = done;
    }
  }

  function launchConfetti() {
    const layer = document.createElement("div");
    layer.className = "confetti-layer";
    layer.innerHTML = Array.from({ length: 26 }, (_, i) => `<span style="--x:${Math.random() * 100}vw;--d:${Math.random() * 1.5 + 1}s;--r:${Math.random() * 360}deg;">${["🍟","⭐","🍔","🎉","🥤"][i % 5]}</span>`).join("");
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2600);
  }

  function renderQuiz(module) {
    const box = $("quizBox");
    if (!box) return;
    box.innerHTML = module.quiz.map((q, qi) => `
      <article class="mini quiz-card">
        <h3>${qi + 1}. ${esc(q.q)}</h3>
        <div class="grid" style="margin-top:10px;gap:8px;">
          ${q.a.map((answer, ai) => `<button class="btn alt quiz-answer" type="button" data-q="${qi}" data-a="${ai}">${esc(answer)}</button>`).join("")}
        </div>
        <p class="muted quiz-result" id="quizResult${qi}" style="margin-top:8px;"></p>
      </article>
    `).join("");

    box.querySelectorAll(".quiz-answer").forEach((btn) => {
      btn.addEventListener("click", () => {
        const qi = Number(btn.dataset.q);
        const ai = Number(btn.dataset.a);
        const result = $(`quizResult${qi}`);
        const correct = module.quiz[qi].correct === ai;
        if (result) result.textContent = correct ? "✅ Correct — nice." : "❌ Not quite. Read the card again and try another answer.";
        btn.classList.toggle("correct-answer", correct);
        btn.classList.toggle("wrong-answer", !correct);
      });
    });
  }

  function renderModule() {
    const module = window.McModules.get(getModuleId());
    document.title = `McTraining - ${module.title}`;

    const title = $("moduleTitle");
    const tag = $("moduleTag");
    const hero = $("moduleHeroCopy");
    const icon = $("moduleIcon");
    const xp = $("moduleXp");
    const time = $("moduleTime");
    const level = $("moduleLevel");

    if (title) title.textContent = module.title;
    if (tag) tag.textContent = `${module.icon} ${module.level}`;
    if (hero) hero.textContent = module.tagline;
    if (icon) icon.textContent = module.icon;
    if (xp) xp.textContent = module.xp;
    if (time) time.textContent = module.time;
    if (level) level.textContent = module.level;

    const lesson = $("lessonSections");
    if (lesson) {
      lesson.innerHTML = module.sections.map((s, i) => `
        <article class="card module-step">
          <span class="pill">Step ${i + 1}</span>
          <h3>${esc(s.title)}</h3>
          <p class="muted">${esc(s.text)}</p>
        </article>
      `).join("");
    }

    const checklist = $("moduleChecklist");
    if (checklist) {
      checklist.innerHTML = module.checklist.map((item, i) => `<label class="mini row module-check"><input type="checkbox" data-check="${i}" style="width:auto;"> <span>${esc(item)}</span></label>`).join("");
      checklist.querySelectorAll("input").forEach((input) => {
        input.addEventListener("change", () => {
          const checked = checklist.querySelectorAll("input:checked").length;
          const total = checklist.querySelectorAll("input").length;
          const bar = $("checklistBar");
          if (bar) bar.style.width = `${Math.round((checked / total) * 100)}%`;
          if (checked === total) toast("Checklist complete ✅");
        });
      });
    }

    renderQuiz(module);
    renderProgress(module);
    $("completeModuleBtn")?.addEventListener("click", () => markComplete(module));
  }

  window.McTrainingModule = { renderModule };
})();
