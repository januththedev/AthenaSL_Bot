import "dotenv/config";
import fs from "node:fs";
import type { Update } from "grammy/types";

/**
 * End-to-end harness: feeds synthetic Telegram updates through the real bot
 * (handleUpdate) while intercepting all outgoing Telegram API calls.
 * Command logic, per-chat state and OpenRouter calls are REAL; only the
 * Telegram transport is mocked. Runs against the local JSON store.
 */

const ADMIN = { id: 111, first_name: "Admin", username: "adminuser" };
const USER = { id: 555, first_name: "User", username: "student" };
const USER2 = { id: 556, first_name: "Newbie" };
const CHAT = -100888777001;
const CHAT2 = -100888777002;
const PRIVATE = 777;

type Person = { id: number; first_name: string; username?: string };

// -------------------------------------------------------------------------
// API mock
// -------------------------------------------------------------------------

interface Call { method: string; payload: Record<string, unknown> }
const calls: Call[] = [];
let fakeMsgId = 5000;

const { getBot } = await import("../src/bot.js");
const bot = getBot();

bot.api.config.use((async (_prev: unknown, method: string, payload: Record<string, unknown>) => {
  calls.push({ method, payload });
  const ok = (result: unknown) => ({ ok: true, result });
  switch (method) {
    case "getMe":
      return ok({ id: 424242, is_bot: true, first_name: "Athena", username: "athena_test" });
    case "getChatAdministrators":
      return ok([{
        user: ADMIN, status: "administrator",
        can_restrict_members: true, can_delete_messages: true, can_pin_messages: true,
      }]);
    case "getChatMember":
      if (payload.user_id === ADMIN.id) {
        return ok({ user: ADMIN, status: "administrator", can_restrict_members: true, can_delete_messages: true, can_pin_messages: true });
      }
      return ok({ user: USER, status: "member" });
    case "getChat":
      return ok({ id: payload.chat_id, type: "supergroup", title: "Test Group" });
    case "getChatMemberCount":
      return ok(42);
    case "sendMessage":
      return ok({
        message_id: ++fakeMsgId, date: Math.floor(Date.now() / 1000),
        chat: { id: payload.chat_id, type: "supergroup", title: "Test Group" },
        text: payload.text,
      });
    case "editMessageText":
      return ok({ message_id: payload.message_id, date: 0, chat: { id: payload.chat_id, type: "supergroup", title: "Test Group" }, text: payload.text });
    default:
      return ok(true);
  }
}) as never);

await bot.init();

// -------------------------------------------------------------------------
// Update builders + assertions
// -------------------------------------------------------------------------

let uid = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mark = () => calls.length;
const since = (m: number) => calls.slice(m);
const repliesSince = (m: number) =>
  since(m).filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text ?? ""));
/** All visible bot output: new messages AND edits (the bot edits "Thinking…" in place). */
const textsSince = (m: number) => [
  ...repliesSince(m),
  ...since(m).filter((c) => c.method === "editMessageText").map((c) => String(c.payload.text ?? "")),
];
const hasReply = (m: number, sub: string) => textsSince(m).some((t) => t.includes(sub));
const apiCalled = (m: number, method: string) => since(m).some((c) => c.method === method);
const groupChatFor = (chatId: number) => ({ id: chatId, type: "supergroup" as const, title: "Test Group" });

function baseMessage(from: Person) {
  return {
    message_id: ++fakeMsgId,
    date: Math.floor(Date.now() / 1000),
    from: { id: from.id, is_bot: false, first_name: from.first_name, username: from.username },
  };
}

