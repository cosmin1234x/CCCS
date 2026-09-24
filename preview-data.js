// Sample restaurant used by preview mode (?preview=crew / ?preview=manager).
// Everything here lives in this browser tab only (sessionStorage). Preview
// mode never reads from or writes to Firebase.
import { weekDates } from "./portal-core.js";

export const PREVIEW_VERSION = 4;
const KEY = (role) => `mc_preview_v${PREVIEW_VERSION}_${role}`;
const DAY = 864e5;

const day = (start, end) => ({ available: true, start, end });
const off = { available: false, start: "", end: "" };

// Weekly patterns: index 0 = Monday … 6 = Sunday. [start, end, station, break]
const PEOPLE = [
  {
    id: "preview-self",
    name: "Cosmin Blidaru",
    email: "cosmin@example.com",
    hourlyRate: 12.6,
    stars: 12,
    badge: "Team player",
    verifiedStations: ["Fries", "Front Counter", "Drive-thru"],
    availability: {
      mon: day("16:00", "02:00"),
      tue: day("16:00", "02:00"),
      wed: off,
      thu: day("09:00", "23:00"),
      fri: day("16:00", "02:00"),
      sat: day("09:00", "02:00"),
      sun: day("10:00", "22:00"),
    },
    pattern: [
      ["16:30", "01:00", "Front Counter", 30],
      null,
      null,
      ["10:00", "18:00", "Drive-thru", 30],
      ["17:00", "01:00", "Fries", 30],
      ["16:30", "01:00", "Front Counter", 30],
      null,
    ],
    notes: "Confident on the till and headset. Ready to start grill training.",
  },
  {
    id: "preview-amelia",
    name: "Amelia Wilson",
    email: "amelia@example.com",
    role: "crewTrainer",
    hourlyRate: 13.1,
    stars: 18,
    badge: "Brilliant trainer",
    verifiedStations: [
      "Fries",
      "Grill",
      "Chicken & Fryer",
      "Front Counter",
      "Drive-thru",
      "Kitchen Assembly",
      "Breakfast",
    ],
    availability: {
      mon: day("06:00", "15:00"),
      tue: day("06:00", "15:00"),
      wed: day("06:00", "15:00"),
      thu: day("06:00", "15:00"),
      fri: day("06:00", "15:00"),
      sat: off,
      sun: day("07:00", "15:00"),
    },
    pattern: [
      ["06:00", "14:00", "Breakfast", 30],
      ["06:00", "14:00", "Grill", 30],
      ["07:00", "15:00", "Training", 30],
      ["06:00", "14:00", "Kitchen Assembly", 30],
      null,
      null,
      ["07:00", "15:00", "Chicken & Fryer", 30],
    ],
    notes: "Leads new-starter inductions on weekday mornings.",
  },
  {
    id: "preview-sophie",
    name: "Sophie Turner",
    email: "sophie@example.com",
    role: "manager",
    hourlyRate: 15.4,
    stars: 20,
    badge: "Shift leader",
    verifiedStations: [
      "Fries",
      "Grill",
      "Chicken & Fryer",
      "Front Counter",
      "Drive-thru",
      "Drinks & McCafé",
      "Kitchen Assembly",
      "Breakfast",
      "Dining Area",
    ],
    availability: {
      mon: day("06:00", "18:00"),
      tue: day("06:00", "18:00"),
      wed: day("06:00", "18:00"),
      thu: day("06:00", "18:00"),
      fri: day("06:00", "18:00"),
      sat: off,
      sun: off,
    },
    pattern: [
      ["08:00", "17:00", "Shift Lead", 45],
      ["08:00", "17:00", "Shift Lead", 45],
      ["09:00", "18:00", "Shift Lead", 45],
      null,
      ["07:00", "16:00", "Shift Lead", 45],
      null,
      null,
    ],
    notes: "",
  },
  {
    id: "preview-maya",
    name: "Maya Patel",
    email: "maya@example.com",
    hourlyRate: 12.6,
    stars: 9,
    badge: "Speedy service",
    verifiedStations: ["Front Counter", "Drinks & McCafé", "Drive-thru"],
    availability: {
      mon: day("07:00", "16:00"),
      tue: day("07:00", "16:00"),
      wed: day("07:00", "16:00"),
      thu: day("07:00", "16:00"),
      fri: day("07:00", "16:00"),
      sat: day("07:00", "16:00"),
      sun: off,
    },
    pattern: [
      null,
      ["07:00", "15:00", "Front Counter", 30],
      ["08:00", "16:00", "Drinks & McCafé", 30],
      ["07:00", "15:00", "Drive-thru", 30],
      null,
      ["08:00", "16:00", "Front Counter", 30],
      null,
    ],
    notes: "",
  },
  {
    id: "preview-ryan",
    name: "Ryan Davies",
    email: "ryan@example.com",
    hourlyRate: 12.21,
    stars: 5,
    badge: "",
    verifiedStations: ["Grill", "Kitchen Assembly"],
    availability: {
      mon: day("17:00", "23:30"),
      tue: day("17:00", "23:30"),
      wed: day("17:00", "23:30"),
      thu: day("17:00", "23:30"),
      fri: day("17:00", "23:30"),
      sat: day("10:00", "23:30"),
      sun: off,
    },
    pattern: [
      ["17:00", "23:00", "Grill", 20],
      null,
      ["17:00", "23:00", "Kitchen Assembly", 20],
      ["17:00", "23:00", "Grill", 20],
      null,
      ["12:00", "20:00", "Grill", 30],
      null,
    ],
    notes: "College Monday to Friday daytime.",
  },
  {
    id: "preview-tom",
    name: "Tom Evans",
    email: "tom@example.com",
    hourlyRate: 12.6,
    stars: 7,
    badge: "Early bird",
    verifiedStations: ["Fries", "Grill", "Breakfast"],
    requestedRole: "crewTrainer",
    roleRequestStatus: "pending",
    availability: {
      mon: off,
      tue: off,
      wed: off,
      thu: off,
      fri: day("16:00", "00:00"),
      sat: day("05:30", "22:00"),
      sun: day("05:30", "22:00"),
    },
    pattern: [
      null,
      null,
      null,
      null,
      ["16:00", "23:30", "Fries", 30],
      ["06:00", "14:00", "Breakfast", 30],
      ["06:00", "14:00", "Breakfast", 30],
    ],
    notes: "",
  },
  {
    id: "preview-ellie",
    name: "Ellie Roberts",
    email: "ellie@example.com",
    hourlyRate: 12.21,
    stars: 4,
    badge: "",
    verifiedStations: ["Dining Area", "Front Counter"],
    requestedRole: "crewTrainer",
    roleRequestStatus: "pending",
    availability: {
      mon: off,
      tue: off,
      wed: day("16:00", "22:00"),
      thu: off,
      fri: off,
      sat: day("08:00", "20:00"),
      sun: day("08:00", "20:00"),
    },
    pattern: [
      null,
      null,
      ["16:00", "22:00", "Dining Area", 20],
      null,
      null,
      ["11:00", "19:00", "Front Counter", 30],
      ["10:00", "18:00", "Dining Area", 30],
    ],
    notes: "",
  },
  {
    id: "preview-jordan",
    name: "Jordan Clarke",
    email: "jordan@example.com",
    hourlyRate: 12.21,
    stars: 2,
    badge: "New starter",
    verifiedStations: [],
    availability: {},
    pattern: [
      null,
      ["11:00", "17:00", "Training", 15],
      null,
      ["11:00", "17:00", "Fries", 15],
      null,
      null,
      null,
    ],
    notes: "Started two weeks ago. Shadowing on fries.",
  },
];

