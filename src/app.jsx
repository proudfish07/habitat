// =====================================================================
//  app.jsx — Habit Hourglass 畫面
//  分頁：今天｜日曆（週 / 月 / 年；全部習慣或單一習慣）｜獎勵｜設定
// =====================================================================
import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  todayKey, addDays, parseKey, keyOf, weekStartOf, daysInMonth, uid,
  PALETTE, PENALTY_COLOR, STREAK_CAP, LS_KEY_PREV,
  loadState, saveState, parseImport, buildIndex, isDone, previewPoints, checkPoints,
  habitStats, rewardTotals, rewardEnd, newReward, newHabit, streakEndingAt, reminderDue, skyAt,
  isDaily, goalLabel, periodWord, periodOf, countInRange, NOTE_MAX,
} from "./lib.js";

// 背景天色跟著時間走：時段寫在 <html data-phase>，日／月位置寫成 CSS 變數
// 網址加 ?sky=dawn|day|dusk|night 可以固定某個時段（預覽用）
function applySky() {
  const s = skyAt();
  const forced = new URLSearchParams(location.search).get("sky");
  if (forced) {
    s.phase = forced;
    Object.assign(s, { dawn: { body: "sun", x: 18, y: 64 }, day: { body: "sun", x: 62, y: 47 }, dusk: { body: "sun", x: 80, y: 62 }, night: { body: "moon", x: 70, y: 49 } }[forced] || {});
  }
  const r = document.documentElement;
  r.dataset.phase = s.phase;
  r.dataset.body = s.body;
  r.style.setProperty("--sun-x", `${s.x}%`);
  r.style.setProperty("--sun-y", `${s.y}%`);
}
applySky();
setInterval(applySky, 60000);

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const weekdayLabels = (ws) => [...Array(7)].map((_, i) => WEEKDAYS[(ws + i) % 7]);
const fmtMD = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtFull = (k) => { const d = parseKey(k); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`; };
const pct = (x) => `${Math.round(x * 100)}%`;
// 系統通知（有授權才會跳）；手機上要透過 service worker 才能顯示
const canNotify = () => typeof Notification !== "undefined";
async function showReminder(body) {
  if (!canNotify() || Notification.permission !== "granted") return;
  const opts = { body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", tag: "habit-reminder" };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification("該打卡囉", opts);
  } catch (e) { /* 改用下面的方式 */ }
  try { new Notification("該打卡囉", opts); } catch (e) { /* 這個瀏覽器不支援 */ }
}
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

// ---------- 小圖示 ----------
const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const I = {
  today: <Icon d={<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>} />,
  cal: <Icon d={<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>} />,
  gift: <Icon d={<><rect x="3" y="8" width="18" height="13" rx="1" /><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z" /></>} />,
  gear: <Icon d={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>} />,
  left: <Icon d={<path d="M15 18l-6-6 6-6" />} />,
  right: <Icon d={<path d="M9 18l6-6-6-6" />} />,
  plus: <Icon d={<path d="M12 5v14M5 12h14" />} />,
  edit: <Icon size={16} d={<path d="M4 20h4L19 9l-4-4L4 16v4z" />} />,
  x: <Icon d={<path d="M6 6l12 12M18 6L6 18" />} />,
  check: <Icon size={16} d={<path d="M5 12l5 5 9-10" />} />,
};

// =====================================================================
//  App
// =====================================================================
function App() {
  const [{ state: initial, migrated }] = useState(() => loadState(window.localStorage));
  const [state, setState] = useState(initial);
  const [today, setToday] = useState(todayKey());
  const [tab, setTab] = useState("today");
  const [sheetDate, setSheetDate] = useState(null); // 點日曆某天 → 補登
  const [editing, setEditing] = useState(null); // 編輯中的習慣（新增時為 {}）
  const [noteFor, setNoteFor] = useState(null); // 正在寫備註的打卡：{ habit, date }
  const [notice, setNotice] = useState(migrated
    ? `已從舊版自動轉換：${migrated.habits} 個習慣、${migrated.checks} 筆打卡、${migrated.penaltyLogs} 筆懲罰${migrated.dropped ? `（${migrated.dropped} 筆找不到對應習慣的紀錄未轉入）` : ""}。舊資料仍保留在瀏覽器中當備份。`
    : null);
  const [saveOk, setSaveOk] = useState(true);

  useEffect(() => { setSaveOk(saveState(window.localStorage, state)); }, [state]);
  // 跨過午夜時自動換日
  useEffect(() => { const t = setInterval(() => setToday(todayKey()), 30000); return () => clearInterval(t); }, []);

  const idx = useMemo(() => buildIndex(state), [state]);
  const activeHabits = state.habits.filter((h) => !h.archived);
  const update = (fn) => setState((s) => fn(s));

  // 打卡提醒：每 30 秒檢查一次；時間到、今天還有沒打卡的習慣就提醒（一天一次）
  const pending = activeHabits.filter((h) => !isDone(idx, h.id, today));
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    const check = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const left = pendingRef.current;
      if (!reminderDue(state.settings, today, hhmm, left.length)) return;
      update((s) => ({ ...s, settings: { ...s.settings, reminderLast: today } }));
      const body = `還有 ${left.length} 個習慣沒打卡：${left.map((h) => h.name).join("、")}`;
      setNotice(`⏰ ${body}`);
      showReminder(body);
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [state.settings.reminderTime, state.settings.reminderLast, today]);

  // ---------- 動作 ----------
  const actions = {
    toggleCheck(habitId, date) {
      if (date > today) return;
      update((s) => {
        const exists = s.checks.some((c) => c.habitId === habitId && c.date === date);
        if (exists) return { ...s, checks: s.checks.filter((c) => !(c.habitId === habitId && c.date === date)) };
        // 補登建立日之前的日子時，建立日跟著往前移，統計才會算到
        const habits = s.habits.map((h) => (h.id === habitId && date < h.createdAt ? { ...h, createdAt: date } : h));
        return { ...s, habits, checks: [...s.checks, { id: uid(), habitId, date, ts: Date.now() }] };
      });
    },
    addPenaltyLog(p, date) {
      update((s) => ({ ...s, penaltyLogs: [...s.penaltyLogs, { id: uid(), penaltyId: p.id, date, ts: Date.now(), value: p.value }] }));
    },
    removePenaltyLog(id) { update((s) => ({ ...s, penaltyLogs: s.penaltyLogs.filter((l) => l.id !== id) })); },
    saveHabit(h) {
      update((s) => {
        const old = s.habits.find((x) => x.id === h.id);
        // 改了頻率 → 週期從這週重新起算
        if (old && (old.goalTimes !== h.goalTimes || old.goalWeeks !== h.goalWeeks)) h = { ...h, goalSince: weekStartOf(today, s.settings.weekStart) };
        return { ...s, habits: old ? s.habits.map((x) => (x.id === h.id ? h : x)) : [...s.habits, h] };
      });
    },
    setCheckNote(habitId, date, note) {
      const t = note.trim().slice(0, NOTE_MAX);
      update((s) => ({
        ...s, checks: s.checks.map((c) => {
          if (c.habitId !== habitId || c.date !== date) return c;
          const { note: _, ...rest } = c;
          return t ? { ...rest, note: t } : rest;
        }),
      }));
    },
    deleteHabit(h) {
      const n = state.checks.filter((c) => c.habitId === h.id).length;
      if (!confirm(`刪除「${h.name}」會一併刪掉 ${n} 筆打卡紀錄，無法復原。\n\n只是不想再追蹤的話，建議改用「封存」保留歷史。\n\n確定刪除？`)) return false;
      update((s) => ({
        ...s, habits: s.habits.filter((x) => x.id !== h.id), checks: s.checks.filter((c) => c.habitId !== h.id),
        rewards: s.rewards.map((r) => (r.habitIds ? { ...r, habitIds: r.habitIds.filter((id) => id !== h.id) } : r)),
      }));
      return true;
    },
    savePenalty(p) {
      update((s) => {
        const exists = s.penalties.some((x) => x.id === p.id);
        return { ...s, penalties: exists ? s.penalties.map((x) => (x.id === p.id ? p : x)) : [...s.penalties, p] };
      });
    },
    deletePenalty(p) {
      const n = state.penaltyLogs.filter((l) => l.penaltyId === p.id).length;
      if (!confirm(`刪除懲罰「${p.name}」會一併刪掉 ${n} 筆扣分紀錄，確定？`)) return;
      update((s) => ({
        ...s, penalties: s.penalties.filter((x) => x.id !== p.id), penaltyLogs: s.penaltyLogs.filter((l) => l.penaltyId !== p.id),
        rewards: s.rewards.map((r) => (r.penaltyIds ? { ...r, penaltyIds: r.penaltyIds.filter((id) => id !== p.id) } : r)),
      }));
    },
    patchReward(id, patch) { update((s) => ({ ...s, rewards: s.rewards.map((r) => (r.id === id ? { ...r, ...patch } : r)) })); },
    addReward() { update((s) => ({ ...s, rewards: [...s.rewards, newReward(today)] })); },
    deleteReward(r) {
      if (!confirm(`刪除獎勵卡「${r.name}」？（打卡紀錄不受影響）`)) return;
      update((s) => ({ ...s, rewards: s.rewards.filter((x) => x.id !== r.id) }));
    },
    newPeriod(r, redeemPoints) {
      const redeeming = redeemPoints !== undefined;
      const msg = redeeming ? `兌換「${r.name}」並從今天開始新的一期？` : `從今天開始新的一期？\n（只是重算點數，打卡紀錄都會保留）`;
      if (!confirm(msg)) return;
      update((s) => ({
        ...s, rewards: s.rewards.map((x) => (x.id !== r.id ? x : {
          ...x, startDate: today, resetTs: Date.now(),
          redemptions: redeeming ? [...x.redemptions, { id: uid(), date: today, note: x.name, points: redeemPoints }] : x.redemptions,
        })),
      }));
    },
    setSettings(patch) { update((s) => ({ ...s, settings: { ...s.settings, ...patch } })); },
    replaceAll(next, msg) {
      try { window.localStorage.setItem(LS_KEY_PREV, JSON.stringify(state)); } catch (e) { /* 備份失敗也繼續 */ }
      setState(next);
      setNotice(msg);
    },
  };

  const ctx = { state, idx, today, actions, activeHabits, openDay: setSheetDate, editHabit: setEditing, editNote: setNoteFor };
  const tabs = [
    ["today", "今天", I.today], ["calendar", "日曆", I.cal],
    ...(state.settings.rewardsEnabled ? [["rewards", "獎勵", I.gift]] : []), ["settings", "設定", I.gear],
  ];

  return (
    <div className="app">
      <header className="topbar">
        <h1>Habit Hourglass</h1>
        <span className="muted">{fmtFull(today)}</span>
      </header>
      {!saveOk && <div className="banner danger">⚠️ 無法寫入瀏覽器儲存空間（可能是私密瀏覽或空間已滿），這次的變更重新整理後會遺失。請到「設定」匯出備份。</div>}
      {notice && <div className="banner" onClick={() => setNotice(null)}>{notice}<span className="banner-x" aria-label="關閉">×</span></div>}

      <main>
        {tab === "today" && <TodayView {...ctx} />}
        {tab === "calendar" && <CalendarView {...ctx} />}
        {tab === "rewards" && <RewardsView {...ctx} />}
        {tab === "settings" && <SettingsView {...ctx} />}
      </main>

      <nav className="tabbar">
        {tabs.map(([k, label, icon]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{icon}<span>{label}</span></button>
        ))}
      </nav>

      {sheetDate && <DaySheet {...ctx} date={sheetDate} onClose={() => setSheetDate(null)} />}
      {editing && <HabitEditor {...ctx} habit={editing} onClose={() => setEditing(null)} />}
      {noteFor && <NoteSheet {...ctx} habit={noteFor.habit} date={noteFor.date} onClose={() => setNoteFor(null)} />}
    </div>
  );
}

// =====================================================================
//  今天
// =====================================================================
function TodayView({ state, idx, today, actions, activeHabits, editHabit, editNote }) {
  const ws = state.settings.weekStart;
  const doneN = activeHabits.filter((h) => isDone(idx, h.id, today)).length;
  return (
    <>
      <section className="card">
        <div className="row between">
          <h2>今天的習慣</h2>
          <span className="muted">{doneN} / {activeHabits.length} 完成</span>
        </div>
        {activeHabits.length === 0 && (
          <div className="empty">還沒有習慣。<button className="link" onClick={() => editHabit({})}>新增第一個習慣</button></div>
        )}
        <ul className="list">
          {activeHabits.map((h) => {
            const done = isDone(idx, h.id, today);
            const st = habitStats(h, idx, today, ws);
            const note = idx.byHabit.get(h.id)?.get(today)?.note;
            // 打卡（不是取消）且這個習慣有開「打卡時寫備註」→ 跳出備註
            const tap = () => { actions.toggleCheck(h.id, today); if (!done && h.askNote) editNote({ habit: h, date: today }); };
            return (
              <SwipeRow key={h.id} className={`habit ${done ? "done" : ""}`} onEdit={() => editHabit(h)} onDelete={() => actions.deleteHabit(h)}>
                <button className="checkbtn" style={{ "--c": h.color }} onClick={tap} aria-pressed={done} aria-label={`${h.name}：${done ? "已完成，點一下取消" : "標記完成"}`}>
                  {done && I.check}
                </button>
                <div className="grow" onClick={tap}>
                  <div className="name">{h.name}</div>
                  <div className="meta">
                    {st.current > 0 && <span>🔥 連續 {st.current} 天</span>}
                    {!isDaily(h) && <span>{periodWord(h)} {st.thisPeriod}/{h.goalTimes}</span>}
                    {state.settings.rewardsEnabled && <span>＋{previewPoints(h, idx, today)}{h.type === "streak" ? "（累計）" : ""}</span>}
                  </div>
                  {done && note && <button className="note-line" onClick={(e) => { e.stopPropagation(); editNote({ habit: h, date: today }); }}>{note}</button>}
                </div>
              </SwipeRow>
            );
          })}
        </ul>
        {activeHabits.length > 0 && <button className="ghost small" onClick={() => editHabit({})}>{I.plus} 新增習慣</button>}
      </section>

      {state.settings.rewardsEnabled && state.penalties.length > 0 && <PenaltyPanel state={state} idx={idx} date={today} actions={actions} />}

      {state.settings.rewardsEnabled && state.rewards.map((r) => <RewardMini key={r.id} state={state} idx={idx} r={r} today={today} />)}
    </>
  );
}

// 左右滑動的清單列：往右滑過門檻 → 編輯，往左滑過門檻 → 刪除（刪除仍會再確認一次）
const SWIPE_TRIGGER = 90; // px
function SwipeRow({ className, onEdit, onDelete, children }) {
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const g = useRef(null); // 進行中的手勢：{ x, y, id, horiz }
  const swiped = useRef(false);

  const down = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    g.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horiz: null };
    swiped.current = false;
    setAnim(false);
  };
  const move = (e) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (s.horiz === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.horiz = Math.abs(mx) > Math.abs(my); // 先判斷方向，垂直的話交給頁面捲動
      if (s.horiz) try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 沒抓到也能滑 */ }
    }
    if (!s.horiz) return;
    swiped.current = true;
    const lim = SWIPE_TRIGGER * 1.6; // 超過門檻後加阻尼
    setDx(Math.abs(mx) > lim ? Math.sign(mx) * (lim + (Math.abs(mx) - lim) * 0.25) : mx);
  };
  const up = (e) => {
    const s = g.current;
    g.current = null;
    if (!s || !s.horiz) return;
    setAnim(true);
    setDx(0);
    if (e.type === "pointercancel") return; // 被系統打斷（例如來電、捲動接手）就只回位
    if (dx >= SWIPE_TRIGGER) onEdit?.();
    else if (dx <= -SWIPE_TRIGGER) setTimeout(() => onDelete?.(), 180); // 等列回位再跳確認框
  };
  // 滑動結束時吃掉那一下 click，避免順便打卡
  const eatClick = (e) => { if (swiped.current) { e.stopPropagation(); e.preventDefault(); swiped.current = false; } };

  const side = dx > 0 ? "edit" : dx < 0 ? "del" : "";
  const armed = Math.abs(dx) >= SWIPE_TRIGGER;
  return (
    <li className={`swipe ${side} ${armed ? "armed" : ""}`}>
      <div className="swipe-bg" aria-hidden="true">
        <span className="swipe-edit">{I.edit} 編輯</span>
        <span className="swipe-del">刪除 {I.x}</span>
      </div>
      <div
        className={`${className} swipe-fg ${anim ? "anim" : ""}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClickCapture={eatClick}
      >
        {children}
      </div>
    </li>
  );
}

