// Break orders (breaks.html) — flat food illustrations (80×80 SVG symbols).
// Built from small layer helpers so every burger stacks the same way. Drinks
// and shakes take their colour from the item's tint (currentColor).

const BUN = "#f0a64b";
const BUN_DARK = "#e0913a";
const BUN_LIGHT = "#f9cf8f";
const PATTY = "#6d3d1d";
const PATTY_LINE = "#8d5630";
const CHEESE = "#ffc933";
const LETTUCE = "#6fc04b";
const RED = "#da291c";
const RED_DARK = "#b51f14";
const GOLD = "#ffc72c";
const GOLD_DARK = "#eba90f";

const shadow = (w = 24) => `<ellipse cx="40" cy="71.5" rx="${w}" ry="3.4" fill="#3a2a10" opacity=".1"/>`;

const topBun = (y, h, color = BUN, seeds = true) => {
  const b = y + h;
  let out = `<path d="M13 ${b - 2.5}C13 ${y + h * 0.28} 25 ${y} 40 ${y}S67 ${y + h * 0.28} 67 ${b - 2.5}Q67 ${b} 64.5 ${b}H15.5Q13 ${b} 13 ${b - 2.5}Z" fill="${color}"/>`;
  out += `<path d="M21.5 ${y + h * 0.62}Q26 ${y + h * 0.2} 39 ${y + h * 0.16}" stroke="${color === BUN ? BUN_LIGHT : "#fff6e3"}" stroke-width="3.2" stroke-linecap="round" fill="none" opacity=".85"/>`;
  if (seeds) {
    const pts = [
      [31, 0.34, -25],
      [40, 0.24, 0],
      [49, 0.36, 22],
      [35, 0.58, -10],
      [45.5, 0.56, 14],
      [55, 0.62, 30],
      [26, 0.62, -30],
    ];
    out += `<g fill="#fff3d6">${pts.map(([x, f, r]) => `<ellipse cx="${x}" cy="${(y + h * f).toFixed(1)}" rx="1.7" ry="1.05" transform="rotate(${r} ${x} ${(y + h * f).toFixed(1)})"/>`).join("")}</g>`;
  }
  return out;
};

const bottomBun = (y, h = 11, color = BUN_DARK) =>
  `<path d="M14 ${y}H66V${y + h - 4.5}Q66 ${y + h} 61.5 ${y + h}H18.5Q14 ${y + h} 14 ${y + h - 4.5}Z" fill="${color}"/>`;

const midBun = (y, h = 7) => `<rect x="13.5" y="${y}" width="53" height="${h}" rx="${h / 2}" fill="${BUN}"/>`;

const patty = (y, h = 10) =>
  `<rect x="13" y="${y}" width="54" height="${h}" rx="${h / 2}" fill="${PATTY}"/>` +
  `<path d="M21 ${y + h * 0.45}h6M33 ${y + h * 0.62}h7M46 ${y + h * 0.4}h6M57 ${y + h * 0.6}h3" stroke="${PATTY_LINE}" stroke-width="1.8" stroke-linecap="round"/>`;

const cheese = (y) => `<path d="M14 ${y}h52v3h-5l-3 6-3-6h-6l-3.5 7-3.5-7h-8l-3 5-3-5h-5l-2.5 5-2.5-5h-4z" fill="${CHEESE}"/>`;

const lettuce = (y) => {
  let d = `M13 ${y}H67V${y + 3.2}`;
  const n = 12;
  const w = 54 / n;
  for (let i = 0; i < n; i += 1) d += `q${-w / 2} ${i % 2 ? 3.2 : 2.2} ${-w} 0`;
  return `<path d="${d}Z" fill="${LETTUCE}"/>`;
};

