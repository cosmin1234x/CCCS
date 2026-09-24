// McAssist chat page (main.html?view=assistant).
// Owned module: rendered into #content by portal-enhancements.js, which passes
// a shared "kit" of helpers (see createKit in portal-enhancements.js).
let kit;
const $ = (id) => document.getElementById(id);
const esc = (value) => kit.esc(value);
let chatBusy = false;
const chatCache = new Map();

function getStoredChat(uid) {
  if (chatCache.has(uid)) return chatCache.get(uid);
  try {
    const stored = JSON.parse(
      sessionStorage.getItem("mc_v2_chat_" + uid) || "[]",
    );
    return Array.isArray(stored)
      ? stored
          .filter(
            (item) =>
              item &&
              typeof item.content === "string" &&
              ["user", "assistant"].includes(item.role),
          )
          .slice(-30)
      : [];
  } catch {
    return [];
  }
}

function saveStoredChat(uid, items) {
  chatCache.set(uid, items.slice(-30));
  try {
    sessionStorage.setItem(
      "mc_v2_chat_" + uid,
      JSON.stringify(items.slice(-30)),
    );
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
}

function renderV2Chat(profile) {
  const chat = $("chat");
  if (!chat) return;
  const submit = $("chatForm")?.querySelector('button[type="submit"]');
  if (submit) submit.disabled = chatBusy;
  chat.setAttribute("aria-busy", String(chatBusy));
  const items = getStoredChat(profile.id);
  const messages = items.length
    ? items
    : [
        {
          role: "assistant",
          content:
            "Hey " +
            String(profile.name || "there").split(" ")[0] +
            " 👋 Ask me about your live shifts, learning, availability, or anything your role allows me to change.",
        },
      ];
  chat.innerHTML =
    messages
      .map(
        (item) =>
          '<div><div class="chat-label" style="' +
          (item.role === "user" ? "text-align:right" : "") +
          '">' +
          (item.role === "user" ? "YOU" : "MCASSIST") +
          '</div><div class="message ' +
          (item.role === "user" ? "user" : "") +
          '">' +
          esc(item.content) +
          "</div></div>",
      )
      .join("") +
    (chatBusy ? '<div class="message">Working on it…</div>' : "");
  chat.scrollTop = chat.scrollHeight;
}

function handleUiAction(action) {
  if (!action) return;
  if (action.type === "openVerification" && action.id) {
    kit.invalidateData();
    setTimeout(() => {
      location.href = "/verification.html?id=" + encodeURIComponent(action.id);
    }, 550);
    return;
  }
  if (action.type === "openPage" && action.page) {
    kit.invalidateData();
    setTimeout(() => {
      location.href = kit.pageFor(action.page);
    }, 550);
  }
}

async function sendV2Chat(data, message) {
  const profile = data.profile;
  const { preview } = kit;
  const items = getStoredChat(profile.id);
  items.push({ role: "user", content: message });
  saveStoredChat(profile.id, items);
  chatBusy = true;
  renderV2Chat(profile);

  try {
    const response = preview
      ? {
          reply:
            "You’re exploring the preview. Sign in to ask McAssist about your real shifts, get learning help, or update your availability. No changes were made.",
        }
      : await kit.api("/api/ai-chat", {
          method: "POST",
          body: JSON.stringify({
            message,
            history: items.slice(0, -1).slice(-10),
            appContext: { page: "assistant" },
          }),
        });
    items.push({ role: "assistant", content: response.reply || "Done." });
    if (response.dataChanged) kit.invalidateData();
    saveStoredChat(profile.id, items);
    handleUiAction(response.uiAction);
  } catch (error) {
    items.push({
      role: "assistant",
      content: error.message || "McAssist could not complete that.",
    });
    saveStoredChat(profile.id, items);
  } finally {
    chatBusy = false;
    renderV2Chat(profile);
  }
}

export function renderAssistant(data, k) {
  kit = k;
  const { preview, roleLabel, normaliseRole } = kit;
  const content = $("content");
  const assistant = $("assistant");
  if (!content || !assistant || content.dataset.enhancedPage === "assistant")
    return;
  content.dataset.enhancedPage = "assistant";

  const role = data.profile.role;
  const firstCrew =
    data.team?.find((person) => normaliseRole(person.role) === "crew")?.name ||
    "Alex";
  const commands = [
    ["My next shift", "What is my next shift and station?"],
    ["Update availability", "Set my Friday availability to 16:00-23:00"],
    ["Learn a station", "Teach me the chicken station basics"],
  ];
  if (role === "crewTrainer")
    commands.push(["Start verification", "Verify " + firstCrew + " on fries"]);
  if (role === "manager") {
    commands.push([
      "Plan a shift",
      "Plan a shift for " +
        firstCrew +
        " tomorrow from 16:00 to 23:00 on Fries with a 30 minute break",
    ]);
    commands.push([
      "Set hourly rate",
      "Set " + firstCrew + " hourly rate to £13.55",
    ]);
    commands.push([
      "Promote member",
      "Promote " + firstCrew + " to Crew Trainer",
    ]);
    commands.push([
      "Multi-action",
      "Set " +
        firstCrew +
        " hourly rate to £13.55, add a note saying strong progress, and give them 3 McStars",
    ]);
    commands.push([
      "Team check",
      "Who is working tomorrow and what stations are they on?",
    ]);
  }

  content.innerHTML =
    '<div class="v2-assistant-page">' +
    '<section class="v2-assistant-hero">' +
    '<div class="eyebrow">YOUR SHIFT COMPANION</div>' +
    "<h1>A little help for your day.</h1>" +
    "<p>Get ready for your shift, learn a station, or organise your working week.</p>" +
    '<div class="v2-assistant-capabilities">' +
    "<span>✓ Live shifts</span><span>✓ Learning</span><span>✓ Availability</span>" +
    (data.permissions?.canVerify ? "<span>✓ Crew verification</span>" : "") +
    (data.permissions?.canPlanShifts
      ? "<span>✓ Shift planning</span><span>✓ Pay rates</span><span>✓ Roles</span><span>✓ Profiles</span><span>✓ McStars</span>"
      : "") +
    "</div>" +
    "</section>" +
    '<div class="v2-assistant-shell"><div id="v2AssistantMount"></div>' +
    '<aside class="v2-command-panel"><div class="v2-data-badge">' +
    (preview ? "Preview · sample data" : esc(roleLabel(role)) + " access") +
    '</div><h3 style="margin-top:14px">Start a conversation</h3><p>Choose a suggestion, edit it, then send when you’re ready.</p><div class="v2-command-list">' +
    commands
      .map(
        (item) =>
          '<button class="v2-command" type="button" data-v2-command="' +
          esc(item[1]) +
          '"><b>' +
          esc(item[0]) +
          "</b>" +
          esc(item[1]) +
          "</button>",
      )
      .join("") +
    "</div></aside>" +
    "</div>" +
    "</div>";

  $("v2AssistantMount").appendChild(assistant);
  assistant.querySelector(".assistant-head small").textContent =
    roleLabel(role) + " access";
  const aiNote = assistant.querySelector(".ai-note");
  if (aiNote)
    aiNote.textContent =
      role === "manager"
        ? "Manager changes are saved to your team’s records. Check names, dates and amounts before sending."
        : "McAssist can only perform actions allowed by your approved role. Exact store procedures still come from official restaurant guidance.";

  const form = $("chatForm");
  const input = $("chatInput");
  if (form && input) {
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (chatBusy) return;
      const message = input.value.trim();
      if (!message) return;
      input.value = "";
      await sendV2Chat(data, message);
    };
  }

  assistant.querySelectorAll("[data-prompt]").forEach((button) => {
    button.onclick = () => {
      input.value = button.dataset.prompt;
      input.focus();
    };
  });

  content.querySelectorAll("[data-v2-command]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.v2Command;
      input.focus();
    });
  });

  renderV2Chat(data.profile);
}
