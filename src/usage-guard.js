import { config } from "./config.js";

// Global daily circuit-breaker on answer generations to cap OpenAI spend.
// In-memory and single-instance; resets on date rollover or process restart.
let state = { date: currentDate(), count: 0 };

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function rollover() {
  const today = currentDate();
  if (state.date !== today) {
    state = { date: today, count: 0 };
  }
}

export function isOverDailyLimit() {
  rollover();
  return state.count >= config.dailyAnswerLimit;
}

export function recordAnswer() {
  rollover();
  state.count += 1;
  return state.count;
}

export function usageSnapshot() {
  rollover();
  return { date: state.date, count: state.count, limit: config.dailyAnswerLimit };
}
