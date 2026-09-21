// module-data.js — shared training module content
// General learning support for the independent crew hub.
// Exact restaurant procedures, recipes, cook cycles, holding times and allergen processes
// must always come from current official restaurant guidance and a trained manager/trainer.
window.McModules = {
  modules: [
    {
      id: "first-shift",
      icon: "🧭",
      title: "First Shift Basics",
      tagline: "Know where to go, who to ask and how to start safely.",
      category: "Essentials",
      station: "All stations",
      keywords: ["first shift", "new starter", "basics", "help"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 80,
      level: "New starter",
      time: "8 min",
      sections: [
        { title: "Start with clarity", text: "Arrive ready, find your trainer or shift lead and confirm the station you are learning before you begin." },
        { title: "Do not guess", text: "If you are unsure about food safety, equipment, allergens, tills or a customer issue, stop and ask a trained person." },
        { title: "Accuracy before speed", text: "Build safe, correct habits first. Speed comes naturally once the process is familiar." }
      ],
      checklist: ["I know who my trainer or shift lead is", "I know my first station", "I know where to ask for help", "I understand that official store guidance takes priority"],
      quiz: [
        { q: "What should you do if you are unsure about a process?", a: ["Guess quickly", "Ask a trainer or manager", "Ignore it"], correct: 1 },
        { q: "What matters first for a new starter?", a: ["Accuracy and safety", "Being the fastest", "Never asking questions"], correct: 0 }
      ]
    },
    {
      id: "food-safety",
      icon: "🧼",
      title: "Food Safety & Hygiene",
      tagline: "The everyday habits that protect customers and the team.",
      category: "Safety",
      station: "All stations",
      keywords: ["food safety", "hygiene", "hands", "clean", "contamination"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 120,
      level: "Priority",
      time: "10 min",
      sections: [
        { title: "Hands and personal hygiene", text: "Wash hands at the required moments, keep uniform and hands clean and follow your restaurant's hygiene process every shift." },
        { title: "Prevent contamination", text: "Use the correct tools and separation for each task. Never move dirty equipment or food-contact items between tasks without following the cleaning process." },
        { title: "Clean as you go", text: "Deal with spills, dirty surfaces and clutter early so the station stays safe during busy periods." }
      ],
      checklist: ["I know when handwashing is required", "I keep food-contact tools correctly separated", "I report hygiene problems", "I clean as I go"],
      quiz: [
        { q: "What is the safest response when a food-safety step is unclear?", a: ["Carry on and guess", "Ask a trained person before continuing", "Skip the step"], correct: 1 },
        { q: "Why clean as you go?", a: ["To reduce hazards and keep the station ready", "Only for appearance", "It is optional during a shift"], correct: 0 }
      ]
    },
    {
      id: "allergens",
      icon: "⚠️",
      title: "Allergens & Customer Questions",
      tagline: "Never guess. Use the current approved allergen information.",
      category: "Safety",
      station: "All stations",
      keywords: ["allergen", "allergy", "cross contact", "customer safety"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 130,
      level: "Priority",
      time: "10 min",
      sections: [
        { title: "Treat every allergy request seriously", text: "Pause the normal flow and follow your restaurant's approved allergen process. Never promise that an item is allergen-free." },
        { title: "Use current information", text: "Ingredients and processes can change. Use the current approved allergen source and involve the trained person responsible on shift." },
        { title: "Prevent cross-contact", text: "Follow the restaurant process for clean hands, equipment and preparation. If you are unsure, stop and ask." }
      ],
      checklist: ["I never guess allergen information", "I know where the current allergen information is", "I know who to involve on shift", "I understand cross-contact matters"],
      quiz: [
        { q: "A customer asks whether a product is safe for their allergy. What should you do?", a: ["Promise it is safe", "Use approved allergen information and involve the trained person", "Guess from memory"], correct: 1 },
        { q: "Can a busy period justify skipping the allergen process?", a: ["Yes", "No", "Only for regular customers"], correct: 1 }
      ]
    },
    {
      id: "fries-station",
      icon: "🍟",
      title: "Fries Station",
      tagline: "Stay ahead of demand while keeping hot-oil safety first.",
      category: "Kitchen",
      station: "Fries",
      keywords: ["fries", "fry", "fryer", "oil", "timers", "salt"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 95,
      level: "Station skill",
      time: "9 min",
      sections: [
        { title: "Read demand early", text: "Watch orders and communicate before stock becomes low. Ask for help before the station falls behind." },
        { title: "Follow the station timer and quality process", text: "Use the current fryer controls, timers, basket guidance and holding process exactly as trained. Do not improvise times or quantities." },
        { title: "Respect hot oil", text: "Keep the area dry and clear, use the correct equipment and follow the approved response for any spill or equipment issue." }
      ],
      checklist: ["I communicate low stock early", "I use the correct station timers", "I keep the floor and station safe", "I follow the official fries station card"],
      quiz: [
        { q: "What should you do when demand starts rising?", a: ["Wait until you run out", "Communicate and prepare using the station process", "Ignore the screen"], correct: 1 },
        { q: "What comes before speed around a fryer?", a: ["Safety", "Bigger batches", "Skipping checks"], correct: 0 }
      ]
    },
    {
      id: "grill-station",
      icon: "🔥",
      title: "Grill & Beef Station",
      tagline: "Consistent product, clean tools and no guessing on cook cycles.",
      category: "Kitchen",
      station: "Grill",
      keywords: ["grill", "beef", "burger", "patties", "cook cycle"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 110,
      level: "Station skill",
      time: "11 min",
      sections: [
        { title: "Set the station before the rush", text: "Check that the work area, tools and equipment are ready and that the correct approved cook programmes are available." },
        { title: "Use the programmed cook cycle", text: "Load product as trained and use the exact equipment programme and timer. Never cook by eye or substitute a different cycle." },
        { title: "Hold, rotate and communicate", text: "Follow the current holding and rotation process, call product levels clearly and keep raw and cooked tools separated." }
      ],
      checklist: ["I know the grill setup check", "I use the approved cook programme every time", "I keep raw and cooked tools separated", "I communicate product levels"],
      quiz: [
        { q: "How should cook time be decided?", a: ["By eye", "By the approved equipment programme and station process", "By how busy the store is"], correct: 1 },
        { q: "Why keep tools separated?", a: ["To prevent contamination", "Only to look tidy", "It does not matter"], correct: 0 }
      ]
    },
    {
      id: "chicken-fryer",
      icon: "🍗",
      title: "Chicken & Fryer Station",
      tagline: "Safe handling, correct baskets and the approved cook programme.",
      category: "Kitchen",
      station: "Chicken & Fryer",
      keywords: ["chicken", "fryer", "nuggets", "selects", "oil", "baskets"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 115,
      level: "Station skill",
      time: "11 min",
      sections: [
        { title: "Use the correct product process", text: "Identify the product, basket and fryer position required by the current station guidance before dropping anything." },
        { title: "Programme, timer and handling", text: "Use the programmed cook cycle and approved handling method every time. Never shorten a cycle or guess when product is ready." },
        { title: "Protect the station", text: "Keep packaging, frozen product and the floor organised so the area stays safe. Escalate fryer faults immediately." }
      ],
      checklist: ["I can identify the correct basket/process", "I use the approved cook programme", "I keep the fryer area dry and clear", "I ask before handling an unfamiliar product"],
      quiz: [
        { q: "What should you do with an unfamiliar chicken product?", a: ["Use any similar cycle", "Check the station guidance or ask a trainer", "Guess based on size"], correct: 1 },
        { q: "Can you shorten a cook cycle to catch up during rush?", a: ["Yes", "No", "Only if the queue is long"], correct: 1 }
      ]
    },
    {
      id: "kitchen-assembly",
      icon: "🍔",
      title: "Kitchen Assembly & Builds",
      tagline: "Accurate builds, clean presentation and strong communication.",
      category: "Kitchen",
      station: "Kitchen Assembly",
      keywords: ["assembly", "line", "build", "burger", "wrap", "order accuracy"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 100,
      level: "Station skill",
      time: "10 min",
      sections: [
        { title: "Read the order before building", text: "Check the screen and customisations before starting. If a build is unfamiliar, use the current build card." },
        { title: "Consistent portions and order", text: "Follow the approved build sequence and portions instead of relying on memory when unsure." },
        { title: "Communicate gaps quickly", text: "Call for product or support early. A clear call is better than silently waiting while orders build up." }
      ],
      checklist: ["I read customisations first", "I use build cards when needed", "I keep the assembly area clean", "I communicate missing product early"],
      quiz: [
        { q: "What should you use for an unfamiliar build?", a: ["Guess", "The current build card", "A photo from memory"], correct: 1 },
        { q: "What should happen when a needed product is running low?", a: ["Say nothing", "Communicate early", "Cancel the order"], correct: 1 }
      ]
    },
    {
      id: "breakfast",
      icon: "🍳",
      title: "Breakfast Station Basics",
      tagline: "Different menu, same focus on safety, quality and accuracy.",
      category: "Kitchen",
      station: "Breakfast",
      keywords: ["breakfast", "muffin", "egg", "hash brown", "morning"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 100,
      level: "Station skill",
      time: "10 min",
      sections: [
        { title: "Know the breakfast setup", text: "Morning equipment and product flow can differ from the main menu. Confirm your station setup with the trainer before service." },
        { title: "Use the correct product programmes", text: "Follow the approved equipment settings, handling and build cards for each breakfast item." },
        { title: "Prepare for changeover", text: "Keep the station organised and follow manager direction for menu changeover, stock and cleaning." }
      ],
      checklist: ["I know my breakfast station setup", "I use the correct product guidance", "I keep builds accurate", "I follow changeover instructions"],
      quiz: [
        { q: "Breakfast product settings should come from where?", a: ["Guessing", "Approved station guidance", "Whatever is fastest"], correct: 1 },
        { q: "Who coordinates menu changeover?", a: ["The shift team under manager direction", "Nobody", "Customers"], correct: 0 }
      ]
    },
    {
      id: "front-counter",
      icon: "🧾",
      title: "Front Counter Service",
      tagline: "Friendly, accurate service without rushing the customer.",
      category: "Service",
      station: "Front Counter",
      keywords: ["front counter", "till", "orders", "customer", "payment"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 80,
      level: "Service skill",
      time: "8 min",
      sections: [
        { title: "Greet and listen", text: "A clear greeting and careful listening prevent many order mistakes before they happen." },
        { title: "Confirm important details", text: "Repeat customisations, drinks, sauces and anything unusual before finishing the order." },
        { title: "Know when to involve a manager", text: "Use manager support for refunds, difficult complaints, unusual payment issues and allergen questions according to store process." }
      ],
      checklist: ["I greet customers clearly", "I confirm key order details", "I stay calm when the queue grows", "I know when to call a manager"],
      quiz: [
        { q: "What helps prevent order mistakes?", a: ["Guessing", "Confirming details", "Rushing the customer"], correct: 1 },
        { q: "What should you do with an issue outside your training?", a: ["Make up a solution", "Ask the appropriate manager or trained person", "Ignore it"], correct: 1 }
      ]
    },
    {
      id: "drive-thru",
      icon: "🚗",
      title: "Drive-thru Order Taking",
      tagline: "Clear headset habits for speed and accuracy.",
      category: "Service",
      station: "Drive-thru",
      keywords: ["drive thru", "drive-thru", "headset", "order taking", "accuracy"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 95,
      level: "Station skill",
      time: "9 min",
      sections: [
        { title: "Speak clearly", text: "Use a calm pace and confirm key order details so both the customer and kitchen receive the right information." },
        { title: "Stay organised", text: "Follow the headset and till process you were trained on. Avoid taking on extra tasks beyond your current training level." },
        { title: "Escalate unusual requests", text: "If a request, complaint or allergy question is unclear, pause and get the right support rather than guessing." }
      ],
      checklist: ["I use a clear headset voice", "I confirm custom orders", "I keep the team updated", "I ask for help when a request is unclear"],
      quiz: [
        { q: "What should you do if you did not hear part of an order?", a: ["Guess", "Politely confirm it again", "Ignore it"], correct: 1 },
        { q: "Drive-thru speed depends most on what?", a: ["Clear teamwork and accuracy", "Talking as fast as possible", "Skipping confirmation"], correct: 0 }
      ]
    },
    {
      id: "drinks-mccafe",
      icon: "🥤",
      title: "Drinks & McCafé",
      tagline: "Correct cup, clean equipment and accurate hand-off.",
      category: "Service",
      station: "Drinks & McCafé",
      keywords: ["drinks", "mccafe", "coffee", "shake", "cup", "beverage"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 90,
      level: "Station skill",
      time: "9 min",
      sections: [
        { title: "Read the full drink order", text: "Check size, type and customisation before starting so remakes do not slow the hand-off." },
        { title: "Use the machine process", text: "Follow the current drink equipment prompts, cleaning process and product guidance. Do not bypass machine warnings." },
        { title: "Present accurately", text: "Match completed drinks to the correct order and keep lids, cups and the hand-off area organised." }
      ],
      checklist: ["I check size and customisation", "I follow equipment prompts", "I keep the area clean", "I match drinks to the right order"],
      quiz: [
        { q: "A machine shows a warning you do not recognise. What should you do?", a: ["Ignore it", "Ask a trained person and follow the equipment process", "Keep pressing buttons"], correct: 1 },
        { q: "What reduces drink remakes?", a: ["Checking the full order first", "Working from memory", "Making random sizes"], correct: 0 }
      ]
    },
    {
      id: "order-presenting",
      icon: "📦",
      title: "Order Assembly & Present",
      tagline: "One final accuracy check before the order reaches the customer.",
      category: "Service",
      station: "Present",
      keywords: ["present", "runner", "order assembly", "bag", "accuracy"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 85,
      level: "Service skill",
      time: "8 min",
      sections: [
        { title: "Work from the order", text: "Use the order display and the restaurant's assembly process instead of relying on memory." },
        { title: "Check before hand-off", text: "Confirm key items, drinks and special requests are matched to the correct order." },
        { title: "Keep the lane moving", text: "Communicate missing items early and use the approved waiting/parking process when directed." }
      ],
      checklist: ["I match items to the correct order", "I check special requests", "I communicate missing items", "I keep the hand-off area organised"],
      quiz: [
        { q: "What should drive order assembly?", a: ["The order display and store process", "Guessing", "Whichever bag is nearest"], correct: 0 },
        { q: "What should you do when an item is missing?", a: ["Hide it", "Communicate it early", "Send the order anyway"], correct: 1 }
      ]
    },
    {
      id: "dining-cleaning",
      icon: "🧹",
      title: "Dining Area, Cleaning & Safety",
      tagline: "A clean restaurant is part of the customer experience.",
      category: "Cleanliness",
      station: "Dining Area",
      keywords: ["lobby", "dining area", "cleaning", "spill", "bins", "toilets"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 80,
      level: "Core skill",
      time: "8 min",
      sections: [
        { title: "See hazards early", text: "Spills, damaged furniture, blocked routes and overflowing bins should be dealt with or reported quickly." },
        { title: "Use cleaning products correctly", text: "Use only the approved product and method for the task. Never mix chemicals or use an unlabelled product." },
        { title: "Reset the area", text: "Leave tables, floors, bins and customer areas ready for the next customer while keeping walkways clear." }
      ],
      checklist: ["I report hazards quickly", "I use approved cleaning products", "I keep walkways clear", "I wash hands after cleaning tasks when required"],
      quiz: [
        { q: "What should you do with an unknown cleaning chemical?", a: ["Use it anyway", "Ask and use only the approved labelled product", "Mix it with another cleaner"], correct: 1 },
        { q: "Why deal with spills quickly?", a: ["They can create slip and hygiene hazards", "Only because they look bad", "There is no reason"], correct: 0 }
      ]
    },
    {
      id: "stock-waste",
      icon: "📦",
      title: "Stock, Rotation & Waste",
      tagline: "Keep product organised and record waste accurately.",
      category: "Operations",
      station: "Stock",
      keywords: ["stock", "rotation", "fifo", "waste", "delivery", "labels"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 85,
      level: "Core skill",
      time: "9 min",
      sections: [
        { title: "Rotate correctly", text: "Follow your restaurant's date, label and rotation process so older in-date stock is used before newer stock." },
        { title: "Store product properly", text: "Return stock to the correct approved storage area and keep packaging protected from contamination." },
        { title: "Record waste honestly", text: "Use the restaurant waste process. Accurate waste records help managers understand stock and production." }
      ],
      checklist: ["I understand stock rotation", "I check labels and dates as trained", "I put stock in the correct area", "I record waste instead of hiding it"],
      quiz: [
        { q: "Why record waste accurately?", a: ["It helps stock and production decisions", "It is better to hide it", "It has no use"], correct: 0 },
        { q: "What should you do with a label or date you do not understand?", a: ["Guess", "Ask a trained person", "Remove it"], correct: 1 }
      ]
    },
    {
      id: "customer-recovery",
      icon: "💬",
      title: "Customer Recovery",
      tagline: "Listen, own the issue and get the right help quickly.",
      category: "Service",
      station: "Customer service",
      keywords: ["complaint", "customer recovery", "refund", "mistake", "replacement"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 90,
      level: "Service skill",
      time: "9 min",
      sections: [
        { title: "Listen first", text: "Let the customer explain the issue without arguing or interrupting. Confirm what has gone wrong." },
        { title: "Use the correct recovery route", text: "Follow the authority level and recovery options your restaurant has trained you to use. Involve a manager when required." },
        { title: "Close the loop", text: "Make sure the customer receives the agreed fix and share useful learning with the team." }
      ],
      checklist: ["I listen before responding", "I stay calm", "I know when manager approval is needed", "I confirm the issue is resolved"],
      quiz: [
        { q: "What is the first step with a complaint?", a: ["Argue", "Listen and understand the issue", "Blame another station"], correct: 1 },
        { q: "What if the requested fix is outside your authority?", a: ["Promise it anyway", "Get manager support", "Ignore the customer"], correct: 1 }
      ]
    },
    {
      id: "delivery-orders",
      icon: "🛵",
      title: "Delivery Order Handover",
      tagline: "Accurate, sealed and matched to the right collection.",
      category: "Service",
      station: "Delivery",
      keywords: ["delivery", "courier", "bag", "handover", "order number"],
      roles: ["crew", "crewTrainer", "manager"],
      xp: 75,
      level: "Service skill",
      time: "7 min",
      sections: [
        { title: "Match the order", text: "Use the restaurant delivery process to match the correct order number and items before handover." },
        { title: "Package as trained", text: "Follow the current packaging, sealing and drink handling process for delivery orders." },
        { title: "Keep collection organised", text: "Separate waiting orders clearly and resolve missing items before handover." }
      ],
      checklist: ["I match the order number", "I follow packaging guidance", "I keep drinks and bags organised", "I do not hand over an incomplete order"],
      quiz: [
        { q: "What should happen before a delivery handover?", a: ["Match the order using the approved process", "Guess which bag it is", "Give the nearest bag"], correct: 0 },
        { q: "What if an item is missing?", a: ["Hand over anyway", "Resolve it through the team process", "Hide the order"], correct: 1 }
      ]
    },
    {
      id: "trainer-coaching",
      icon: "🛡️",
      title: "Crew Trainer Coaching",
      tagline: "Teach clearly, watch the task and give useful feedback.",
      category: "Crew Trainer",
      station: "Training",
      keywords: ["crew trainer", "coach", "training", "feedback"],
      roles: ["crewTrainer"],
      xp: 130,
      level: "Crew Trainer",
      time: "12 min",
      sections: [
        { title: "Explain the why", text: "Show the process in manageable steps and explain the safety or quality reason behind important checks." },
        { title: "Watch real performance", text: "Let the Crew Member perform the task while you observe. Correct unsafe or incorrect habits before they become routine." },
        { title: "Give specific feedback", text: "Say what was done well, what needs changing and what the next practice goal is." }
      ],
      checklist: ["I demonstrate before expecting speed", "I observe the Crew Member doing the task", "I give specific feedback", "I escalate anything I am not authorised to teach"],
      quiz: [
        { q: "What proves someone can perform a station task?", a: ["They watched once", "You observe them doing it correctly", "They say they understand"], correct: 1 },
        { q: "Useful feedback should be", a: ["Specific and actionable", "Vague", "Only negative"], correct: 0 }
      ]
    },
    {
      id: "trainer-verification",
      icon: "✍️",
      title: "Station Verification & Sign-off",
      tagline: "Use the two-signature check only after real station coaching.",
      category: "Crew Trainer",
      station: "Training",
      keywords: ["verification", "sign", "crew trainer", "station sign off"],
      roles: ["crewTrainer"],
      xp: 140,
      level: "Crew Trainer",
      time: "10 min",
      sections: [
        { title: "Verification is not a shortcut", text: "A learning module alone does not prove station competence. Observe the Crew Member performing the station task in the real working environment." },
        { title: "Discuss the result together", text: "Confirm strengths, corrections and any follow-up practice before either person signs." },
        { title: "Two signatures are required", text: "The Crew Trainer signs only their own side and the Crew Member signs only their own side. Never sign on behalf of another person." }
      ],
      checklist: ["I observed the real station task", "I discussed feedback before sign-off", "I sign only my own side", "I know an unsigned check stays pending"],
      quiz: [
        { q: "Can a Crew Trainer sign for the Crew Member?", a: ["Yes", "No", "Only if busy"], correct: 1 },
        { q: "When should station verification happen?", a: ["After observing the task", "Before training begins", "Without seeing the station"], correct: 0 }
      ]
    },
    {
      id: "manager-rush",
      icon: "📈",
      title: "Manager Rush Planning",
      tagline: "Check coverage before peak pressure hits.",
      category: "Manager",
      station: "Shift leadership",
      keywords: ["manager", "rush", "peak", "coverage", "positions"],
      roles: ["manager"],
      xp: 140,
      level: "Manager",
      time: "12 min",
      sections: [
        { title: "Look ahead", text: "Review staffing, breaks, station capability and expected pressure before the peak begins." },
        { title: "Protect key positions", text: "Put trained people where the shift needs stability and make sure new starters have appropriate support." },
        { title: "Move people early", text: "Small early adjustments are usually easier than emergency moves once orders or queues are already building." }
      ],
      checklist: ["I reviewed the rota", "I know who is verified on key stations", "I planned break coverage", "I know where new starters need support"],
      quiz: [
        { q: "When is the best time to fix an obvious coverage gap?", a: ["Before peak", "After pressure is already severe", "Never"], correct: 0 },
        { q: "Station verification can help a manager understand what?", a: ["Who has documented station sign-offs", "Who is tallest", "Who arrived first"], correct: 0 }
      ]
    },
    {
      id: "manager-shift-planning",
      icon: "📅",
      title: "Manager Shift Planning",
      tagline: "Plan around availability, station skills and overlapping shifts.",
      category: "Manager",
      station: "Shift planning",
      keywords: ["manager", "schedule", "rota", "shift", "availability"],
      roles: ["manager"],
      xp: 130,
      level: "Manager",
      time: "11 min",
      sections: [
        { title: "Start with availability", text: "Use the team member's recorded availability as a planning constraint and speak to them when information is missing or unclear." },
        { title: "Check collisions and station needs", text: "Avoid overlapping shifts and consider documented station capability when deciding where people are most useful." },
        { title: "Publish clearly", text: "Use clear dates, start/end times, station assignments and break information so the team can understand the plan." }
      ],
      checklist: ["I checked availability", "I checked for overlapping shifts", "I considered verified stations", "I reviewed the shift before publishing"],
      quiz: [
        { q: "What should you do with missing availability?", a: ["Assume anything", "Check with the Crew Member", "Ignore it"], correct: 1 },
        { q: "What should happen before publishing a shift?", a: ["Check times, availability and conflicts", "Nothing", "Guess the station"], correct: 0 }
      ]
    }
  ],
  get(id) {
    return this.modules.find((m) => m.id === id) || this.modules[0];
  }
};
