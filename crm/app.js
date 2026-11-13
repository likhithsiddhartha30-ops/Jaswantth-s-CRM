/* CRM — shared data layer, sign-in, navigation, modal and per-page rendering.
   Data lives in Supabase (see config.js and supabase/schema.sql); each page loads it on open. */

const SESSION_KEY = "lumen-crm-session";
// Shown in the sidebar, sign-in page and tab titles; set CRM_NAME in config.js.
const APP_NAME = (window.CRM_NAME || "CRM").trim() || "CRM";
// Opportunity pipeline statuses. Each one is Active (still in play), Won (counts as revenue) or Lost.
const STAGE_TYPES = ["Active", "Won", "Lost"];
const DEFAULT_STAGES = ["Typeform Lead", "Qualified (Didn't Book)", "Call Booked", "Pitched (Didn't Close)", "PIF", "Unqualified", "In-House Finance"];
const DEFAULT_STAGE_TYPES = { "Typeform Lead": "Active", "Qualified (Didn't Book)": "Active", "Call Booked": "Active", "Pitched (Didn't Close)": "Active", PIF: "Won", Unqualified: "Lost", "In-House Finance": "Won" };
const DEFAULT_STATUSES = ["Typeform Lead", "Qualified (Didn't Book)", "Call Booked", "No Showed / Cancelled", "Pitched (Didn't Close)", "Closed", "Expired", "Past Due / Inactive", "Unqualified"];
// Older saved data used these defaults; they are mapped onto the new names on load.
const OLD_STAGE_MAP = { Lead: "Typeform Lead", Qualified: "Qualified (Didn't Book)", Proposal: "Call Booked", Negotiation: "Pitched (Didn't Close)", Won: "PIF" };
const OLD_STATUS_MAP = { Lead: "Typeform Lead", Active: "Call Booked", Customer: "Closed", Churned: "Past Due / Inactive" };
const DEFAULT_SOURCES = ["Instagram", "Referral", "Website", "Meta Ads", "YouTube"];
const CALL_TYPES = ["Discovery call", "Follow-up", "Demo", "Onboarding", "Check-in"];
const CALL_STATUSES = ["Scheduled", "Completed", "No-show", "Cancelled"];
const PAYMENT_METHODS = ["", "UPI", "Bank transfer", "Card", "Stripe", "Razorpay", "PayPal", "Cash", "Other"];
// Default colours for stages, lead stages and sources, handed out in this order.
// Checked for colour-blind separation and contrast against the dark surface.
const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const COLOR_KINDS = ["stages", "statuses", "sources"];
const GRAY = "#7a7a85";
const NAMED_COLORS = {
  "Typeform Lead": GRAY, "Qualified (Didn't Book)": "#3987e5", "Call Booked": "#c98500", "No Showed / Cancelled": GRAY,
  "Pitched (Didn't Close)": "#d95926", Closed: "#008300", Expired: "#199e70", "Past Due / Inactive": "#199e70", Unqualified: GRAY,
  PIF: "#008300", "In-House Finance": "#199e70",
};

/* ---------- Config ----------
   Business defaults and display limits — change these to tune the app without touching logic. */
const REVENUE_GOAL_DEFAULT = 30000;
const NEW_LEADS_DAYS = 30;
const ACTIVITY_MAX = 40;
const DASH_ACTIVITY_ROWS = 6;
const DASH_TASK_ROWS = 5;
const DASH_LEAD_ROWS = 5;
const REVENUE_MONTHS = 6;
const MARKETING_WEEKS = 8;
const CLOSE_DAYS_DEFAULT = 14;
const PAST_CALLS_MAX = 10;
const TOP_CLIENTS_MAX = 5;
const FOLLOWUP_DAYS = 1;
const BIG_DEAL_MIN = 10000;