const chickenPatty = (y, h = 13) =>
  `<rect x="11" y="${y}" width="58" height="${h}" rx="${h / 2.2}" fill="#d4822a"/>` +
  `<g fill="#f0b457">${[
    [18, 0.3],
    [27, 0.7],
    [36, 0.35],
    [45, 0.72],
    [54, 0.3],
    [62, 0.66],
  ]
    .map(([x, f]) => `<circle cx="${x}" cy="${(y + h * f).toFixed(1)}" r="1.6"/>`)
    .join("")}</g>` +
  `<path d="M17 ${y + 3}h22" stroke="#f4c374" stroke-width="2.2" stroke-linecap="round"/>`;

const burgerArt = {
  burger: () => shadow() + bottomBun(55) + patty(45, 11) + cheese(43) + lettuce(40) + topBun(15, 27),
  bigmac: () =>
    shadow() + bottomBun(57, 10) + patty(48, 9) + cheese(47) + patty(31, 9) + midBun(39, 7) + lettuce(44) + lettuce(28) + topBun(8, 23),
  double: () => shadow() + bottomBun(55) + patty(46, 10) + cheese(44) + patty(35, 10) + cheese(33) + topBun(11, 25),
  chicken: () => shadow() + bottomBun(56) + chickenPatty(43, 14) + lettuce(40) + topBun(15, 27),
  fish: () =>
    shadow() +
    bottomBun(56, 10, "#efcf97") +
    `<rect x="17" y="44" width="46" height="13" rx="5" fill="#dfa35a"/><path d="M22 47.5h16" stroke="#f0c07f" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M27 42h26v3.5l-3 5-3-5h-6l-3 6-3-6h-5l-3 5z" fill="${CHEESE}"/>` +
    topBun(17, 26, "#f6dcaa", false),
};

const arches = (x, y, s = 1, color = GOLD, width = 3.2) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 14V7.5C0 2.2 2 0 4 0S8 2.5 9 7.5C10 2.5 12 0 14 0S18 2.2 18 7.5V14" fill="none" stroke="${color}" stroke-width="${width}"/>`;

