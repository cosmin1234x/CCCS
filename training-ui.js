// Learning hub (training.html) and module pages (module.html).
// Owned module: rendered into #content by portal-enhancements.js, which passes
// a shared "kit" of helpers (see createKit in portal-enhancements.js).
let kit;
const $ = (id) => document.getElementById(id);
const esc = (value) => kit.esc(value);
let updateLearning = null;

export function moduleVisibleForRole(module, role) {
  if (!Array.isArray(module.roles) || !module.roles.length) return true;
  return module.roles.includes(kit.normaliseRole(role));
}

export function renderTraining(data, k) {
  kit = k;
  const { preview, pageFor, normaliseRole } = kit;
  const content = $("content");
  if (!content) return;
  if (content.dataset.enhancedPage === "training") {
    updateLearning?.(data);
    return;
  }
  content.dataset.enhancedPage = "training";
  const allModules = (window.McModules?.modules || []).filter((m) =>
    moduleVisibleForRole(m, data.profile.role),
  );
  const categories = [
    ...new Set(allModules.map((m) => m.category || "Essentials")),
  ];
  const moduleUrl = (m) =>
    "/module.html?id=" +
    encodeURIComponent(m.id) +
    (preview ? "&preview=" + encodeURIComponent(preview) : "");
  content.innerHTML =
    '<div class="learning-page">' +
    '<header class="learning-heading"><div><div class="eyebrow">A LITTLE LEARNING. EVERY SHIFT.</div><h1>Your learning</h1><p>Build confidence, one skill at a time.</p></div><a class="learning-signoffs" href="' +
    pageFor("verification") +
    '">Station sign-offs <span aria-hidden="true">↗</span></a></header>' +
    '<section class="learning-next" id="learningNext" aria-label="Your next step"></section>' +
    '<section class="learning-library" aria-labelledby="libraryTitle"><div class="learning-library-head"><h2 id="libraryTitle">Your modules</h2><span id="learningCount" role="status"></span></div>' +
    '<div class="learning-filters"><label class="learning-search"><span class="sr-only">Search modules</span><input id="v2TrainingSearch" type="search" placeholder="Search a skill or station…" autocomplete="off"></label><label><span class="sr-only">Category</span><select id="learningCategory"><option value="">All categories</option>' +
    categories.map((c) => "<option>" + esc(c) + "</option>").join("") +
    "</select></label></div>" +
    '<div class="learning-status" aria-label="Filter by progress"><button type="button" data-status="all" aria-pressed="true">All modules</button><button type="button" data-status="todo" aria-pressed="false">To do</button><button type="button" data-status="done" aria-pressed="false">Completed</button></div>' +
    '<div id="v2LearningGrid" class="learning-list"></div><div class="learning-more"><button id="learningMore" class="btn light" type="button">Show more modules</button></div></section>' +
    '<p class="learning-footnote">Learning is a starting point. Practise with your Crew Trainer and follow your restaurant’s current guidance.</p></div>';
  let activeStatus = "all",
    limit = 6,
    currentData = data;
  const search = $("v2TrainingSearch"),
    category = $("learningCategory");
  const draw = () => {
    const done = (m) => Boolean(currentData.progress?.[m.id]?.completed);
    const completed = allModules.filter(done).length;
    const percent = allModules.length
      ? Math.round((completed / allModules.length) * 100)
      : 0;
    const next = allModules.find((m) => !done(m));
    $("learningNext").innerHTML =
      '<div class="learning-next-copy"><div class="eyebrow">' +
      (next ? "UP NEXT" : "NICE WORK") +
      "</div><h2>" +
      esc(next?.title || "You’re all caught up.") +
      "</h2><p>" +
      esc(
        next?.tagline || "Keep your skills fresh. Revisit any module below.",
      ) +
      "</p>" +
      (next
        ? '<a class="btn dark" href="' +
          moduleUrl(next) +
          '">Start learning <span aria-hidden="true">→</span></a><span class="learning-duration">' +
          esc(next.time) +
          "</span>"
        : "") +
      '</div><div class="learning-progress"><span class="learning-progress-number">' +
      completed +
      "<small> / " +
      allModules.length +
      '</small></span><b>modules completed</b><div class="progress" role="progressbar" aria-label="Learning progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      percent +
      '"><span style="width:' +
      percent +
      '%"></span></div><span>' +
      (percent === 100
        ? "Ready for your next challenge"
        : "Every step counts") +
      "</span></div>";
    const q = search.value.trim().toLowerCase();
    const filtered = allModules.filter(
      (m) =>
        (!category.value || (m.category || "Essentials") === category.value) &&
        (activeStatus === "all" || done(m) === (activeStatus === "done")) &&
        [m.title, m.tagline, m.category, m.station, ...(m.keywords || [])]
          .join(" ")
          .toLowerCase()
          .includes(q),
    );
    $("learningCount").textContent =
      filtered.length + (filtered.length === 1 ? " module" : " modules");
    $("v2LearningGrid").innerHTML = filtered.length
      ? filtered
          .slice(0, limit)
          .map(
            (m) =>
              '<a class="learning-row" href="' +
              moduleUrl(m) +
              '"><span class="learning-icon" aria-hidden="true">' +
              esc(m.icon || "✦") +
              '</span><span class="learning-row-copy"><small>' +
              esc(m.category || "Essentials") +
              "</small><strong>" +
              esc(m.title) +
              "</strong><span>" +
              esc(m.tagline) +
              '</span><span class="learning-row-meta">' +
              esc(m.time) +
              " · " +
              (done(m) ? "Completed ✓" : esc(m.level || "Ready to start")) +
              '</span></span><span class="learning-row-arrow" aria-hidden="true">↗</span></a>',
          )
          .join("")
      : '<div class="learning-empty"><h3>No modules found</h3><p>Try another keyword or reset your filters.</p><button class="btn light" id="learningReset" type="button">Reset filters</button></div>';
    $("learningMore").hidden = filtered.length <= limit;
    $("learningReset")?.addEventListener("click", () => {
      search.value = "";
      category.value = "";
      activeStatus = "all";
      limit = 6;
      updateButtons();
      draw();
      search.focus();
    });
  };
  const updateButtons = () =>
    content
      .querySelectorAll("[data-status]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.status === activeStatus),
        ),
      );
  search.addEventListener("input", () => {
    limit = 6;
    draw();
  });
  category.addEventListener("change", () => {
    limit = 6;
    draw();
  });
  content.querySelectorAll("[data-status]").forEach((b) =>
    b.addEventListener("click", () => {
      activeStatus = b.dataset.status;
      limit = 6;
      updateButtons();
      draw();
    }),
  );
  $("learningMore").addEventListener("click", () => {
    const previous = limit;
    limit += 6;
    draw();
    $("v2LearningGrid").children[previous]?.focus();
  });
  updateLearning = (fresh) => {
    currentData = fresh;
    draw();
  };
  draw();
}

// Module page takeover (module.html?id=…). Return true when this module has
// rendered the page; returning false leaves the legacy portal-pages.js markup.
export function renderModule(data, k) {
  kit = k;
  return false;
}
