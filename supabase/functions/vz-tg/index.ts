// ВЕЗУ: Telegram-бот @vezu_orders_bot — уведомления водителям и админу.
// 1) Вебхук Telegram (заголовок X-Telegram-Bot-Api-Secret-Token = vz_tg_webhook_secret):
//    /start <токен из кабинета> — привязать чат к визитке;
//    /start admin_<токен из админки> — привязать Telegram админа (30 мин);
//    /stop — отключить водителя или админа (если чат совпал).
//    callback: admin:ok:<card> / admin:no:<card> — только из чата админа.
// 2) Уведомление (заголовок x-vz-notify = vz_tg_notify_secret):
//    { order, tier } — заказы водителям;
//    { type: "admin_verify", card } — новая заявка админу;
//    { type: "driver_verify", card, decide, note? } — решение водителю.
// Секреты — в Supabase Vault, public.vz_tg_secrets() (только service_role).
import { createClient } from "npm:@supabase/supabase-js@2";

// Платформа переехала: avtomaster24bot-lab.github.io/dogruz → /vezu/ (03.11.2026). Старый VZ_SITE, если задан, не используем.
const SITE = "https://avtomaster24bot-lab.github.io/vezu/";
const CARGO: Record<string, string> = { move: "Переезд / мебель", appliance: "Бытовая техника", build: "Стройматериалы", trash: "Вывоз мусора", other: "Другое" };
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

