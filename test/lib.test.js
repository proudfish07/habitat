// 執行：npm test（或 node test/lib.test.js）
import assert from "node:assert/strict";
import {
  addDays, diffDays, weekStartOf, migrateV1, normalizeState, buildIndex, checkPoints, previewPoints,
  habitStats, rewardTotals, parseImport, loadState, reminderDue, LS_KEY, LS_KEY_V1,
} from "../src/lib.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("✓", name); };

const TODAY = "2026-10-22"; // 星期四

test("日期運算跨月、跨年", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(diffDays("2026-02-27", "2026-03-02"), 3);
  assert.equal(weekStartOf(TODAY, 1), "2026-10-19");
  assert.equal(weekStartOf(TODAY, 0), "2026-10-18");
});

// 模擬舊版 habit_rewards_v1 的資料（結構照原本 index.html）
const v1 = {
  rewards: [{
    id: "r1", name: "買新鞋", color: "#6b7280", target: 30, startDate: "2026-10-15", periodDays: 30,
    habits: [
      { id: "h1", name: "運動", type: "count", color: "#6b7280", value: 2, streakMax: 30 },
      { id: "h2", name: "早睡", type: "streak", color: "#9aa5b1", value: 1, streakMax: 30 },
    ],
    penalties: [{ id: "p1", name: "油炸物", value: 5 }],
    events: [
      { id: "e1", habitId: "h1", date: "2026-10-20", ts: 1, delta: 2 },
      { id: "e2", habitId: "h2", date: "2026-10-20", ts: 2, delta: 1 },
      { id: "e3", habitId: "h2", date: "2026-10-21", ts: 3, delta: 2 },
      { id: "e4", habitId: null, penaltyId: "p1", date: "2026-10-21", ts: 4, delta: -5, isPenalty: true },
      { id: "e5", habitId: "ghost", date: "2026-10-21", ts: 5, delta: 9 }, // 孤兒
    ],
    redemptions: [{ id: "x", date: "2026-10-14", note: "買新鞋" }],
  }],
};

test("v1 遷移：習慣、打卡、懲罰、兌換都保留，孤兒紀錄被排除", () => {
  const { state, report } = migrateV1(v1, TODAY);
  assert.equal(state.habits.length, 2);
  assert.equal(state.checks.length, 3);
  assert.equal(state.penaltyLogs.length, 1);
  assert.equal(report.dropped, 1);
  assert.equal(state.rewards[0].redemptions.length, 1);
  assert.deepEqual(state.rewards[0].habitIds, ["h1", "h2"]);
  assert.equal(state.habits[1].createdAt, "2026-10-20");
});

test("v1 遷移：總分和舊版一樣（2+1+2-5=0）", () => {
  const { state } = migrateV1(v1, TODAY);
  const idx = buildIndex(state);
  const t = rewardTotals(state, idx, state.rewards[0]);
  assert.equal(t.plus, 5);
  assert.equal(t.minus, 5);
  assert.equal(t.total, 0);
});

test("累計型：連續天數加成，今天打卡預覽 = value × 3", () => {
  const { state } = migrateV1(v1, TODAY);
  const idx = buildIndex(state);
  const h2 = state.habits[1];
  assert.equal(previewPoints(h2, idx, TODAY), 3);
  const s2 = { ...state, checks: [...state.checks, { id: "n", habitId: "h2", date: TODAY, ts: 9 }] };
  const idx2 = buildIndex(s2);
  assert.equal(checkPoints(h2, idx2, TODAY), 3);
});

test("統計：目前連續（今天還沒打不算斷）、最長連續、本週次數", () => {
  const s = normalizeState({
    version: 2,
    habits: [{ id: "a", name: "讀書", type: "count", value: 1, weeklyTarget: 3, createdAt: "2026-10-01" }],
    checks: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-20", "2026-10-21"].map((d, i) => ({ id: "c" + i, habitId: "a", date: d, ts: i })),
  }, TODAY);
  const st = habitStats(s.habits[0], buildIndex(s), TODAY, 1);
  assert.equal(st.current, 2);
  assert.equal(st.longest, 4);
  assert.equal(st.thisWeek, 2);
  assert.equal(st.doneThisMonth, 6);
  assert.equal(st.daysSoFar, 22);
});

