import {
  managerRole,
  isoDate,
  weekDates,
  shiftMinutes,
  shiftEnd,
  durationLabel,
  escapeHTML as esc,
} from "./portal-core.js";
import {
  homeView,
  scheduleView,
  plannerView,
  teamView,
  availabilityView,
  rewardsView,
} from "./pages-views.js";
export function renderPage(page, c) {
  const {
    state,
    params,
    modules,
    icon,
    pill,
    heading,
    empty,
    url,
    currency,
    dateLabel,
    isManager,
    myShifts,
  } = c;
  // Home, schedule, availability, team, planner and McStars live in pages-views.js.
  const home = () => homeView(c);
  const schedule = () => scheduleView(c);
  // The learning hub and lesson player are rendered by training-ui.js once
  // the page's data is ready. These skeletons mirror their layout so the page
  // never flashes an older design while it loads.
  const training = () =>
    `<div class="tr-skeleton" role="status" aria-live="polite"><span class="sr-only">Loading your learning…</span><div class="tr-skel tr-skel-hero"></div><div class="tr-skel-row"><div class="tr-skel tr-skel-card"></div><div class="tr-skel tr-skel-card"></div></div><div class="tr-skel tr-skel-line"></div><div class="tr-skel-grid"><div class="tr-skel tr-skel-tile"></div><div class="tr-skel tr-skel-tile"></div><div class="tr-skel tr-skel-tile"></div></div></div>`;
  const modulePage = () =>
    `<div class="tr-skeleton" role="status" aria-live="polite"><span class="sr-only">Opening your lesson…</span><div class="tr-skel tr-skel-line short"></div><div class="tr-skel tr-skel-hero lesson"></div><div class="tr-skel tr-skel-line"></div><div class="tr-skel-row"><div class="tr-skel tr-skel-stage"></div><div class="tr-skel tr-skel-side"></div></div></div>`;
  const availability = () => availabilityView(c);
  const team = () => teamView(c);
  const manage = () => plannerView(c);
  const rewards = () => rewardsView(c);
  // McAssist is rendered by mcassist-ui.js once the page's data is ready. This
  // skeleton mirrors its layout so nothing jumps when the chat appears.
  const assistant = () =>
    `<div class="mca-page mca-skeleton" role="status" aria-live="polite"><header class="mca-hero"><div class="mca-hero-copy"><p class="mca-eyebrow">McAssist</p><h1>Getting McAssist ready…</h1><p class="mca-hero-sub">Loading your restaurant, rota and learning so McAssist can help.</p></div></header><div class="mca-shell"><div class="mca-library mca-skel-library" aria-hidden="true"><span class="mca-skel"></span><span class="mca-skel"></span><span class="mca-skel"></span></div><div class="mca-panel mca-panel-page mca-skel-panel" aria-hidden="true"><div class="mca-skel-row"><span class="mca-skel mca-skel-avatar"></span><span class="mca-skel mca-skel-bubble"></span></div><div class="mca-skel-row is-user"><span class="mca-skel mca-skel-bubble short"></span></div><div class="mca-skel-row"><span class="mca-skel mca-skel-avatar"></span><span class="mca-skel mca-skel-bubble"></span></div><span class="mca-skel mca-skel-composer"></span></div></div></div>`;
  // The waste counter is rendered by waste-page.js once the page loads.
  const waste = () =>
    `<div class="page-loading" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><p>Opening the waste counter…</p></div>`;
  return {
    home,
    schedule,
    training,
    module: modulePage,
    availability,
    team,
    manage,
    rewards,
    assistant,
    waste,
  }[page]();
}