let S: Record<string, string> | null = null, sAt = 0;
async function secrets() {
  if (!S || Date.now() - sAt > 300_000) {
    const { data, error } = await db.rpc("vz_tg_secrets");
    if (error) throw new Error("secrets");
    S = (data ?? {}) as Record<string, string>; sAt = Date.now();
  }
  return S;
}
function eq(a: string, b: string) {   // сравнение без утечки по времени
  if (!a || !b || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function tg(method: string, payload: unknown) {
  const tok = (await secrets()).vz_tg_bot_token;
  if (!tok) return { ok: false, description: "no token" };
  const r = await fetch(`https://api.telegram.org/bot${tok}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return await r.json().catch(() => ({ ok: false }));
}
const esc = (s: string) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const ok = (b: unknown = { ok: true }) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });

function briefWhat(j: Record<string, unknown>) {
  const raw = String(j.what ?? "").replace(/\s+/g, " ").trim();
  const words = raw.split(" ").filter(Boolean).slice(0, 6).join(" ");
  return words.length > 42 ? words.slice(0, 42).replace(/\s+\S*$/, "") : words;
}
function briefLine(j: Record<string, unknown>) {
  const what = briefWhat(j);
  const price = typeof j.price === "number" ? Number(j.price).toLocaleString("ru-RU") + " ₸" : "цена договорная";
  return "Новый заказ. " + (what ? what + ". " : "") + price;
}
function orderText(j: Record<string, unknown>) {
  const lines = [j.scope === "picked" ? "🚚 <b>Заказ лично вам</b>" : "🚚 <b>Новый заказ в ленте ВЕЗУ</b>"];
  lines.push(briefLine(j));
  if (j.cargo && CARGO[j.cargo as string]) lines.push("📦 " + CARGO[j.cargo as string]);
  if (j.city) lines.push("🏙 " + esc(String(j.city)));
  const route = [j.from, j.to].filter(Boolean).map((x) => esc(String(x))).join(" → ");
  if (route) lines.push("📍 " + route);
  let when = String(j.when ?? "");
  if (j.when_at) when = new Date(String(j.when_at)).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  if (when) lines.push("🕒 " + esc(when));
  if (typeof j.km === "number") lines.push("🛣 ≈ " + j.km + " км");
  if (typeof j.price === "number") lines.push("💰 Цена клиента: " + j.price.toLocaleString("ru-RU") + " ₸");
  lines.push("", "Телефон клиента увидит только водитель, которого клиент выберет. Откликнуться — в ленте:");
  return lines.join("\n");
}

function chosenText(j: Record<string, unknown>) {
  const lines = ["✅ <b>Вас выбрали на заказ</b>"];
  if (j.what) lines.push("📦 " + esc(String(j.what)));
  else if (j.cargo && CARGO[j.cargo as string]) lines.push("📦 " + CARGO[j.cargo as string]);
  if (j.city) lines.push("🏙 " + esc(String(j.city)));
  const route = [j.from, j.to].filter(Boolean).map((x) => esc(String(x))).join(" → ");
  if (route) lines.push("📍 " + route);
  if (typeof j.price === "number") lines.push("💰 Цена: " + Number(j.price).toLocaleString("ru-RU") + " ₸");
  lines.push("", "Телефон клиента — в ленте ВЕЗУ, в карточке этого заказа.");
  return lines.join("\n");
}

async function notify(order: string, tier: string) {
  const rpc = tier === "chosen" ? "vz_tg_chosen" : "vz_tg_job";
  const args = tier === "chosen" ? { p_order: order } : { p_order: order, p_tier: tier };
  const { data, error } = await db.rpc(rpc, args);
  if (error || !data) return { sent: 0 };
  const j = data as Record<string, unknown>, chats = (j.chats as number[]) ?? [];
  const text = tier === "chosen" ? chosenText(j) : orderText(j);
  let sent = 0;
  for (const chat of chats) {
    const r = await tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "Открыть ленту заказов", url: SITE + "app.html#feed" }]] } });
    if (r.ok) sent++;
    else if (r.error_code === 403) await db.rpc("vz_tg_unbind_chat", { p_chat: chat });   // водитель заблокировал бота — забываем chat_id
    await new Promise((res) => setTimeout(res, 40));
  }
  return { sent };
}

async function notifyAdmin(card: string) {
  const { data: chat } = await db.rpc("vz_tg_admin_chat");
  if (!chat) { console.log("admin telegram not linked, skip notify"); return { sent: 0, skipped: "not_linked" }; }
  const { data: c } = await db.from("vz_cards").select("id, slug, phone, city, veh, data").eq("id", card).maybeSingle();
  if (!c) return { sent: 0, skipped: "no_card" };
  const { data: v } = await db.from("vz_verify_req").select("plate, created_at").eq("card_id", card).maybeSingle();
  const d = (c.data ?? {}) as Record<string, unknown>;
  const name = String(d.n ?? "Водитель");
  const car = [d.c, d.w, c.veh].filter(Boolean).map(String);
  const lines = [
    "🪪 <b>Визитка на проверке</b>",
    "👤 " + esc(name),
    "📞 +" + esc(String(c.phone ?? "")),
  ];
  if (c.city) lines.push("🏙 " + esc(String(c.city)));
  if (car.length) lines.push("🚚 " + esc(car.filter((x, i, a) => a.indexOf(x) === i).join(" · ")));
  if (v && v.plate) lines.push("🔢 Госномер: " + esc(String(v.plate)));
  const url = c.slug ? SITE + c.slug : SITE + "admin.html";
  lines.push("", "Открыть визитку: " + url, "Список заявок: " + SITE + "admin.html");
  const r = await tg("sendMessage", {
    chat_id: chat,
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Одобрить", callback_data: "admin:ok:" + card },
          { text: "❌ Отклонить", callback_data: "admin:no:" + card },
        ],
        [{ text: "Открыть админку", url: SITE + "admin.html" }],
      ],
    },
  });
  if (!r.ok) { console.log("admin notify failed", r.error_code || r.description || "unknown"); return { sent: 0 }; }
  return { sent: 1 };
}

async function notifyDriver(card: string, decide: string, note?: string) {
  const { data: t } = await db.from("vz_tg").select("chat_id, enabled").eq("card_id", card).maybeSingle();
  if (!t || !t.enabled || !t.chat_id) { console.log("driver telegram not linked, skip notify"); return { sent: 0, skipped: "not_linked" }; }
  const okDecide = decide === "ok";
  const text = okDecide
    ? "✅ <b>Ваша визитка одобрена</b>\nЗначок «Одобрена» уже в приложении. Открыть визитку: " + SITE + "app.html#mycard"
    : "✏️ <b>Визитку нужно исправить</b>\n" + esc((note || "Проверьте данные и фото машины, затем отправьте ещё раз.").slice(0, 200)) + "\nОткрыть: " + SITE + "app.html#mycard";
  const r = await tg("sendMessage", {
    chat_id: t.chat_id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: "Моя визитка", url: SITE + "app.html#mycard" }]] },
  });
  if (r.ok) return { sent: 1 };
  if (r.error_code === 403) await db.rpc("vz_tg_unbind_chat", { p_chat: t.chat_id });
  console.log("driver notify failed", r.error_code || r.description || "unknown");
  return { sent: 0 };
}

async function onCallback(q: Record<string, any>) {
  const id = String(q.id ?? "");
  const chat = q.message && q.message.chat ? q.message.chat.id : q.from && q.from.id;
  const data = String(q.data ?? "");
  const m = data.match(/^admin:(ok|no):([0-9a-f-]{36})$/);
  const ack = (text: string) => tg("answerCallbackQuery", { callback_query_id: id, text, show_alert: true });
  if (!m) { if (id) await ack("Неизвестная команда"); return; }
  const { data: admin } = await db.rpc("vz_tg_admin_chat");
  if (!admin || Number(chat) !== Number(admin)) { await ack("Нет прав — это только для админа ВЕЗУ"); return; }
  const decide = m[1], card = m[2];
  const note = decide === "no" ? "Проверьте данные и фото машины, затем отправьте ещё раз." : "";
  const upd = decide === "ok"
    ? { verified_at: new Date().toISOString(), verify_note: "" }
    : { verify_note: note };
  const { error } = await db.from("vz_cards").update(upd).eq("id", card);
  if (error) { console.error("decide", error); await ack("Не удалось сохранить решение"); return; }
  const { data: files } = await db.storage.from("vz_verify").list(card);
  if (files && files.length) await db.storage.from("vz_verify").remove(files.map((f: { name: string }) => card + "/" + f.name));
  await db.from("vz_verify_req").delete().eq("card_id", card);
  try { await notifyDriver(card, decide, note); } catch (e) { console.log("driver notify error"); }
  await ack(decide === "ok" ? "Одобрено" : "Отклонено");
  if (q.message && q.message.chat && q.message.message_id) {
    await tg("editMessageReplyMarkup", { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: decide === "ok" ? "✅ Одобрено" : "❌ Отклонено", callback_data: "done" }]] } });
  }
}

async function onUpdate(u: Record<string, any>) {
  if (u.callback_query) { try { await onCallback(u.callback_query); } catch (_) { /* ignore */ } return; }
  const m = u.message; if (!m || !m.chat || m.chat.type !== "private") return;
  const chat = m.chat.id as number, text = String(m.text ?? "").trim();
  const adminStart = text.match(/^\/start\s+admin_([a-f0-9]{32})$/i);
  if (adminStart) {
    const { data } = await db.rpc("vz_tg_admin_bind", { p_token: adminStart[1].toLowerCase(), p_chat: chat });
    if (data) return tg("sendMessage", { chat_id: chat, text: "✅ Telegram админа ВЕЗУ подключён. Сюда будут приходить заявки на проверку визиток — можно одобрить или отклонить прямо в этом чате. Отключить — /stop" });
    return tg("sendMessage", { chat_id: chat, text: "Ссылка устарела. Откройте админку ВЕЗУ → «Подключить Telegram админа» ещё раз (действует 30 минут)." });
  }
  const start = text.match(/^\/start(?:\s+([a-f0-9]{32}))?$/i);
  if (start && start[1]) {
    const { data } = await db.rpc("vz_tg_bind", { p_token: start[1].toLowerCase(), p_chat: chat });
    if (data) return tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text: `✅ Готово! Telegram подключён к визитке <b>${esc((data as any).name || "водителя")}</b>.\nНовые заказы из ленты ВЕЗУ будут приходить сюда. Города можно выбрать в кабинете. Отключить — /stop` });
    return tg("sendMessage", { chat_id: chat, text: "Ссылка устарела. Откройте кабинет ВЕЗУ → «Уведомления в Telegram» → «Подключить» ещё раз." });
  }
  if (/^\/stop\b/i.test(text)) {
    const { data: adm } = await db.rpc("vz_tg_admin_unbind", { p_chat: chat });
    const { data } = await db.rpc("vz_tg_unbind_chat", { p_chat: chat });
    if (adm) return tg("sendMessage", { chat_id: chat, text: "Telegram админа отключён. Заявки больше не будут приходить в этот чат. Подключить снова можно в админке." });
    return tg("sendMessage", { chat_id: chat, text: data ? "Уведомления отключены, ваш Telegram отвязан от визитки." : "Этот Telegram не был подключён к визитке." });
  }
  return tg("sendMessage", { chat_id: chat, text: "Это бот уведомлений ВЕЗУ. Водитель подключает его в кабинете визитки: " + SITE + "app.html#settings. Админ — в админке. Отключить — /stop" });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  let s: Record<string, string>;
  try { s = await secrets(); } catch { return new Response("unavailable", { status: 503 }); }
  const hook = req.headers.get("x-telegram-bot-api-secret-token") ?? "", nt = req.headers.get("x-vz-notify") ?? "";
  const body = await req.json().catch(() => null);
  if (!body) return new Response("bad", { status: 400 });
  if (hook && eq(hook, s.vz_tg_webhook_secret ?? "")) { try { await onUpdate(body); } catch (_) { /* Telegram не должен повторять */ } return ok(); }
  if (nt && eq(nt, s.vz_tg_notify_secret ?? "")) {
    const typ = String(body.type ?? "");
    if (typ === "admin_verify") {
      if (!/^[0-9a-f-]{36}$/.test(String(body.card ?? ""))) return new Response("bad", { status: 400 });
      return ok(await notifyAdmin(String(body.card)));
    }
    if (typ === "driver_verify") {
      if (!/^[0-9a-f-]{36}$/.test(String(body.card ?? "")) || !["ok", "no"].includes(String(body.decide ?? ""))) return new Response("bad", { status: 400 });
      return ok(await notifyDriver(String(body.card), String(body.decide), body.note ? String(body.note) : undefined));
    }
    if (!/^[0-9a-f-]{36}$/.test(String(body.order ?? "")) || !["pro", "all", "chosen"].includes(body.tier)) return new Response("bad", { status: 400 });
    return ok(await notify(body.order, body.tier));
  }
  return new Response("forbidden", { status: 403 });
});