test("補登建立日之前的日子：建立日往前移，本月達成率算得到", () => {
  const s = normalizeState({
    version: 2,
    habits: [{ id: "a", name: "讀書", createdAt: TODAY }],
    checks: ["2026-10-20", "2026-10-21"].map((d, i) => ({ id: "c" + i, habitId: "a", date: d, ts: i })),
  }, TODAY);
  assert.equal(s.habits[0].createdAt, "2026-10-20");
  const st = habitStats(s.habits[0], buildIndex(s), TODAY, 1);
  assert.equal(st.current, 2);
  assert.equal(st.doneThisMonth, 2);
  assert.equal(st.daysSoFar, 3);
});

test("同一習慣同一天重複打卡只算一次", () => {
  const s = normalizeState({
    version: 2, habits: [{ id: "a", name: "x" }],
    checks: [{ id: "1", habitId: "a", date: TODAY, ts: 1 }, { id: "2", habitId: "a", date: TODAY, ts: 2 }],
  }, TODAY);
  assert.equal(s.checks.length, 1);
});

test("兌換後同一天新開一期：兌換前的紀錄不重複計分", () => {
  const s = normalizeState({
    version: 2, habits: [{ id: "a", name: "x", value: 1 }],
    checks: [{ id: "1", habitId: "a", date: TODAY, ts: 100 }],
    rewards: [{ id: "r", name: "r", target: 5, startDate: TODAY, periodDays: 7, resetTs: 200 }],
  }, TODAY);
  assert.equal(rewardTotals(s, buildIndex(s), s.rewards[0]).total, 0);
});

test("匯入：v2 匯出檔與 v1 舊檔都能讀，亂碼會丟錯", () => {
  const { state } = migrateV1(v1, TODAY);
  assert.equal(parseImport(JSON.stringify(state), TODAY).from, "v2");
  assert.equal(parseImport(JSON.stringify(v1), TODAY).from, "v1");
  assert.throws(() => parseImport('{"foo":1}', TODAY));
});

test("loadState：只有舊版資料時自動遷移，舊 key 不被刪", () => {
  const mem = new Map([[LS_KEY_V1, JSON.stringify(v1)]]);
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const { state, migrated } = loadState(storage, TODAY);
  assert.ok(migrated);
  assert.equal(state.habits.length, 2);
  assert.ok(mem.has(LS_KEY_V1));
  assert.ok(!mem.has(LS_KEY));
});

test("預設純打卡模式：新使用者與舊版轉換都關閉點數，已開啟的設定會保留", () => {
  assert.equal(normalizeState(null, TODAY).settings.rewardsEnabled, false);
  assert.equal(migrateV1(v1, TODAY).state.settings.rewardsEnabled, false);
  assert.equal(normalizeState({ version: 2, settings: { rewardsEnabled: true } }, TODAY).settings.rewardsEnabled, true);
});

test("打卡提醒：時間到、今天沒提醒過、還有沒打卡的才提醒；壞掉的時間會被清掉", () => {
  const st = normalizeState({ version: 2, settings: { reminderTime: "21:00" } }, TODAY).settings;
  assert.equal(st.reminderTime, "21:00");
  assert.equal(reminderDue(st, TODAY, "20:59", 2), false);
  assert.equal(reminderDue(st, TODAY, "21:00", 2), true);
  assert.equal(reminderDue(st, TODAY, "23:10", 0), false);
  assert.equal(reminderDue({ ...st, reminderLast: TODAY }, TODAY, "21:30", 2), false);
  assert.equal(reminderDue({ ...st, reminderTime: "" }, TODAY, "21:30", 2), false);
  assert.equal(normalizeState({ version: 2, settings: { reminderTime: "25:99" } }, TODAY).settings.reminderTime, "");
});

console.log(`\n全部 ${passed} 項通過`);