function sendText(chatId: number, from: Person, text: string, opts: { replyTo?: number; replyText?: string; messageId?: number; entities?: Record<string, unknown>[] } = {}) {
  // grammY's command() filter requires a bot_command entity at offset 0 —
  // real Telegram always includes one for commands, so synthesize it here.
  const entities: Record<string, unknown>[] = [...(opts.entities ?? [])];
  if (text.startsWith("/")) {
    const cmdLen = text.split(/\s+/)[0]?.length ?? 0;
    entities.unshift({ offset: 0, length: cmdLen, type: "bot_command" });
  }
  const message: Record<string, unknown> = {
    ...baseMessage(from),
    ...(opts.messageId ? { message_id: opts.messageId } : {}),
    chat: chatId > 0 ? { id: chatId, type: "private", first_name: from.first_name } : groupChatFor(chatId),
    text,
    ...(entities.length > 0 ? { entities } : {}),
    ...(opts.replyTo
      ? {
          reply_to_message: {
            ...baseMessage(USER),
            message_id: opts.replyTo,
            chat: groupChatFor(chatId),
            text: opts.replyText ?? "replied content",
          },
        }
      : {}),
  };
  return bot.handleUpdate({ update_id: uid++, message } as unknown as Update);
}

function sendMemberEvent(chatId: number, kind: "new_chat_members" | "left_chat_member", user: Person) {
  const message: Record<string, unknown> = {
    ...baseMessage(ADMIN),
    chat: chatId > 0 ? { id: chatId, type: "private", first_name: user.first_name } : groupChatFor(chatId),
    [kind]: kind === "new_chat_members" ? [{ id: user.id, is_bot: false, first_name: user.first_name, username: user.username }] : { id: user.id, is_bot: false, first_name: user.first_name },
  };
  return bot.handleUpdate({ update_id: uid++, message } as unknown as Update);
}

function sendCallback(from: Person, data: string, msgId = 999) {
  return bot.handleUpdate({
    update_id: uid++,
    callback_query: {
      id: String(uid), from: { id: from.id, is_bot: false, first_name: from.first_name },
      message: { message_id: msgId, date: 0, chat: groupChatFor(CHAT) }, chat_instance: "c1", data,
    },
  } as unknown as Update);
}

