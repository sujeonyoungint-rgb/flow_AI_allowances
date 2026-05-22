import { ParsedTitle } from "./types";

export function parseTitle(title: string): ParsedTitle {
  const trimmed = (title || "").trim();
  // 마이너스(-) 허용: "20260710 매장명 -17000원" 같은 취소 항목
  const match = trimmed.match(/^(\d{8})\s+(.+?)\s+(-?[\d,]+)\s*원?\s*$/);
  if (!match) return { valid: false };
  const [, dateStr, store, amountStr] = match;
  const year = parseInt(dateStr.slice(0, 4));
  const month = parseInt(dateStr.slice(4, 6));
  const day = parseInt(dateStr.slice(6, 8));
  const amount = parseInt(amountStr.replace(/,/g, ""));
  if (month < 1 || month > 12 || day < 1 || day > 31) return { valid: false };
  if (isNaN(amount) || amount === 0) return { valid: false };
  return {
    valid: true, year, month, day,
    dateStr: `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`,
    store: store.trim(), amount,
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