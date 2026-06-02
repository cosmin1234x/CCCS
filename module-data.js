// module-data.js — shared training module content
window.McModules = {
  modules: [
    {
      id: "first-shift",
      icon: "🧭",
      title: "First Shift Basics",
      tagline: "Know what to do before the rush starts.",
      xp: 80,
      level: "New starter",
      time: "8 min",
      color: "ok",
      sections: [
        { title: "Start strong", text: "Arrive ready, know who your trainer or manager is, and ask what station you are learning today." },
        { title: "Do not guess", text: "If you are unsure about food safety, tills, allergens, customer complaints, or equipment, ask a trainer or manager." },
        { title: "Accuracy first", text: "Speed comes later. New crew should focus on safe, correct work before trying to go fast." }
      ],
      checklist: ["I know who my trainer is", "I know my station", "I know where to ask for help", "I understand breaks follow the manager plan"],
      quiz: [
        { q: "What should you do if you are unsure?", a: ["Guess quickly", "Ask trainer/manager", "Ignore it"], correct: 1 },
        { q: "What matters first for new crew?", a: ["Accuracy and safety", "Being fastest", "Never asking questions"], correct: 0 }
      ]
    },
    {
      id: "food-safety",
      icon: "🧼",
      title: "Food Safety Basics",
      tagline: "Simple hygiene habits that protect customers and crew.",
      xp: 120,
      level: "Priority",
      time: "10 min",
      color: "bad",
      sections: [
        { title: "Wash hands often", text: "Wash hands after toilets, bins, cleaning tasks, breaks, touching face/hair, or changing station." },
        { title: "Allergens are serious", text: "Never guess allergen information. Follow store policy and ask a trained person or manager." },
        { title: "Clean as you go", text: "Spills, dirty surfaces, and clutter create hazards. Keep the station clean during quieter moments." }
      ],
      checklist: ["I know when to wash hands", "I know not to guess allergens", "I report hazards", "I clean as I go"],
      quiz: [
        { q: "What should you do with an allergen question?", a: ["Guess", "Ask trained person/manager", "Say everything is safe"], correct: 1 },
        { q: "When should you wash hands?", a: ["Only once", "After breaks/cleaning/toilets/task changes", "Never during rush"], correct: 1 }
      ]
    },
    {
      id: "fries-station",
      icon: "🍟",
      title: "Fries Station",
      tagline: "Stay calm, clean, and ready during peak rush.",
      xp: 90,
      level: "Station skill",
      time: "9 min",
      color: "warn",
      sections: [
        { title: "Watch demand", text: "Fries can crash the rush if the station is behind. Communicate early when stock or batches are low." },
        { title: "Use timers and rotation", text: "Follow the station process and timers. Do not serve old or poor-quality product." },
        { title: "Keep the area safe", text: "Oil, hot equipment, and dropped fries can be hazards. Keep the floor and station tidy." }
      ],
      checklist: ["I communicate low stock", "I follow timers", "I keep the station tidy", "I ask for help before falling behind"],
      quiz: [
        { q: "What should you do if fries are running low before peak?", a: ["Say nothing", "Communicate early", "Leave the station"], correct: 1 },
        { q: "What is most important around fryers?", a: ["Safety", "Rushing", "Ignoring spills"], correct: 0 }
      ]
    },
    {
      id: "front-counter",
      icon: "🧾",
      title: "Front Counter Service",
      tagline: "Clear, calm customer service that helps the whole store.",
      xp: 70,
      level: "Service skill",
      time: "7 min",
      color: "ok",
      sections: [
        { title: "Greet and listen", text: "A simple friendly greeting and good listening prevent most order mistakes." },
        { title: "Repeat key details", text: "Confirm customisations, meals, drinks, sauces, and anything unusual before completing the order." },
        { title: "Call for help", text: "For complaints, refunds, difficult customers, or allergen questions, ask a manager or trained person." }
      ],
      checklist: ["I greet customers", "I confirm details", "I stay calm", "I ask for help with complaints"],
      quiz: [
        { q: "What helps prevent order mistakes?", a: ["Guessing", "Confirming details", "Rushing every customer"], correct: 1 },
        { q: "Who handles difficult complaints?", a: ["Manager/trained person", "Nobody", "A new starter alone"], correct: 0 }
      ]
    },
    {
      id: "drive-thru",
      icon: "🚗",
      title: "Drive-thru Communication",
      tagline: "Clear headset habits for speed and accuracy.",
      xp: 90,
      level: "Station skill",
      time: "9 min",
      color: "warn",
      sections: [
        { title: "Speak clearly", text: "Use a calm voice and repeat important order details so the team can prepare correctly." },
        { title: "Stay organised", text: "Drive-thru needs accuracy, timing, and teamwork. Do not multitask beyond your training level." },
        { title: "Ask when unsure", text: "If the customer asks something unusual, pause and ask a manager rather than guessing." }
      ],
      checklist: ["I speak clearly", "I repeat custom orders", "I do not guess", "I keep the team updated"],
      quiz: [
        { q: "What should you do with unclear orders?", a: ["Confirm again", "Guess", "Ignore it"], correct: 0 },
        { q: "Drive-thru needs", a: ["Teamwork", "Silence", "No communication"], correct: 0 }
      ]
    },
    {
      id: "manager-rush",
      icon: "📈",
      title: "Manager Rush Planning",
      tagline: "Plan staffing before peak pressure hits.",
      xp: 140,
      level: "Manager",
      time: "12 min",
      color: "bad",
      sections: [
        { title: "Look before peak", text: "Check staffing, station coverage, and new-starter support before the rush starts, not during it." },
        { title: "Protect key stations", text: "Fries, front counter, drive-thru, and kitchen line usually need strong coverage during dinner peak." },
        { title: "Move people early", text: "A calm early move is better than a panic move after queues build up." }
      ],
      checklist: ["I checked rota gaps", "I know peak window", "I assigned shift lead", "I paired new crew with support"],
      quiz: [
        { q: "When should managers fix staffing gaps?", a: ["Before peak", "After the queue is huge", "Never"], correct: 0 },
        { q: "What helps new starters most?", a: ["Pairing with support", "Leaving them alone", "Changing station every 2 minutes"], correct: 0 }
      ]
    }
  ],
  get(id) {
    return this.modules.find((m) => m.id === id) || this.modules[0];
  }
};