// -------------------------------------------------------------------------
// Tiny test framework
// -------------------------------------------------------------------------

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function t(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name} — ${msg.slice(0, 220)}`);
    console.log(`  ✗ ${name} — ${msg.slice(0, 160)}`);
  }
}

function expect(cond: boolean, what: string): void {
  if (!cond) throw new Error(what);
}

/** Run an AI-dependent command with pacing for the free-tier rate limit. */
async function aiStep(fn: () => Promise<void>): Promise<void> {
  await sleep(3500);
  await fn();
}

// =========================================================================
console.log("\n== /start /help /about");
{
  let m = mark();
  await sendText(PRIVATE, ADMIN, "/start");
  await t("start (private) shows intro with credit", () => {
    expect(hasReply(m, "Built by"), "no credit line");
  });
  m = mark();
  await sendText(CHAT, ADMIN, "/start");
  await t("start (group) is brief", () => expect(hasReply(m, "I'm awake"), "wrong reply"));
  m = mark();
  await sendText(CHAT, ADMIN, "/help");
  await t("help lists Study tools + Moderation", () => {
    expect(hasReply(m, "Study tools") && hasReply(m, "Moderation"), "missing sections");
  });
  m = mark();
  await sendText(CHAT, ADMIN, "/about");
  await t("about shows version + januth.dev", () => {
    expect(hasReply(m, "januth.dev") && hasReply(m, "Januth"), "missing credit");
  });
}

console.log("\n== /id /admins /info /report");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/id");
  await t("id shows chat and user id", () => {
    expect(hasReply(m, String(CHAT)) && hasReply(m, "Your ID"), "ids missing");
  });
  m = mark();
  await sendText(CHAT, ADMIN, "/admins");
  await t("admins lists @adminuser", () => expect(hasReply(m, "@adminuser"), "not listed"));
  const userMsg = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "hello everyone", { messageId: userMsg });
  m = mark();
  await sendText(CHAT, ADMIN, "/info", { replyTo: userMsg });
  await t("info (reply) shows member status and zero warnings", () => {
    expect(hasReply(m, "Status: member") && hasReply(m, "Warnings: 0"), "bad info");
  });
  m = mark();
  await sendText(CHAT, USER, "/report", { replyTo: userMsg });
  await t("report pings @adminuser", () => expect(hasReply(m, "@adminuser"), "no ping"));
  m = mark();
  await sendText(CHAT, USER, "/report");
  await t("report without reply asks for target", () => expect(hasReply(m, "Reply"), "no usage"));
  m = mark();
  await sendText(PRIVATE, USER, "/report");
  await t("report in private is ignored", () => expect(repliesSince(m).length === 0, "should be silent"));
}

console.log("\n== /setrules /rules /clearrules");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/setrules Be kind and study hard");
  await t("setrules saves", () => expect(hasReply(m, "saved"), "no confirm"));
  m = mark();
  await sendText(CHAT, USER, "/rules");
  await t("rules shows text", () => expect(hasReply(m, "Be kind"), "not shown"));
  m = mark();
  await sendText(CHAT, ADMIN, "/clearrules");
  await sendText(CHAT, USER, "/rules");
  await t("clearrules empties rules", () => expect(hasReply(m, "No rules"), "still set"));
}

console.log("\n== welcome / goodbye");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/setwelcome Hi {first} at {chatname} (# {count})");
  await t("setwelcome renders preview", () => expect(hasReply(m, "Hi Admin at Test Group"), "bad render"));
  m = mark();
  await sendText(CHAT, ADMIN, "/welcome");
  await t("welcome shows status+text", () => expect(hasReply(m, "enabled") && hasReply(m, "Hi Admin"), "bad view"));
  m = mark();
  await sendMemberEvent(CHAT, "new_chat_members", USER);
  await t("join triggers welcome with fillings", () => expect(hasReply(m, "Hi User at Test Group"), "no welcome"));
  m = mark();
  await sendText(CHAT, ADMIN, "/welcome off");
  m = mark();
  await sendMemberEvent(CHAT, "new_chat_members", USER2);
  await t("welcome off silences join", () => expect(repliesSince(m).length === 0, "still welcoming"));
  m = mark();
  await sendText(CHAT, ADMIN, "/resetwelcome");
  await sendText(CHAT, ADMIN, "/welcome on");
  await sendMemberEvent(CHAT, "new_chat_members", USER);
  await t("resetwelcome restores default text", () => expect(hasReply(m, "Hey User, welcome to Test Group!"), "no default"));
  m = mark();
  await sendText(CHAT, ADMIN, "/setgoodbye Bye {first}, come back!");
  await sendMemberEvent(CHAT, "left_chat_member", USER2);
  await t("leave triggers goodbye", () => expect(hasReply(m, "Bye Newbie"), "no goodbye"));
  m = mark();
  await sendText(CHAT, ADMIN, "/goodbye off");
  m = mark();
  await sendMemberEvent(CHAT, "left_chat_member", USER2);
  await t("goodbye off silences leave", () => expect(repliesSince(m).length === 0, "still saying bye"));
}

console.log("\n== /cleanservice");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/cleanservice on");
  await t("cleanservice on confirms", () => expect(hasReply(m, "🧹"), "no confirm"));
  m = mark();
  await sendMemberEvent(CHAT, "new_chat_members", USER2);
  await t("service join message gets deleted", () => expect(apiCalled(m, "deleteMessage"), "not deleted"));
  m = mark();
  await sendText(CHAT, ADMIN, "/cleanservice off");
  await sendMemberEvent(CHAT, "new_chat_members", USER2);
  await t("cleanservice off keeps service messages", () => expect(!apiCalled(m, "deleteMessage"), "still deleting"));
}

console.log("\n== notes: /save #tag /get /notes /clear");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/save formula E=mc^2");
  await t("save stores note", () => expect(hasReply(m, "#formula"), "not saved"));
  m = mark();
  await sendText(CHAT, USER, "remember #formula please");
  await t("#tag retrieves note", () => expect(hasReply(m, "E=mc^2"), "no reply"));
  m = mark();
  await sendText(CHAT, ADMIN, "/save emptyname");
  await t("save without content explains usage", () => expect(hasReply(m, "Nothing to save"), "no hint"));
  m = mark();
  await sendText(CHAT, USER, "/get formula");
  await t("get returns content", () => expect(hasReply(m, "E=mc^2"), "no content"));
  m = mark();
  await sendText(CHAT, USER, "/get ghost");
  await t("get missing note says so", () => expect(hasReply(m, "No note named #ghost"), "wrong msg"));
  m = mark();
  await sendText(CHAT, ADMIN, "/notes");
  await t("notes lists names", () => expect(hasReply(m, "#formula"), "not listed"));
  m = mark();
  await sendText(CHAT, ADMIN, "/clear formula");
  await sendText(CHAT, USER, "again #formula");
  await t("clear removes #tag retrieval", () => expect(repliesSince(m).filter((x) => x === "E=mc^2").length === 0, "still replies"));
  m = mark();
  await sendText(CHAT, ADMIN, "/clear ghost");
  await t("clear missing note says so", () => expect(hasReply(m, "No note named #ghost"), "wrong msg"));
}

console.log("\n== filters: /filter /filters /stop");
{
  const setup = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "Please do your homework now", { messageId: setup });
  let m = mark();
  await sendText(CHAT, ADMIN, "/filter homework", { replyTo: setup, replyText: "Please do your homework now" });
  await t("filter set from reply", () => expect(hasReply(m, "Filter set"), "not set"));
  m = mark();
  await sendText(CHAT, USER, "my homework is late");
  await t("keyword triggers auto-reply", () => expect(hasReply(m, "Please do your homework now"), "no auto-reply"));
  m = mark();
  await sendText(CHAT, ADMIN, "homework homework");
  await t("admins are exempt from filters", () => expect(repliesSince(m).length === 0, "admin got filtered"));
  m = mark();
  await sendText(CHAT, ADMIN, "/filters");
  await t("filters lists keyword", () => expect(hasReply(m, "homework"), "not listed"));
  m = mark();
  await sendText(CHAT, ADMIN, "/stop homework");
  await sendText(CHAT, USER, "my homework is late again");
  await t("stop removes filter", () => expect(repliesSince(m).filter((x) => x.includes("homework now")).length === 0, "still active"));
  m = mark();
  await sendText(CHAT, ADMIN, "/stop ghost");
  await t("stop unknown filter says so", () => expect(hasReply(m, "No filter"), "wrong msg"));
}

console.log("\n== warns: /warn /warnings /resetwarn + remove button");
{
  const userMsg = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "spam", { messageId: userMsg });
  let m = mark();
  await sendText(CHAT, ADMIN, "/warn spamming", { replyTo: userMsg });
  await t("warn records 1/3 with button", () => {
    const last = since(m).find((c) => c.method === "sendMessage" && String(c.payload.text ?? "").includes("was warned"));
    expect(Boolean(last), "no warn message");
    expect(JSON.stringify(last?.payload.reply_markup ?? {}).includes("warnrm"), "no remove button");
  });
  m = mark();
  await sendText(CHAT, ADMIN, "/warnings", { replyTo: userMsg });
  await t("warnings lists entry", () => expect(hasReply(m, "spamming"), "not listed"));
  m = mark();
  await sendText(CHAT, USER, "/warn someone");
  await t("non-admin cannot warn", () => expect(hasReply(m, "admins"), "not denied"));
  m = mark();
  await sendText(CHAT, ADMIN, "/warn");
  await t("warn without reply explains usage", () => expect(hasReply(m, "Usage"), "no usage"));
  m = mark();
  await sendCallback(ADMIN, `warnrm:${USER.id}`);
  await t("remove-warning callback works", () => {
    expect(apiCalled(m, "answerCallbackQuery"), "no callback answer");
    expect(apiCalled(m, "editMessageText"), "no edit");
  });
  m = mark();
  await sendText(CHAT, ADMIN, "/warnings", { replyTo: userMsg });
  await t("warnings empty after removal", () => expect(hasReply(m, "no warnings"), "still listed"));
  m = mark();
  await sendText(CHAT, ADMIN, "/warn spamming", { replyTo: userMsg });
  await sendText(CHAT, ADMIN, "/resetwarn", { replyTo: userMsg });
  await sendText(CHAT, ADMIN, "/warnings", { replyTo: userMsg });
  await t("resetwarn clears", () => expect(hasReply(m, "no warnings"), "still there"));
  m = mark();
  await sendText(CHAT, USER, "/resetwarn");
  await t("non-admin cannot resetwarn", () => expect(hasReply(m, "admins"), "not denied"));
}

console.log("\n== /warnlimit /warnaction + limit actions");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/warnlimit 2");
  await t("warnlimit sets to 2", () => expect(hasReply(m, "after 2 warnings"), "no confirm"));
  m = mark();
  await sendText(CHAT, ADMIN, "/warnlimit 0");
  await t("warnlimit rejects invalid", () => expect(hasReply(m, "Usage"), "no usage"));
  const userMsg = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "spam2", { messageId: userMsg });
  m = mark();
  await sendText(CHAT, ADMIN, "/warn a", { replyTo: userMsg });
  await sendText(CHAT, ADMIN, "/warn b", { replyTo: userMsg });
  await t("limit reached triggers ban", () => {
    expect(hasReply(m, "limit reached"), "no limit msg");
    expect(apiCalled(m, "banChatMember"), "no ban call");
  });
  m = mark();
  await sendText(CHAT, ADMIN, "/warnaction mute");
  await t("warnaction sets mute", () => expect(hasReply(m, "muted for 1 hour"), "no confirm"));
  m = mark();
  await sendText(CHAT, ADMIN, "/warnaction banana");
  await t("warnaction rejects invalid", () => expect(hasReply(m, "Usage"), "no usage"));
  await sendText(CHAT, ADMIN, "/warnlimit 1");
  m = mark();
  await sendText(CHAT, ADMIN, "/warn c", { replyTo: userMsg });
  await t("mute action restricts member", () => expect(apiCalled(m, "restrictChatMember"), "no restrict"));
  await sendText(CHAT, ADMIN, "/warnaction ban");
  await sendText(CHAT, ADMIN, "/warnlimit 3");
}

console.log("\n== locks: /lock /locks /unlock + enforcement");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/lock sticker url");
  await t("lock confirms types", () => expect(hasReply(m, "Locked: sticker, url"), "no confirm"));
  m = mark();
  await sendText(CHAT, ADMIN, "/lock banana");
  await t("lock rejects unknown type", () => expect(hasReply(m, "Unknown types"), "no rejection"));
  m = mark();
  await sendText(CHAT, ADMIN, "/locks");
  await t("locks lists active", () => expect(hasReply(m, "sticker"), "not listed"));
  m = mark();
  await sendText(CHAT, USER, "check https://example.com/x", {
    entities: [{ offset: 6, length: 21, type: "url" }],
  });
  await t("locked url message is deleted", () => {
    expect(apiCalled(m, "deleteMessage"), "not deleted");
    expect(hasReply(m, "locked here"), "no notice");
  });
  m = mark();
  await sendText(CHAT, ADMIN, "/unlock url");
  await sendText(CHAT, USER, "check https://example.com/y", {
    entities: [{ offset: 6, length: 21, type: "url" }],
  });
  await t("unlocked type passes through", () => expect(!apiCalled(m, "deleteMessage"), "still deleting"));
  m = mark();
  await sendText(CHAT, ADMIN, "/unlock sticker");
  await sendText(CHAT, ADMIN, "/locks");
  await t("locks empty after unlock", () => expect(hasReply(m, "Nothing is locked"), "still locked"));
}

console.log("\n== /antiflood");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/antiflood 3");
  await t("antiflood enables with limit", () => expect(hasReply(m, "more than 3"), "no confirm"));
  m = mark();
  for (let i = 0; i < 4; i++) await sendText(CHAT, USER, `flood ${i}`);
  await t("flooder gets restricted", () => {
    expect(apiCalled(m, "restrictChatMember"), "no restrict");
    expect(hasReply(m, "muted for 10 min"), "no notice");
  });
  m = mark();
  for (let i = 0; i < 5; i++) await sendText(CHAT, ADMIN, `admin chat ${i}`);
  await t("admins exempt from antiflood", () => expect(!apiCalled(m, "restrictChatMember"), "admin restricted"));
  m = mark();
  await sendText(CHAT, ADMIN, "/antiflood off");
  await t("antiflood disables", () => expect(hasReply(m, "disabled"), "no confirm"));
}

console.log("\n== /purge /spurge /del");
{
  const a = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "to purge", { messageId: a });
  let m = mark();
  await sendText(CHAT, ADMIN, "/purge", { replyTo: a });
  await t("purge deletes the range", () => {
    expect(since(m).filter((c) => c.method === "deleteMessage").length >= 2, "too few deletes");
  });
  m = mark();
  await sendText(CHAT, USER, "/purge");
  await t("non-admin cannot purge", () => expect(hasReply(m, "admins"), "not denied"));
  m = mark();
  await sendText(CHAT, ADMIN, "/purge");
  await t("purge without reply explains usage", () => expect(hasReply(m, "Reply"), "no usage"));
  const b = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "to spurge", { messageId: b });
  m = mark();
  await sendText(CHAT, ADMIN, "/spurge", { replyTo: b });
  await t("spurge deletes silently", () => {
    expect(apiCalled(m, "deleteMessage"), "not deleted");
    expect(repliesSince(m).filter((x) => x.includes("🧹")).length === 0, "not silent");
  });
  const c = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "to delete", { messageId: c });
  m = mark();
  await sendText(CHAT, ADMIN, "/del", { replyTo: c });
  await t("del removes replied message", () => expect(apiCalled(m, "deleteMessage"), "not deleted"));
  m = mark();
  await sendText(CHAT, USER, "/del");
  await t("non-admin cannot del", () => expect(hasReply(m, "admins"), "not denied"));
}

console.log("\n== /pin /unpin");
{
  const target = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "pin me", { messageId: target });
  let m = mark();
  await sendText(CHAT, ADMIN, "/pin", { replyTo: target });
  await t("pin calls pinChatMessage", () => expect(apiCalled(m, "pinChatMessage"), "not pinned"));
  m = mark();
  await sendText(CHAT, USER, "/pin");
  await t("non-admin cannot pin", () => expect(hasReply(m, "admins"), "not denied"));
  m = mark();
  await sendText(CHAT, ADMIN, "/unpin", { replyTo: target });
  await t("unpin calls unpinChatMessage", () => expect(apiCalled(m, "unpinChatMessage"), "not unpinned"));
}

console.log("\n== /persona /setpersona /resetpersona");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/persona");
  await t("persona default view", () => expect(hasReply(m, "default Athena style"), "wrong view"));
  m = mark();
  await sendText(CHAT, ADMIN, "/setpersona Always mention pizza.");
  await t("setpersona saves", () => expect(hasReply(m, "pizza"), "not saved"));
  m = mark();
  await sendText(CHAT, USER, "/persona");
  await t("persona shows custom style", () => expect(hasReply(m, "pizza"), "not shown"));
  m = mark();
  await sendText(CHAT, ADMIN, `/setpersona ${"x".repeat(900)}`);
  await t("setpersona enforces length limit", () => expect(hasReply(m, "Too long"), "accepted 900 chars"));
  m = mark();
  await sendText(CHAT, USER, "/setpersona hack");
  await t("non-admin cannot setpersona", () => expect(hasReply(m, "admins"), "not denied"));
  await sendText(CHAT, ADMIN, "/resetpersona");
}

console.log("\n== /ask");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/ask");
  await t("bare /ask explains usage", () => expect(hasReply(m, "Usage"), "no usage"));
  await aiStep(async () => {
    m = mark();
    await sendText(CHAT, ADMIN, "/ask what is 2+2? one line");
  });
  await t("ask returns a real answer", () => {
    const out = textsSince(m).filter((x) => x.length > 0 && !x.startsWith("🤔"));
    expect(out.some((x) => !x.startsWith("⚠️")), `AI error: ${out.join(" | ").slice(0, 140)}`);
  });
  const q = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "Explain photosynthesis in one sentence", { messageId: q });
  await aiStep(async () => {
    m = mark();
    await sendText(CHAT, ADMIN, "/ask", { replyTo: q });
  });
  await t("ask on a reply answers that message", () => {
    expect(repliesSince(m).some((x) => !x.startsWith("⚠️") && x.length > 0), "no answer");
  });
}

console.log("\n== /remind /reminders /delremind + scheduler");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/remind 30m stretch break");
  await t("remind confirms with UTC time", () => expect(hasReply(m, "I'll remind"), "no confirm"));
  m = mark();
  await sendText(CHAT, ADMIN, "/remind banana nothing");
  await t("remind rejects bad time", () => expect(hasReply(m, "Time formats"), "no hint"));
  let m2 = mark();
  await sendText(CHAT, ADMIN, "/remind 15s fire drill");
  await t("15s reminder accepted", () => expect(hasReply(m2, "I'll remind"), "not set"));
  await sleep(16_000);
  m = mark();
  const { processDueReminders } = await import("../src/modules/reminders.js");
  await processDueReminders(bot);
  await t("scheduler fires due reminder", () => expect(hasReply(m, "⏰ Reminder: fire drill"), "not fired"));
  m = mark();
  await sendText(CHAT, ADMIN, "/reminders");
  await t("reminders lists pending", () => expect(hasReply(m, "stretch break"), "not listed"));
  const listText = repliesSince(m).join("\n");
  const code = /<code>([a-z0-9]{6})<\/code>/.exec(listText)?.[1];
  m = mark();
  await sendText(CHAT, ADMIN, `/delremind ${code ?? "zzzzzz"}`);
  await t("delremind cancels by code", () => expect(hasReply(m, "cancelled"), "not cancelled"));
  m = mark();
  await sendText(CHAT, ADMIN, "/delremind zzzzzz");
  await t("delremind unknown code says so", () => expect(hasReply(m, "No reminder"), "wrong msg"));
}

console.log("\n== /exam /exams + daily countdown");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/exam 2026-12-25 Physics midterm");
  await t("exam countdown set", () => expect(hasReply(m, "Countdown set"), "no confirm"));
  m = mark();
  await sendText(CHAT, ADMIN, "/exams");
  await t("exams lists entries", () => expect(hasReply(m, "Physics midterm"), "not listed"));
  m = mark();
  await sendText(CHAT, ADMIN, "/exam soon X");
  await t("exam rejects non-date", () => expect(hasReply(m, "Usage"), "no usage"));
  const today = new Date().toISOString().slice(0, 10);
  await sendText(CHAT, ADMIN, `/exam ${today} FireDrill`);
  m = mark();
  const { processDueReminders } = await import("../src/modules/reminders.js");
  await processDueReminders(bot);
  await t("exam today announces TODAY", () => expect(hasReply(m, "is TODAY"), "not announced"));
}

console.log("\n== /quiz /quizstop");
{
  const quizStarted = () =>
    calls.some((c) => c.method === "sendMessage" && String(c.payload.text ?? "").includes("1/5"));
  await aiStep(async () => {
    mark();
    await sendText(CHAT, ADMIN, "/quiz photosynthesis");
  });
  if (!quizStarted()) {
    // Free-tier AI can be transiently rate-limited; retry once.
    await sleep(8000);
    await sendText(CHAT, ADMIN, "/quizstop");
    await aiStep(async () => {
      mark();
      await sendText(CHAT, ADMIN, "/quiz photosynthesis");
    });
  }
  await t("quiz generates question 1/5 with buttons", () => {
    const q = calls.filter((c) => c.method === "sendMessage" && String(c.payload.text ?? "").includes("1/5")).at(-1);
    expect(Boolean(q), "no question");
    expect(JSON.stringify(q?.payload.reply_markup ?? {}).includes("qa:"), "no buttons");
  });
  let m = mark();
  await sendCallback(USER, "qa:0");
  await t("answering advances to question 2/5", () => {
    expect(apiCalled(m, "answerCallbackQuery"), "no callback answer");
    expect(hasReply(m, "2/5"), "no next question");
  });
  m = mark();
  await sendText(CHAT, ADMIN, "/quiz another topic");
  await t("second quiz rejected while active", () => expect(hasReply(m, "already running"), "allowed"));
  for (let i = 0; i < 3; i++) await sendCallback(USER, "qa:1");
  m = mark();
  await sendCallback(USER, "qa:2");
  await t("quiz finishes with scoreboard", () => expect(hasReply(m, "finished"), "no scoreboard"));
  m = mark();
  await sendText(CHAT, ADMIN, "/quizstop");
  await t("quizstop with none says so", () => expect(hasReply(m, "No quiz"), "wrong msg"));
  await aiStep(async () => {
    m = mark();
    await sendText(CHAT, ADMIN, "/quiz world capitals");
  });
  await t("new quiz starts after stop", () => {
    expect(calls.some((c) => c.method === "sendMessage" && String(c.payload.text ?? "").includes("1/5")), "no question");
  });
  m = mark();
  await sendText(CHAT, ADMIN, "/quizstop");
  await t("quizstop ends quiz", () => expect(hasReply(m, "Quiz ended"), "not ended"));
}

console.log("\n== /summarize");
{
  let m = mark();
  await sendText(CHAT, ADMIN, "/summarize");
  await t("summarize without reply explains usage", () => expect(hasReply(m, "Reply"), "no usage"));
  const short = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "hi", { messageId: short });
  m = mark();
  await sendText(CHAT, ADMIN, "/summarize", { replyTo: short });
  await t("short message refused", () => expect(hasReply(m, "too short"), "no refusal"));
  const long = baseMessage(USER).message_id;
  await sendText(CHAT, USER, "The water cycle describes how water moves on Earth. ".repeat(12) + "Evaporation turns liquid water into vapor. Condensation forms clouds. Precipitation returns rain and snow. Runoff collects into rivers, lakes and oceans, closing the loop. ".repeat(4), { messageId: long });
  await aiStep(async () => {
    m = mark();
    await sendText(CHAT, ADMIN, "/summarize", { replyTo: long });
  });
  await t("summarize condenses long text", () => {
    expect(repliesSince(m).some((x) => x.length > 30 && !x.startsWith("⚠️")), "no summary");
  });
}

console.log("\n== /recap /resources (second chat)");
{
  let m = mark();
  await sendText(CHAT2, ADMIN, "/recap");
  await t("recap with no data explains", () => {
    expect(hasReply(m, "Not enough"), `got: ${JSON.stringify(textsSince(m).slice(0, 2)).slice(0, 200)}`);
  });
  for (let i = 0; i < 6; i++) await sendText(CHAT2, USER, `study note number ${i} about algebra`);
  await aiStep(async () => {
    m = mark();
    await sendText(CHAT2, ADMIN, "/recap");
  });
  await t("recap summarizes the day", () => {
    expect(textsSince(m).some((x) => x.length > 30 && !x.startsWith("⚠️") && !x.startsWith("📖")), "no recap");
  });
  m = mark();
  await sendText(CHAT2, ADMIN, "/resources");
  await t("resources empty state", () => {
    expect(hasReply(m, "No links"), `got: ${JSON.stringify(textsSince(m).slice(0, 2)).slice(0, 200)}`);
  });
  await sendText(CHAT2, USER, "check https://docs.example.com/guide", {
    entities: [{ offset: 6, length: 30, type: "url" }],
  });
  m = mark();
  await sendText(CHAT2, ADMIN, "/resources");
  await t("resources lists shared link", () => expect(hasReply(m, "https://docs.example.com/guide"), "not listed"));
  await sendText(CHAT2, USER, "check https://docs.example.com/guide", {
    entities: [{ offset: 6, length: 30, type: "url" }],
  });
  m = mark();
  await sendText(CHAT2, ADMIN, "/resources");
  await t("duplicate links are deduped", () => {
    const text = repliesSince(m).join("\n");
    expect(text.split("https://docs.example.com/guide").length - 1 === 1, "duplicated");
  });
}

// -------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed, ${pass + fail} total`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  • ${f}`);
}
try { fs.rmSync("data", { recursive: true, force: true }); } catch { /* scratch store */ }
process.exit(fail === 0 ? 0 : 1);