// Next week is left partly open so "Copy last week" has real work to do.
const NEXT_WEEK_KEEP = new Set([
  "preview-sophie",
  "preview-amelia",
  "preview-maya",
]);

const TEAM_PROGRESS = {
  "preview-amelia": [
    "first-shift",
    "food-safety",
    "allergens",
    "fries-station",
    "grill-station",
    "chicken-fryer",
    "kitchen-assembly",
    "breakfast",
    "front-counter",
    "drive-thru",
    "drinks-mccafe",
    "order-presenting",
    "trainer-coaching",
    "trainer-verification",
  ],
  "preview-sophie": [
    "first-shift",
    "food-safety",
    "allergens",
    "fries-station",
    "grill-station",
    "chicken-fryer",
    "kitchen-assembly",
    "breakfast",
    "front-counter",
    "drive-thru",
    "drinks-mccafe",
    "order-presenting",
    "dining-cleaning",
    "stock-waste",
    "customer-recovery",
    "delivery-orders",
    "manager-rush",
    "manager-shift-planning",
  ],
  "preview-maya": [
    "first-shift",
    "food-safety",
    "allergens",
    "front-counter",
    "drive-thru",
    "drinks-mccafe",
    "order-presenting",
    "customer-recovery",
    "delivery-orders",
  ],
  "preview-ryan": [
    "first-shift",
    "food-safety",
    "allergens",
    "grill-station",
    "kitchen-assembly",
  ],
  "preview-tom": [
    "first-shift",
    "food-safety",
    "allergens",
    "fries-station",
    "grill-station",
    "breakfast",
    "stock-waste",
  ],
  "preview-ellie": [
    "first-shift",
    "food-safety",
    "allergens",
    "dining-cleaning",
  ],
  "preview-jordan": ["first-shift", "food-safety"],
};