const uid = () => Math.random().toString(36).slice(2, 10);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return ymd(d); };
const parseDay = (s) => new Date(s + "T00:00");
const money = (n) => "$" + Math.round(Number(n || 0)).toLocaleString("en-US");
const pct = (n) => (isFinite(n) ? Math.round(n * 100) : 0) + "%";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (name) => (name || "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const sum = (arr, fn) => arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);
const $ = (sel, root = document) => root.querySelector(sel);
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

// A fresh, empty CRM: the default pipeline statuses, lead stages and sources, and no records.
function seed() {
  return {
    stages: [...DEFAULT_STAGES], stageTypes: { ...DEFAULT_STAGE_TYPES }, statuses: [...DEFAULT_STATUSES], sources: [...DEFAULT_SOURCES],
    contacts: [], deals: [], tasks: [], calls: [], campaigns: [], integrations: {}, revenueGoal: REVENUE_GOAL_DEFAULT, activity: [],
  };
}

// Fill in anything an older saved copy (or an imported backup) is missing.
function normalize(data) {
  const fresh = seed();
  data.stages ||= fresh.stages;
  data.statuses ||= fresh.statuses;
  data.sources ||= fresh.sources;
  data.contacts ||= []; data.deals ||= []; data.tasks ||= []; data.activity ||= [];
  data.colors ||= {};

  // Untouched old default lists move onto the new stage names, records included.
  const same = (a, b) => a.length === Object.keys(b).length && a.every((x) => x in b);
  if (same(data.stages, OLD_STAGE_MAP)) {
    data.deals.forEach((d) => { d.stage = OLD_STAGE_MAP[d.stage] || DEFAULT_STAGES[0]; });
    data.stages = [...DEFAULT_STAGES]; data.stageTypes = { ...DEFAULT_STAGE_TYPES }; data.colors.stages = {};
  }
  if (same(data.statuses, OLD_STATUS_MAP)) {
    data.contacts.forEach((c) => { c.status = OLD_STATUS_MAP[c.status] || DEFAULT_STATUSES[0]; });
    data.statuses = [...DEFAULT_STATUSES]; data.colors.statuses = {};
  }
  if (!data.stageTypes) { // saved before stages had types: guess from the name, and the last stage was the won one
    data.stageTypes = {};
    data.stages.forEach((s) => { data.stageTypes[s] = /won|closed|pif|paid|finance/i.test(s) ? "Won" : /lost|unqualified|dead/i.test(s) ? "Lost" : "Active"; });
    if (!data.stages.some((s) => data.stageTypes[s] === "Won")) data.stageTypes[data.stages[data.stages.length - 1]] = "Won";
  }
  data.stages.forEach((s) => { if (!STAGE_TYPES.includes(data.stageTypes[s])) data.stageTypes[s] = "Active"; });
  data.views ||= defaultViews(data);
  data.contacts.forEach((c) => { c.source ||= data.sources[0]; });
  data.calls ||= [];
  data.campaigns ||= fresh.campaigns;
  data.integrations ||= {};
  data.revenueGoal ||= fresh.revenueGoal;
  COLOR_KINDS.forEach((kind) => { data.colors[kind] ||= {}; data[kind].forEach((name) => assignColor(data, kind, name)); });
  return data;
}
// Starter smart views for the Leads page; they can be edited or deleted like any other.
function defaultViews(data) {
  const f = (o) => ({ statuses: [], sources: [], added: 0, deal: "any", next: "any", minValue: 0, ...o });
  return [
    { id: uid(), name: "New this week", filters: f({ added: 7 }) },
    { id: uid(), name: "Calls booked", filters: f({ next: "call" }) },
    { id: uid(), name: "Needs follow-up", filters: f({ statuses: data.statuses.slice(0, 3), next: "none" }) },
    { id: uid(), name: "Clients", filters: f({ deal: "won" }) },
    { id: uid(), name: `Big deals $${(BIG_DEAL_MIN / 1000).toFixed(0)}k+`, filters: f({ minValue: BIG_DEAL_MIN }) },
  ];
}
// Give a name the first palette colour its list isn't using yet, so colours stay put when lists are reordered.
function assignColor(data, kind, name) {
  const map = data.colors[kind];
  if (/^#[0-9a-f]{6}$/i.test(map[name] || "")) return;
  if (NAMED_COLORS[name]) { map[name] = NAMED_COLORS[name]; return; }
  const used = new Set(Object.values(map));
  map[name] = PALETTE.find((c) => !used.has(c)) || PALETTE[Object.keys(map).length % PALETTE.length];
}
function log(text) { db.activity.unshift({ id: uid(), text, at: Date.now() }); db.activity = db.activity.slice(0, ACTIVITY_MAX); }

let db;
const contactOf = (id) => db.contacts.find((c) => c.id === id);
const contactName = (id) => contactOf(id)?.name || "—";
const stageType = (stage) => db.stageTypes[stage] || "Active";
const isWon = (d) => stageType(d.stage) === "Won";
const isOpen = (d) => stageType(d.stage) === "Active";
const typeBadge = (type) => `<span class="type t-${type}">${type}</span>`;
const colorOf = (kind, name) => { const c = db.colors[kind]?.[name]; return /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#8d8798"; };
// A coloured dot plus the name in normal text, so the label never relies on colour alone.
const tag = (kind, name) => `<span class="tag" style="--c:${colorOf(kind, name)}"><i></i>${esc(name)}</span>`;
const statusBadge = (s) => tag("statuses", s);
const callBadge = (s) => `<span class="badge call-${s.replace(/\W/g, "")}">${esc(s)}</span>`;
const fmtDate = (s, opts = { month: "short", day: "numeric" }) => parseDay(s).toLocaleDateString("en-US", opts);
const fmtTime = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}
function dueInfo(date) {
  const diff = Math.round((parseDay(date) - parseDay(day())) / 86400e3);
  if (diff < 0) return { cls: "overdue", text: diff === -1 ? "Yesterday" : `${-diff} days overdue` };
  if (diff === 0) return { cls: "today", text: "Today" };
  if (diff === 1) return { cls: "later", text: "Tomorrow" };
  return { cls: "later", text: fmtDate(date) };
}
const relDay = (date) => { const d = dueInfo(date); return d.cls === "overdue" ? fmtDate(date) : d.text; };

/* ---------- Files ---------- */
function download(name, text, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const toCSV = (rows) => rows.map((r) => r.map((v) => { v = String(v ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\n");
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/* ---------- Supabase ----------
   Each record is a row in its own table, shared by the whole team; the editable lists, colours, views
   and goal are the single workspace row. save() compares db with what was last synced and sends only the changes. */
// Invite and password-reset emails land here with the session in the URL hash; read it before supabase-js clears it.
const LINK = new URLSearchParams(location.hash.slice(1));
const SET_PASSWORD_LINK = ["invite", "recovery"].includes(LINK.get("type"));
const sb = window.supabase && window.SUPABASE_URL && !/^YOUR_/.test(window.SUPABASE_URL)
  ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY) : null;
// Table name -> the record fields stored in it (camelCase here, snake_case in the database).
const TABLES = {
  contacts: ["name", "company", "email", "phone", "status", "source", "created", "notes"],
  deals: ["title", "contactId", "value", "paidUpfront", "paymentMethod", "stage", "close"],
  calls: ["contactId", "type", "status", "date", "time", "duration", "inviteLead", "guestEmail", "notes"],
  tasks: ["title", "contactId", "due", "priority", "done"],
  campaigns: ["name", "channel", "start", "spend", "impressions", "clicks", "leads"],
  activity: ["text", "at"],
};
const TABLE_ORDER = { contacts: "inserted_at", deals: "inserted_at", calls: "inserted_at", tasks: "inserted_at", campaigns: "inserted_at", activity: "at" };
const SETTINGS = ["stages", "stageTypes", "statuses", "sources", "colors", "views", "integrations", "revenueGoal"];
const DATE_COLS = new Set(["created", "close", "date", "due", "start", "time"]);
const NUM_COLS = new Set(["value", "paidUpfront", "duration", "spend", "impressions", "clicks", "leads"]);
const snake = (k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

function toRow(table, rec) {
  const row = { id: rec.id };
  TABLES[table].forEach((k) => {
    let v = rec[k];
    if (k === "contactId") v = contactOf(v) ? v : null; // a lead that no longer exists can't be referenced
    else if (k === "at") v = new Date(v || Date.now()).toISOString();
    else if (DATE_COLS.has(k)) v = v || null; // empty date inputs give "", which Postgres won't take
    else if (NUM_COLS.has(k)) v = Number(v) || 0;
    else if (k === "done") v = !!v;
    else v = v ?? "";
    row[snake(k)] = v;
  });
  return row;
}
function fromRow(table, row) {
  const rec = { id: row.id };
  TABLES[table].forEach((k) => {
    let v = row[snake(k)];
    if (k === "at") v = Date.parse(v);
    else if (k === "time") v = v ? v.slice(0, 5) : "";
    else if (NUM_COLS.has(k)) v = Number(v) || 0;
    else if (k === "done") v = !!v;
    else v = v ?? "";
    rec[k] = v;
  });
  return rec;
}
const settingsRow = () => ({ id: true, ...Object.fromEntries(SETTINGS.map((k) => [snake(k), db[k]])), updated_at: new Date().toISOString() });

// What the database holds: a JSON string per row, so changed rows are found by comparing strings.
let synced = null;
function snapshot() {
  const s = { settings: JSON.stringify({ ...settingsRow(), updated_at: null }) };
  for (const t in TABLES) s[t] = new Map(db[t].map((r) => [r.id, JSON.stringify(toRow(t, r))]));
  return s;
}
const check = async (query) => { const { error } = await query; if (error) throw error; };

async function flush() {
  const now = snapshot(), prev = synced, tables = Object.keys(TABLES), blocked = new Set();
  // Leads go first so the other rows can point at them; deletions run the other way round.
  // Changes this role isn't allowed to make are skipped (the database would refuse them anyway).
  for (const t of tables) {
    const rows = [...now[t]].filter(([id, json]) => prev[t].get(id) !== json).map(([, json]) => JSON.parse(json));
    if (!rows.length) continue;
    if (can(t)) await check(sb.from(t).upsert(rows)); else blocked.add(t);
  }
  if (now.settings !== prev.settings) {
    if (can("workspace")) await check(sb.from("workspace").upsert(settingsRow())); else blocked.add("settings");
  }
  for (const t of [...tables].reverse()) {
    const gone = [...prev[t].keys()].filter((id) => !now[t].has(id));
    if (!gone.length) continue;
    if (can(t)) await check(sb.from(t).delete().in("id", gone)); else blocked.add(t);
  }
  synced = now;
  if (blocked.size) notify(`View only: your role can't change ${[...blocked].join(", ")}, so those edits weren't saved.`);
}

// Saves run one after another; a failed one is retried in full by the next save.
let saving = Promise.resolve(), unsaved = 0;
function save() {
  unsaved++;
  saving = saving.then(flush).catch((e) => { console.error(e); notify("Couldn't save to Supabase: " + e.message); }).finally(() => unsaved--);
  return saving;
}
addEventListener("beforeunload", (e) => { if (unsaved) { e.preventDefault(); e.returnValue = ""; } });

async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    // Clients read lead names only, through a view without emails and phone numbers.
    const source = table === "contacts" && user.role === "client" ? "contact_names" : table;
    const { data, error } = await sb.from(source).select("*").order(TABLE_ORDER[table]).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
async function loadDb() {
  const tables = Object.keys(TABLES);
  const [settings, ...lists] = await Promise.all([sb.from("workspace").select("*").maybeSingle(), ...tables.map(fetchAll)]);
  if (settings.error) throw settings.error;
  // Everyone shares one workspace; until the admin first saves it, the default stages and sources apply.
  const data = settings.data ? Object.fromEntries(SETTINGS.map((k) => [k, settings.data[snake(k)]])) : seed();
  tables.forEach((t, i) => { data[t] = lists[i].map((r) => fromRow(t, r)); });
  data.activity.reverse(); // newest first
  db = normalize(data);
  synced = snapshot();
  if (!settings.data && can("workspace")) { synced.settings = null; return save(); }
}

function notify(text) {
  let el = $("#notice");
  if (!el) {
    el = document.createElement("p");
    el.id = "notice"; el.className = "msg bad"; el.setAttribute("role", "alert");
    el.style.cssText = "position:fixed;right:16px;bottom:16px;max-width:360px;margin:0;padding:12px 14px;border-radius:10px;background:var(--surface,#1b1a20);border:1px solid currentColor;z-index:100";
    document.body.appendChild(el);
  }
  el.textContent = text;
}

/* ---------- Roles ----------
   One shared CRM. A person's role (from the team list) decides which pages they see and what they can change;
   supabase/roles.sql enforces the same rules in the database. */
const ROLES = { admin: "Admin", setter: "Setter", closer: "Closer", media_buyer: "Media buyer", client: "Client" };
const EVERYONE = Object.keys(ROLES);
const PAGE_ROLES = {
  dashboard: EVERYONE, settings: EVERYONE,
  leads: ["admin", "setter", "closer", "media_buyer"],
  pipeline: ["admin", "closer", "client"],
  calendar: ["admin", "setter", "closer"],
  tasks: ["admin", "setter", "closer"],
  marketing: ["admin", "media_buyer", "client"],
  revenue: ["admin", "closer", "client"],
  integrations: ["admin"], team: ["admin"],
};
const WRITE_ROLES = {
  contacts: ["admin", "setter", "closer"], deals: ["admin", "closer"], calls: ["admin", "setter", "closer"], tasks: ["admin", "setter", "closer"],
  campaigns: ["admin", "media_buyer"], activity: ["admin", "setter", "closer", "media_buyer"], workspace: ["admin"],
};
// The table each page edits: a role that can see the page but not write this table gets it read-only.
const PAGE_TABLE = { leads: "contacts", pipeline: "deals", calendar: "calls", tasks: "tasks", marketing: "campaigns", revenue: "workspace" };
const can = (table) => !!WRITE_ROLES[table]?.includes(user?.role);
const canSee = (p) => !!PAGE_ROLES[p]?.includes(user?.role);
const readOnly = () => document.body.classList.contains("read-only");

/* ---------- Sign-in ----------
   Accounts are Supabase Auth users. SESSION_KEY is only a hint so pages can bounce
   signed-out visitors before app.js loads; the real check is the Supabase session. */
let user = null;
const currentUser = () => user;
const toUser = (u, member) => ({ id: u.id, email: u.email, role: member?.role || null, name: u.user_metadata?.name || member?.name || u.email.split("@")[0] });
async function signOut() { await sb.auth.signOut(); write(SESSION_KEY, null); location.href = "login.html"; }

/* ---------- Navigation ---------- */
const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  leads: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5.5-5-6"/>',
  pipeline: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  tasks: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  marketing: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
  revenue: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  integrations: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/>',
  team: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8M15 9h3M15 13h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const NAV = [
  ["index.html", "Overview", "dashboard"],
  ["leads.html", "Leads", "leads"],
  ["pipeline.html", "Pipeline", "pipeline"],
  ["calendar.html", "Calls & Calendar", "calendar"],
  ["tasks.html", "Tasks & Follow-ups", "tasks"],
  ["marketing.html", "Marketing Analytics", "marketing"],
  ["revenue.html", "Revenue", "revenue"],
  null, // divider
  ["team.html", "Team", "team"],
  ["integrations.html", "Integrations", "integrations"],
  ["settings.html", "Settings", "settings"],
];

function renderNav(page) {
  const user = currentUser();
  $("#nav").className = "sidebar";
  // Only the pages this role can open, without a divider left dangling at either end.
  const items = NAV.filter((item) => !item || canSee(item[2])).filter((item, i, a) => item || (i > 0 && i < a.length - 1 && a[i - 1]));
  $("#nav").innerHTML = `
    <a class="brand" href="index.html">${esc(APP_NAME)}</a>
    <nav class="nav">${items.map((item) => item ? `
      <a href="${item[0]}" class="${item[2] === page ? "active" : ""}" title="${item[1]}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[item[2]]}</svg>
        <span>${item[1]}</span>
      </a>` : '<hr class="nav-divider">').join("")}
    </nav>
    <div class="sidebar-foot">
      <div class="person"><div class="avatar">${initials(user.name)}</div><div style="min-width:0"><div class="name">${esc(user.name)}</div><span class="role">${ROLES[user.role]}</span><button id="signout">Sign out</button></div></div>
    </div>`;
  $("#signout").onclick = signOut;
  // In-page links ("View board", "All leads"…) to pages this role can't open are hidden too.
  document.querySelectorAll('main a[href$=".html"]').forEach((a) => {
    const item = NAV.find((n) => n && n[0] === a.getAttribute("href"));
    if (item && !canSee(item[2])) a.hidden = true;
  });
}

/* ---------- Tooltip for chart marks ---------- */
function initTooltips() {
  const tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);
  const show = (el) => {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    tip.style.left = Math.min(innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2)) + "px";
    tip.style.top = Math.max(8, r.top - t.height - 8) + "px";
  };
  document.addEventListener("mouseover", (e) => { const el = e.target.closest("[data-tip]"); el ? show(el) : (tip.hidden = true); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) show(el); });
  document.addEventListener("focusout", () => (tip.hidden = true));
  addEventListener("scroll", () => (tip.hidden = true), true);
}

/* Single-series column chart. Only the latest bar carries a printed value; the rest show on hover. */
function columnChart(el, points, { format = String, goal } = {}) {
  const max = Math.max(1, goal || 0, ...points.map((p) => p.value));
  el.innerHTML = `
    <div class="cols">
      ${goal ? `<div class="goal-line" style="bottom:${(goal / max) * 100}%"><span>Goal ${esc(format(goal))}</span></div>` : ""}
      ${points.map((p, i) => `<div class="col" tabindex="0" data-tip="${esc(p.label)}: ${esc(format(p.value))}">
        ${i === points.length - 1 ? `<span class="col-val">${esc(format(p.value))}</span>` : ""}
        <div class="col-bar ${i === points.length - 1 ? "latest" : ""}" style="height:${(p.value / max) * 100}%"></div></div>`).join("")}
    </div>
    <div class="col-labels">${points.map((p) => `<span>${esc(p.short)}</span>`).join("")}</div>`;
}

/* ---------- Modal ---------- */
function openModal({ title, fields, values = {}, onSave, onDelete, saveLabel = "Save" }) {
  const root = $("#modal-root");
  const control = (f) => {
    const v = esc(values[f.name] ?? f.default ?? "");
    if (f.type === "select") return `<select class="input" name="${f.name}">${f.options.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(values[f.name] ?? f.default ?? "") ? "selected" : ""}>${esc(lab)}</option>`).join("")}</select>`;
    if (f.type === "textarea") return `<textarea class="input" name="${f.name}" rows="3">${v}</textarea>`;
    return `<input class="input" type="${f.type || "text"}" name="${f.name}" value="${v}" ${f.required ? "required" : ""} ${f.type === "number" ? 'min="0"' : ""}>`;
  };
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" novalidate>
        <h2>${esc(title)}</h2>
        <div class="form">${fields.map((f) => `<div class="field ${f.full ? "full" : ""}"><label>${f.label}</label>${control(f)}</div>`).join("")}</div>
        <div class="modal-actions">
          ${onDelete ? '<button type="button" class="btn btn-ghost btn-danger" data-act="delete">Delete</button>' : ""}
          <button type="button" class="btn" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${saveLabel}</button>
        </div>
      </form>
    </div>`;
  const form = $("form", root);
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  $(".modal-backdrop", root).addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) close(); });
  $('[data-act="cancel"]', root).onclick = close;
  if (onDelete) $('[data-act="delete"]', root).onclick = () => { if (confirm("Delete this item?")) { onDelete(); close(); } };
  form.onsubmit = (e) => {
    e.preventDefault();
    const missing = fields.find((f) => f.required && !form.elements[f.name].value.trim());
    if (missing) { form.elements[missing.name].focus(); return; }
    const data = {};
    fields.forEach((f) => { const raw = form.elements[f.name].value; data[f.name] = f.type === "number" ? Number(raw) : raw.trim(); });
    onSave(data); close();
  };
  if (readOnly()) {
    $("h2", root).textContent = title.replace(/^Edit\b/, "View");
    form.querySelectorAll("input, select, textarea").forEach((el) => { el.disabled = true; });
    $('[type="submit"]', root).hidden = true;
    $('[data-act="delete"]', root)?.remove();
    $('[data-act="cancel"]', root).textContent = "Close";
  }
  form.elements[0]?.focus();
}

