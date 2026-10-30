// =====================================================================
//  lib.js — 純邏輯（日期、資料結構、遷移、計分、統計），不碰畫面
//  這個檔可以直接用 node 跑測試：node test/lib.test.js
// =====================================================================

// ---------- 日期工具（一律用本地時間，避免 new Date("YYYY-MM-DD") 被當成 UTC） ----------
const pad = (n) => String(n).padStart(2, "0");
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k) => {
  const [y, m, d] = String(k).split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const isDateKey = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) && !isNaN(parseKey(k));
const isTime = (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); // "HH:MM"
export const todayKey = () => keyOf(new Date());
export const addDays = (k, n) => {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyOf(d);
};
export const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
// weekStart：1 = 週一開始，0 = 週日開始
export const weekStartOf = (k, weekStart = 1) => {
  const d = parseKey(k);
  const back = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - back);
  return keyOf(d);
};
export const monthKey = (k) => k.slice(0, 7);
export const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

// ---------- 常數 ----------
export const SCHEMA_VERSION = 2;
export const LS_KEY = "habit_hourglass_v2";
export const LS_KEY_V1 = "habit_rewards_v1"; // 舊版資料，遷移後保留不動，當作備份
export const LS_KEY_PREV = "habit_hourglass_v2_before_import"; // 匯入前自動備份
export const STREAK_CAP = 30;
export const PALETTE = ["#5b7f6a", "#4e6a8a", "#b0764f", "#8a9a5b", "#8c7a96", "#c4a35a", "#6f9e98", "#b5574b"];
export const PENALTY_COLOR = "#b28d8d";
export const NOTE_MAX = 500; // 每筆打卡備註的字數上限

// ---------- 預設資料 ----------
export function defaultState(today = todayKey()) {
  return {
    version: SCHEMA_VERSION,
    habits: [],
    checks: [],
    penalties: [
      { id: uid(), name: "油炸物", value: 5 },
      { id: uid(), name: "含糖飲料", value: 2 },
    ],
    penaltyLogs: [],
    rewards: [newReward(today)],
    settings: { rewardsEnabled: false, weekStart: 1, reminderTime: "", reminderLast: "" }, // 預設純打卡模式；點數可在設定中開啟
  };
}

export function newReward(today = todayKey()) {
  return {
    id: uid(),
    name: "本期獎勵",
    target: 30,
    startDate: today,
    periodDays: 30,
    resetTs: 0, // 同一天兌換後新開一期時，用來排除「起始日當天、兌換之前」的紀錄
    habitIds: null, // null = 所有習慣都算分
    penaltyIds: null, // null = 所有懲罰都扣分
    redemptions: [],
  };
}

export function newHabit(partial = {}, usedCount = 0, today = todayKey()) {
  return {
    id: uid(),
    name: "",
    color: PALETTE[usedCount % PALETTE.length],
    type: "count", // count = 每次固定加分；streak = 連續天數加成
    value: 1,
    goalTimes: 7, // 目標：每 goalWeeks 週 goalTimes 次；7 次／1 週 = 每天
    goalWeeks: 1,
    goalSince: weekStartOf(today), // 週期從這週開始算（改目標時會重設）
    askNote: false, // 打卡時跳出備註輸入
    archived: false,
    createdAt: today,
    ...partial,
  };
}

// ---------- 目標頻率（每 X 週 Y 次） ----------
export const isDaily = (h) => h.goalWeeks === 1 && h.goalTimes >= 7;
export const goalLabel = (h) => (isDaily(h) ? "每天" : h.goalWeeks === 1 ? `每週 ${h.goalTimes} 次` : `每 ${h.goalWeeks} 週 ${h.goalTimes} 次`);
export const periodWord = (h) => (h.goalWeeks === 1 ? "本週" : "本期");

// date 所在的那一期：{ start, end }，每期 goalWeeks 週，從 goalSince 那週往前後推
export function periodOf(h, date, weekStart = 1) {
  const len = h.goalWeeks * 7;
  const anchor = weekStartOf(h.goalSince || h.createdAt, weekStart);
  const k = Math.floor(diffDays(anchor, weekStartOf(date, weekStart)) / len);
  const start = addDays(anchor, k * len);
  return { start, end: addDays(start, len - 1) };
}