function signature(name, at) {
  return { name, typedName: name, signatureData: null, signedAt: at };
}

/** Builds a fresh sample restaurant for the requested preview role. */
export function buildPreviewData(role = "crew", now = new Date()) {
  const manager = role === "manager";
  const t = now.getTime();
  const weeks = [-1, 0, 1].map((offset) => weekDates(offset, now));
  const team = PEOPLE.map(({ pattern, ...person }) => ({
    ...person,
    role:
      person.id === "preview-self"
        ? manager
          ? "manager"
          : "crew"
        : person.role || "crew",
    storeId: "1170",
    storeName: "1170 · Hayle",
  }));
  const self = team[0];
  if (manager) {
    self.hourlyRate = 14.8;
    self.badge = "Store manager";
    self.verifiedStations = [
      ...self.verifiedStations,
      "Grill",
      "Kitchen Assembly",
    ];
  }

  let n = 0;
  const shifts = [];
  PEOPLE.forEach((person, index) => {
    weeks.forEach((dates, w) => {
      if (w === 2 && !NEXT_WEEK_KEEP.has(person.id)) {
        // Keep only the first two of Cosmin's next-week shifts.
        if (person.id !== "preview-self") return;
      }
      let kept = 0;
      person.pattern.forEach((slot, d) => {
        if (!slot) return;
        if (w === 2 && person.id === "preview-self" && kept >= 2) return;
        kept++;
        const [start, end, station, breakMinutes] = slot;
        shifts.push({
          id: `ps-${++n}`,
          userId: person.id,
          userName: person.name,
          role: team[index].role,
          date: dates[d],
          start,
          end,
          station:
            manager && person.id === "preview-self" && d === 4
              ? "Shift Lead"
              : station,
          breakMinutes,
          createdBy: "preview-sophie",
        });
      });
    });
  });

  const recognition = [
    [
      "preview-self",
      3,
      "Handled the Saturday drive-thru rush brilliantly.",
      2,
      "preview-sophie",
    ],
    [
      "preview-amelia",
      3,
      "Fantastic coaching session with the new starters.",
      3,
      "preview-sophie",
    ],
    ["preview-maya", 2, "Spotless front counter all shift.", 4, "preview-sophie"],
    [
      "preview-ryan",
      1,
      "Covered a late shift at short notice.",
      6,
      "preview-sophie",
    ],
    [
      "preview-self",
      2,
      "Great help showing Jordan the fries station.",
      9,
      "preview-sophie",
    ],
    ["preview-tom", 2, "Breakfast changeover done early.", 11, "preview-sophie"],
    ["preview-self", 1, "Always first to help a customer.", 16, "preview-amelia"],
  ].map(([userId, amount, note, daysAgo, by], i) => ({
    id: `pr-${i + 1}`,
    userId,
    userName: team.find((p) => p.id === userId).name,
    amount,
    note,
    createdBy: by,
    createdByName: team.find((p) => p.id === by).name,
    createdAt: t - daysAgo * DAY - i * 3600e3,
    source: "portal",
  }));

  const verification = (id, crewId, station, status, trainerSigned, daysAgo) => {
    const crew = team.find((p) => p.id === crewId);
    const created = t - daysAgo * DAY;
    return {
      id,
      storeId: "1170",
      crewId,
      crewName: crew.name,
      trainerId: "preview-amelia",
      trainerName: "Amelia Wilson",
      station,
      status,
      trainerSignature:
        status === "verified" || trainerSigned
          ? signature("Amelia Wilson", created + 3600e3)
          : null,
      crewSignature:
        status === "verified" ? signature(crew.name, created + 5400e3) : null,
      createdAt: created,
      completedAt: status === "verified" ? created + 5400e3 : null,
    };
  };
  const verifications = [
    verification("pv-jordan-fries", "preview-jordan", "Fries", "pending_signatures", true, 1),
    verification("pv-ellie-counter", "preview-ellie", "Front Counter", "pending_signatures", false, 2),
    verification("pv-maya-drinks", "preview-maya", "Drinks & McCafé", "verified", true, 12),
    verification("pv-ryan-grill", "preview-ryan", "Grill", "verified", true, 20),
  ];
  if (!manager) {
    verifications.unshift(
      verification("pv-self-grill", "preview-self", "Grill", "pending_signatures", true, 0),
    );
    verifications.push(
      verification("pv-self-drive", "preview-self", "Drive-thru", "verified", true, 24),
    );
  }

  const roleRequests = team
    .filter((p) => p.roleRequestStatus === "pending")
    .map((p, i) => ({
      id: p.id,
      uid: p.id,
      name: p.name,
      email: p.email,
      storeId: "1170",
      requestedRole: p.requestedRole,
      status: "pending",
      createdAt: t - (i + 1) * DAY,
    }));

  const doneAt = (i) => t - (30 - i * 3) * DAY;
  // The priority safety modules are left open so the learning hub has a
  // clear "start here" recommendation in the demo.
  const ownModules = [
    "first-shift",
    "fries-station",
    "front-counter",
    "drive-thru",
    "order-presenting",
    ...(manager ? ["manager-shift-planning"] : []),
  ];
  const progress = Object.fromEntries(
    ownModules.map((id, i) => [
      id,
      { completed: true, xp: 100, completedAt: doneAt(i) },
    ]),
  );

  // Crew accounts only ever see their own shifts, recognition and sign-offs.
  const visibleShifts = manager
    ? shifts
    : shifts.filter((s) => s.userId === self.id);
  return {
    version: PREVIEW_VERSION,
    weekStart: weekDates(0, now)[0],
    user: self,
    team: manager ? team : [],
    shifts: visibleShifts,
    progress,
    extras: {
      loaded: true,
      verifications: manager
        ? verifications
        : verifications.filter((v) => v.crewId === self.id),
      roleRequests: manager ? roleRequests : [],
      recognition: manager
        ? recognition
        : recognition.filter((r) => r.userId === self.id),
      teamProgress: manager ? TEAM_PROGRESS : {},
    },
  };
}

/** Saved preview state for this tab, or null when missing or out of date. */
export function loadPreviewState(role, now = new Date()) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY(role)) || "null");
    if (
      saved?.version === PREVIEW_VERSION &&
      saved.weekStart === weekDates(0, now)[0] &&
      saved.user?.id === "preview-self"
    )
      return saved;
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return null;
}

export function savePreviewState(role, state) {
  if (!role || !state?.user) return;
  try {
    sessionStorage.setItem(
      KEY(role),
      JSON.stringify({
        version: PREVIEW_VERSION,
        weekStart: weekDates(0)[0],
        user: state.user,
        team: state.team,
        shifts: state.shifts,
        progress: state.progress,
        extras: state.extras,
      }),
    );
  } catch {
    /* Preview still works for this page when storage is blocked. */
  }
}