const contactOptions = () => db.contacts.map((c) => [c.id, `${c.name} · ${c.company}`]);

/* ---------- Overview ---------- */
function renderDashboard() {
  const open = db.deals.filter(isOpen);
  const won = db.deals.filter(isWon);
  const pending = db.tasks.filter((t) => !t.done);
  const dueToday = pending.filter((t) => t.due <= day());
  const byStage = db.stages.map((s) => [s, db.deals.filter((d) => d.stage === s).length]);
  const max = Math.max(1, ...byStage.map(([, v]) => v));
  const callsToday = db.calls.filter((c) => c.date === day() && c.status === "Scheduled");
  const wonThisMonth = won.filter((d) => d.close.startsWith(ymd(new Date()).slice(0, 7)));
  // Cards for data this role can't read are left out rather than shown empty.
  $("#calls").closest(".card").hidden = !canSee("calendar");
  $("#upcoming").closest(".card").hidden = !canSee("tasks");
  $("#activity").closest(".card").hidden = user.role === "client";

  $("#kpis").innerHTML = [
    ["Open pipeline", money(sum(open, (d) => d.value)), `${open.length} active deals`],
    ["Revenue won", money(sum(won, (d) => d.value)), `${won.length} closed`],
    ["Leads", db.contacts.length, `${db.contacts.filter((c) => c.created >= day(-NEW_LEADS_DAYS)).length} new in ${NEW_LEADS_DAYS} days`],
    canSee("calendar") ? ["Calls today", callsToday.length, `${dueToday.length} tasks due now`] : ["Won this month", money(sum(wonThisMonth, (d) => d.value)), `${wonThisMonth.length} deals`],
  ].map(([l, v, s]) => `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join("");

  $("#stages").innerHTML = byStage.map(([s, v]) => `
    <div class="bar-row"><span class="dot-label" style="--c:${colorOf("stages", s)}"><i></i>${esc(s)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%;background:${colorOf("stages", s)}"></div></div><span class="v num">${v}</span></div>`).join("");

  const up = pending.slice().sort((a, b) => a.due.localeCompare(b.due)).slice(0, DASH_TASK_ROWS);
  $("#upcoming").innerHTML = up.length ? up.map((t) => { const d = dueInfo(t.due); return `
    <div class="list-item"><div class="grow"><div>${esc(t.title)}</div><div class="sub-line">${esc(contactName(t.contactId))}</div></div><span class="due ${d.cls}">${d.text}</span></div>`; }).join("")
    : `<div class="empty">Nothing due. Enjoy the quiet.</div>`;

  const nextCalls = db.calls.filter((c) => c.status === "Scheduled" && c.date >= day()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 4);
  $("#calls").innerHTML = nextCalls.length ? nextCalls.map((c) => `
    <div class="list-item"><div class="person grow"><div class="avatar">${initials(contactName(c.contactId))}</div><div style="min-width:0"><div class="name">${esc(contactName(c.contactId))}</div><div class="meta">${esc(c.type)}</div></div></div><span class="when">${relDay(c.date)} · ${fmtTime(c.time)}</span></div>`).join("")
    : `<div class="empty">No calls booked.</div>`;

  $("#activity").innerHTML = db.activity.slice(0, DASH_ACTIVITY_ROWS).map((a) => `
    <div class="list-item"><span class="dot"></span><div class="grow">${esc(a.text)}</div><span class="when">${ago(a.at)}</span></div>`).join("");

  const recent = db.contacts.slice().sort((a, b) => b.created.localeCompare(a.created)).slice(0, DASH_LEAD_ROWS);
  $("#recent").innerHTML = recent.map((c) => `
    <div class="list-item"><div class="person grow"><div class="avatar">${initials(c.name)}</div><div style="min-width:0"><div class="name">${esc(c.name)}</div><div class="meta">${esc(c.company)} · ${esc(c.source)}</div></div></div>${statusBadge(c.status)}</div>`).join("");
}

/* ---------- Leads ---------- */
function contactForm(existing, onDone = renderContacts) {
  openModal({
    title: existing ? "Edit lead" : "New lead",
    values: existing || {},
    fields: [
      { name: "name", label: "Full name", required: true, full: true },
      { name: "company", label: "Company" },
      { name: "status", label: "Lead stage", type: "select", options: db.statuses.map((s) => [s, s]), default: db.statuses[0] },
      { name: "email", label: "Email", type: "email" },
      { name: "phone", label: "Phone", type: "tel" },
      { name: "source", label: "Source", type: "select", options: db.sources.map((s) => [s, s]), default: db.sources[0] },
      { name: "created", label: "Added on", type: "date", default: day() },
      { name: "notes", label: "Notes", type: "textarea", full: true },
    ],
    onSave: (data) => {
      if (existing) { Object.assign(existing, data); syncDealsFromContact(existing); log(`Updated lead ${data.name}`); }
      else { db.contacts.push({ id: uid(), ...data }); log(`New lead: ${data.name} (${data.source})`); }
      save(); onDone();
    },
    onDelete: existing && (() => {
      db.contacts = db.contacts.filter((c) => c.id !== existing.id);
      db.deals = db.deals.filter((d) => d.contactId !== existing.id);
      db.tasks = db.tasks.filter((t) => t.contactId !== existing.id);
      db.calls = db.calls.filter((c) => c.contactId !== existing.id);
      log(`Removed lead ${existing.name}`); save(); onDone();
    }),
  });
}

/* Smart views: named, saved filter sets for the Leads list. Search applies on top of the view. */
const VIEW_KEY = "lumen-crm-leads-view";
const ADDED_OPTS = [[0, "Any time"], [7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]];
const DEAL_OPTS = [["any", "Any"], ["open", "Has an open deal"], ["won", "Has a won deal"], ["none", "No deals"]];
const NEXT_OPTS = [["any", "Any"], ["call", "Call booked"], ["task", "Open task"], ["none", "Nothing planned"]];
let leadView = read(VIEW_KEY) || "all";
let leadFilters = null;
let filtersOpen = false;

const canon = (f = {}) => ({
  statuses: [...(f.statuses || [])].sort(), sources: [...(f.sources || [])].sort(),
  added: Number(f.added) || 0, deal: f.deal || "any", next: f.next || "any", minValue: Number(f.minValue) || 0,
});
const sameFilters = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const activeView = () => db.views.find((v) => v.id === leadView);
const viewFilters = () => canon(activeView()?.filters);
const optLabel = (opts, v) => opts.find((o) => String(o[0]) === String(v))?.[1] || v;

function matchLead(c, f) {
  if (f.statuses.length && !f.statuses.includes(c.status)) return false;
  if (f.sources.length && !f.sources.includes(c.source)) return false;
  if (f.added && c.created < day(-f.added)) return false;
  const deals = db.deals.filter((d) => d.contactId === c.id);
  if (f.deal === "open" && !deals.some(isOpen)) return false;
  if (f.deal === "won" && !deals.some(isWon)) return false;
  if (f.deal === "none" && deals.length) return false;
  if (f.minValue && sum(deals, (d) => d.value) < f.minValue) return false;
  if (f.next !== "any") {
    const call = db.calls.some((k) => k.contactId === c.id && k.status === "Scheduled" && k.date >= day());
    const task = db.tasks.some((t) => t.contactId === c.id && !t.done);
    if (f.next === "call" && !call) return false;
    if (f.next === "task" && !task) return false;
    if (f.next === "none" && (call || task)) return false;
  }
  return true;
}

function renderViews() {
  const count = (f) => db.contacts.filter((c) => matchLead(c, canon(f))).length;
  const tab = (id, name, n) => `<button type="button" class="view-tab ${leadView === id ? "on" : ""}" data-view="${id}" aria-pressed="${leadView === id}">${esc(name)}<span class="n">${n}</span></button>`;
  $("#views").innerHTML = tab("all", "All leads", db.contacts.length)
    + db.views.map((v) => tab(v.id, v.name, count(v.filters))).join("")
    + `<button type="button" class="view-tab add" data-newview>+ New smart view</button>`;
}

function renderFilterPanel() {
  const f = leadFilters;
  const multi = (key, kind) => db[kind].map((v) => `<button type="button" class="fchip ${f[key].includes(v) ? "on" : ""}" style="--c:${colorOf(kind, v)}" data-multi="${key}" data-v="${esc(v)}" aria-pressed="${f[key].includes(v)}"><i></i>${esc(v)}</button>`).join("");
  const single = (key, opts) => opts.map(([v, label]) => `<button type="button" class="fchip plain ${String(f[key]) === String(v) ? "on" : ""}" data-single="${key}" data-v="${v}" aria-pressed="${String(f[key]) === String(v)}">${label}</button>`).join("");
  $("#filter-panel").innerHTML = `
    <div class="fgroup"><div class="flabel">Lead stage <span>any of</span></div><div class="fchips">${multi("statuses", "statuses")}</div></div>
    <div class="fgroup"><div class="flabel">Source <span>any of</span></div><div class="fchips">${multi("sources", "sources")}</div></div>
    <div class="fgrid">
      <div class="fgroup"><div class="flabel">Added</div><div class="fchips">${single("added", ADDED_OPTS)}</div></div>
      <div class="fgroup"><div class="flabel">Deals</div><div class="fchips">${single("deal", DEAL_OPTS)}</div></div>
      <div class="fgroup"><div class="flabel">Next step</div><div class="fchips">${single("next", NEXT_OPTS)}</div></div>
      <div class="fgroup"><div class="flabel">Total deal value at least</div><input class="input" type="number" min="0" step="500" data-min value="${f.minValue || ""}" placeholder="$0" aria-label="Minimum total deal value"></div>
    </div>`;
}

function renderFilterSummary() {
  const f = leadFilters, chips = [];
  f.statuses.forEach((v) => chips.push(["statuses", v, `Stage: ${v}`]));
  f.sources.forEach((v) => chips.push(["sources", v, `Source: ${v}`]));
  if (f.added) chips.push(["added", "", `Added: ${optLabel(ADDED_OPTS, f.added).toLowerCase()}`]);
  if (f.deal !== "any") chips.push(["deal", "", optLabel(DEAL_OPTS, f.deal)]);
  if (f.next !== "any") chips.push(["next", "", `Next step: ${optLabel(NEXT_OPTS, f.next).toLowerCase()}`]);
  if (f.minValue) chips.push(["minValue", "", `Deals ≥ ${money(f.minValue)}`]);
  const view = activeView(), dirty = !sameFilters(f, viewFilters());
  $("#filter-count").textContent = chips.length || "";
  $("#filter-count").hidden = !chips.length;
  const el = $("#filter-summary");
  el.hidden = !chips.length && !view;
  el.innerHTML = `
    ${view ? `<span class="view-name">${esc(view.name)}${dirty ? " · edited" : ""}</span>` : ""}
    ${chips.map(([k, v, label]) => `<span class="active-chip">${esc(label)}<button type="button" data-clear="${k}" data-v="${esc(v)}" aria-label="Remove filter: ${esc(label)}">×</button></span>`).join("")}
    ${chips.length ? `<button type="button" class="link-btn" data-clearall>Clear all</button>` : ""}
    <span class="spacer"></span>
    ${view && dirty ? `<button type="button" class="btn btn-sm" data-update>Save changes</button>` : ""}
    ${dirty && chips.length ? `<button type="button" class="btn btn-sm btn-primary" data-saveas>Save as smart view</button>` : ""}
    ${view ? `<button type="button" class="btn btn-sm btn-ghost" data-renameview>Rename</button><button type="button" class="btn btn-sm btn-ghost btn-danger" data-deleteview>Delete view</button>` : ""}`;
}

function renderContacts() {
  if (!activeView()) leadView = "all";
  leadFilters ||= viewFilters();
  renderViews(); renderFilterSummary();
  const q = ($("#search").value || "").toLowerCase();
  const rows = db.contacts
    .filter((c) => matchLead(c, leadFilters) && [c.name, c.company, c.email, c.phone].join(" ").toLowerCase().includes(q))
    .sort((a, b) => b.created.localeCompare(a.created));
  $("#count").textContent = `${rows.length} of ${db.contacts.length}`;
  $("#rows").innerHTML = rows.length ? rows.map((c) => `<tr data-id="${c.id}">
      <td><div class="person"><div class="avatar">${initials(c.name)}</div><div><div class="name">${esc(c.name)}</div><div class="meta">${esc(c.company)}</div></div></div></td>
      <td>${esc(c.email)}<div class="meta">${esc(c.phone)}</div></td>
      <td>${tag("sources", c.source)}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="num">${money(sum(db.deals.filter((d) => d.contactId === c.id), (d) => d.value))}</td>
      <td class="meta">${fmtDate(c.created)}</td></tr>`).join("")
    : `<tr><td colspan="6"><div class="empty"><div class="serif">No one matches</div>Try a different search, or loosen the filters.</div></td></tr>`;
}

function initContacts() {
  const panel = $("#filter-panel"), toggle = $("#filter-toggle");
  const setOpen = (open) => { filtersOpen = open; panel.hidden = !open; toggle.setAttribute("aria-expanded", open); toggle.classList.toggle("on", open); if (open) renderFilterPanel(); };
  const pickView = (id) => { leadView = id; write(VIEW_KEY, id); leadFilters = viewFilters(); if (filtersOpen) renderFilterPanel(); renderContacts(); };
  const nameView = (title, value, onSave) => openModal({ title, values: { name: value }, saveLabel: "Save view", fields: [{ name: "name", label: "View name", required: true, full: true }], onSave: ({ name }) => onSave(name) });

  $("#search").oninput = renderContacts;
  $("#add").onclick = () => contactForm();
  toggle.onclick = () => setOpen(!filtersOpen);
  $("#rows").onclick = (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) contactForm(contactOf(tr.dataset.id)); };

  $("#views").onclick = (e) => {
    const tab = e.target.closest("[data-view]");
    if (tab) return pickView(tab.dataset.view);
    if (e.target.closest("[data-newview]")) { pickView("all"); setOpen(true); panel.querySelector("button")?.focus(); }
  };

  panel.addEventListener("click", (e) => {
    const m = e.target.closest("[data-multi]"), s = e.target.closest("[data-single]");
    if (m) { const list = leadFilters[m.dataset.multi], v = m.dataset.v; list.includes(v) ? list.splice(list.indexOf(v), 1) : list.push(v); }
    else if (s) leadFilters[s.dataset.single] = s.dataset.single === "added" ? Number(s.dataset.v) : s.dataset.v;
    else return;
    renderFilterPanel(); renderContacts();
  });
  panel.addEventListener("input", (e) => { if (e.target.matches("[data-min]")) { leadFilters.minValue = Math.max(0, Number(e.target.value) || 0); renderContacts(); } });

  $("#filter-summary").onclick = (e) => {
    const t = e.target.closest("button"); if (!t) return;
    const f = leadFilters, view = activeView();
    if (t.dataset.clear) {
      const k = t.dataset.clear;
      if (Array.isArray(f[k])) f[k] = f[k].filter((v) => v !== t.dataset.v);
      else f[k] = canon()[k];
    } else if (t.hasAttribute("data-clearall")) leadFilters = canon();
    else if (t.hasAttribute("data-update")) { view.filters = canon(f); log(`Smart view "${view.name}" updated`); save(); }
    else if (t.hasAttribute("data-saveas")) {
      return nameView("Save smart view", "", (name) => {
        const v = { id: uid(), name, filters: canon(leadFilters) };
        db.views.push(v); log(`Smart view "${name}" created`); save(); pickView(v.id);
      });
    } else if (t.hasAttribute("data-renameview")) return nameView("Rename smart view", view.name, (name) => { view.name = name; save(); renderContacts(); });
    else if (t.hasAttribute("data-deleteview")) {
      if (!confirm(`Delete the smart view "${view.name}"? Your leads stay as they are.`)) return;
      db.views = db.views.filter((v) => v.id !== view.id); save(); return pickView("all");
    }
    if (filtersOpen) renderFilterPanel();
    renderContacts();
  };
  renderContacts();
}

/* ---------- Pipeline ---------- */
// When a deal's stage changes, push the same stage name onto the lead's status (if it exists there).
function syncContactFromDeal(deal) {
  const contact = contactOf(deal.contactId);
  if (!contact || !db.statuses.includes(deal.stage)) return;
  contact.status = deal.stage;
}
// When a lead's status changes, push the same status name onto their open deal's stage (if it exists there).
function syncDealsFromContact(contact) {
  if (!db.stages.includes(contact.status)) return;
  db.deals.filter((d) => d.contactId === contact.id && isOpen(d)).forEach((d) => { d.stage = contact.status; });
}

function dealForm(existing, stage) {
  if (!db.contacts.length) { alert("Add a lead first."); return; }
  // Moving a deal into a Won status asks for the payment first; cancelling leaves the deal where it was.
  const winning = !!(existing && stage && stageType(stage) === "Won" && stageType(existing.stage) !== "Won");
  openModal({
    title: winning ? `Close ${existing.title}` : existing ? "Edit deal" : "New deal",
    values: winning ? { ...existing, stage, close: day() } : existing || { stage },
    saveLabel: winning ? "Mark as won" : "Save",
    fields: [
      { name: "title", label: "Deal name", required: true, full: true },
      { name: "contactId", label: "Lead", type: "select", options: contactOptions(), full: true },
      { name: "value", label: "Deal value (USD)", type: "number", default: 0 },
      { name: "paidUpfront", label: "Paid upfront (USD)", type: "number", default: 0 },
      { name: "paymentMethod", label: "Payment method", type: "select", options: PAYMENT_METHODS.map((m) => [m, m || "—"]), default: "" },
      { name: "stage", label: "Stage", type: "select", options: db.stages.map((s) => [s, s]), default: db.stages[0] },
      { name: "close", label: "Close date", type: "date", default: day(CLOSE_DAYS_DEFAULT), full: true },
    ],
    onSave: (data) => {
      if (existing) { if (existing.stage !== data.stage) log(`${data.title} moved to ${data.stage}`); Object.assign(existing, data); syncContactFromDeal(existing); }
      else { const nd = { id: uid(), ...data }; db.deals.push(nd); syncContactFromDeal(nd); log(`New deal: ${data.title}`); }
      save(); renderPipeline();
    },
    onDelete: existing && (() => { db.deals = db.deals.filter((d) => d.id !== existing.id); log(`Deleted deal ${existing.title}`); save(); renderPipeline(); }),
  });
}

function renderPipeline() {
  const open = db.deals.filter(isOpen);
  $("#pipe-total").textContent = `${money(sum(open, (d) => d.value))} open across ${open.length} deals`;
  $("#board").innerHTML = db.stages.map((s) => {
    const deals = db.deals.filter((d) => d.stage === s).sort((a, b) => (isOpen(a) ? a.close.localeCompare(b.close) : b.close.localeCompare(a.close)));
    return `<section class="column" data-stage="${esc(s)}" style="--c:${colorOf("stages", s)}">
      <div class="column-head"><h3 class="dot-label"><i></i><span class="col-name">${esc(s)}</span></h3>${typeBadge(stageType(s))}</div>
      <div class="column-total num">${deals.length} deal${deals.length === 1 ? "" : "s"}</div>
      ${deals.map((d) => `<article class="deal" draggable="true" data-id="${d.id}">
        <div class="title">${esc(d.title)}</div><div class="company">${esc(contactOf(d.contactId)?.company || "")} · ${esc(contactName(d.contactId))}</div>
        <div class="row"><span class="amount">${money(d.value)}</span><span class="close">${isOpen(d) ? dueInfo(d.close).text : fmtDate(d.close)}</span></div></article>`).join("")}
      <button class="btn btn-ghost" data-add="${esc(s)}">+ Add deal</button>
    </section>`;
  }).join("");
}

function initPipeline() {
  const board = $("#board");
  $("#add").onclick = () => dealForm(null, db.stages[0]);
  board.onclick = (e) => {
    const add = e.target.closest("[data-add]");
    if (add) return dealForm(null, add.dataset.add);
    const card = e.target.closest(".deal");
    if (card) dealForm(db.deals.find((d) => d.id === card.dataset.id));
  };
  board.addEventListener("dragstart", (e) => {
    if (readOnly()) return e.preventDefault();
    const card = e.target.closest(".deal"); if (!card) return;
    e.dataTransfer.setData("text/plain", card.dataset.id); card.classList.add("dragging");
  });
  board.addEventListener("dragend", (e) => e.target.closest(".deal")?.classList.remove("dragging"));
  board.addEventListener("dragover", (e) => {
    const col = e.target.closest(".column"); if (!col) return;
    e.preventDefault(); board.querySelectorAll(".column.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over");
  });
  board.addEventListener("dragleave", (e) => { const col = e.target.closest(".column"); if (col && !col.contains(e.relatedTarget)) col.classList.remove("over"); });
  board.addEventListener("drop", (e) => {
    const col = e.target.closest(".column"); if (!col) return;
    e.preventDefault();
    const deal = db.deals.find((d) => d.id === e.dataTransfer.getData("text/plain"));
    // Into a Won status: ask for the payment first; the deal moves (and the win alert goes out) on save.
    if (deal && stageType(col.dataset.stage) === "Won" && stageType(deal.stage) !== "Won") { renderPipeline(); return dealForm(deal, col.dataset.stage); }
    if (deal && deal.stage !== col.dataset.stage) {
      const wasOpen = isOpen(deal);
      deal.stage = col.dataset.stage;
      if (wasOpen && !isOpen(deal)) deal.close = day(); // a deal dropped into a Won or Lost status closes today
      syncContactFromDeal(deal);
      log(`${deal.title} moved to ${deal.stage}`); save();
    }
    renderPipeline();
  });
  renderPipeline();
}

/* ---------- Calls & Calendar ---------- */
let calMonth = new Date(); calMonth.setDate(1);
let calSelected = day();

function callForm(existing, date) {
  if (!db.contacts.length) { alert("Add a lead first."); return; }
  openModal({
    title: existing ? "Edit call" : "Schedule a call",
    values: existing || { date },
    fields: [
      { name: "contactId", label: "With", type: "select", options: contactOptions(), full: true },
      { name: "type", label: "Call type", type: "select", options: CALL_TYPES.map((s) => [s, s]), default: CALL_TYPES[0] },
      { name: "status", label: "Status", type: "select", options: CALL_STATUSES.map((s) => [s, s]), default: "Scheduled" },
      { name: "date", label: "Date", type: "date", default: day() },
      { name: "time", label: "Time", type: "time", default: "10:00" },
      { name: "duration", label: "Length (minutes)", type: "number", default: 30 },
      // Calendar guests besides the host: the lead and/or one more person.
      { name: "inviteLead", label: "Invite the lead", type: "select", options: [["Yes", "Yes"], ["No", "No"]], default: "Yes" },
      { name: "guestEmail", label: "Extra guest email (optional)", type: "email" },
      { name: "notes", label: "Notes / outcome", type: "textarea", full: true },
    ],
    onSave: (data) => {
      data.guestEmail = data.guestEmail.toLowerCase();
      if (data.guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.guestEmail)) { alert(`"${data.guestEmail}" isn't a valid email, so the call wasn't saved.`); return; }
      if (existing) { if (existing.status !== data.status) log(`${data.type} with ${contactName(data.contactId)}: ${data.status.toLowerCase()}`); Object.assign(existing, data); }
      else { db.calls.push({ id: uid(), ...data }); log(`${data.type} booked with ${contactName(data.contactId)}`); }
      calSelected = data.date; const d = parseDay(data.date); calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      save(); renderCalendar();
    },
    onDelete: existing && (() => { db.calls = db.calls.filter((c) => c.id !== existing.id); save(); renderCalendar(); }),
  });
}

