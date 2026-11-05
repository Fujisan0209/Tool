/* 日付まわり。学習の「1日」は朝4時に切りかわります（夜ふかしして0時をまたいでも同じ日）。 */
"use strict";

const DAY = 24 * 60 * 60 * 1000;

/** その時刻が属する学習日を "YYYY-MM-DD"（ローカル時刻）で返します */
function dayKey(ms, dayStartHour = 4) {
  const d = new Date(ms - dayStartHour * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 学習日 key の n 日あと */
function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(y, m - 1, d + n, 12);
  return dayKey(t.getTime(), 0);
}

module.exports = { DAY, dayKey, addDays };