export function countInRange(idx, habitId, start, end) {
  const m = idx.byHabit.get(habitId);
  if (!m) return 0;
  let n = 0;
  for (const d of m.keys()) if (d >= start && d <= end) n++;
  return n;
}

// ---------- 清理 / 驗證 ----------
const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
const str = (v, fb = "") => (v === null || v === undefined ? fb : String(v));
const clampInt = (v, lo, hi, fb) => Math.min(hi, Math.max(lo, Math.round(num(v, fb))));

// 目標頻率：舊資料只有 weeklyTarget（每週 1–7 次）→ 視為每 1 週 N 次
export function normalizeGoal(h) {
  const goalWeeks = clampInt(h.goalWeeks, 1, 52, 1);
  const goalTimes = clampInt(h.goalTimes ?? h.weeklyTarget, 1, goalWeeks * 7, 7);
  return { goalTimes, goalWeeks };
}

export function normalizeState(s, today = todayKey()) {
  const out = defaultState(today);
  if (!s || typeof s !== "object") return out;
  out.habits = (Array.isArray(s.habits) ? s.habits : []).filter((h) => h && h.id).map((h, i) => {
    const createdAt = isDateKey(h.createdAt) ? h.createdAt : today;
    return {
      id: str(h.id),
      name: str(h.name, "未命名習慣"),
      color: typeof h.color === "string" ? h.color : PALETTE[i % PALETTE.length],
      type: h.type === "streak" ? "streak" : "count",
      value: clampInt(h.value, 1, 9999, 1),
      ...normalizeGoal(h),
      goalSince: isDateKey(h.goalSince) ? h.goalSince : createdAt,
      askNote: !!h.askNote,
      archived: !!h.archived,
      createdAt,
    };
  });
  const habitIds = new Set(out.habits.map((h) => h.id));
  const seen = new Set();
  out.checks = (Array.isArray(s.checks) ? s.checks : []).filter((c) => {
    if (!c || !habitIds.has(c.habitId) || !isDateKey(c.date)) return false;
    const k = c.habitId + "|" + c.date; // 一個習慣一天只算一次
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((c) => {
    const o = { id: str(c.id, uid()), habitId: c.habitId, date: c.date, ts: num(c.ts, 0) };
    if (Number.isFinite(c.points)) o.points = c.points; // 舊版遷移過來的分數，保留原值
    const note = str(c.note, "").trim().slice(0, NOTE_MAX);
    if (note) o.note = note;
    return o;
  });
  // 補登了建立日之前的日子 → 建立日往前移，否則本月達成率、連續達標週數會漏算
  const firstCheck = new Map();
  for (const c of out.checks) if (!firstCheck.has(c.habitId) || c.date < firstCheck.get(c.habitId)) firstCheck.set(c.habitId, c.date);
  for (const h of out.habits) { const f = firstCheck.get(h.id); if (f && f < h.createdAt) h.createdAt = f; }
  out.penalties =(Array.isArray(s.penalties) ? s.penalties : []).filter((p) => p && p.id).map((p) => ({
    id: str(p.id), name: str(p.name, "未命名懲罰"), value: clampInt(p.value, 1, 9999, 1),
  }));
  const penIds = new Set(out.penalties.map((p) => p.id));
  out.penaltyLogs = (Array.isArray(s.penaltyLogs) ? s.penaltyLogs : [])
    .filter((l) => l && penIds.has(l.penaltyId) && isDateKey(l.date))
    .map((l) => ({ id: str(l.id, uid()), penaltyId: l.penaltyId, date: l.date, ts: num(l.ts, 0), value: clampInt(l.value, 1, 9999, 1) }));
  out.rewards = (Array.isArray(s.rewards) ? s.rewards : []).filter((r) => r && r.id).map((r) => ({
    id: str(r.id),
    name: str(r.name, "獎勵"),
    target: clampInt(r.target, 1, 999999, 30),
    startDate: isDateKey(r.startDate) ? r.startDate : today,
    periodDays: clampInt(r.periodDays, 1, 3650, 30),
    resetTs: num(r.resetTs, 0),
    habitIds: Array.isArray(r.habitIds) ? r.habitIds.filter((id) => habitIds.has(id)) : null,
    penaltyIds: Array.isArray(r.penaltyIds) ? r.penaltyIds.filter((id) => penIds.has(id)) : null,
    redemptions: (Array.isArray(r.redemptions) ? r.redemptions : []).filter((x) => x && isDateKey(x.date)).map((x) => ({
      id: str(x.id, uid()), date: x.date, note: str(x.note, ""), ...(Number.isFinite(x.points) ? { points: x.points } : {}),
    })),
  }));
  const st = s.settings || {};
  out.settings = {
    rewardsEnabled: st.rewardsEnabled === true, weekStart: st.weekStart === 0 ? 0 : 1,
    reminderTime: isTime(st.reminderTime) ? st.reminderTime : "", // "" = 關閉
    reminderLast: isDateKey(st.reminderLast) ? st.reminderLast : "", // 最後一次提醒的日期，一天只提醒一次
  };
  return out;
}

// ---------- 背景天色：依時間決定時段和日／月位置 ----------
// 時段：清晨 5:00–7:30、白天 7:30–16:30、黃昏 16:30–19:00、夜晚其餘
// 太陽 6:00 從左邊山後升起、18:00 在右邊落下；月亮 18:00–6:00 走同一條弧線
export function skyAt(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  const phase = h >= 5 && h < 7.5 ? "dawn" : h >= 7.5 && h < 16.5 ? "day" : h >= 16.5 && h < 19 ? "dusk" : "night";
  const sun = h >= 6 && h < 18;
  const p = sun ? (h - 6) / 12 : ((h + 6) % 24) / 12; // 弧線上的進度 0 → 1
  const x = 12 + 76 * p; // %，左到右
  const y = 72 - 26 * Math.sin(Math.PI * p); // %，地平線在山後；最高只到畫面中段，才不會整個躲在卡片後面
  return { phase, body: sun ? "sun" : "moon", x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

// ---------- 打卡提醒（App 開著時才會觸發） ----------
// 現在是否該提醒：已設定時間、今天還沒提醒過、時間已到、還有沒打卡的習慣
export function reminderDue(settings, today, nowHHMM, pendingCount) {
  return !!settings.reminderTime && settings.reminderLast !== today && nowHHMM >= settings.reminderTime && pendingCount > 0;
}

// ---------- 從舊版 habit_rewards_v1 遷移 ----------
// 舊版：rewards[] 底下各自有 habits / penalties / events / redemptions
// 新版：習慣、懲罰、打卡紀錄獨立；獎勵卡用 habitIds / penaltyIds 指定計分範圍
export function migrateV1(old, today = todayKey()) {
  const report = { habits: 0, checks: 0, penaltyLogs: 0, dropped: 0 };
  const s = { version: SCHEMA_VERSION, habits: [], checks: [], penalties: [], penaltyLogs: [], rewards: [], settings: { rewardsEnabled: false, weekStart: 1 } };
  const rewards = Array.isArray(old?.rewards) ? old.rewards : [];
  for (const r of rewards) {
    const events = Array.isArray(r.events) ? r.events : [];
    const habits = Array.isArray(r.habits) ? r.habits : [];
    const penalties = Array.isArray(r.penalties) ? r.penalties : [];
    // 舊版顏色是系統自動配的灰階色（舊版沒有選色功能），在日曆上很難分辨，換成新版的色盤
    const OLD_PALETTE = ["#6b7280", "#9aa5b1", "#8fa3a3", "#a3a0b5", "#b0a68a", "#b28d8d", "#8ea0b0", "#9aa79a"];
    for (const h of habits) {
      const dates = events.filter((e) => e.habitId === h.id && isDateKey(e.date)).map((e) => e.date).sort();
      s.habits.push({
        id: h.id, name: h.name,
        color: !h.color || OLD_PALETTE.includes(h.color) ? PALETTE[s.habits.length % PALETTE.length] : h.color,
        type: h.type === "streak" ? "streak" : "count",
        value: h.value, goalTimes: 7, goalWeeks: 1, askNote: false, archived: false,
        createdAt: dates[0] && dates[0] < today ? dates[0] : today,
      });
    }
    for (const p of penalties) s.penalties.push({ id: p.id, name: p.name, value: p.value });
    const hIds = new Set(habits.map((h) => h.id));
    const pIds = new Set(penalties.map((p) => p.id));
    for (const e of events) {
      if (e.habitId && hIds.has(e.habitId)) {
        s.checks.push({ id: e.id || uid(), habitId: e.habitId, date: e.date, ts: e.ts, points: Number(e.delta) });
      } else if (e.isPenalty && e.penaltyId && pIds.has(e.penaltyId)) {
        s.penaltyLogs.push({ id: e.id || uid(), penaltyId: e.penaltyId, date: e.date, ts: e.ts, value: Math.abs(Number(e.delta)) });
      } else {
        report.dropped++; // 找不到對應習慣／懲罰的孤兒紀錄
      }
    }
    s.rewards.push({
      id: r.id || uid(), name: r.name, target: r.target, startDate: r.startDate, periodDays: r.periodDays,
      resetTs: 0, habitIds: habits.map((h) => h.id), penaltyIds: penalties.map((p) => p.id),
      redemptions: r.redemptions || [],
    });
  }
  const norm = normalizeState(s, today);
  if (norm.rewards.length === 0) norm.rewards = [newReward(today)];
  report.habits = norm.habits.length;
  report.checks = norm.checks.length;
  report.penaltyLogs = norm.penaltyLogs.length;
  report.dropped += (s.checks.length - norm.checks.length) + (s.penaltyLogs.length - norm.penaltyLogs.length);
  return { state: norm, report };
}

// ---------- 載入 / 儲存 ----------
export function loadState(storage, today = todayKey()) {
  try {
    const raw = storage.getItem(LS_KEY);
    if (raw) return { state: normalizeState(JSON.parse(raw), today), migrated: null };
  } catch (e) { /* 壞掉就往下試舊版 */ }
  try {
    const rawV1 = storage.getItem(LS_KEY_V1);
    if (rawV1) {
      const { state, report } = migrateV1(JSON.parse(rawV1), today);
      return { state, migrated: report };
    }
  } catch (e) { /* 舊版也壞了就給預設值 */ }
  return { state: defaultState(today), migrated: null };
}

export function saveState(storage, state) {
  try { storage.setItem(LS_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
}

// 匯入：接受新版匯出檔，或舊版 habit_rewards_v1 的 JSON
export function parseImport(text, today = todayKey()) {
  const obj = JSON.parse(text);
  if (obj && obj.version === SCHEMA_VERSION) return { state: normalizeState(obj, today), from: "v2" };
  if (obj && Array.isArray(obj.rewards) && obj.rewards.some((r) => Array.isArray(r.events))) {
    return { state: migrateV1(obj, today).state, from: "v1" };
  }
  throw new Error("看不懂這個檔案格式");
}

// ---------- 索引（每次資料變動算一次，畫面查詢用） ----------
export function buildIndex(state) {
  const byHabit = new Map(); // habitId -> Map(date -> check)
  const byDate = new Map(); // date -> Set(habitId)
  for (const h of state.habits) byHabit.set(h.id, new Map());
  for (const c of state.checks) {
    byHabit.get(c.habitId)?.set(c.date, c);
    if (!byDate.has(c.date)) byDate.set(c.date, new Set());
    byDate.get(c.date).add(c.habitId);
  }
  const penByDate = new Map(); // date -> log[]
  for (const l of state.penaltyLogs) {
    if (!penByDate.has(l.date)) penByDate.set(l.date, []);
    penByDate.get(l.date).push(l);
  }
  return { byHabit, byDate, penByDate };
}

export const isDone = (idx, habitId, date) => !!idx.byHabit.get(habitId)?.has(date);

// 以 date 為結尾的連續天數（date 本身要有打卡才算 1）
export function streakEndingAt(idx, habitId, date) {
  const m = idx.byHabit.get(habitId);
  if (!m) return 0;
  let n = 0, d = date;
  while (m.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// 一筆打卡值多少分
export function checkPoints(habit, idx, date) {
  const c = idx.byHabit.get(habit.id)?.get(date);
  if (c && Number.isFinite(c.points)) return c.points; // 舊版遷移的固定分數
  const mult = habit.type === "streak" ? Math.min(Math.max(1, streakEndingAt(idx, habit.id, date)), STREAK_CAP) : 1;
  return habit.value * mult;
}

// 如果現在在 date 打卡，會加幾分（還沒打卡時的預覽）
export function previewPoints(habit, idx, date) {
  if (isDone(idx, habit.id, date)) return checkPoints(habit, idx, date);
  const mult = habit.type === "streak" ? Math.min(1 + streakEndingAt(idx, habit.id, addDays(date, -1)), STREAK_CAP) : 1;
  return habit.value * mult;
}

// ---------- 習慣統計 ----------
export function habitStats(habit, idx, today, weekStart = 1) {
  const m = idx.byHabit.get(habit.id) || new Map();
  const dates = [...m.keys()].sort();
  // 目前連續：今天還沒打不算斷，從昨天往回算
  const current = m.has(today) ? streakEndingAt(idx, habit.id, today) : streakEndingAt(idx, habit.id, addDays(today, -1));
  let longest = 0, run = 0, prev = null;
  for (const d of dates) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  // 本月達成率：分母 = 本月 1 號（或建立日）到今天的天數
  const mStart = `${monthKey(today)}-01`;
  const from = habit.createdAt > mStart ? habit.createdAt : mStart;
  const daysSoFar = Math.max(0, diffDays(from, today) + 1);
  const doneThisMonth = dates.filter((d) => d >= from && d <= today).length;
  // 本期次數 & 連續達標期數（每期 = goalWeeks 週）
  const cur = periodOf(habit, today, weekStart);
  const thisPeriod = countInRange(idx, habit.id, cur.start, cur.end);
  const periodLeft = diffDays(today, cur.end); // 本期還剩幾天（不含今天）
  let periodStreak = thisPeriod >= habit.goalTimes ? 1 : 0;
  let p = periodOf(habit, addDays(cur.start, -1), weekStart);
  while (p.end >= habit.createdAt && countInRange(idx, habit.id, p.start, p.end) >= habit.goalTimes) {
    periodStreak++;
    p = periodOf(habit, addDays(p.start, -1), weekStart);
  }
  return {
    current, longest, total: dates.length,
    monthRate: daysSoFar ? doneThisMonth / daysSoFar : 0, doneThisMonth, daysSoFar,
    thisPeriod, periodStreak, periodLeft,
  };
}

// ---------- 獎勵週期 ----------
export const rewardEnd = (r) => addDays(r.startDate, r.periodDays - 1);

export function rewardTotals(state, idx, r) {
  const end = rewardEnd(r);
  const inWin = (x) => x.date >= r.startDate && x.date <= end && !(x.date === r.startDate && x.ts < r.resetTs);
  const habitScope = r.habitIds ? new Set(r.habitIds) : null;
  const penScope = r.penaltyIds ? new Set(r.penaltyIds) : null;
  const habitsById = new Map(state.habits.map((h) => [h.id, h]));
  const byHabit = new Map();
  let plus = 0, minus = 0;
  for (const c of state.checks) {
    if (habitScope && !habitScope.has(c.habitId)) continue;
    if (!inWin(c)) continue;
    const h = habitsById.get(c.habitId);
    if (!h) continue;
    const p = checkPoints(h, idx, c.date);
    plus += p;
    byHabit.set(h.id, (byHabit.get(h.id) || 0) + p);
  }
  for (const l of state.penaltyLogs) {
    if (penScope && !penScope.has(l.penaltyId)) continue;
    if (!inWin(l)) continue;
    minus += l.value;
  }
  return { plus, minus, total: plus - minus, byHabit, end };
}