function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // weeks start Monday
  const days = new Date(y, m + 1, 0).getDate();
  const cells = Math.ceil((offset + days) / 7) * 7;
  $("#cal-title").textContent = calMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  let html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < cells; i++) {
    const d = new Date(y, m, 1 - offset + i), date = ymd(d);
    const calls = db.calls.filter((c) => c.date === date && c.status !== "Cancelled").sort((a, b) => a.time.localeCompare(b.time));
    const tasks = db.tasks.filter((t) => t.due === date && !t.done);
    html += `<button class="cal-cell ${d.getMonth() !== m ? "other" : ""} ${date === day() ? "today" : ""} ${date === calSelected ? "sel" : ""}" data-date="${date}" aria-label="${fmtDate(date, { weekday: "long", month: "long", day: "numeric" })}: ${calls.length} calls, ${tasks.length} tasks">
      <span class="cal-num">${d.getDate()}</span>
      ${calls.slice(0, 2).map((c) => `<span class="cal-pill ${c.status === "Scheduled" ? "" : "past"}">${fmtTime(c.time).replace(":00", "")} ${esc(contactName(c.contactId).split(" ")[0])}</span>`).join("")}
      ${calls.length > 2 ? `<span class="cal-more">+${calls.length - 2} more</span>` : ""}
      ${tasks.length ? `<span class="cal-task">${tasks.length} task${tasks.length > 1 ? "s" : ""}</span>` : ""}
      <span class="cal-dots">${calls.length ? '<i class="d-call"></i>' : ""}${tasks.length ? '<i class="d-task"></i>' : ""}</span>
    </button>`;
  }
  $("#cal-grid").innerHTML = html;

  // Selected-day panel
  const calls = db.calls.filter((c) => c.date === calSelected).sort((a, b) => a.time.localeCompare(b.time));
  const tasks = db.tasks.filter((t) => t.due === calSelected);
  $("#day-title").textContent = fmtDate(calSelected, { weekday: "long", month: "long", day: "numeric" });
  $("#day-list").innerHTML = (calls.length || tasks.length) ? `
    ${calls.map((c) => `<button class="day-item" data-call="${c.id}">
      <span class="day-time">${fmtTime(c.time)}</span>
      <span class="grow"><span class="name">${esc(contactName(c.contactId))}</span><span class="meta">${esc(c.type)} · ${c.duration} min</span></span>
      ${callBadge(c.status)}</button>`).join("")}
    ${tasks.map((t) => `<a class="day-item" href="tasks.html"><span class="day-time">Task</span><span class="grow"><span class="name ${t.done ? "struck" : ""}">${esc(t.title)}</span><span class="meta">${esc(contactName(t.contactId))}</span></span></a>`).join("")}`
    : `<div class="empty" style="padding:28px 0">Nothing on this day.</div>`;

  // Upcoming & recent
  const upcoming = db.calls.filter((c) => c.status === "Scheduled" && c.date >= day()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const past = db.calls.filter((c) => c.date < day() || c.status !== "Scheduled").sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const row = (c) => `<tr data-call="${c.id}">
    <td><div class="person"><div class="avatar">${initials(contactName(c.contactId))}</div><div><div class="name">${esc(contactName(c.contactId))}</div><div class="meta">${esc(contactOf(c.contactId)?.company || "")}</div></div></div></td>
    <td>${esc(c.type)}</td><td>${relDay(c.date)} · ${fmtTime(c.time)}</td><td>${c.duration} min</td><td>${callBadge(c.status)}</td></tr>`;
  $("#upcoming-calls").innerHTML = upcoming.length ? upcoming.map(row).join("") : `<tr><td colspan="5"><div class="empty">No calls booked yet.</div></td></tr>`;
  $("#past-calls").innerHTML = past.length ? past.slice(0, PAST_CALLS_MAX).map(row).join("") : `<tr><td colspan="5"><div class="empty">No call history yet.</div></td></tr>`;

  const done = db.calls.filter((c) => c.status === "Completed").length, noshow = db.calls.filter((c) => c.status === "No-show").length;
  $("#call-stats").textContent = `${upcoming.length} upcoming · ${pct(done / Math.max(1, done + noshow))} show-up rate`;
}

