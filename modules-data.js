// modules-data.js
// Single source of truth for modules used by training.js + wrapped.js

export const MODULES = [
  {
    id: "food_safety_basics",
    title: "Food Safety Basics",
    tag: "Food safety",
    level: 1,
    xp: 40,
    durationMins: 8,
    keywords: ["food safety", "hygiene", "contamination", "temps", "allergens", "uk"],
    summary: "Prevent contamination, follow time/temp rules, and protect customers (UK focus).",
    steps: [
      "Wash hands properly: warm water + soap, scrub all areas, dry fully.",
      "Avoid cross-contamination: separate raw vs ready-to-eat items and tools.",
      "Follow time/temp rules for holding, chilling, and reheating (use store logs).",
      "Clean-as-you-go: sanitise surfaces and tools using approved solution.",
      "Allergens: follow your store allergen process and prevent contact."
    ],
    doDont: {
      do: ["Change gloves between tasks", "Use separate tools for raw/cooked", "Use sanitiser correctly"],
      dont: ["Store raw above cooked", "Ignore allergen requests", "Reuse dirty cloths without sanitiser"]
    },
    checklist: [
      "I know the handwash steps",
      "I can explain cross-contamination",
      "I know how to use sanitiser correctly",
      "I take allergen requests seriously"
    ],
    quiz: [
      {
        q: "Best way to prevent cross-contamination?",
        options: ["Use same tools for speed", "Separate raw and ready-to-eat items + tools", "Only wipe surfaces at end"],
        answer: 1,
        explain: "Separation prevents bacteria/allergens spreading."
      },
      {
        q: "When should you change gloves?",
        options: ["Only if ripped", "Between tasks/foods", "Once per hour"],
        answer: 1,
        explain: "Change gloves between tasks to stop transferring bacteria/allergens."
      }
    ]
  },

  {
    id: "grill_station",
    title: "Grill Station – Core",
    tag: "Kitchen",
    level: 1,
    xp: 55,
    durationMins: 10,
    keywords: ["grill", "meat", "burger", "cook", "timers", "uk"],
    summary: "Cook safely, use timers, and keep quality consistent during rush.",
    steps: [
      "Pre-shift: confirm grill is ready, tools are clean, timers are working.",
      "Load patties evenly; don’t overcrowd.",
      "Use the correct cook cycle/timer every time (no guessing).",
      "Hold product correctly and rotate (first-in-first-out).",
      "Between rushes: quick scrape/clean using approved method."
    ],
    doDont: {
      do: ["Use timers every cook", "Call out product levels", "Rotate held product"],
      dont: ["Guess cook time", "Mix old/new without rotation", "Ignore holding rules"]
    },
    checklist: [
      "I can do pre-shift setup",
      "I use timers every cook",
      "I rotate held product properly",
      "I keep tools separated"
    ],
    quiz: [
      {
        q: "What prevents over/under cooking best?",
        options: ["Cook by eye", "Use timers consistently", "Flip early"],
        answer: 1,
        explain: "Timers remove guessing and keep results consistent."
      }
    ]
  },

  {
    id: "fryer_station",
    title: "Fry Station – Quality & Safety",
    tag: "Kitchen",
    level: 1,
    xp: 50,
    durationMins: 9,
    keywords: ["fryer", "fries", "oil", "timers", "burns", "uk"],
    summary: "Crisp fries, safe oil handling, and fast rhythm without burns.",
    steps: [
      "Check fryer is operating normally and baskets are safe to use.",
      "Use correct basket fill guideline to prevent soggy fries.",
      "Use the timer for every drop; shake as per store practice.",
      "Season consistently (if your store uses salting station).",
      "Hold correctly, rotate, and keep the station tidy."
    ],
    doDont: {
      do: ["Use timer every drop", "Keep area dry to prevent slips", "Rotate fries properly"],
      dont: ["Overfill baskets", "Rush and splash oil", "Serve fries out of quality window"]
    },
    checklist: [
      "I follow fill guidelines",
      "I use timers for every drop",
      "I understand holding/rotation",
      "I work safely around hot oil"
    ]
  },

  {
    id: "uk_build_big_mac",
    title: "Build – Big Mac (UK training)",
    tag: "Product build",
    level: 2,
    xp: 70,
    durationMins: 10,
    keywords: ["big mac", "build", "uk", "assemble", "sandwich"],
    summary: "Build a Big Mac cleanly and consistently using your store build card order.",
    steps: [
      "Prep area: clean hands/gloves, correct packaging ready.",
      "Use correct bun set and toast per store process.",
      "Apply correct sauce/condiment amounts (follow your build card).",
      "Add salad/pickles in the correct order for even coverage.",
      "Add patties using correct tools; keep the build neat and stable.",
      "Close, wrap/box, and present cleanly."
    ],
    doDont: {
      do: ["Follow build card order", "Keep ingredients centered", "Wipe spills immediately"],
      dont: ["Guess sauce amounts", "Over-stack and crush the build", "Cross-contaminate tools"]
    },
    checklist: [
      "I follow a consistent build order",
      "I keep portions consistent",
      "I package neatly"
    ],
    quiz: [
      {
        q: "What matters most for consistency on builds?",
        options: ["Going fast only", "Following build card order + portions", "Adding extra sauce automatically"],
        answer: 1,
        explain: "Order + correct portions = consistent results."
      }
    ]
  },

  {
    id: "drive_thru_speed",
    title: "Drive-thru – Speed & Clarity",
    tag: "Drive-thru",
    level: 2,
    xp: 60,
    durationMins: 10,
    keywords: ["drive thru", "drive-thru", "speed", "headset", "park", "uk"],
    summary: "Clear communication and fast workflow without mistakes.",
    steps: [
      "Speak clearly on headset and confirm key items/drinks.",
      "Use a calm pace; accuracy beats redoing orders.",
      "Use 'park' when needed per store process and manager guidance.",
      "Prep condiments/napkins while payment happens.",
      "Hand-off with a final confirmation."
    ],
    doDont: {
      do: ["Repeat key items", "Keep calm tone", "Prep while payment happens"],
      dont: ["Rush and mishear", "Forget final confirmation", "Skip park process"]
    },
    checklist: [
      "I speak clearly on headset",
      "I repeat the order back",
      "I understand when to park",
      "I confirm at hand-off"
    ]
  },

  {
    id: "customer_recovery",
    title: "Customer Recovery – Fixing Mistakes",
    tag: "Customer experience",
    level: 2,
    xp: 55,
    durationMins: 9,
    keywords: ["complaint", "refund", "apology", "replacement", "uk"],
    summary: "Own the issue, fix it fast, keep the customer calm.",
    steps: [
      "Listen without interrupting.",
      "Apologise and acknowledge the issue.",
      "Offer the correct fix (replace/remake/manager support).",
      "Thank them for telling you.",
      "Share the learning with the team."
    ],
    doDont: {
      do: ["Stay calm", "Fix quickly", "Ask manager if needed"],
      dont: ["Argue", "Blame the customer", "Delay the fix"]
    },
    checklist: [
      "I stay calm with complaints",
      "I follow apology + fix flow",
      "I can get help quickly"
    ]
  }
];

// For Wrapped (or anywhere) that wants a compact list:
export const MODULES_MIN = MODULES.map(m => ({
  id: m.id,
  title: m.title,
  tag: m.tag,
  xp: m.xp
}));
