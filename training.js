const cleanNavCss = document.createElement("link");
cleanNavCss.rel = "stylesheet";
cleanNavCss.href = "nav-clean.css";
document.head.appendChild(cleanNavCss);

const moduleGrid = document.getElementById("moduleGrid");
const lessonSteps = document.getElementById("lessonSteps");
const doList = document.getElementById("doList");
const dontList = document.getElementById("dontList");
const playerTitle = document.getElementById("playerTitle");
const playerStatus = document.getElementById("playerStatus");

const modules = [
  {
    title: "Grill Station",
    steps: ["Turn on grill", "Cook meat properly", "Clean after use"],
    do: ["Wash hands", "Check temps"],
    dont: ["Touch raw meat after cooked", "Leave grill dirty"]
  },
  {
    title: "Fries Station",
    steps: ["Drop fries", "Salt evenly", "Serve fresh"],
    do: ["Use timer", "Keep area clean"],
    dont: ["Oversalt", "Reuse old fries"]
  }
];

function renderModules() {
  moduleGrid.innerHTML = "";

  modules.forEach((m, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.cursor = "pointer";

    card.innerHTML = `
      <strong>${m.title}</strong>
      <p style="font-size:0.8rem; color:#6b7280;">Click to open module</p>
    `;

    card.onclick = () => loadModule(i);
    moduleGrid.appendChild(card);
  });
}

function loadModule(index) {
  const m = modules[index];

  playerTitle.textContent = m.title;
  playerStatus.textContent = "In progress";

  lessonSteps.innerHTML = m.steps.map(s => `<li><span>${s}</span></li>`).join("");
  doList.innerHTML = m.do.map(s => `<li><span>${s}</span></li>`).join("");
  dontList.innerHTML = m.dont.map(s => `<li><span>${s}</span></li>`).join("");
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const tab = btn.dataset.tab;

    document.querySelectorAll(".tabPanel").forEach(p => {
      p.style.display = "none";
    });

    const panel = document.querySelector('[data-panel="' + tab + '"]');
    if (panel) panel.style.display = "block";
  });
});

renderModules();