function initCalendar() {
  $("#add").onclick = () => callForm(null, calSelected);
  $("#add-day").onclick = () => callForm(null, calSelected);
  $("#prev").onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); };
  $("#next").onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); };
  $("#today").onclick = () => { calMonth = new Date(); calMonth.setDate(1); calSelected = day(); renderCalendar(); };
  $("#cal-grid").onclick = (e) => { const c = e.target.closest(".cal-cell"); if (c) { calSelected = c.dataset.date; renderCalendar(); } };
  document.querySelector("main").addEventListener("click", (e) => {
    const el = e.target.closest("[data-call]");
    if (el) callForm(db.calls.find((c) => c.id === el.dataset.call));
  });
  renderCalendar();
}

/* ---------- Tasks & Follow-ups ---------- */
let taskFilter = "open";
function taskForm(existing) {
  openModal({
    title: existing ? "Edit task" : "New task",
    values: existing || {},
    fields: [
      { name: "title", label: "Task", required: true, full: true },
      { name: "contactId", label: "Related lead", type: "select", options: [["", "None"], ...contactOptions()], full: true },
      { name: "due", label: "Due date", type: "date", default: day() },
      { name: "priority", label: "Priority", type: "select", options: [["Normal", "Normal"], ["High", "High"]], default: "Normal" },
    ],
    onSave: (data) => {
      if (existing) Object.assign(existing, data);
      else { db.tasks.push({ id: uid(), done: false, ...data }); log(`New task: ${data.title}`); }
      save(); renderTasks();
    },
    onDelete: existing && (() => { db.tasks = db.tasks.filter((t) => t.id !== existing.id); save(); renderTasks(); }),
  });
}

