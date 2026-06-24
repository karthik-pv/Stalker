import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SECRET_KEY = Deno.env.get("DB_SECRET_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const ALLOWED_USER_ID = Deno.env.get("TELEGRAM_USER_ID")!;

if (!ALLOWED_USER_ID) {
  console.error("TELEGRAM_USER_ID secret not set — all requests will be rejected");
}

function isAuthorized(userId: string | undefined): boolean {
  if (!ALLOWED_USER_ID || !userId) return false;
  return userId === ALLOWED_USER_ID;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------

const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

async function sendMessage(chatId: string | number, text: string, replyMarkup?: unknown) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  try {
    const res = await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Telegram sendMessage error: ${res.status} ${errText}`);
    }
    return await res.json();
  } catch (e) {
    console.error("sendMessage failed:", e);
  }
}

async function answerCallbackQuery(callbackQueryId: string) {
  try {
    await fetch(`${TG_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch (e) {
    console.error("answerCallbackQuery failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Keyboard builders
// ---------------------------------------------------------------------------

async function fetchActivities() {
  const { data, error } = await supabase
    .from("activities")
    .select("id,code,display_name")
    .eq("is_active", true)
    .order("display_name");

  if (error || !data) {
    console.error("fetchActivities error:", error);
    return [];
  }
  return data;
}

async function sendActivityKeyboard(chatId: string | number, repairMode: boolean) {
  const activities = await fetchActivities();

  if (activities.length === 0) {
    await sendMessage(chatId, "No activities available. Please run the setup script.");
    return;
  }

  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < activities.length; i += 2) {
    const row: { text: string; callback_data: string }[] = [];
    row.push({
      text: activities[i].display_name,
      callback_data: `activity:${activities[i].code}`,
    });
    if (i + 1 < activities.length) {
      row.push({
        text: activities[i + 1].display_name,
        callback_data: `activity:${activities[i + 1].code}`,
      });
    }
    rows.push(row);
  }

  // Last row: repair or exit repair
  if (repairMode) {
    rows.push([{ text: "Exit Repair", callback_data: "exit_repair" }]);
  } else {
    rows.push([{ text: "Repair", callback_data: "repair" }]);
  }

  await sendMessage(chatId, repairMode ? "Repair mode — select activity:" : "Select activity:", {
    inline_keyboard: rows,
  });
}

async function sendStopKeyboard(chatId: string | number, activityName: string) {
  await sendMessage(chatId, `Current activity: ${activityName}`, {
    inline_keyboard: [[{ text: "STOP", callback_data: "stop" }]],
  });
}

// ---------------------------------------------------------------------------
// Repair mode: time selection keyboards
// ---------------------------------------------------------------------------

// Hour buttons: 0-23 in rows of 6
function buildHourKeyboard(): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let h = 0; h < 24; h += 6) {
    const row: { text: string; callback_data: string }[] = [];
    for (let i = h; i < h + 6 && i < 24; i++) {
      row.push({ text: `${i}:00`, callback_data: `r_hour:${i}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "Cancel", callback_data: "r_cancel" }]);
  return { inline_keyboard: rows };
}

// Minute buttons: 0, 15, 30, 45
function buildMinuteKeyboard(hour: number): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows: { text: string; callback_data: string }[][] = [];
  const row: { text: string; callback_data: string }[] = [];
  for (const m of [0, 15, 30, 45]) {
    row.push({ text: `${hour}:${m.toString().padStart(2, "0")}`, callback_data: `r_min:${hour}:${m}` });
  }
  rows.push(row);
  rows.push([{ text: "Cancel", callback_data: "r_cancel" }]);
  return { inline_keyboard: rows };
}

// Duration buttons: various options
function buildDurationKeyboard(): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const durations = [
    { label: "15m", mins: 15 },
    { label: "30m", mins: 30 },
    { label: "45m", mins: 45 },
    { label: "1h", mins: 60 },
    { label: "1.5h", mins: 90 },
    { label: "2h", mins: 120 },
    { label: "3h", mins: 180 },
    { label: "4h", mins: 240 },
    { label: "5h", mins: 300 },
    { label: "6h", mins: 360 },
    { label: "7h", mins: 420 },
    { label: "8h", mins: 480 },
  ];
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < durations.length; i += 4) {
    const row: { text: string; callback_data: string }[] = [];
    for (let j = i; j < i + 4 && j < durations.length; j++) {
      row.push({ text: durations[j].label, callback_data: `r_dur:${durations[j].mins}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "Cancel", callback_data: "r_cancel" }]);
  return { inline_keyboard: rows };
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

async function getActiveSession(telegramUserId: string) {
  const { data, error } = await supabase
    .from("activity_sessions")
    .select("*, activities(*)")
    .eq("telegram_user_id", telegramUserId)
    .is("ended_at", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getActiveSession error:", error);
    return null;
  }
  return data;
}

async function getUserState(telegramUserId: string) {
  const { data, error } = await supabase
    .from("user_state")
    .select("*, activities(*)")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (error) {
    console.error("getUserState error:", error);
    return null;
  }
  return data;
}

async function setUserState(telegramUserId: string, fields: Record<string, unknown>) {
  const { error } = await supabase
    .from("user_state")
    .upsert({
      telegram_user_id: telegramUserId,
      ...fields,
      updated_at: new Date().toISOString(),
    });
  if (error) console.error("setUserState error:", error);
  return !error;
}

async function clearUserState(telegramUserId: string) {
  await supabase.from("user_state").delete().eq("telegram_user_id", telegramUserId);
}

async function handleStart(chatId: number) {
  await sendActivityKeyboard(chatId, false);
}

// ---------------------------------------------------------------------------
// Normal mode: activity selected
// ---------------------------------------------------------------------------

async function handleActivityCallback(
  chatId: number,
  telegramUserId: string,
  activityCode: string,
  callbackQueryId: string,
) {
  await answerCallbackQuery(callbackQueryId);

  const { data: activity, error: actError } = await supabase
    .from("activities")
    .select("*")
    .eq("code", activityCode)
    .maybeSingle();

  if (actError || !activity) {
    await sendMessage(chatId, `Activity "${activityCode}" not found.`);
    return;
  }

  const activeSession = await getActiveSession(telegramUserId);
  if (activeSession) {
    await sendMessage(
      chatId,
      `Stop current activity "${activeSession.activities?.display_name ?? "unknown"}" first.`,
    );
    return;
  }

  if (activity.requires_description) {
    await setUserState(telegramUserId, {
      pending_activity_id: activity.id,
      awaiting_description: true,
      repair_mode: false,
    });
    await sendMessage(chatId, `Send description for ${activity.display_name}`);
  } else {
    const { error: sessionError } = await supabase.from("activity_sessions").insert({
      telegram_user_id: telegramUserId,
      activity_id: activity.id,
      started_at: new Date().toISOString(),
    });

    if (sessionError) {
      console.error("session insert error:", sessionError);
      await sendMessage(chatId, "Failed to start activity. Try again.");
      return;
    }

    await sendStopKeyboard(chatId, activity.display_name);
  }
}

// ---------------------------------------------------------------------------
// Repair mode: activity selected
// ---------------------------------------------------------------------------

async function handleRepairActivityCallback(
  chatId: number,
  telegramUserId: string,
  activityCode: string,
  callbackQueryId: string,
) {
  await answerCallbackQuery(callbackQueryId);

  const { data: activity, error: actError } = await supabase
    .from("activities")
    .select("*")
    .eq("code", activityCode)
    .maybeSingle();

  if (actError || !activity) {
    await sendMessage(chatId, `Activity "${activityCode}" not found.`);
    return;
  }

  if (activity.requires_description) {
    await setUserState(telegramUserId, {
      pending_activity_id: activity.id,
      awaiting_description: true,
      repair_mode: true,
    });
    await sendMessage(chatId, `Send description for ${activity.display_name}`);
  } else {
    // Ask for start time
    await setUserState(telegramUserId, {
      pending_activity_id: activity.id,
      awaiting_description: false,
      repair_mode: true,
      repair_step: "select_hour",
    });
    await sendMessage(chatId, `Repair: ${activity.display_name}\nSelect start hour:`, buildHourKeyboard());
  }
}

// ---------------------------------------------------------------------------
// Repair mode: time/duration selection
// ---------------------------------------------------------------------------

async function handleRepairHourCallback(
  chatId: number,
  telegramUserId: string,
  hour: number,
  callbackQueryId: string,
) {
  await answerCallbackQuery(callbackQueryId);
  await setUserState(telegramUserId, { repair_step: "select_minute", repair_hour: hour });
  await sendMessage(chatId, `Start hour: ${hour}:00\nSelect minutes:`, buildMinuteKeyboard(hour));
}

async function handleRepairMinuteCallback(
  chatId: number,
  telegramUserId: string,
  hour: number,
  minute: number,
  callbackQueryId: string,
) {
  await answerCallbackQuery(callbackQueryId);
  await setUserState(telegramUserId, { repair_step: "select_duration", repair_hour: hour, repair_minute: minute });
  await sendMessage(chatId, `Start time: ${hour}:${minute.toString().padStart(2, "0")}\nSelect duration:`, buildDurationKeyboard());
}

async function handleRepairDurationCallback(
  chatId: number,
  telegramUserId: string,
  durationMins: number,
  callbackQueryId: string,
) {
  await answerCallbackQuery(callbackQueryId);

  const state = await getUserState(telegramUserId);
  if (!state || !state.pending_activity_id || state.repair_hour === null || state.repair_minute === null) {
    await sendMessage(chatId, "Repair state lost. Please start again.");
    await clearUserState(telegramUserId);
    await sendActivityKeyboard(chatId, true);
    return;
  }

  const activity = state.activities;
  if (!activity) {
    await sendMessage(chatId, "Activity not found. Please start again.");
    await clearUserState(telegramUserId);
    await sendActivityKeyboard(chatId, true);
    return;
  }

  // Calculate start and end times for today (IST) at the selected hour:minute
  // We store UTC in DB; IST = UTC + 5:30
  const IST_OFFSET_MS = 5.5 * 3600000;
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istYear = istNow.getUTCFullYear();
  const istMonth = istNow.getUTCMonth();
  const istDay = istNow.getUTCDate();

  // Start time in IST -> convert to UTC
  const startedAtUTC = new Date(Date.UTC(istYear, istMonth, istDay, state.repair_hour, state.repair_minute, 0, 0) - IST_OFFSET_MS);
  const endedAtUTC = new Date(startedAtUTC.getTime() + durationMins * 60000);

  const description = state.repair_description || null;

  const { error: sessionError } = await supabase.from("activity_sessions").insert({
    telegram_user_id: telegramUserId,
    activity_id: activity.id,
    started_at: startedAtUTC.toISOString(),
    ended_at: endedAtUTC.toISOString(),
    description,
  });

  if (sessionError) {
    console.error("repair session insert error:", sessionError);
    await sendMessage(chatId, "Failed to add session. Try again.");
    return;
  }

  const startStr = `${state.repair_hour}:${state.repair_minute.toString().padStart(2, "0")}`;
  const endHour = Math.floor((startedAtUTC.getTime() + durationMins * 60000 + IST_OFFSET_MS) / 3600000) % 24;
  const endMin = Math.floor(((startedAtUTC.getTime() + durationMins * 60000 + IST_OFFSET_MS) % 3600000) / 60000);
  const endStr = `${endHour}:${endMin.toString().padStart(2, "0")}`;
  const durLabel = durationMins >= 60 ? `${(durationMins / 60).toFixed(durationMins % 60 ? 1 : 0)}h` : `${durationMins}m`;

  await sendMessage(
    chatId,
    `Added: ${activity.display_name}\n${startStr} → ${endStr} (${durLabel})${description ? `\n"${description}"` : ""}`,
  );

  // Clear repair state but stay in repair mode
  await setUserState(telegramUserId, {
    pending_activity_id: null,
    awaiting_description: false,
    repair_mode: true,
    repair_step: null,
    repair_hour: null,
    repair_minute: null,
    repair_description: null,
  });

  await sendActivityKeyboard(chatId, true);
}

async function handleRepairCancel(chatId: number, telegramUserId: string, callbackQueryId: string) {
  await answerCallbackQuery(callbackQueryId);
  await setUserState(telegramUserId, {
    pending_activity_id: null,
    awaiting_description: false,
    repair_mode: true,
    repair_step: null,
    repair_hour: null,
    repair_minute: null,
    repair_description: null,
  });
  await sendMessage(chatId, "Cancelled.");
  await sendActivityKeyboard(chatId, true);
}

// ---------------------------------------------------------------------------
// Stop handler
// ---------------------------------------------------------------------------

async function handleStopCallback(
  chatId: number,
  telegramUserId: string,
  callbackQueryId: string,
) {
  await answerCallbackQuery(callbackQueryId);

  const activeSession = await getActiveSession(telegramUserId);
  if (!activeSession) {
    await sendMessage(chatId, "No active session to stop.");
    return;
  }

  const { error } = await supabase
    .from("activity_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", activeSession.id);

  if (error) {
    console.error("stop session error:", error);
    await sendMessage(chatId, "Failed to stop activity. Try again.");
    return;
  }

  const durationMin = activeSession.started_at
    ? Math.round((Date.now() - new Date(activeSession.started_at).getTime()) / 60000)
    : 0;
  await sendMessage(
    chatId,
    `Stopped "${activeSession.activities?.display_name ?? "activity"}" (${durationMin} min).`,
  );
  await sendActivityKeyboard(chatId, false);
}

// ---------------------------------------------------------------------------
// Text message handler (handles description input for both modes)
// ---------------------------------------------------------------------------

async function handleTextMessage(chatId: number, telegramUserId: string, text: string) {
  const state = await getUserState(telegramUserId);

  if (!state) {
    await sendMessage(chatId, "Please use activity buttons.");
    return;
  }

  if (state.awaiting_description && state.pending_activity_id) {
    const activity = state.activities;
    if (!activity) {
      await sendMessage(chatId, "Activity not found. Please start again.");
      await clearUserState(telegramUserId);
      await sendActivityKeyboard(chatId, state.repair_mode ?? false);
      return;
    }

    if (state.repair_mode) {
      // Repair mode: save description, then ask for start time
      await setUserState(telegramUserId, {
        awaiting_description: false,
        repair_step: "select_hour",
        repair_description: text,
      });
      await sendMessage(chatId, `Description saved: "${text}"\nSelect start hour:`, buildHourKeyboard());
    } else {
      // Normal mode: create session with description
      const activeSession = await getActiveSession(telegramUserId);
      if (activeSession) {
        await sendMessage(
          chatId,
          `Stop current activity "${activeSession.activities?.display_name ?? "unknown"}" first.`,
        );
        return;
      }

      const { error: sessionError } = await supabase.from("activity_sessions").insert({
        telegram_user_id: telegramUserId,
        activity_id: activity.id,
        started_at: new Date().toISOString(),
        description: text,
      });

      if (sessionError) {
        console.error("session insert (with description) error:", sessionError);
        await sendMessage(chatId, "Failed to start activity. Try again.");
        return;
      }

      await clearUserState(telegramUserId);
      await sendStopKeyboard(chatId, activity.display_name);
    }
  } else {
    await sendMessage(chatId, "Please use activity buttons.");
  }
}

// ---------------------------------------------------------------------------
// Webhook entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const update = await req.json();

    const userId = String(
      update.message?.from?.id ?? update.callback_query?.from?.id ?? "",
    );

    if (!isAuthorized(userId)) {
      console.error(`Unauthorized access attempt from user_id: ${userId}`);
      return new Response("OK", { status: 200 });
    }

    // Handle /start command
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;
      await handleStart(chatId);
      return new Response("OK", { status: 200 });
    }

    // Handle callback queries (button clicks)
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const telegramUserId = String(cq.from?.id);
      const data = cq.data;

      if (!chatId || !telegramUserId || !data) {
        return new Response("OK", { status: 200 });
      }

      if (data === "stop") {
        await handleStopCallback(chatId, telegramUserId, cq.id);
      } else if (data === "repair") {
        await answerCallbackQuery(cq.id);
        await setUserState(telegramUserId, { repair_mode: true, pending_activity_id: null, awaiting_description: false, repair_step: null });
        await sendActivityKeyboard(chatId, true);
      } else if (data === "exit_repair") {
        await answerCallbackQuery(cq.id);
        await clearUserState(telegramUserId);
        await sendMessage(chatId, "Exited repair mode.");
        await sendActivityKeyboard(chatId, false);
      } else if (data === "r_cancel") {
        await handleRepairCancel(chatId, telegramUserId, cq.id);
      } else if (data.startsWith("r_hour:")) {
        const hour = parseInt(data.slice("r_hour:".length), 10);
        await handleRepairHourCallback(chatId, telegramUserId, hour, cq.id);
      } else if (data.startsWith("r_min:")) {
        const parts = data.slice("r_min:".length).split(":");
        const hour = parseInt(parts[0], 10);
        const minute = parseInt(parts[1], 10);
        await handleRepairMinuteCallback(chatId, telegramUserId, hour, minute, cq.id);
      } else if (data.startsWith("r_dur:")) {
        const mins = parseInt(data.slice("r_dur:".length), 10);
        await handleRepairDurationCallback(chatId, telegramUserId, mins, cq.id);
      } else if (data.startsWith("activity:")) {
        const activityCode = data.slice("activity:".length);
        const state = await getUserState(telegramUserId);
        const inRepair = state?.repair_mode ?? false;
        if (inRepair) {
          await handleRepairActivityCallback(chatId, telegramUserId, activityCode, cq.id);
        } else {
          await handleActivityCallback(chatId, telegramUserId, activityCode, cq.id);
        }
      }

      return new Response("OK", { status: 200 });
    }

    // Handle regular text messages
    if (update.message?.text && !update.message.text.startsWith("/")) {
      const chatId = update.message.chat.id;
      const telegramUserId = String(update.message.from?.id);
      await handleTextMessage(chatId, telegramUserId, update.message.text);
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Webhook error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
});