function PenaltyPanel({ state, idx, date, actions }) {
  const logs = idx.penByDate.get(date) || [];
  const byId = new Map(state.penalties.map((p) => [p.id, p]));
  return (
    <section className="card">
      <h2>懲罰<span className="muted small">（{date === todayKey() ? "今天" : fmtMD(date)}）</span></h2>
      <div className="chips">
        {state.penalties.map((p) => (
          <button key={p.id} className="chip penalty" onClick={() => actions.addPenaltyLog(p, date)}>{p.name} −{p.value}</button>
        ))}
      </div>
      {logs.length > 0 && (
        <ul className="loglist">
          {logs.map((l) => (
            <li key={l.id}><span>{byId.get(l.penaltyId)?.name ?? "（已刪除）"} −{l.value}</span><button className="link" onClick={() => actions.removePenaltyLog(l.id)}>撤銷</button></li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProgressBar({ total, target, plus, minus }) {
  const fill = Math.max(0, Math.min(1, total / target));
  return (
    <div className="bar" role="progressbar" aria-valuenow={total} aria-valuemax={target}>
      <div className="fill" style={{ width: `${fill * 100}%` }} />
      {minus > 0 && plus > 0 && <div className="lost" style={{ left: `${fill * 100}%`, width: `${Math.min(1 - fill, minus / target) * 100}%` }} />}
    </div>
  );
}

function RewardMini({ state, idx, r, today }) {
  const t = rewardTotals(state, idx, r);
  const left = Math.max(0, rewardEnd(r) >= today ? Math.round((parseKey(rewardEnd(r)) - parseKey(today)) / 86400000) + 1 : 0);
  return (
    <section className="card">
      <div className="row between"><h2>{r.name}</h2><span className="mono">{t.total} / {r.target}</span></div>
      <ProgressBar total={t.total} target={r.target} plus={t.plus} minus={t.minus} />
      <div className="muted small">{t.total >= r.target ? "🎉 已達標，可以到「獎勵」頁兌換" : left > 0 ? `本期還剩 ${left} 天` : "本期已結束"}</div>
    </section>
  );
}

// =====================================================================
//  日曆
// =====================================================================
function CalendarView(props) {
  const { state, activeHabits, today } = props;
  const [filter, setFilter] = useState("all"); // "all" 或 habitId
  const [mode, setMode] = useState("month"); // week | month | year
  const [anchor, setAnchor] = useState(today); // 目前看的日期
  const [showArchived, setShowArchived] = useState(false);
  const habits = showArchived ? state.habits : activeHabits;
  const habit = filter === "all" ? null : state.habits.find((h) => h.id === filter) || null;
  useEffect(() => { if (filter !== "all" && !habit) setFilter("all"); }, [filter, habit]);

  const ws = state.settings.weekStart;
  const shift = (dir) => {
    if (mode === "week") setAnchor(addDays(anchor, 7 * dir));
    else if (mode === "month") { const d = parseKey(anchor); setAnchor(keyOf(new Date(d.getFullYear(), d.getMonth() + dir, 1))); }
    else { const d = parseKey(anchor); setAnchor(keyOf(new Date(d.getFullYear() + dir, 0, 1))); }
  };
  const a = parseKey(anchor);
  const title = mode === "week" ? `${fmtMD(weekStartOf(anchor, ws))} – ${fmtMD(addDays(weekStartOf(anchor, ws), 6))}`
    : mode === "month" ? `${a.getFullYear()} 年 ${a.getMonth() + 1} 月` : `${a.getFullYear()} 年`;

  return (
    <>
      <section className="card tight">
        <div className="seg">
          {[["week", "週"], ["month", "月"], ["year", "年"]].map(([k, l]) => (
            <button key={k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
        <div className="chips scroll">
          <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>全部習慣</button>
          {habits.map((h) => (
            <button key={h.id} className={`chip ${filter === h.id ? "on" : ""}`} style={{ "--c": h.color }} onClick={() => setFilter(h.id)}>
              <i className="dot" style={{ background: h.color }} />{h.name}{h.archived ? "（封存）" : ""}
            </button>
          ))}
        </div>
        {state.habits.some((h) => h.archived) && (
          <label className="muted small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> 顯示已封存的習慣</label>
        )}
      </section>

      {habit && <StatsCard {...props} habit={habit} />}

      <section className="card">
        <div className="row between nav">
          <button className="icon" onClick={() => shift(-1)} aria-label="上一頁">{I.left}</button>
          <button className="title" onClick={() => setAnchor(today)} title="回到今天">{title}</button>
          <button className="icon" onClick={() => shift(1)} aria-label="下一頁">{I.right}</button>
        </div>
        {mode === "week" && <WeekGrid {...props} habits={habit ? [habit] : habits} anchor={anchor} />}
        {mode === "month" && <MonthGrid {...props} habits={habits} habit={habit} anchor={anchor} />}
        {mode === "year" && <YearHeatmap {...props} habits={habits} habit={habit} anchor={anchor} />}
      </section>
    </>
  );
}

function StatsCard({ state, idx, today, habit, editHabit }) {
  const st = habitStats(habit, idx, today, state.settings.weekStart);
  return (
    <section className="card">
      <div className="row between">
        <h2><i className="dot" style={{ background: habit.color }} />{habit.name}</h2>
        <button className="icon" onClick={() => editHabit(habit)} aria-label="編輯習慣">{I.edit}</button>
      </div>
      <div className="stats">
        <div><b>{st.current}</b><span>目前連續</span></div>
        <div><b>{st.longest}</b><span>最長連續</span></div>
        {/* 本月達成率以「每天」為基準，只對每天的習慣有意義；其他頻率改顯示累計次數 */}
        {isDaily(habit)
          ? <>
              <div><b>{pct(st.monthRate)}</b><span>本月 {st.doneThisMonth}/{st.daysSoFar} 天</span></div>
              <div><b>{st.total}</b><span>累計天數</span></div>
            </>
          : <>
              <div><b>{st.thisPeriod}/{habit.goalTimes}</b><span>{periodWord(habit)}・連續達標 {st.periodStreak} {habit.goalWeeks === 1 ? "週" : "期"}{habit.goalWeeks > 1 ? `・剩 ${st.periodLeft} 天` : ""}</span></div>
              <div><b>{st.total}</b><span>累計次數</span></div>
            </>}
      </div>
    </section>
  );
}

function WeekGrid({ state, idx, today, actions, habits, anchor }) {
  const ws = state.settings.weekStart;
  const start = weekStartOf(anchor, ws);
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  if (!habits.length) return <div className="empty">沒有可顯示的習慣</div>;
  return (
    <div className="week">
      <div className="wrow head">
        <span />
        {days.map((d) => <span key={d} className={d === today ? "today" : ""}>{WEEKDAYS[parseKey(d).getDay()]}<br /><small>{parseKey(d).getDate()}</small></span>)}
        <span>次數</span>
      </div>
      {habits.map((h) => {
        // 次數算「這一週所在那一期」的累計（每週一期時就是本週）
        const per = periodOf(h, start, ws);
        const n = countInRange(idx, h.id, per.start, per.end);
        const met = n >= h.goalTimes;
        return (
          <div className="wrow" key={h.id}>
            <span className="wname"><i className="dot" style={{ background: h.color }} />{h.name}</span>
            {days.map((d) => {
              const done = isDone(idx, h.id, d);
              const future = d > today;
              return (
                <button key={d} disabled={future} className={`wcell ${done ? "done" : ""}`} style={{ "--c": h.color }}
                  onClick={() => actions.toggleCheck(h.id, d)} aria-label={`${h.name} ${fmtMD(d)} ${done ? "已完成" : "未完成"}`}>
                  {done && I.check}
                </button>
              );
            })}
            <span className={`wcount ${met ? "met" : ""}`}>{isDaily(h) ? `${n}/7` : `${n}/${h.goalTimes}`}</span>
          </div>
        );
      })}
    </div>
  );
}

function monthCells(anchor, ws) {
  const a = parseKey(anchor);
  const y = a.getFullYear(), m = a.getMonth();
  const first = keyOf(new Date(y, m, 1));
  const lead = (parseKey(first).getDay() - ws + 7) % 7;
  const n = daysInMonth(y, m);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= n; d++) cells.push(keyOf(new Date(y, m, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

function MonthGrid({ state, idx, today, openDay, habits, habit, anchor }) {
  const ws = state.settings.weekStart;
  const cells = monthCells(anchor, ws);
  return (
    <div className="month">
      {weekdayLabels(ws).map((w) => <span key={w} className="wd">{w}</span>)}
      {cells.map((d, i) => {
        if (!d) return <span key={i} className="mcell blank" />;
        const future = d > today;
        const pens = idx.penByDate.get(d)?.length || 0;
        if (habit) {
          const done = isDone(idx, habit.id, d);
          const col = i % 7; // 只在同一列內把連續天數連起來
          const prevDone = done && col > 0 && isDone(idx, habit.id, addDays(d, -1));
          const nextDone = done && col < 6 && isDone(idx, habit.id, addDays(d, 1));
          return (
            <button key={d} disabled={future} onClick={() => openDay(d)}
              className={`mcell single ${done ? "done" : ""} ${prevDone ? "joinL" : ""} ${nextDone ? "joinR" : ""} ${d === today ? "today" : ""}`}
              style={{ "--c": habit.color }}>
              <span className="dnum">{parseKey(d).getDate()}</span>
              {done && habit.type === "streak" && <span className="sub">×{Math.min(streakEndingAt(idx, habit.id, d), STREAK_CAP)}</span>}
            </button>
          );
        }
        const doneSet = idx.byDate.get(d) || new Set();
        const shown = habits.filter((h) => doneSet.has(h.id));
        return (
          <button key={d} disabled={future} onClick={() => openDay(d)} className={`mcell ${d === today ? "today" : ""}`}>
            <span className="dnum">{parseKey(d).getDate()}</span>
            <span className="dots">
              {shown.map((h) => <i key={h.id} className="dot" style={{ background: h.color }} title={h.name} />)}
              {pens > 0 && state.settings.rewardsEnabled && <i className="dot pen" title={`懲罰 ${pens} 次`} />}
            </span>
          </button>
        );
      })}
      {!habit && habits.length > 0 && (
        <div className="legend">
          {habits.map((h) => <span key={h.id}><i className="dot" style={{ background: h.color }} />{h.name}</span>)}
          {state.settings.rewardsEnabled && <span><i className="dot pen" />懲罰</span>}
        </div>
      )}
    </div>
  );
}

function YearHeatmap({ state, idx, today, openDay, habits, habit, anchor }) {
  const ws = state.settings.weekStart;
  const y = parseKey(anchor).getFullYear();
  const jan1 = `${y}-01-01`, dec31 = `${y}-12-31`;
  const start = weekStartOf(jan1, ws);
  const weeks = [];
  for (let w = start; w <= dec31; w = addDays(w, 7)) weeks.push(w);
  const scroller = useRef(null);
  useEffect(() => { // 預設捲到「今天」附近
    const el = scroller.current;
    if (!el) return;
    const i = today.startsWith(String(y)) ? weeks.findIndex((w) => addDays(w, 6) >= today) : 0;
    el.scrollLeft = Math.max(0, i * 14 - el.clientWidth + 60);
  }, [y]);

  const level = (d) => {
    if (habit) return isDone(idx, habit.id, d) ? 4 : 0;
    const active = habits.filter((h) => h.createdAt <= d);
    if (!active.length) return 0;
    const set = idx.byDate.get(d);
    const n = set ? active.filter((h) => set.has(h.id)).length : 0;
    if (!n) return 0;
    return Math.max(1, Math.ceil((n / active.length) * 4));
  };
  const color = habit ? habit.color : "var(--accent)";
  let doneDays = 0, total = 0;
  const monthLabels = weeks.map((w, i) => {
    const d = parseKey(addDays(w, 6));
    return d.getFullYear() === y && (i === 0 || parseKey(addDays(weeks[i - 1], 6)).getMonth() !== d.getMonth()) ? `${d.getMonth() + 1}月` : "";
  });
  const grid = weeks.map((w) => [...Array(7)].map((_, r) => {
    const d = addDays(w, r);
    if (d < jan1 || d > dec31) return { d, out: true };
    if (d <= today) { total++; if (level(d) > 0) doneDays++; }
    return { d, lv: d > today ? -1 : level(d) };
  }));

  return (
    <div>
      <div className="heat-wrap" ref={scroller}>
        <div className="heat" style={{ "--c": color }}>
          <div className="hmonths">{monthLabels.map((l, i) => <span key={i}>{l}</span>)}</div>
          <div className="hgrid">
            {grid.map((col, i) => (
              <div key={i} className="hcol">
                {col.map((c) => c.out ? <span key={c.d} className="hc out" /> : (
                  <button key={c.d} className={`hc l${c.lv}`} disabled={c.lv < 0} onClick={() => openDay(c.d)} title={`${c.d}`} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="row between muted small">
        <span>{y} 年有紀錄的天數：{doneDays} / {total}</span>
        <span className="hlegend" style={{ "--c": color }}>少 {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`hc l${l}`} />)} 多</span>
      </div>
    </div>
  );
}

// =====================================================================
//  某一天的補登面板
// =====================================================================
function DaySheet({ state, idx, today, actions, activeHabits, date, onClose }) {
  const habits = state.habits.filter((h) => !h.archived || isDone(idx, h.id, date));
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${date} 紀錄`}>
        <div className="row between">
          <h2>{fmtFull(date)}{date === today && "・今天"}</h2>
          <button className="icon" onClick={onClose} aria-label="關閉">{I.x}</button>
        </div>
        {date > today ? <div className="empty">不能記錄未來的日子</div> : (
          <>
            <ul className="list">
              {habits.map((h) => {
                const done = isDone(idx, h.id, date);
                const note = idx.byHabit.get(h.id)?.get(date)?.note || "";
                return (
                  <li key={h.id} className={`habit ${done ? "done" : ""}`} onClick={() => actions.toggleCheck(h.id, date)}>
                    <span className="checkbtn" style={{ "--c": h.color }}>{done && I.check}</span>
                    <div className="grow">
                      <div className="name">{h.name}{h.archived ? "（封存）" : ""}</div>
                      {done && state.settings.rewardsEnabled && <div className="meta"><span>＋{checkPoints(h, idx, date)}</span></div>}
                      {done && (
                        <input key={note} className="inline note-input" placeholder="備註" defaultValue={note} maxLength={NOTE_MAX}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => e.target.value.trim() !== note && actions.setCheckNote(h.id, date, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
                      )}
                    </div>
                  </li>
                );
              })}
              {habits.length === 0 && <div className="empty">還沒有習慣</div>}
            </ul>
            {state.settings.rewardsEnabled && state.penalties.length > 0 && <PenaltyPanel state={state} idx={idx} date={date} actions={actions} />}
          </>
        )}
      </div>
    </div>
  );
}

// 打卡後寫備註（或修改已寫的備註）
function NoteSheet({ idx, actions, habit, date, onClose }) {
  const [text, setText] = useState(() => idx.byHabit.get(habit.id)?.get(date)?.note || "");
  const save = () => { actions.setCheckNote(habit.id, date, text); onClose(); };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${habit.name} 備註`}>
        <div className="row between">
          <h2><i className="dot" style={{ background: habit.color }} />{habit.name}</h2>
          <button className="icon" onClick={onClose} aria-label="關閉">{I.x}</button>
        </div>
        <textarea autoFocus rows={3} maxLength={NOTE_MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder="寫點什麼…（可留白）" />
        <div className="row between actions">
          <button className="ghost small" onClick={onClose}>略過</button>
          <button className="primary" onClick={save}>儲存</button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
//  新增 / 編輯習慣
// =====================================================================
function HabitEditor({ state, today, actions, habit, onClose }) {
  const isNew = !habit.id;
  const [h, setH] = useState(() => (isNew ? newHabit({}, state.habits.length, today) : { ...habit }));
  const set = (patch) => setH((x) => ({ ...x, ...patch }));
  const save = () => {
    if (!h.name.trim()) return;
    actions.saveHabit({ ...h, name: h.name.trim() });
    onClose();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="row between">
          <h2>{isNew ? "新增習慣" : "編輯習慣"}</h2>
          <button className="icon" onClick={onClose} aria-label="關閉">{I.x}</button>
        </div>
        <label className="field">名稱
          <input autoFocus value={h.name} onChange={(e) => set({ name: e.target.value })} placeholder="例如：運動 30 分鐘" onKeyDown={(e) => e.key === "Enter" && save()} />
        </label>
        <div className="field">顏色
          <div className="swatches">
            {PALETTE.map((c) => <button key={c} className={`sw ${h.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />)}
          </div>
        </div>
        <div className="field">頻率
          <div className="row gap wrap">
            <select value={isDaily(h) ? "daily" : "custom"} onChange={(e) => set(e.target.value === "daily" ? { goalTimes: 7, goalWeeks: 1 } : { goalTimes: 3, goalWeeks: 1 })}>
              <option value="daily">每天</option>
              <option value="custom">自訂</option>
            </select>
            {!isDaily(h) && (
              <span className="row gap goal">
                每<NumField value={h.goalWeeks} min={1} max={52} onChange={(w) => set({ goalWeeks: w, goalTimes: Math.min(h.goalTimes, w * 7) })} />週
                <NumField value={h.goalTimes} min={1} max={h.goalWeeks * 7} onChange={(t) => set({ goalTimes: t })} />次
              </span>
            )}
          </div>
        </div>
        <label className="row between field-switch">
          <span>打卡時寫備註</span>
          <input type="checkbox" className="switch" checked={!!h.askNote} onChange={(e) => set({ askNote: e.target.checked })} />
        </label>
        {state.settings.rewardsEnabled && (
          <div className="row gap">
            <label className="field grow">計分方式
              <select value={h.type} onChange={(e) => set({ type: e.target.value })}>
                <option value="count">計次（每次固定加分）</option>
                <option value="streak">累計（× 連續天數，最多 ×{STREAK_CAP}）</option>
              </select>
            </label>
            <label className="field narrow">每次加
              <input inputMode="numeric" value={h.value} onChange={(e) => set({ value: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} />
            </label>
          </div>
        )}
        <div className="row between actions">
          {!isNew ? (
            <div className="row gap">
              <button className="ghost small" onClick={() => { actions.saveHabit({ ...h, name: h.name.trim() || habit.name, archived: !h.archived }); onClose(); }}>{h.archived ? "取消封存" : "封存"}</button>
              <button className="ghost small danger" onClick={() => { if (actions.deleteHabit(habit)) onClose(); }}>刪除</button>
            </div>
          ) : <span />}
          <button className="primary" disabled={!h.name.trim()} onClick={save}>儲存</button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
//  獎勵
// =====================================================================
function RewardsView({ state, idx, today, actions }) {
  return (
    <>
      {state.rewards.map((r) => <RewardCard key={r.id} state={state} idx={idx} r={r} today={today} actions={actions} />)}
      <button className="ghost" onClick={actions.addReward}>{I.plus} 新增獎勵卡</button>
    </>
  );
}

function NumField({ value, onChange, min = 1, max = Infinity }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Math.min(max, Math.max(min, Number(v) || min)); setV(String(n)); if (n !== value) onChange(n); };
  return <input className="num" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />;
}

function RewardCard({ state, idx, r, today, actions }) {
  const t = rewardTotals(state, idx, r);
  const achieved = t.total >= r.target;
  const ended = t.end < today;
  const [scopeOpen, setScopeOpen] = useState(false);
  const patch = (p) => actions.patchReward(r.id, p);
  const toggleScope = (key, all, id) => {
    const cur = r[key] ?? all.map((x) => x.id);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    patch({ [key]: next.length === all.length ? null : next });
  };
  const habitsById = new Map(state.habits.map((h) => [h.id, h]));
  return (
    <section className="card">
      <div className="row between">
        <input className="title-input" value={r.name} onChange={(e) => patch({ name: e.target.value })} aria-label="獎勵名稱" />
        <button className="icon" onClick={() => actions.deleteReward(r)} aria-label="刪除獎勵卡">{I.x}</button>
      </div>
      <div className="row gap wrap small">
        <label>起始 <input type="date" value={r.startDate} max={today} onChange={(e) => e.target.value && patch({ startDate: e.target.value, resetTs: 0 })} /></label>
        <label>期間 <NumField value={r.periodDays} onChange={(n) => patch({ periodDays: n })} /> 天</label>
        <span className="muted">～ {t.end}{ended ? "（已結束）" : ""}</span>
      </div>
      <div className="row between">
        <span className="mono big">{t.total} / <NumField value={r.target} onChange={(n) => patch({ target: n })} /></span>
        <span className="muted small">習慣 +{t.plus}・懲罰 −{t.minus}</span>
      </div>
      <ProgressBar total={t.total} target={r.target} plus={t.plus} minus={t.minus} />
      {t.byHabit.size > 0 && (
        <div className="contrib">
          {[...t.byHabit.entries()].sort((a, b) => b[1] - a[1]).map(([id, p]) => (
            <span key={id}><i className="dot" style={{ background: habitsById.get(id)?.color }} />{habitsById.get(id)?.name} +{p}</span>
          ))}
        </div>
      )}
      <div className="row gap wrap">
        {achieved && <button className="primary" onClick={() => actions.newPeriod(r, t.total)}>🎉 兌換</button>}
        <button className="ghost small" onClick={() => actions.newPeriod(r)}>新開一期</button>
        <button className="ghost small" onClick={() => setScopeOpen((x) => !x)}>計分範圍{r.habitIds || r.penaltyIds ? "（自訂）" : "（全部）"}</button>
      </div>
      {scopeOpen && (
        <div className="scope">
          <div className="muted small">哪些習慣加分：</div>
          <div className="chips">
            {state.habits.map((h) => {
              const on = !r.habitIds || r.habitIds.includes(h.id);
              return <button key={h.id} className={`chip ${on ? "on" : ""}`} onClick={() => toggleScope("habitIds", state.habits, h.id)}><i className="dot" style={{ background: h.color }} />{h.name}</button>;
            })}
          </div>
          <div className="muted small">哪些懲罰扣分：</div>
          <div className="chips">
            {state.penalties.map((p) => {
              const on = !r.penaltyIds || r.penaltyIds.includes(p.id);
              return <button key={p.id} className={`chip ${on ? "on" : ""}`} onClick={() => toggleScope("penaltyIds", state.penalties, p.id)}>{p.name}</button>;
            })}
          </div>
        </div>
      )}
      {r.redemptions.length > 0 && (
        <details>
          <summary className="muted small">兌換紀錄（{r.redemptions.length}）</summary>
          <ul className="loglist">
            {[...r.redemptions].reverse().map((x) => <li key={x.id}><span>{x.date}　{x.note}</span>{Number.isFinite(x.points) && <span className="muted">{x.points} 點</span>}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

// =====================================================================
//  設定
// =====================================================================
function SettingsView({ state, today, actions, editHabit }) {
  const fileRef = useRef(null);
  const [pName, setPName] = useState("");
  const [pVal, setPVal] = useState("1");

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `habit-hourglass-${stamp()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const { state: next, from } = parseImport(await f.text(), today);
      const msg = `匯入「${f.name}」：${next.habits.length} 個習慣、${next.checks.length} 筆打卡、${next.penaltyLogs.length} 筆懲罰。\n\n目前的資料會被取代（會先自動備份一份在瀏覽器中）。確定匯入？`;
      if (!confirm(msg)) return;
      actions.replaceAll(next, `已匯入${from === "v1" ? "（舊版格式，已自動轉換）" : ""}：${next.habits.length} 個習慣、${next.checks.length} 筆打卡。`);
    } catch (err) {
      alert(`匯入失敗：${err.message}`);
    }
  };

  return (
    <>
      <section className="card">
        <div className="row between"><h2>習慣</h2><button className="ghost small" onClick={() => editHabit({})}>{I.plus} 新增</button></div>
        <ul className="list">
          {state.habits.map((h) => (
            <li key={h.id} className={`habit ${h.archived ? "archived" : ""}`} onClick={() => editHabit(h)}>
              <i className="dot big" style={{ background: h.color }} />
              <div className="grow">
                <div className="name">{h.name}{h.archived && <span className="tag">封存</span>}</div>
                <div className="meta"><span>{goalLabel(h)}</span>{state.settings.rewardsEnabled && <span>{h.type === "streak" ? "累計" : "計次"} +{h.value}</span>}</div>
              </div>
              {I.edit}
            </li>
          ))}
          {state.habits.length === 0 && <div className="empty">還沒有習慣</div>}
        </ul>
      </section>

      <section className="card">
        <label className="row between">
          <b>獎勵／懲罰點數</b>
          <input type="checkbox" className="switch" checked={state.settings.rewardsEnabled} onChange={(e) => actions.setSettings({ rewardsEnabled: e.target.checked })} />
        </label>
        {state.settings.rewardsEnabled && (
          <>
            <h3>懲罰項目</h3>
            <ul className="loglist">
              {state.penalties.map((p) => (
                <li key={p.id}>
                  <input className="inline" value={p.name} onChange={(e) => actions.savePenalty({ ...p, name: e.target.value })} aria-label="懲罰名稱" />
                  <span className="row gap">−<NumField value={p.value} onChange={(n) => actions.savePenalty({ ...p, value: n })} /><button className="link danger" onClick={() => actions.deletePenalty(p)}>刪除</button></span>
                </li>
              ))}
            </ul>
            <div className="row gap">
              <input className="grow" placeholder="新增懲罰，例如：熬夜" value={pName} onChange={(e) => setPName(e.target.value)} />
              <span>−</span>
              <input className="num" inputMode="numeric" value={pVal} onChange={(e) => setPVal(e.target.value.replace(/\D/g, ""))} />
              <button className="primary small" disabled={!pName.trim()} onClick={() => { actions.savePenalty({ id: uid(), name: pName.trim(), value: Math.max(1, Number(pVal) || 1) }); setPName(""); setPVal("1"); }}>{I.plus}</button>
            </div>
          </>
        )}
      </section>

      <ReminderCard state={state} actions={actions} />

      <section className="card">
        <label className="row between">
          <b>每週從哪天開始</b>
          <select value={state.settings.weekStart} onChange={(e) => actions.setSettings({ weekStart: Number(e.target.value) })}>
            <option value={1}>星期一</option><option value={0}>星期日</option>
          </select>
        </label>
      </section>

      <section className="card">
        <h2>備份</h2>
        <div className="row gap wrap">
          <button className="primary" onClick={exportJson}>匯出 JSON</button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>匯入 JSON</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
        </div>
      </section>
    </>
  );
}

function ReminderCard({ state, actions }) {
  const time = state.settings.reminderTime;
  const [perm, setPerm] = useState(canNotify() ? Notification.permission : "unsupported");
  const askPerm = async () => {
    if (!canNotify()) return;
    try { setPerm(await Notification.requestPermission()); } catch (e) { /* 舊版 Safari 不回傳 Promise */ }
  };
  const toggle = (on) => {
    actions.setSettings({ reminderTime: on ? (time || "21:00") : "", reminderLast: "" });
    if (on && perm === "default") askPerm();
  };
  return (
    <section className="card">
      <label className="row between">
        <b>打卡提醒</b>
        <input type="checkbox" className="switch" checked={!!time} onChange={(e) => toggle(e.target.checked)} />
      </label>
      {time && (
        <>
          <label className="row between">
            <span>提醒時間</span>
            <input type="time" value={time} onChange={(e) => e.target.value && actions.setSettings({ reminderTime: e.target.value, reminderLast: "" })} />
          </label>
          {perm === "default" && <button className="ghost small" onClick={askPerm}>允許顯示通知</button>}
          {perm === "denied" && <p className="muted small">通知已被封鎖</p>}
          {perm === "unsupported" && <p className="muted small">iPhone 需先加入主畫面才能通知</p>}
        </>
      )}
    </section>
  );
}

// ---------- 啟動 ----------
createRoot(document.getElementById("root")).render(<App />);

// Service worker：新版部署後自動換上（重新整理一次）
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloaded) { reloaded = true; window.location.reload(); }
    });
  });
}