function renderTasks() {
  const filters = {
    open: (t) => !t.done,
    today: (t) => !t.done && t.due <= day(),
    high: (t) => !t.done && t.priority === "High",
    done: (t) => t.done,
    all: () => true,
  };
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.f === taskFilter));
  const list = db.tasks.filter(filters[taskFilter]).sort((a, b) => a.done - b.done || a.due.localeCompare(b.due));
  $("#task-list").innerHTML = list.length ? list.map((t) => { const d = dueInfo(t.due); return `
    <div class="task ${t.done ? "done" : ""}" data-id="${t.id}">
      <input type="checkbox" class="check" ${t.done ? "checked" : ""} aria-label="Mark done">
      <div class="grow"><div class="t-title">${esc(t.title)}</div><div class="t-meta">${esc(contactName(t.contactId))}</div></div>
      ${t.priority === "High" ? '<span class="prio High">High</span>' : ""}
      <span class="due ${t.done ? "later" : d.cls}">${d.text}</span>
    </div>`; }).join("")
    : `<div class="empty"><div class="serif">All clear</div>No tasks in this view.</div>`;
  $("#task-count").textContent = `${db.tasks.filter((t) => !t.done).length} open`;

  // Leads with no open task and no upcoming call are slipping through the cracks.
  const open = db.statuses.slice(0, 3); // the first three lead stages are the ones still being worked
  const stale = db.contacts.filter((c) => open.includes(c.status)
    && !db.tasks.some((t) => !t.done && t.contactId === c.id)
    && !db.calls.some((k) => k.status === "Scheduled" && k.date >= day() && k.contactId === c.id));
  $("#stale").innerHTML = stale.length ? stale.map((c) => `
    <div class="list-item"><div class="person grow"><div class="avatar">${initials(c.name)}</div><div style="min-width:0"><div class="name">${esc(c.name)}</div><div class="meta">${esc(c.source)} · added ${fmtDate(c.created)}</div></div></div>
    <button class="btn btn-sm" data-follow="${c.id}">+ Follow-up</button></div>`).join("")
    : `<div class="empty" style="padding:24px 0">Every active lead has a next step.</div>`;
}

function initTasks() {
  $("#add").onclick = () => taskForm();
  $(".chips").onclick = (e) => { const c = e.target.closest(".chip"); if (c) { taskFilter = c.dataset.f; renderTasks(); } };
  $("#task-list").onclick = (e) => {
    const row = e.target.closest(".task"); if (!row) return;
    const task = db.tasks.find((t) => t.id === row.dataset.id);
    if (e.target.classList.contains("check")) { task.done = e.target.checked; if (task.done) log(`Completed: ${task.title}`); save(); renderTasks(); }
    else if (e.target.closest(".grow")) taskForm(task);
  };
  $("#stale").onclick = (e) => {
    const b = e.target.closest("[data-follow]"); if (!b) return;
    const c = contactOf(b.dataset.follow);
    taskForm(null); const f = $("#modal-root form").elements;
    f.title.value = `Follow up with ${c.name.split(" ")[0]}`; f.contactId.value = c.id; f.due.value = day(FOLLOWUP_DAYS);
  };
  renderTasks();
}

/* ---------- Marketing Analytics ---------- */
function weeklyLeads(weeks = MARKETING_WEEKS) {
  const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: weeks }, (_, i) => {
    const start = new Date(monday); start.setDate(start.getDate() - (weeks - 1 - i) * 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    const value = db.contacts.filter((c) => c.created >= ymd(start) && c.created < ymd(end)).length;
    const label = `Week of ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    return { label, short: `${start.getMonth() + 1}/${start.getDate()}`, value };
  });
}

function campaignForm(existing) {
  openModal({
    title: existing ? "Edit campaign" : "New campaign",
    values: existing || {},
    fields: [
      { name: "name", label: "Campaign name", required: true, full: true },
      { name: "channel", label: "Channel", type: "select", options: db.sources.map((s) => [s, s]), default: db.sources[0] },
      { name: "start", label: "Start date", type: "date", default: day() },
      { name: "spend", label: "Spend (USD)", type: "number", default: 0 },
      { name: "impressions", label: "Impressions", type: "number", default: 0 },
      { name: "clicks", label: "Clicks", type: "number", default: 0 },
      { name: "leads", label: "Leads", type: "number", default: 0 },
    ],
    onSave: (data) => { if (existing) Object.assign(existing, data); else { db.campaigns.push({ id: uid(), ...data }); log(`New campaign: ${data.name}`); } save(); renderMarketing(); },
    onDelete: existing && (() => { db.campaigns = db.campaigns.filter((c) => c.id !== existing.id); save(); renderMarketing(); }),
  });
}

function renderMarketing() {
  const wonBy = (c) => db.deals.filter((d) => d.contactId === c.id && isWon(d));
  const spend = sum(db.campaigns, (c) => c.spend), campaignLeads = sum(db.campaigns, (c) => c.leads);
  const converted = db.contacts.filter((c) => wonBy(c).length).length;
  const weeks = weeklyLeads();
  const thisWeek = weeks[weeks.length - 1].value, lastWeek = weeks[weeks.length - 2].value;

  $("#kpis").innerHTML = [
    [`New leads · ${NEW_LEADS_DAYS} days`, db.contacts.filter((c) => c.created >= day(-NEW_LEADS_DAYS)).length, `${thisWeek} this week, ${lastWeek} last week`],
    ["Ad spend", money(spend), `${db.campaigns.length} campaigns`],
    ["Cost per lead", campaignLeads ? money(spend / campaignLeads) : "—", `${campaignLeads} leads from campaigns`],
    ["Lead → client", pct(converted / Math.max(1, db.contacts.length)), `${converted} of ${db.contacts.length} leads bought`],
  ].map(([l, v, s]) => `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join("");

  columnChart($("#weekly"), weeks, { format: (v) => `${v} lead${v === 1 ? "" : "s"}` });

  const sources = [...new Set([...db.sources, ...db.contacts.map((c) => c.source)])];
  const rows = sources.map((s) => {
    const leads = db.contacts.filter((c) => c.source === s);
    const won = leads.filter((c) => wonBy(c).length);
    return { s, leads: leads.length, won: won.length, revenue: sum(leads.flatMap(wonBy), (d) => d.value) };
  }).sort((a, b) => b.leads - a.leads);
  const maxLeads = Math.max(1, ...rows.map((r) => r.leads));
  $("#sources").innerHTML = rows.map((r) => `<tr>
    <td>${tag("sources", r.s)}</td>
    <td><div class="inline-bar"><div class="track"><div class="fill" style="width:${(r.leads / maxLeads) * 100}%;background:${colorOf("sources", r.s)}"></div></div><span class="num">${r.leads}</span></div></td>
    <td class="num">${r.won}</td><td class="num">${r.leads ? pct(r.won / r.leads) : "—"}</td><td class="num">${money(r.revenue)}</td></tr>`).join("");

  $("#campaigns").innerHTML = db.campaigns.length ? db.campaigns.slice().sort((a, b) => b.start.localeCompare(a.start)).map((c) => `<tr data-id="${c.id}">
    <td><div class="name">${esc(c.name)}</div><div class="meta">Started ${fmtDate(c.start)}</div></td>
    <td>${tag("sources", c.channel)}</td><td class="num">${money(c.spend)}</td>
    <td class="num">${Number(c.impressions).toLocaleString()}</td><td class="num">${Number(c.clicks).toLocaleString()}</td>
    <td class="num">${c.impressions ? (c.clicks / c.impressions * 100).toFixed(1) + "%" : "—"}</td>
    <td class="num">${c.leads}</td><td class="num">${c.leads && c.spend ? money(c.spend / c.leads) : "—"}</td></tr>`).join("")
    : `<tr><td colspan="8"><div class="empty">No campaigns yet.</div></td></tr>`;
}

function initMarketing() {
  $("#add").onclick = () => campaignForm();
  $("#campaigns").onclick = (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) campaignForm(db.campaigns.find((c) => c.id === tr.dataset.id)); };
  renderMarketing();
}

