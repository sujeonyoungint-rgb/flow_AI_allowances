import { ParsedTitle } from "./types";

export function parseTitle(title: string): ParsedTitle {
  const trimmed = (title || "").trim();
  // (괄호) 부가 정보 캡처 (선택사항)
  const match = trimmed.match(/^(\d{8}|\d{6})\s+(.+?)\s*(-?[\d,]+)\s*원?\s*(?:\(([^)]+)\))?\s*$/);
  if (!match) return { valid: false };

  const [, dateStr, store, amountStr, note] = match;
  
  let year: number, month: number, day: number;
  if (dateStr.length === 8) {
    year = parseInt(dateStr.slice(0, 4));
    month = parseInt(dateStr.slice(4, 6));
    day = parseInt(dateStr.slice(6, 8));
  } else {
    year = 2000 + parseInt(dateStr.slice(0, 2));
    month = parseInt(dateStr.slice(2, 4));
    day = parseInt(dateStr.slice(4, 6));
  }
  
  const amount = parseInt(amountStr.replace(/,/g, ""));
  
  if (month < 1 || month > 12 || day < 1 || day > 31) return { valid: false };
  if (isNaN(amount) || amount === 0) return { valid: false };
  
  return {
    valid: true, year, month, day,
    dateStr: `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    store: store.trim(),
    amount,
    note: note?.trim() || undefined,
  };
}

export function parseFlowDateTime(s: string): Date | null {
  if (!s || s.length < 8) return null;
  const y = +s.slice(0, 4), m = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
  const hh = +s.slice(8, 10) || 0, mm = +s.slice(10, 12) || 0, ss = +s.slice(12, 14) || 0;
  return new Date(y, m, d, hh, mm, ss);
}

export function formatKRW(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}