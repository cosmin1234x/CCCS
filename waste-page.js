// Waste counter page (waste.html), ported from the Hayle Waste Counter app.
// Owned module: rendered into #content by portal-enhancements.js, which passes
// a shared "kit" of helpers (see createKit in portal-enhancements.js).
let kit;
const $ = (id) => document.getElementById(id);

export async function renderWaste(data, k) {
  kit = k;
  const content = $("content");
  if (!content || content.dataset.enhancedPage === "waste") return;
  content.dataset.enhancedPage = "waste";
  content.innerHTML =
    '<section class="card"><h1>Waste</h1><p class="form-note">The waste counter is being set up.</p></section>';
}