/* ---------- Revenue ---------- */
function renderRevenue() {
  const won = db.deals.filter(isWon);
  const open = db.deals.filter(isOpen);
  const active = db.stages.filter((s) => stageType(s) === "Active");
  const prob = (stage) => (active.indexOf(stage) + 1) / (active.length + 1); // earlier Active statuses are less likely to close
  const monthKey = ymd(new Date()).slice(0, 7);
  const thisMonth = sum(won.filter((d) => d.close.startsWith(monthKey)), (d) => d.value);
  const goal = db.revenueGoal;

  const months = Array.from({ length: REVENUE_MONTHS }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i));
    const key = ymd(d).slice(0, 7);
    return { label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }), short: d.toLocaleDateString("en-US", { month: "short" }), value: sum(won.filter((x) => x.close.startsWith(key)), (x) => x.value) };
  });
  const weighted = sum(open, (d) => d.value * prob(d.stage));

  $("#goal-card").innerHTML = `
    <div class="label">${new Date().toLocaleDateString("en-US", { month: "long" })} so far</div>
    <div class="goal-row"><span class="value">${money(thisMonth)}</span><span class="of">of ${money(goal)} goal</span><button class="btn btn-sm" id="edit-goal">Edit goal</button></div>
    <div class="progress" role="progressbar" aria-valuenow="${Math.round((thisMonth / goal) * 100)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.min(100, (thisMonth / goal) * 100)}%"></div></div>
    <div class="sub">${thisMonth >= goal ? "Goal reached — nice work." : `${money(goal - thisMonth)} to go`}</div>`;
  $("#edit-goal").onclick = () => openModal({
    title: "Monthly revenue goal", values: { goal }, saveLabel: "Save goal",
    fields: [{ name: "goal", label: "Goal (USD per month)", type: "number", full: true }],
    onSave: ({ goal }) => { db.revenueGoal = Math.max(1, goal); save(); renderRevenue(); },
  });

  $("#kpis").innerHTML = [
    ["Total won", money(sum(won, (d) => d.value)), `${won.length} deals`],
    ["Average deal", money(sum(won, (d) => d.value) / Math.max(1, won.length)), "Across won deals"],
    ["Weighted forecast", money(weighted), `From ${money(sum(open, (d) => d.value))} open`],
  ].map(([l, v, s]) => `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join("");

  columnChart($("#monthly"), months, { format: money, goal });

  $("#forecast").innerHTML = active.map((s) => {
    const deals = open.filter((d) => d.stage === s), value = sum(deals, (d) => d.value);
    return `<tr><td>${tag("stages", s)}</td><td class="num">${deals.length}</td><td class="num">${money(value)}</td><td class="num">${pct(prob(s))}</td><td class="num">${money(value * prob(s))}</td></tr>`;
  }).join("") + `<tr class="total-row"><td>Total</td><td class="num">${open.length}</td><td class="num">${money(sum(open, (d) => d.value))}</td><td></td><td class="num">${money(weighted)}</td></tr>`;

  const byClient = {};
  won.forEach((d) => { byClient[d.contactId] = (byClient[d.contactId] || 0) + d.value; });
  const top = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, TOP_CLIENTS_MAX);
  $("#top-clients").innerHTML = top.length ? top.map(([id, v]) => `
    <div class="list-item"><div class="person grow"><div class="avatar">${initials(contactName(id))}</div><div style="min-width:0"><div class="name">${esc(contactName(id))}</div><div class="meta">${esc(contactOf(id)?.company || "")}</div></div></div><span class="num">${money(v)}</span></div>`).join("")
    : `<div class="empty">No won deals yet.</div>`;

  $("#won-deals").innerHTML = won.length ? won.slice().sort((a, b) => b.close.localeCompare(a.close)).map((d) => `<tr>
    <td>${esc(d.title)}</td><td>${esc(contactName(d.contactId))}</td><td>${fmtDate(d.close, { month: "short", day: "numeric", year: "numeric" })}</td><td class="num">${money(d.value)}</td></tr>`).join("")
    : `<tr><td colspan="4"><div class="empty">No won deals yet.</div></td></tr>`;
}

/* ---------- Integrations ---------- */
const APPS = [
  ["Google Calendar", "Sync booked calls both ways.", "G"],
  ["Gmail", "Log emails against each lead.", "M"],
  ["WhatsApp Business", "Message leads from their profile.", "W"],
  ["Instagram", "Turn DMs and form fills into leads.", "IG"],
  ["Meta Ads", "Pull spend, clicks and leads per campaign.", "f"],
  ["Calendly", "New bookings appear as calls.", "C"],
  ["Stripe", "Mark deals won when payment lands.", "S"],
  ["Zapier", "Connect anything else.", "Z"],
  ["Slack", "Get a ping when a deal is won.", "#"],
];

function renderIntegrations() {
  $("#apps").innerHTML = APPS.map(([name, desc, mark]) => {
    const on = db.integrations[name];
    return `<div class="card app">
      <div class="app-head"><span class="app-mark">${esc(mark)}</span><div><h3>${esc(name)}</h3><span class="app-state ${on ? "on" : ""}">${on ? "Marked as connected" : "Not connected"}</span></div></div>
      <p>${esc(desc)}</p>
      <button class="btn btn-sm ${on ? "" : "btn-primary"}" data-app="${esc(name)}">${on ? "Disconnect" : "Connect"}</button>
    </div>`;
  }).join("");
}

function initIntegrations() {
  $("#apps").onclick = (e) => {
    const b = e.target.closest("[data-app]"); if (!b) return;
    const name = b.dataset.app;
    db.integrations[name] = !db.integrations[name];
    log(`${name} ${db.integrations[name] ? "marked as connected" : "disconnected"}`); save(); renderIntegrations();
  };
  const msg = (t, bad) => { const m = $("#data-msg"); m.textContent = t; m.className = "msg " + (bad ? "bad" : "good"); };

  $("#export-leads").onclick = () => download(`leads-${day()}.csv`, toCSV([["name", "company", "email", "phone", "stage", "source", "added"], ...db.contacts.map((c) => [c.name, c.company, c.email, c.phone, c.status, c.source, c.created])]));
  $("#export-deals").onclick = () => download(`deals-${day()}.csv`, toCSV([["deal", "lead", "value", "stage", "close"], ...db.deals.map((d) => [d.title, contactName(d.contactId), d.value, d.stage, d.close])]));
  $("#export-backup").onclick = () => download(`${APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-backup-${day()}.json`, JSON.stringify(db, null, 2), "application/json");

  $("#import-leads").onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    const rows = parseCSV(await file.text());
    if (rows.length < 2) return msg("That file has no rows to import.", true);
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const ix = { name: col("name", "full name"), company: col("company"), email: col("email"), phone: col("phone"), status: col("stage", "status", "lead stage"), source: col("source") };
    if (ix.name < 0) return msg('The first row needs a "name" column.', true);
    let added = 0;
    rows.slice(1).forEach((r) => {
      const get = (k) => (ix[k] >= 0 ? (r[ix[k]] || "").trim() : "");
      if (!get("name")) return;
      const status = db.statuses.find((s) => s.toLowerCase() === get("status").toLowerCase()) || db.statuses[0];
      const source = get("source") || db.sources[0];
      if (!db.sources.includes(source)) { db.sources.push(source); assignColor(db, "sources", source); }
      db.contacts.push({ id: uid(), name: get("name"), company: get("company"), email: get("email"), phone: get("phone"), status, source, created: day() });
      added++;
    });
    log(`Imported ${added} leads from ${file.name}`); save();
    msg(`Imported ${added} lead${added === 1 ? "" : "s"}.`);
  };

  $("#import-backup").onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    let data; try { data = JSON.parse(await file.text()); } catch (err) { return msg("That isn't a valid backup file.", true); }
    if (!Array.isArray(data.contacts) || !Array.isArray(data.deals)) return msg("That isn't a backup from this CRM.", true);
    if (!confirm("Replace everything in the CRM with this backup?")) return;
    db = normalize(data); save(); msg("Backup restored."); renderIntegrations();
  };
  renderIntegrations();
}

/* ---------- Settings ---------- */
/* An editable list of names. Each row remembers the name it started with, so on save
   renamed entries carry their records along and removed ones move to the first entry. */
function listEditor(root, { kind, min, noun, collection, typed, onSaved }) {
  const fresh = (name) => ({ orig: name, name, color: colorOf(kind, name), type: typed ? stageType(name) : null });
  let rows = db[kind].map(fresh);
  const nextColor = () => { const used = new Set(rows.map((r) => r.color)); return PALETTE.find((c) => !used.has(c)) || PALETTE[rows.length % PALETTE.length]; };
  const typeSelect = (value, attrs) => `<select class="type-select t-${value}" ${attrs}>${STAGE_TYPES.map((t) => `<option ${t === value ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  const draw = () => {
    root.innerHTML = `
      <div class="add-row">
        <input class="input" data-new placeholder="${noun[0].toUpperCase() + noun.slice(1)} name" aria-label="New ${noun} name">
        ${typed ? typeSelect("Active", 'data-new-type aria-label="New status type"') : ""}
        <button type="button" class="btn btn-blue" data-add>Add</button>
      </div>
      <div class="edit-list">${rows.map((r, i) => `
        <div class="edit-row" data-i="${i}">
          <span class="edit-num">${i + 1}</span>
          <input type="color" class="swatch" value="${r.color}" aria-label="${noun} ${i + 1} colour" title="Change colour">
          <input class="input" data-name value="${esc(r.name)}" aria-label="${noun} ${i + 1} name">
          ${typed ? typeSelect(r.type, `data-type aria-label="${noun} ${i + 1} type"`) : ""}
          <button type="button" class="icon-btn" data-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
          <button type="button" class="icon-btn" data-move="1" ${i === rows.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
          <button type="button" class="icon-btn danger" data-remove ${rows.length <= min ? "disabled" : ""} aria-label="Remove">✕</button>
        </div>`).join("")}
      </div>
      <div class="edit-actions">
        <span class="msg" aria-live="polite"></span>
        <button type="button" class="btn btn-primary" data-save>Save ${noun}s</button>
      </div>`;
  };
  const msg = (text, bad) => { const m = $(".msg", root); m.textContent = text; m.className = "msg " + (bad ? "bad" : "good"); };
  const add = () => {
    const input = $("[data-new]", root), name = input.value.trim();
    if (!name) { input.focus(); return msg(`Type a name for the new ${noun}.`, true); }
    if (rows.some((r) => r.name.trim().toLowerCase() === name.toLowerCase())) return msg("That name is already in the list.", true);
    rows.push({ orig: null, name, color: NAMED_COLORS[name] || nextColor(), type: typed ? $("[data-new-type]", root).value : null });
    draw(); $("[data-new]", root).focus(); msg(`Added — press Save to keep it.`);
  };
  root.addEventListener("input", (e) => {
    if (e.target.matches(".type-select")) e.target.className = `type-select t-${e.target.value}`;
    const row = e.target.closest(".edit-row"); if (!row) return;
    const r = rows[row.dataset.i];
    if (e.target.classList.contains("swatch")) r.color = e.target.value;
    else if (e.target.hasAttribute("data-type")) r.type = e.target.value;
    else r.name = e.target.value;
  });
  root.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-new]")) { e.preventDefault(); add(); } });
  root.addEventListener("click", (e) => {
    const row = e.target.closest(".edit-row"); const i = row && Number(row.dataset.i);
    if (e.target.closest("[data-move]")) { const j = i + Number(e.target.dataset.move); [rows[i], rows[j]] = [rows[j], rows[i]]; draw(); }
    else if (e.target.closest("[data-remove]")) { rows.splice(i, 1); draw(); }
    else if (e.target.closest("[data-add]")) add();
    else if (e.target.closest("[data-save]")) {
      const names = rows.map((r) => r.name.trim());
      if (names.some((n) => !n)) return msg("Every name needs some text.", true);
      if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return msg("Names must be different from each other.", true);
      const rename = Object.fromEntries(rows.filter((r) => r.orig).map((r) => [r.orig, r.name.trim()]));
      collection.forEach(([coll, key]) => db[coll].forEach((rec) => { rec[key] = rename[rec[key]] ?? names[0]; }));
      db[kind] = names;
      db.colors[kind] = Object.fromEntries(rows.map((r) => [r.name.trim(), r.color]));
      if (typed) db.stageTypes = Object.fromEntries(rows.map((r) => [r.name.trim(), r.type]));
      onSaved(rename);
      rows = db[kind].map(fresh);
      save(); draw(); msg("Saved.");
    }
  });
  draw();
}

function initSettings() {
  const user = currentUser();
  const profile = $("#profile");
  profile.elements.name.value = user.name;
  profile.elements.email.value = user.email;
  profile.elements.email.readOnly = true; // the team list is keyed by email, so the admin changes it there
  profile.onsubmit = async (e) => {
    e.preventDefault();
    const f = profile.elements, m = $("#profile-msg");
    const say = (t, bad) => { m.textContent = t; m.className = "msg " + (bad ? "bad" : "good"); };
    if (!f.name.value.trim() || !f.email.value.trim()) return say("Name and email are required.", true);
    const changes = { data: { name: f.name.value.trim() } };
    if (f.newpw.value) {
      if (f.newpw.value.length < 6) return say("New password needs at least 6 characters.", true);
      const { error } = await sb.auth.signInWithPassword({ email: user.email, password: f.current.value });
      if (error) return say("Current password is incorrect.", true);
      changes.password = f.newpw.value;
    }
    const { data, error } = await sb.auth.updateUser(changes);
    if (error) return say(error.message, true);
    user = toUser(data.user, user);
    f.current.value = f.newpw.value = "";
    renderNav("settings");
    say("Profile saved.");
  };

  // Saved smart views filter by name, so renamed or removed entries are carried into them too.
  const syncViews = (key, kind) => (rename) => db.views.forEach((v) => {
    v.filters[key] = (v.filters[key] || []).map((n) => rename[n] ?? n).filter((n) => db[kind].includes(n));
  });
  listEditor($("#stages-editor"), {
    kind: "stages", min: 2, noun: "status", typed: true, collection: [["deals", "stage"]],
    onSaved: () => log("Pipeline statuses updated"),
  });
  listEditor($("#statuses-editor"), {
    kind: "statuses", min: 1, noun: "lead stage", collection: [["contacts", "status"]],
    onSaved: (rename) => { syncViews("statuses", "statuses")(rename); log("Lead stages updated"); },
  });
  listEditor($("#sources-editor"), {
    kind: "sources", min: 1, noun: "source", collection: [["contacts", "source"], ["campaigns", "channel"]],
    onSaved: (rename) => { syncViews("sources", "sources")(rename); log("Lead sources updated"); },
  });
  $("#reset").onclick = () => {
    if (!confirm("Delete every lead, deal, call, task, campaign and activity entry? Your stages, sources and login stay. This can't be undone.")) return;
    const { contacts, deals, tasks, calls, campaigns, activity } = seed();
    Object.assign(db, { contacts, deals, tasks, calls, campaigns, activity });
    save().then(() => location.reload());
  };
}

/* ---------- Team (admin only) ----------
   The team list lives in Supabase (members). Adding someone lets them create an account with that
   email from the sign-in page, and their role decides what they see. */
function initTeam() {
  const msg = (t, bad) => { const m = $("#team-msg"); m.textContent = t; m.className = "msg " + (bad ? "bad" : "good"); };
  const roleSelect = (value, attrs) => `<select class="input role-select" ${attrs}>${Object.entries(ROLES).map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const load = async () => {
    const { data, error } = await sb.rpc("team_members");
    if (error) return msg(error.message, true);
    $("#team-count").textContent = `${data.length} ${data.length === 1 ? "person" : "people"}`;
    $("#team-rows").innerHTML = data.map((p) => {
      const me = p.email === user.email.toLowerCase();
      return `<tr data-email="${esc(p.email)}">
        <td><div class="person"><div class="avatar">${initials(p.name || p.email)}</div><div style="min-width:0"><div class="name">${esc(p.name || p.email.split("@")[0])}${me ? ' <span class="meta">(you)</span>' : ""}</div><div class="meta">${esc(p.email)}</div></div></div></td>
        <td>${me ? `<span class="badge">${ROLES[p.role]}</span>` : roleSelect(p.role, `data-role aria-label="Role for ${esc(p.email)}"`)}</td>
        <td>${p.joined ? '<span class="badge call-Completed">Joined</span>' : '<span class="badge">Not set up yet</span>'}</td>
        <td class="meta">${p.last_sign_in ? ago(Date.parse(p.last_sign_in)) : "—"}</td>
        <td class="num">${me ? "" : '<button class="btn btn-sm btn-ghost btn-danger" data-remove>Remove</button>'}</td></tr>`;
    }).join("");
  };

  const link = new URL("login.html#setup", location.href).href;
  $("#signup-link").value = link;
  $("#copy-link").onclick = async () => {
    try { await navigator.clipboard.writeText(link); msg("Sign-up link copied."); } catch (e) { $("#signup-link").select(); msg("Press Ctrl+C to copy the link."); }
  };
  $("#add").onclick = () => openModal({
    title: "Add a person", saveLabel: "Add to team",
    fields: [
      { name: "email", label: "Email", type: "email", required: true, full: true },
      { name: "name", label: "Name", full: true },
      { name: "role", label: "Role", type: "select", options: Object.entries(ROLES), default: "setter", full: true },
    ],
    onSave: async ({ email, name, role }) => {
      email = email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg("That email doesn't look right.", true);
      const { error } = await sb.from("members").insert({ email, name, role });
      if (error) return msg(error.code === "23505" ? "That email is already on the team." : error.message, true);
      msg(`Added ${email} as ${ROLES[role]}. Send them the sign-up link above.`);
      load();
    },
  });
  $("#team-rows").addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-role]"); if (!sel) return;
    const email = sel.closest("tr").dataset.email;
    const { error } = await sb.from("members").update({ role: sel.value }).eq("email", email);
    if (error) { msg(error.message, true); return load(); }
    msg(`${email} is now ${ROLES[sel.value]}.`);
  });
  $("#team-rows").addEventListener("click", async (e) => {
    if (!e.target.closest("[data-remove]")) return;
    const email = e.target.closest("tr").dataset.email;
    if (!confirm(`Remove ${email} from the team? They won't be able to open the CRM any more. Their leads, deals and notes stay.`)) return;
    const { error } = await sb.from("members").delete().eq("email", email);
    if (error) return msg(error.message, true);
    msg(`Removed ${email}.`);
    load();
  });
  load();
}

// Signed in, but not on the team list (or removed from it).
function noAccess() {
  document.body.innerHTML = `<div class="auth-panel" style="min-height:100vh"><div class="auth-card card">
    <h2>No access yet</h2>
    <p class="sub">${esc(user.email)} isn't on the team list for this CRM. Ask your admin to add you, then sign in again.</p>
    <button class="btn btn-primary" id="na-signout">Sign out</button></div></div>`;
  $("#na-signout").onclick = signOut;
}

/* ---------- Login ----------
   Only people on the team list can get in. They set up their account here with the email the admin added
   (the database refuses any other), or through an invite email; a reset link opens the set-password screen. */
function initLogin(session) {
  let mode = session ? "setpw" : LINK.has("setup") ? "signup" : "signin";
  const invited = LINK.get("type") === "invite";
  const form = $("#auth"), f = form.elements;
  const say = (t) => { $("#auth-msg").textContent = t; };
  const draw = () => {
    const setpw = mode === "setpw", signup = mode === "signup";
    $("#auth-title").textContent = setpw ? (invited ? "Welcome aboard" : "Choose a new password") : signup ? "Set up your account" : "Welcome back";
    $("#auth-sub").textContent = setpw ? `Set the password for ${session.user.email}.` : signup ? "Use the email your admin added to the team." : "Sign in to your CRM.";
    $("#name-field").hidden = !(signup || (setpw && invited));
    $("#email").closest(".field").hidden = setpw;
    $("#confirm-field").hidden = !(setpw || signup);
    $("#submit").textContent = setpw ? "Save password" : signup ? "Create account" : "Sign in";
    $("#switch").innerHTML = setpw ? "" : signup
      ? '<button type="button" data-mode="signin">Back to sign in</button>'
      : '<button type="button" data-mode="forgot">Forgot password?</button><span class="sep">·</span><button type="button" data-mode="signup">First time? Set up your account</button>';
    f.password.autocomplete = mode === "signin" ? "current-password" : "new-password";
    say("");
  };
  if (mode === "setpw") f.name.value = session.user.user_metadata?.name || "";

  $("#switch").onclick = async (e) => {
    const b = e.target.closest("[data-mode]"); if (!b) return;
    if (b.dataset.mode !== "forgot") { mode = b.dataset.mode; return draw(); }
    if (!sb) return;
    const email = f.email.value.trim().toLowerCase();
    if (!email) { f.email.focus(); return say("Enter your email above, then press Forgot password."); }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL("login.html", location.href).href });
    say(error ? error.message : "If that email has an account, a link to reset the password is on its way.");
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!sb) return say("Supabase isn't set up yet: add the project URL and publishable key to config.js.");
    const password = f.password.value, email = f.email.value.trim().toLowerCase(), name = f.name.value.trim();
    $("#submit").disabled = true;
    try {
      if (mode === "setpw") {
        if (invited && !name) return say("Enter your name.");
        if (password.length < 6) return say("Password needs at least 6 characters.");
        if (password !== f.confirm.value) return say("Passwords don't match.");
        const { error } = await sb.auth.updateUser({ password, ...(invited && { data: { name } }) });
        if (error) return say(error.message);
        write(SESSION_KEY, session.user.email);
      } else if (mode === "signup") {
        if (!email || !name) return say("Enter your name and email.");
        if (password.length < 6) return say("Password needs at least 6 characters.");
        if (password !== f.confirm.value) return say("Passwords don't match.");
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: new URL("login.html", location.href).href } });
        if (error) return say(/database error|not been added/i.test(error.message) ? "That email isn't on the team yet. Ask your admin to add you first." : error.message);
        if (!data.session) { mode = "signin"; draw(); return say("Almost there: open the confirmation link we emailed you, then sign in."); }
        write(SESSION_KEY, email);
      } else {
        if (!email || !password) return say("Enter your email and password.");
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return say(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
        write(SESSION_KEY, email);
      }
      location.replace("index.html");
    } finally { $("#submit").disabled = false; }
  };
  draw();
  if (!sb) say("Supabase isn't set up yet: add the project URL and publishable key to config.js.");
  else if (LINK.get("error_description")) say(LINK.get("error_description").replace(/\+/g, " ") + ". Ask for a new link.");
}