const FOOD = {
  ...burgerArt,
  fries: () =>
    shadow(20) +
    `<g stroke="${GOLD_DARK}" stroke-width="1" fill="${GOLD}">` +
    [
      [24, 17, -12],
      [29.5, 11, -6],
      [35, 8, -2],
      [41, 7, 2],
      [46.5, 10, 6],
      [52, 14, 11],
      [32, 15, -3],
      [44, 13, 4],
    ]
      .map(([x, y, r]) => `<rect x="${x}" y="${y}" width="5.4" height="30" rx="1.2" transform="rotate(${r} ${x + 2.7} ${y + 30})"/>`)
      .join("") +
    `</g>` +
    `<path d="M17 30Q40 41 63 30L57.5 67Q57 70 54 70H26Q23 70 22.5 67Z" fill="${RED}"/>` +
    `<path d="M63 30L57.5 67Q57 70 54 70H50L56 34Q60 32.5 63 30Z" fill="${RED_DARK}" opacity=".55"/>` +
    arches(31, 47, 1, GOLD, 3.4),
  cup: () =>
    shadow(17) +
    `<rect x="41.5" y="4" width="4.6" height="20" rx="2" fill="currentColor" transform="rotate(14 43.8 22)"/>` +
    `<path d="M22 27H58L54 67.5Q53.7 70 51 70H29Q26.3 70 26 67.5Z" fill="#fff" stroke="#e2dccd" stroke-width="1.4"/>` +
    `<path d="M58 27L54 67.5Q53.7 70 51 70H48L52.5 27Z" fill="#ece8df"/>` +
    `<path d="M24.3 39H55.7L54.5 53H25.5Z" fill="currentColor"/>` +
    `<path d="M26 47.5Q33 42.5 40 47T54.5 46" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
    `<rect x="19" y="21" width="42" height="7.5" rx="3.75" fill="#f2efe6"/><path d="M28 21q12-7 24 0z" fill="#f7f5ee"/>`,
  bottle: () =>
    shadow(13) +
    `<rect x="35" y="7" width="10" height="7" rx="2" fill="currentColor"/>` +
    `<path d="M35.5 14h9v6c5 2.5 8 6.5 8 12v33.5c0 2.5-2 4.5-4.5 4.5h-16c-2.5 0-4.5-2-4.5-4.5V32c0-5.5 3-9.5 8-12z" fill="#e8f3fb" stroke="#e2dccd" stroke-width="1.4"/>` +
    `<path d="M27.5 38h25v17h-25z" fill="currentColor"/>` +
    `<path d="M31 25c-2 2-3 5-3 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none"/>` +
    `<path d="M31 45.5h18" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`,
  coffee: () =>
    shadow(16) +
    `<path d="M33 13c-3 3 3 5 0 9M42 11c-3 3 3 5 0 9" stroke="#cdc3b1" stroke-width="2.2" stroke-linecap="round" fill="none"/>` +
    `<path d="M23 29H57L53.5 67.5Q53.2 70 50.5 70H29.5Q26.8 70 26.5 67.5Z" fill="#fff" stroke="#e2dccd" stroke-width="1.4"/>` +
    `<path d="M57 29L53.5 67.5Q53.2 70 50.5 70H48L52 29Z" fill="#ece8df"/>` +
    `<path d="M24.6 42H55.4L54.3 56H25.7Z" fill="#8a5a33"/>` +
    arches(33, 45, 0.78, GOLD, 2.8) +
    `<rect x="20.5" y="24" width="39" height="7" rx="3.5" fill="#3b2f27"/><path d="M26 24q14-5 28 0z" fill="#4a3c32"/>`,
  mcflurry: () =>
    shadow(18) +
    `<rect x="46" y="5" width="4.8" height="30" rx="2.4" fill="#e3e3de" transform="rotate(18 48 30)"/>` +
    `<path d="M21 31q0-12 19-14 19 2 19 14z" fill="#fffaf0" stroke="#e2dccd" stroke-width="1.4"/>` +
    `<g fill="#3b2a22"><circle cx="31" cy="25" r="1.8"/><circle cx="38" cy="21.5" r="1.5"/><circle cx="46" cy="25.5" r="1.9"/><circle cx="35" cy="28" r="1.3"/><circle cx="52" cy="28" r="1.4"/></g>` +
    `<path d="M19 30H61L56 67.5Q55.7 70 53 70H27Q24.3 70 24 67.5Z" fill="#fff" stroke="#e2dccd" stroke-width="1.4"/>` +
    `<path d="M61 30L56 67.5Q55.7 70 53 70H50.5L56 30Z" fill="#ece8df"/>` +
    `<path d="M22.5 44Q31 36 40 44T58 42" stroke="#2c6fd1" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `<path d="M24.5 55Q32 49 40 55T56 53" stroke="${GOLD}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  shake: () =>
    shadow(15) +
    `<rect x="42" y="3" width="4.6" height="22" rx="2.3" fill="#e84a5f" transform="rotate(10 44 22)"/>` +
    `<path d="M26 22q14-12 28 0z" fill="#f4f1ea"/>` +
    `<path d="M24 26H56L52.5 67.5Q52.2 70 49.5 70H30.5Q27.8 70 27.5 67.5Z" fill="#fff" stroke="#e2dccd" stroke-width="1.4"/>` +
    `<path d="M56 26L52.5 67.5Q52.2 70 49.5 70H47L51.5 26Z" fill="#ece8df"/>` +
    `<path d="M25.5 38H54.5L53.4 52H26.6Z" fill="currentColor"/>` +
    `<rect x="22" y="21" width="36" height="6.5" rx="3.25" fill="#f2efe6"/>`,
  sundae: () =>
    shadow(16) +
    `<path d="M26 34q-2-14 14-16 16 2 14 16z" fill="#fffaf0"/><path d="M31 22q9-9 18 0" stroke="#fffaf0" stroke-width="6" stroke-linecap="round" fill="none"/>` +
    `<path d="M40 11c3 2 3 6 0 8" stroke="#fffaf0" stroke-width="5" stroke-linecap="round" fill="none"/>` +
    `<path d="M27 27q6 5 8 0t8 1 9-2l2 6H26z" fill="#b8671a"/>` +
    `<path d="M22 32H58L53 57Q52.5 60 49.5 60H30.5Q27.5 60 27 57Z" fill="#fdf7ea" stroke="#e8dfcd" stroke-width="1.5"/>` +
    `<path d="M24 38Q40 44 56 38" stroke="#b8671a" stroke-width="3" fill="none" opacity=".75"/>` +
    `<path d="M36 60h8v6h6v4H30v-4h6z" fill="#efe7d7"/>`,
  pie: () =>
    shadow(22) +
    `<rect x="16" y="20" width="48" height="26" rx="6" fill="#e7a54f" transform="rotate(-8 40 33)"/>` +
    `<g stroke="#c47a25" stroke-width="2.4" stroke-linecap="round" transform="rotate(-8 40 33)"><path d="M26 29l5 7M36 28l5 7M46 28l5 7"/></g>` +
    `<path d="M14 40H66L62 67.5Q61.6 70 59 70H21Q18.4 70 18 67.5Z" fill="${RED}"/>` +
    `<path d="M14 40H66L65.3 45H14.7Z" fill="${RED_DARK}"/>` +
    arches(31, 51, 1, GOLD, 3.2),
  cookie: () =>
    shadow(20) +
    `<circle cx="40" cy="42" r="25" fill="#d9a15b"/><circle cx="40" cy="42" r="25" fill="none" stroke="#c48a45" stroke-width="2"/>` +
    `<g fill="#5a3a22"><ellipse cx="31" cy="33" rx="3.4" ry="2.6"/><ellipse cx="47" cy="30" rx="2.8" ry="2.2"/><ellipse cx="50" cy="46" rx="3.4" ry="2.6"/><ellipse cx="36" cy="50" rx="3" ry="2.4"/><ellipse cx="27" cy="44" rx="2.4" ry="2"/><ellipse cx="42" cy="41" rx="2.2" ry="1.8"/><ellipse cx="44" cy="58" rx="2.4" ry="1.9"/></g>`,
  nuggets: () =>
    shadow(22) +
    `<g fill="#e7a23d"><path d="M22 34c-2-6 4-11 10-9s9 7 6 11-14 5-16-2z"/><path d="M38 28c1-6 9-8 13-4s3 11-3 12-11-2-10-8z"/><path d="M49 36c3-5 11-4 12 2s-4 10-9 8-5-6-3-10z"/><path d="M30 38c2-4 10-4 11 1s-3 9-8 8-5-5-3-9z"/></g>` +
    `<g fill="#c9801f"><circle cx="28" cy="31" r="1.3"/><circle cx="46" cy="29" r="1.3"/><circle cx="55" cy="40" r="1.3"/><circle cx="36" cy="42" r="1.2"/></g>` +
    `<path d="M15 40H65L61 67.5Q60.6 70 58 70H22Q19.4 70 19 67.5Z" fill="${GOLD}"/>` +
    `<path d="M65 40L61 67.5Q60.6 70 58 70H55L60 40Z" fill="${GOLD_DARK}" opacity=".6"/>` +
    `<path d="M16.2 47H63.8L62.9 53H17.1Z" fill="${RED}"/>`,
  dippers: () =>
    shadow(20) +
    `<g fill="#e3a049" stroke="#c9801f" stroke-width="1">` +
    [
      [25, 12, -14],
      [33, 9, -5],
      [41, 10, 5],
      [49, 13, 14],
    ]
      .map(([x, y, r]) => `<rect x="${x}" y="${y}" width="8" height="30" rx="3.5" transform="rotate(${r} ${x + 4} ${y + 30})"/>`)
      .join("") +
    `</g>` +
    `<path d="M17 36H63L59 67.5Q58.6 70 56 70H24Q21.4 70 21 67.5Z" fill="${RED}"/>` +
    `<path d="M63 36L59 67.5Q58.6 70 56 70H53L58.5 36Z" fill="${RED_DARK}" opacity=".55"/>` +
    arches(31, 49, 1, GOLD, 3.2),
  wrap: () =>
    shadow(20) +
    `<path d="M22 64L50 14q10 4 12 14L34 70z" fill="#f3d9a2"/>` +
    `<path d="M50 14q10 4 12 14" stroke="#e9c27d" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `<g fill="${LETTUCE}"><circle cx="50" cy="17" r="4"/><circle cx="57" cy="20" r="4"/></g><circle cx="53" cy="22" r="3.4" fill="#e7a23d"/><circle cx="59.5" cy="25" r="2.6" fill="#e8513c"/>` +
    `<path d="M36 36l12 5M31 46l12 5" stroke="#d9a860" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M16 55l22-6 8 21H26z" fill="#fff"/><path d="M16 55l22-6 2.3 6-23 6z" fill="${RED}"/>`,
  salad: () =>
    shadow(22) +
    `<g fill="${LETTUCE}"><circle cx="28" cy="36" r="9"/><circle cx="40" cy="31" r="10"/><circle cx="52" cy="36" r="9"/></g>` +
    `<g fill="#4fa134"><circle cx="34" cy="38" r="6"/><circle cx="47" cy="37" r="6"/></g>` +
    `<g fill="#e8513c"><circle cx="31" cy="32" r="3.8"/><circle cx="50" cy="30" r="3.4"/></g><circle cx="41" cy="36" r="3" fill="#f6e3a3"/>` +
    `<path d="M14 40H66Q64 64 44 66H36Q16 64 14 40Z" fill="#f4f1e8"/><path d="M14 40H66" stroke="#e2ddcf" stroke-width="2"/>`,
  carrot: () =>
    shadow(16) +
    `<g fill="#f28c28" stroke="#d8731a" stroke-width="1">` +
    [
      [28, 14, -10],
      [34, 11, -3],
      [40, 12, 4],
      [46, 15, 11],
    ]
      .map(([x, y, r]) => `<rect x="${x}" y="${y}" width="6" height="32" rx="3" transform="rotate(${r} ${x + 3} ${y + 32})"/>`)
      .join("") +
    `</g>` +
    `<path d="M22 38H58L55 67.5Q54.7 70 52 70H28Q25.3 70 25 67.5Z" fill="#e9f5e2" opacity=".95" stroke="#e2dccd" stroke-width="1.4"/>` +
    `<path d="M22 38H58" stroke="#b7d8a5" stroke-width="3"/><path d="M31 52h18" stroke="#5aa83a" stroke-width="3" stroke-linecap="round"/>`,
  fruit: () =>
    shadow(16) +
    `<path d="M22 30H58L55 67.5Q54.7 70 52 70H28Q25.3 70 25 67.5Z" fill="#eef7f0" stroke="#e2dccd" stroke-width="1.4"/>` +
    `<g><path d="M28 50a10 10 0 0 1 20 0z" fill="#fff4d8"/><path d="M28 50a10 10 0 0 1 20 0" stroke="#5aa83a" stroke-width="2.6" fill="none"/></g>` +
    `<g><path d="M36 60a9 9 0 0 1 18 0z" fill="#fff4d8"/><path d="M36 60a9 9 0 0 1 18 0" stroke="#d8392b" stroke-width="2.6" fill="none"/></g>` +
    `<path d="M22 30H58" stroke="#b7d8a5" stroke-width="3"/>`,
  muffin: () =>
    shadow(22) +
    `<rect x="15" y="54" width="50" height="11" rx="5.5" fill="#efd3a0"/>` +
    `<rect x="14" y="44" width="52" height="10" rx="5" fill="#8a4b27"/>` +
    `<path d="M13 40c6-5 48-5 54 0 2 3-2 5-4 5H17c-2 0-6-2-4-5z" fill="#fffdf6"/><ellipse cx="41" cy="40.5" rx="8" ry="3.4" fill="${CHEESE}"/>` +
    `<path d="M15 38c0-12 11-18 25-18s25 6 25 18z" fill="#f3d7a5"/>` +
    `<g fill="#fff8e8"><circle cx="28" cy="29" r="1"/><circle cx="36" cy="25" r="1"/><circle cx="45" cy="27" r="1"/><circle cx="53" cy="31" r="1"/><circle cx="33" cy="33" r="1"/><circle cx="48" cy="34" r="1"/></g>`,
  pancakes: () =>
    shadow(25) +
    `<ellipse cx="40" cy="64" rx="28" ry="5" fill="#f4f1e8" stroke="#e2ddcf" stroke-width="1.5"/>` +
    [52, 44, 36]
      .map(
        (y) =>
          `<rect x="15" y="${y}" width="50" height="10" rx="5" fill="#e3a452"/><path d="M19 ${y + 3}h26" stroke="#f1c27c" stroke-width="2" stroke-linecap="round"/>`,
      )
      .join("") +
    `<path d="M20 38q20-8 40 0v3c-3 0-3 7-6 7s-3-5-6-5-3 9-6 9-3-9-6-9-3 5-6 5-3-6-6-6z" fill="#9c5412" opacity=".85"/>` +
    `<rect x="34" y="28" width="12" height="8" rx="2" fill="#ffe7a1"/>`,
  hashbrown: () =>
    shadow(20) +
    `<ellipse cx="40" cy="36" rx="24" ry="17" fill="#e5a24a"/>` +
    `<g stroke="#c9801f" stroke-width="1.6" stroke-linecap="round"><path d="M26 30l6 3M36 27l6 3M46 30l6 3M30 39l6 3M42 38l6 3"/></g>` +
    `<path d="M14 42H66L62 67.5Q61.6 70 59 70H21Q18.4 70 18 67.5Z" fill="#fff" stroke="#e2dccd" stroke-width="1.4"/>` +
    `<path d="M14 42H66L65.3 47H14.7Z" fill="${RED}"/>` +
    arches(31, 52, 1, RED, 3),
  bag: () =>
    shadow(22) +
    `<path d="M31 18a9 9 0 0 1 18 0" stroke="#b58a52" stroke-width="3" fill="none"/>` +
    `<path d="M18 22H62L65 67.5Q65.2 70 62.5 70H17.5Q14.8 70 15 67.5Z" fill="#c99a5f"/>` +
    `<path d="M62 22L65 67.5Q65.2 70 62.5 70H58L58.5 22Z" fill="#b5864c"/>` +
    arches(28, 38, 1.35, GOLD, 4),
};

export const FOOD_IDS = Object.keys(FOOD);

// One hidden sprite per page; items reference it with <use>.
export function installFoodSprite() {
  if (document.getElementById("boFoodSprite")) return;
  const holder = document.createElement("div");
  holder.id = "boFoodSprite";
  holder.hidden = true;
  holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">${Object.entries(FOOD)
    .map(([id, draw]) => `<symbol id="bo-food-${id}" viewBox="0 0 80 80">${draw()}</symbol>`)
    .join("")}</svg>`;
  document.body.prepend(holder);
}

export const food = (name, tint = "", cls = "") =>
  `<svg class="bo-food ${cls}" viewBox="0 0 80 80" aria-hidden="true" focusable="false"${tint ? ` style="color:${tint}"` : ""}><use href="#bo-food-${FOOD[name] ? name : "burger"}"/></svg>`;
