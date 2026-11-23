import type { DatabaseSync } from "node:sqlite";
import type { UploadQuota } from "../src/lib/uploads";
import { HttpError } from "./http";

const DAILY_LIMIT = 2;
const campusDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const campusOffset = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", timeZoneName: "longOffset",
});

// New York's midnight precedes its 2am daylight-saving transition. The offset
// at UTC midnight on the same date therefore gives the correct local midnight.
function midnightUtc(utcDate: number) {
  const offset = campusOffset.formatToParts(utcDate).find((part) => part.type === "timeZoneName")!.value;
  const hours = Number(offset.match(/GMT([+-]\d{2}):00/)![1]);
  return utcDate - hours * 60 * 60 * 1000;
}

export function uploadQuota(database: DatabaseSync, userId: number, now = new Date()): UploadQuota {
  const parts = campusDate.formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const date = Date.UTC(value("year"), value("month") - 1, value("day"));
  const start = new Date(midnightUtc(date));
  const end = new Date(midnightUtc(date + 24 * 60 * 60 * 1000));
  const sqlDate = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
  const row = database.prepare(`SELECT COUNT(*) AS count FROM panoramas
    WHERE uploaded_by = ? AND uploaded_at >= ? AND uploaded_at < ?`)
    .get(userId, sqlDate(start), sqlDate(end))!;
  return { limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - Number(row.count)), resetsAt: end.toISOString() };
}

export class UploadLimitError extends HttpError {
  constructor(public quota: UploadQuota) {
    super(429, "You've reached today's upload limit. You can upload again after midnight New York time.");
  }
}

export function checkUploadQuota(database: DatabaseSync, userId: number) {
  const quota = uploadQuota(database, userId);
  if (quota.remaining === 0) throw new UploadLimitError(quota);
}