/* ---------- Boot ---------- */
const page = document.body.dataset.page;
document.title = document.title.replace(/CRM$/, APP_NAME);
document.querySelectorAll("[data-app-name]").forEach((el) => { el.textContent = APP_NAME; });
(async () => {
  const session = sb && (await sb.auth.getSession()).data.session;
  if (page === "login") {
    // Restore the hint too, or the page gates would bounce straight back here in a loop.
    if (session && !SET_PASSWORD_LINK) { write(SESSION_KEY, session.user.email); return location.replace("index.html"); }
    return initLogin(SET_PASSWORD_LINK ? session : null);
  }
  // A link that landed on another page (the Site URL) still has to finish on the login page.
  if (SET_PASSWORD_LINK && session) return location.replace("login.html#type=" + LINK.get("type"));
  if (!session) { write(SESSION_KEY, null); return location.replace("login.html" + (LINK.has("error") ? location.hash : "")); }
  write(SESSION_KEY, session.user.email);
  const { data: member, error } = await sb.from("members").select("role, name").eq("email", session.user.email.toLowerCase()).maybeSingle();
  if (error) return notify("Couldn't check your access (has supabase/roles.sql been run?): " + error.message);
  user = toUser(session.user, member);
  if (!user.role) return noAccess();
  if (!canSee(page)) return location.replace(NAV.find((n) => n && canSee(n[2]))[0]);
  document.body.classList.add("role-" + user.role);
  if (PAGE_TABLE[page] && !can(PAGE_TABLE[page])) document.body.classList.add("read-only");
  renderNav(page);
  document.body.classList.add("loading");
  try { await loadDb(); } catch (e) { console.error(e); return notify("Couldn't load your CRM from Supabase: " + e.message); }
  document.body.classList.replace("loading", "ready");
  initTooltips();
  ({
    dashboard: renderDashboard, leads: initContacts, pipeline: initPipeline, calendar: initCalendar, tasks: initTasks,
    marketing: initMarketing, revenue: renderRevenue, integrations: initIntegrations, settings: initSettings, team: initTeam,
  })[page]?.();
})();
