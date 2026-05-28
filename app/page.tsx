"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Calendar, RefreshCw, CheckCircle2, AlertTriangle, Download,
  ChevronDown, ChevronRight, CircleDollarSign, AlertCircle, Pencil
} from "lucide-react";
import * as XLSX from "xlsx";
import { formatKRW } from "@/lib/utils";
import { Post, MemberSettlement } from "@/lib/types";
import { createClient } from "@/lib/supabase-client";

export default function App() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const now = new Date();
  const [selectedMonths, setSelectedMonths] = useState<{ year: number; month: number }[]>([
    { year: now.getFullYear(), month: now.getMonth() + 1 },
  ]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]); // 빈 배열 = 전체

  // 파생값
  const isSingleMonth = selectedMonths.length === 1;
  const year = selectedMonths[0]?.year ?? now.getFullYear();
  const month = selectedMonths[0]?.month ?? now.getMonth() + 1;

  const [monthPosts, setMonthPosts] = useState<Post[]>([]);
  const [modifiedPosts, setModifiedPosts] = useState<Post[]>([]);
  const [deletedLockedPosts, setDeletedLockedPosts] = useState<Post[]>([]);
  const [invalidPosts, setInvalidPosts] = useState<Post[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [settlements, setSettlements] = useState<MemberSettlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedContent, setExpandedContent] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [monthOptions, setMonthOptions] = useState<{ year: number; month: number }[]>([]);

  // 드롭다운 열림 상태
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);

  // 드롭다운 내 임시 선택 (적용 버튼 누르기 전까지 반영 안 됨)
  const [draftMonths, setDraftMonths] = useState<{ year: number; month: number }[]>(selectedMonths);
  const [draftMembers, setDraftMembers] = useState<string[]>(selectedMembers);

  // 실지급액 모달
  const [actualModalOpen, setActualModalOpen] = useState(false);
  const [actualModalMember, setActualModalMember] = useState<string | null>(null);
  const [actualModalAmount, setActualModalAmount] = useState("");
  const [actualModalMemo, setActualModalMemo] = useState("");
  const [actualModalSaving, setActualModalSaving] = useState(false);

  useEffect(() => { loadData(); }, [selectedMonths]);
  useEffect(() => { loadMonths(); }, []);
  // members가 로드/변경되면 selectedMembers 동기화
  // - 처음: 전원 선택
  // - 새 담당자 추가됨: 자동으로 선택에 포함
  // - 기존 선택은 유지
  useEffect(() => {
    if (members.length === 0) return;
    setSelectedMembers(prev => {
      // 처음(빈 상태)이면 전원 선택
      if (prev.length === 0) return members;
      // 기존 선택 중 현재 members에 있는 것만 유지 + 새로 생긴 담당자 자동 추가
      const stillValid = prev.filter(m => members.includes(m));
      const newcomers = members.filter(m => !prev.includes(m));
      return [...stillValid, ...newcomers];
    });
  }, [members]);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  // 외부 클릭 시 드롭다운 닫기 (draft 버림 = 취소)
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-dropdown='month']") && monthDropdownOpen) {
        setMonthDropdownOpen(false);
        setDraftMonths(selectedMonths); // 미적용 변경 취소
      }
      if (!target.closest("[data-dropdown='member']") && memberDropdownOpen) {
        setMemberDropdownOpen(false);
        setDraftMembers(selectedMembers); // 미적용 변경 취소
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [monthDropdownOpen, memberDropdownOpen, selectedMonths, selectedMembers]);

  async function loadData() {
    if (selectedMonths.length === 0) {
      setMonthPosts([]);
      setModifiedPosts([]);
      setDeletedLockedPosts([]);
      setInvalidPosts([]);
      setSettlements([]);
      return;
    }

    setLoading(true); setError(null);
    try {
      const results = await Promise.all(
        selectedMonths.map(async ({ year, month }) => {
          const [postsRes, settlementsRes] = await Promise.all([
            fetch(`/api/posts?year=${year}&month=${month}`),
            fetch(`/api/settlements?year=${year}&month=${month}`),
          ]);
          const postsData = await postsRes.json();
          const settlementsData = await settlementsRes.json();
          if (!postsRes.ok) throw new Error(postsData.error);
          return { year, month, postsData, settlementsData };
        })
      );

      const allMonthPosts: Post[] = [];
      const allModified: Post[] = [];
      const allDeleted: Post[] = [];
      const allInvalid: Post[] = [];
      const allSettlements: MemberSettlement[] = [];
      const memberSet = new Set<string>();

      results.forEach(({ postsData, settlementsData }) => {
        allMonthPosts.push(...(postsData.monthPosts || []));
        allModified.push(...(postsData.modifiedPosts || []));
        allDeleted.push(...(postsData.deletedLockedPosts || []));
        allInvalid.push(...(postsData.invalidPosts || []));
        allSettlements.push(...(settlementsData.settlements || []));
        (postsData.members || []).forEach((m: string) => memberSet.add(m));
      });

      setMonthPosts(allMonthPosts);
      setModifiedPosts(allModified);
      setDeletedLockedPosts(allDeleted);
      setInvalidPosts(allInvalid);
      setMembers(Array.from(memberSet));
      setSettlements(allSettlements);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMonths() {
    try {
      const res = await fetch("/api/months");
      const data = await res.json();
      setMonthOptions(data.months || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleSync() {
    setSyncing(true); setError(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await loadData();
      await loadMonths();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSignOut() {
    await fetch("/auth/signout", { method: "POST" });
    window.location.href = "/login";
  }

  function getSettlement(memberName: string, y: number, m: number): MemberSettlement | undefined {
    return settlements.find(s => s.member_name === memberName && s.year === y && s.month === m);
  }

  // 다중 월일 때는 [year, month, memberName] 키로 그룹핑
  // 단일 월일 때는 memberName만으로 그룹핑
  const groupedRows = useMemo(() => {
    type Group = {
      key: string;
      name: string;
      label: string;
      year: number;
      month: number;
      items: Post[];
      invalidItems: Post[];
      carriedItems: Post[];
      modifiedItems: Post[];
      deletedItems: Post[];
      total: number;
    };

    const groups: Record<string, Group> = {};

    const ensureGroup = (y: number, m: number, name: string): Group => {
      const key = isSingleMonth ? name : `${y}-${String(m).padStart(2, "0")}-${name}`;
      const label = isSingleMonth ? name : `[${y}-${String(m).padStart(2, "0")}] ${name}`;
      if (!groups[key]) {
        groups[key] = {
          key, name, label, year: y, month: m,
          items: [], invalidItems: [], carriedItems: [], modifiedItems: [], deletedItems: [], total: 0,
        };
      }
      return groups[key];
    };

    monthPosts.forEach(p => {
      if (p.settlement_year == null || p.settlement_month == null) return;
      const g = ensureGroup(p.settlement_year, p.settlement_month, p.member_name);
      g.items.push(p);
      g.total += p.parsed_amount || 0;
      if (p.parsed_date) {
        const [py, pm] = p.parsed_date.split("-").map(Number);
        if (py !== g.year || pm !== g.month) g.carriedItems.push(p);
      }
    });
    invalidPosts.forEach(p => {
      // 파싱 실패 글은 settlement_year/month가 없음 → 현재 선택된 월 그룹에 배치
      // 다중 월 선택일 때는 첫 번째 월에 배치 (어차피 같은 글이 여러 월에 중복으로 안 나오게)
      const targetMonth = selectedMonths[0];
      if (!targetMonth) return;
      const g = ensureGroup(targetMonth.year, targetMonth.month, p.member_name);
      g.invalidItems.push(p);
    });
    modifiedPosts.forEach(p => {
      if (p.settlement_year == null || p.settlement_month == null) return;
      const g = ensureGroup(p.settlement_year, p.settlement_month, p.member_name);
      g.modifiedItems.push(p);
    });
    deletedLockedPosts.forEach(p => {
      if (p.settlement_year == null || p.settlement_month == null) return;
      const g = ensureGroup(p.settlement_year, p.settlement_month, p.member_name);
      g.deletedItems.push(p);
    });

    // 이름 필터 적용
    const filtered = Object.values(groups).filter(g =>
  selectedMembers.includes(g.name)
);

    // 정렬: 월 오름차순 → 이름 가나다순
    filtered.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if (a.month !== b.month) return a.month - b.month;
      return a.name.localeCompare(b.name, "ko");
    });

    return filtered;
  }, [monthPosts, invalidPosts, modifiedPosts, deletedLockedPosts, selectedMembers, selectedMonths, isSingleMonth]);

  // 총액: 실지급액 있으면 그걸 우선, 없으면 시스템 금액
  const grandTotal = groupedRows.reduce((s, g) => {
    const settlement = getSettlement(g.name, g.year, g.month);
    const effective = (settlement?.actual_amount !== null && settlement?.actual_amount !== undefined)
      ? settlement.actual_amount
      : g.total;
    return s + effective;
  }, 0);

  async function handleReview(memberName: string) {
    const g = groupedRows.find(r => r.name === memberName && r.year === year && r.month === month);
    if (!g || g.items.length === 0) return;
    if (!confirm(
      `${memberName}님의 ${year}년 ${month}월 정산을 검토완료합니다.\n` +
      `${g.items.length}건 / ${formatKRW(g.total)}\n\n` +
      `검토완료 후 금액이 잠깁니다. 진행하시겠습니까?`
    )) return;

    const res = await fetch("/api/settlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review", year, month,
        member_name: memberName,
        total_amount: g.total, post_count: g.items.length,
        actor: "확인자",
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert("실패: " + err.error);
      return;
    }
    await loadData();
  }

  async function handlePay(memberName: string) {
    const s = getSettlement(memberName, year, month);
    if (!s?.is_reviewed) return;
    if (!confirm(
      `${memberName}님께 ${formatKRW(s.total_amount)} 지급완료 처리합니다.\n` +
      `지급완료 후 해당 월이 잠기며, 늦은 글은 다음 달로 이월됩니다.\n진행하시겠습니까?`
    )) return;

    const res = await fetch("/api/settlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "pay", year, month,
        member_name: memberName,
        actor: "자금집행자",
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert("실패: " + err.error);
      return;
    }
    await loadData();
  }

  function openActualModal(memberName: string) {
    const s = getSettlement(memberName, year, month);
    if (!s?.is_reviewed) {
      alert("검토완료 후에만 입력 가능합니다");
      return;
    }
    setActualModalMember(memberName);
    setActualModalAmount(s.actual_amount !== null && s.actual_amount !== undefined ? String(s.actual_amount) : "");
    setActualModalMemo(s.memo || "");
    setActualModalOpen(true);
  }

  async function submitActualModal() {
    if (!actualModalMember) return;

    const trimmed = actualModalAmount.trim();
    const parsedAmount = trimmed === "" ? null : parseInt(trimmed.replace(/,/g, ""));
    if (parsedAmount !== null && isNaN(parsedAmount)) {
      alert("금액은 숫자만 입력해주세요");
      return;
    }

    setActualModalSaving(true);
    try {
      const res = await fetch("/api/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateActual",
          year, month,
          member_name: actualModalMember,
          actual_amount: parsedAmount,
          memo: actualModalMemo,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert("실패: " + err.error);
        return;
      }
      setActualModalOpen(false);
      await loadData();
    } finally {
      setActualModalSaving(false);
    }
  }

  async function handleCancelReview(memberName: string) {
    if (
      !confirm(
        `${memberName}님의 ${year}년 ${month}월 검토를 취소합니다.\n게시글 금액 잠금도 함께 해제됩니다.\n진행하시겠습니까?`
      )
    )
      return;

    const res = await fetch("/api/settlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cancelReview",
        year,
        month,
        member_name: memberName,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert("실패: " + err.error);
      return;
    }
    await loadData();
  }

  async function handleCancelPay(memberName: string) {
    const confirmText = prompt(
      `⚠️ ${memberName}님의 ${year}년 ${month}월 지급을 취소합니다.\n이미 실제로 입금된 경우 회계 처리가 필요할 수 있습니다.\n진행하려면 "취소합니다"를 정확히 입력하세요:`
    );
    if (confirmText !== "취소합니다") {
      if (confirmText !== null) alert("취소되었습니다");
      return;
    }

    const res = await fetch("/api/settlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cancelPay",
        year,
        month,
        member_name: memberName,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert("실패: " + err.error);
      return;
    }
    await loadData();
  }

  function getExportSuffix(): string {
    if (selectedMonths.length === 0) return "empty";
    const sorted = [...selectedMonths].sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month
    );
    const first = sorted[0];
    if (sorted.length === 1) {
      return `${first.year}-${String(first.month).padStart(2, "0")}`;
    }
    return `${first.year}-${String(first.month).padStart(2, "0")}_외${sorted.length - 1}개`;
  }

  function exportCSV() {
    const rows: string[][] = [["담당자", "건수", "시스템금액", "실지급액", "차이", "메모", "검토", "지급"]];
    groupedRows.forEach(g => {
      const s = getSettlement(g.name, g.year, g.month);
      const actual = s?.actual_amount ?? null;
      const diff = actual !== null ? actual - g.total : null;
      rows.push([
        g.label,
        String(g.items.length),
        String(g.total),
        actual !== null ? String(actual) : "",
        diff !== null ? String(diff) : "",
        s?.memo || "",
        s?.is_reviewed ? "완료" : "대기",
        s?.is_paid ? "완료" : "대기",
      ]);
    });
    rows.push(["합계", "", String(grandTotal), "", "", "", "", ""]);
    rows.push([]);
    rows.push(["담당자", "날짜", "매장", "비고", "수당", "이월"]);
    groupedRows.forEach(g => {
      g.items.forEach(item => {
        const isCarried = g.carriedItems.includes(item);
        rows.push([
          g.label,
          item.parsed_date || "",
          item.parsed_store || "",
          item.parsed_note || "",
          String(item.parsed_amount || 0),
          isCarried ? "이월" : "",
        ]);
      });
    });
    const csv = "\uFEFF" + rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `정산_${getExportSuffix()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportXLSX() {
    const summaryRows: any[][] = [
      ["담당자", "건수", "시스템금액", "실지급액", "차이", "메모", "검토", "지급"],
    ];
    groupedRows.forEach(g => {
      const s = getSettlement(g.name, g.year, g.month);
      const actual = s?.actual_amount ?? null;
      const diff = actual !== null ? actual - g.total : null;
      summaryRows.push([
        g.label,
        g.items.length,
        g.total,
        actual ?? "",
        diff ?? "",
        s?.memo || "",
        s?.is_reviewed ? "완료" : "대기",
        s?.is_paid ? "완료" : "대기",
      ]);
    });
    summaryRows.push(["합계", "", grandTotal, "", "", "", "", ""]);

    const detailRows: any[][] = [
      ["담당자", "날짜", "매장", "비고", "수당", "이월"],
    ];
    groupedRows.forEach(g => {
      g.items.forEach(item => {
        const isCarried = g.carriedItems.includes(item);
        detailRows.push([
          g.label,
          item.parsed_date || "",
          item.parsed_store || "",
          item.parsed_note || "",
          item.parsed_amount || 0,
          isCarried ? "이월" : "",
        ]);
      });
    });

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
    const ws2 = XLSX.utils.aoa_to_sheet(detailRows);
    ws1["!cols"] = [{ wch: 18 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 30 }, { wch: 8 }, { wch: 8 }];
    ws2["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 35 }, { wch: 12 }, { wch: 14 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws1, "요약");
    XLSX.utils.book_append_sheet(wb, ws2, "상세");
    XLSX.writeFile(wb, `정산_${getExportSuffix()}.xlsx`);
  }

  function toggleExpand(key: string) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  }
  function toggleContent(id: string) {
    setExpandedContent(prev => ({ ...prev, [id]: !prev[id] }));
  }

  // 월 드롭다운 토글: 열 때 draft를 현재값으로 초기화
  function toggleMonthDropdown() {
    setMonthDropdownOpen(v => {
      if (!v) setDraftMonths(selectedMonths);
      return !v;
    });
  }
  function applyMonths() {
    setSelectedMonths(draftMonths);
    setMonthDropdownOpen(false);
  }

  // 담당자 드롭다운 토글
  function toggleMemberDropdown() {
    setMemberDropdownOpen(v => {
      if (!v) setDraftMembers(selectedMembers);
      return !v;
    });
  }
  function applyMembers() {
    setSelectedMembers(draftMembers);
    setMemberDropdownOpen(false);
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">월별 수당 정산</h1>
            <p className="text-sm text-neutral-500 mt-1">Flow 게시글 기반 · 검토 → 지급 2단계 · 자동 이월</p>
          </div>
          {userEmail && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-600">{userEmail}</span>
              <button
                onClick={handleSignOut}
                className="text-neutral-500 hover:text-neutral-900 underline text-xs"
              >
                로그아웃
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            ⚠ {error}
          </div>
        )}

        <div className="bg-white rounded-lg border border-neutral-200 p-4 mb-4 flex items-center gap-3 flex-wrap">
          {/* 날짜 드롭다운 */}
          <div className="relative" data-dropdown="month">
            <button
              onClick={toggleMonthDropdown}
              className="flex items-center gap-2 text-sm border border-neutral-300 rounded px-3 py-1.5 bg-white hover:bg-neutral-50 min-w-[180px]"
            >
              <Calendar size={14} className="text-neutral-500" />
              <span className="flex-1 text-left text-neutral-700">
                {selectedMonths.length === 0
                  ? "선택 없음"
                  : selectedMonths.length === 1
                    ? `${selectedMonths[0].year}년 ${selectedMonths[0].month}월`
                    : `${selectedMonths.length}개 월 선택됨`}
              </span>
              <ChevronDown size={14} className={`text-neutral-400 transition-transform ${monthDropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {monthDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-10 min-w-[200px] max-h-96 overflow-hidden flex flex-col">
                <div className="p-2 border-b border-neutral-100 flex items-center justify-between">
                  <span className="text-xs text-neutral-500">정산월 선택</span>
                  {draftMonths.length > 0 && (
                    <button
                      onClick={() => setDraftMonths([])}
                      className="text-xs text-neutral-500 hover:text-neutral-900 underline"
                    >
                      초기화
                    </button>
                  )}
                </div>
                <div className="py-1 overflow-y-auto flex-1">
                  {monthOptions.map(o => {
                    const checked = draftMonths.some(s => s.year === o.year && s.month === o.month);
                    return (
                      <label
                        key={`${o.year}-${o.month}`}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-50 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setDraftMonths(prev => {
                              const exists = prev.some(s => s.year === o.year && s.month === o.month);
                              if (exists) return prev.filter(s => !(s.year === o.year && s.month === o.month));
                              return [...prev, { year: o.year, month: o.month }];
                            });
                          }}
                          className="rounded border-neutral-300"
                        />
                        <span className="text-neutral-700">{o.year}년 {o.month}월</span>
                      </label>
                    );
                  })}
                </div>
                <div className="p-2 border-t border-neutral-100 flex items-center justify-end gap-2">
                  <button
                    onClick={() => { setMonthDropdownOpen(false); setDraftMonths(selectedMonths); }}
                    className="text-xs px-3 py-1.5 rounded border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={applyMonths}
                    disabled={draftMonths.length === 0}
                    className={`text-xs px-3 py-1.5 rounded ${
                      draftMonths.length === 0
                        ? "bg-neutral-200 text-neutral-400 cursor-not-allowed"
                        : "bg-neutral-900 text-white hover:bg-neutral-800"
                    }`}
                  >
                    적용
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 담당자 드롭다운 */}
          {members.length > 0 && (
            <div className="relative" data-dropdown="member">
              <button
                onClick={toggleMemberDropdown}
                className="flex items-center gap-2 text-sm border border-neutral-300 rounded px-3 py-1.5 bg-white hover:bg-neutral-50 min-w-[160px]"
              >
                <span className="flex-1 text-left text-neutral-700">
                  {selectedMembers.length === members.length
                    ? "담당자 전체"
                    : selectedMembers.length === 0
                      ? "선택 없음"
                      : selectedMembers.length === 1
                        ? selectedMembers[0]
                        : `${selectedMembers.length}명 선택됨`}
                </span>
                <ChevronDown size={14} className={`text-neutral-400 transition-transform ${memberDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {memberDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-10 min-w-[200px] max-h-96 overflow-hidden flex flex-col">
                  <div className="p-2 border-b border-neutral-100 flex items-center justify-between">
                    <span className="text-xs text-neutral-500">담당자 필터</span>
                    <button
                      onClick={() => setDraftMembers(members)}
                      className="text-xs text-neutral-500 hover:text-neutral-900 underline"
                    >
                      전체선택
                    </button>
                  </div>
                  <div className="py-1 overflow-y-auto flex-1">
                    {members.map(name => {
                      const checked = draftMembers.includes(name);
                      return (
                        <label
                          key={name}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-50 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setDraftMembers(prev =>
                                prev.includes(name)
                                  ? prev.filter(m => m !== name)
                                  : [...prev, name]
                              );
                            }}
                            className="rounded border-neutral-300"
                          />
                          <span className="text-neutral-700">{name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="p-2 border-t border-neutral-100 flex items-center justify-end gap-2">
                    <button
                      onClick={() => { setMemberDropdownOpen(false); setDraftMembers(selectedMembers); }}
                      className="text-xs px-3 py-1.5 rounded border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                    >
                      취소
                    </button>
                    <button
                      onClick={applyMembers}
                      disabled={draftMembers.length === 0}
                      className={`text-xs px-3 py-1.5 rounded ${
                        draftMembers.length === 0
                          ? "bg-neutral-200 text-neutral-400 cursor-not-allowed"
                          : "bg-neutral-900 text-white hover:bg-neutral-800"
                      }`}
                    >
                      적용
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm border border-neutral-300 rounded px-3 py-1.5 bg-white hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            {syncing ? "동기화 중..." : "Flow 동기화"}
          </button>

          <div className="flex-1" />

          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 text-sm border border-neutral-300 rounded px-3 py-1.5 bg-white hover:bg-neutral-50"
          >
            <Download size={14} />
            CSV
          </button>

          <button
            onClick={exportXLSX}
            className="flex items-center gap-1.5 text-sm border border-neutral-300 rounded px-3 py-1.5 bg-white hover:bg-neutral-50"
          >
            <Download size={14} />
            Excel
          </button>

          <div className="text-sm">
            <span className="text-neutral-500">총액 </span>
            <span className="font-semibold text-neutral-900 tabular-nums">{formatKRW(grandTotal)}</span>
            {(() => {
              const systemTotal = groupedRows.reduce((s, g) => s + g.total, 0);
              if (systemTotal !== grandTotal) {
                return (
                  <span className="text-xs text-orange-600 ml-1">
                    (시스템 {formatKRW(systemTotal)})
                  </span>
                );
              }
              return null;
            })()}
          </div>
        </div>

        <div className="space-y-3">
          {groupedRows.map(group => {
            const memberName = group.name;
            const s = getSettlement(memberName, group.year, group.month);
            const isReviewed = !!s?.is_reviewed;
            const isPaid = !!s?.is_paid;
            const isOpen = expanded[group.key];

            let borderClass = "border-neutral-200";
            if (isPaid) borderClass = "border-emerald-200";
            else if (isReviewed) borderClass = "border-sky-200";

            return (
              <div key={group.key} className={`bg-white rounded-lg border ${borderClass} overflow-hidden`}>
                <div className="p-4 flex items-center gap-3">
                  <button onClick={() => toggleExpand(group.key)} className="text-neutral-400 hover:text-neutral-700">
                    {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-neutral-900">{group.label}</span>
                      {group.carriedItems.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                          🔄 이월 {group.carriedItems.length}
                        </span>
                      )}
                      {group.invalidItems.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          <AlertTriangle size={10} /> 제목오류 {group.invalidItems.length}
                        </span>
                      )}
                      {group.modifiedItems.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                          <AlertCircle size={10} /> 확정후수정 {group.modifiedItems.length}
                        </span>
                      )}
                      {group.deletedItems.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                          <AlertCircle size={10} /> 확정후삭제 {group.deletedItems.length}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {group.items.length}건
                      {s?.reviewed_at && <span> · 검토 {new Date(s.reviewed_at).toLocaleDateString("ko-KR")}</span>}
                      {s?.paid_at && <span> · 지급 {new Date(s.paid_at).toLocaleDateString("ko-KR")}</span>}
                    </div>
                  </div>

                  {/* 금액 + ✏️ 메모 */}
                  <div className="flex items-center gap-2 justify-end">
                    <div className="text-right">
                      <div className="font-semibold text-neutral-900 tabular-nums">{formatKRW(group.total)}</div>
                      {s?.actual_amount !== null && s?.actual_amount !== undefined && s.actual_amount !== group.total && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            alert(
                              `실지급: ${formatKRW(s.actual_amount!)}\n` +
                              `시스템: ${formatKRW(group.total)}\n` +
                              `차이: ${formatKRW(s.actual_amount! - group.total)}\n\n` +
                              `메모: ${s.memo || "(없음)"}\n\n` +
                              `수정자: ${s.actual_updated_by || "-"}\n` +
                              `수정시각: ${s.actual_updated_at ? new Date(s.actual_updated_at).toLocaleString("ko-KR") : "-"}`
                            );
                          }}
                          className="text-xs text-orange-600 hover:underline mt-0.5"
                        >
                          실지급: {formatKRW(s.actual_amount)} ⚠
                        </button>
                      )}
                    </div>
                    {isSingleMonth && isReviewed && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openActualModal(memberName); }}
                        className="text-xs px-2 py-1.5 rounded border border-orange-400 bg-white text-orange-700 hover:bg-orange-50"
                        title="실제 지급액 입력/수정"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>

                  {/* 검토/지급 액션 — 단일 월일 때만 */}
                  {isSingleMonth && (
                    <div className="flex items-center gap-4">
                      {/* 검토 그룹 */}
                      <div className="flex items-center gap-1.5">
                        {!isReviewed ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReview(memberName); }}
                            disabled={group.items.length === 0}
                            className={`text-xs px-2.5 py-1.5 rounded border ${
                              group.items.length === 0
                                ? "border-neutral-200 text-neutral-400 cursor-not-allowed"
                                : "border-sky-600 bg-white text-sky-700 hover:bg-sky-50"
                            }`}
                          >
                            검토완료
                          </button>
                        ) : (
                          <>
                            <button
                              disabled
                              className="text-xs px-2.5 py-1.5 rounded border border-emerald-600 bg-emerald-600 text-white cursor-default"
                              title="검토완료됨"
                            >
                              <span className="inline-flex items-center gap-1">
                                <CheckCircle2 size={11} /> 검토완료
                              </span>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCancelReview(memberName); }}
                              disabled={isPaid}
                              className={`text-xs px-2.5 py-1.5 rounded border ${
                                isPaid
                                  ? "border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed"
                                  : "border-red-300 bg-white text-red-600 hover:bg-red-50"
                              }`}
                              title={isPaid ? "지급취소 먼저 진행하세요" : "검토 완료취소"}
                            >
                              완료취소
                            </button>
                          </>
                        )}
                      </div>

                      {/* 지급 그룹 */}
                      <div className="flex items-center gap-1.5">
                        {!isPaid ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handlePay(memberName); }}
                            disabled={!isReviewed}
                            className={`text-xs px-2.5 py-1.5 rounded border ${
                              !isReviewed
                                ? "border-neutral-200 text-neutral-400 cursor-not-allowed"
                                : "border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50"
                            }`}
                          >
                            지급완료
                          </button>
                        ) : (
                          <>
                            <button
                              disabled
                              className="text-xs px-2.5 py-1.5 rounded border border-emerald-600 bg-emerald-600 text-white cursor-default"
                              title="지급완료됨"
                            >
                              <span className="inline-flex items-center gap-1">
                                <CircleDollarSign size={11} /> 지급완료
                              </span>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCancelPay(memberName); }}
                              className="text-xs px-2.5 py-1.5 rounded border border-red-300 bg-white text-red-600 hover:bg-red-50"
                              title="지급 완료취소"
                            >
                              완료취소
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 다중 월일 때 — 상태 뱃지만 */}
                  {!isSingleMonth && (
                    <div className="flex items-center gap-1.5">
                      {isPaid && (
                        <span className="text-xs px-2 py-1 rounded border border-emerald-600 bg-emerald-600 text-white inline-flex items-center gap-1">
                          <CircleDollarSign size={11} /> 지급완료
                        </span>
                      )}
                      {!isPaid && isReviewed && (
                        <span className="text-xs px-2 py-1 rounded border border-sky-600 bg-sky-50 text-sky-700 inline-flex items-center gap-1">
                          <CheckCircle2 size={11} /> 검토완료
                        </span>
                      )}
                      {!isReviewed && (
                        <span className="text-xs px-2 py-1 rounded border border-neutral-200 bg-neutral-50 text-neutral-500">
                          미검토
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 카드 펼침 영역 */}
                {isOpen && (
                  <div className="border-t border-neutral-100 bg-neutral-50/50">
                    {group.modifiedItems.length > 0 && (
                      <div className="border-b border-neutral-100 p-3 bg-red-50/70">
                        <div className="text-xs font-medium text-red-800 mb-2 flex items-center gap-1">
                          <AlertCircle size={12} />
                          확정 후 원본 금액이 수정된 게시글이 있습니다. 담당자에게 다음 달에 마이너스 보정 글을 올리도록 안내하세요.
                        </div>
                        <div className="space-y-1">
                          {group.modifiedItems.map(item => (
                            <div key={item.post_id} className="text-xs text-neutral-700 bg-white px-2 py-1 rounded border border-red-100">
                              <span className="text-neutral-500">[{item.settlement_year}-{String(item.settlement_month).padStart(2, "0")}월 확정분]</span>
                              {" · "}{item.parsed_store}{" · "}
                              <span className="line-through text-neutral-400">{formatKRW(item.locked_amount || 0)}</span>
                              {" → "}
                              <span className="font-semibold text-red-700">{formatKRW(item.parsed_amount || 0)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {group.deletedItems.length > 0 && (
                      <div className="border-b border-neutral-100 p-3 bg-red-50/70">
                        <div className="text-xs font-medium text-red-800 mb-2 flex items-center gap-1">
                          <AlertCircle size={12} />
                          확정 후 Flow에서 삭제된 게시글이 있습니다. 담당자에게 다음 달에 마이너스 보정 글을 올리도록 안내하세요.
                        </div>
                        <div className="space-y-1">
                          {group.deletedItems.map(item => (
                            <div key={item.post_id} className="text-xs text-neutral-700 bg-white px-2 py-1 rounded border border-red-100">
                              <span className="text-neutral-500">[{item.settlement_year}-{String(item.settlement_month).padStart(2, "0")}월 확정분]</span>
                              {" · "}{item.parsed_store}{" · "}
                              <span className="line-through text-neutral-400">{formatKRW(item.locked_amount || 0)}</span>
                              {" "}<span className="text-red-700 font-semibold">(삭제됨)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {group.items.length === 0 ? (
                      <div className="p-4 text-sm text-neutral-500 text-center">이번 달 게시글이 없습니다</div>
                    ) : (
                      <div className="divide-y divide-neutral-100">
                        {group.items.map(item => {
                          const isContentOpen = expandedContent[item.post_id];
                          const hasContent = item.flow_content && item.flow_content.trim();
                          const isCarried = group.carriedItems.includes(item);
                          return (
                            <div key={item.post_id} className="px-4 py-2.5">
                              <div
                                className={`flex items-center gap-3 text-sm ${hasContent ? "cursor-pointer" : ""}`}
                                onClick={() => hasContent && toggleContent(item.post_id)}
                              >
                                <div className="text-neutral-400 w-4">
                                  {hasContent && (isContentOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                                </div>
                                <div className="text-neutral-700 w-24 tabular-nums">{item.parsed_date}</div>
                                <div className="flex-1 text-neutral-900 flex items-center gap-2">
                                  {item.parsed_store}
                                  {item.parsed_note && (
                                    <span className="text-xs text-neutral-500">[{item.parsed_note}]</span>
                                  )}
                                  {isCarried && (
                                    <span className="text-xs text-violet-600 bg-violet-50 border border-violet-200 rounded px-1">🔄 이월</span>
                                  )}
                                  {(item.parsed_amount || 0) < 0 && (
                                    <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-1">취소</span>
                                  )}
                                </div>
                                <div className={`tabular-nums w-24 text-right ${(item.parsed_amount || 0) < 0 ? "text-red-600" : "text-neutral-900"}`}>{formatKRW(item.parsed_amount || 0)}</div>
                              </div>
                              {isContentOpen && hasContent && (
                                <div className="mt-2 ml-7 p-3 bg-white rounded border border-neutral-200 text-xs text-neutral-700 whitespace-pre-wrap">
                                  {item.flow_content}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {group.invalidItems.length > 0 && (
                      <div className="border-t border-neutral-100 p-3 bg-amber-50/50">
                        <div className="text-xs font-medium text-amber-800 mb-2 flex items-center gap-1">
                          <AlertTriangle size={12} />
                          제목 형식 오류 - 담당자에게 수정 요청
                        </div>
                        <div className="space-y-1">
                          {group.invalidItems.map(item => (
                            <div key={item.post_id} className="text-xs text-neutral-700">· {item.flow_title}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-xs text-neutral-400 text-center space-y-1">
          <div>제목 형식: <code className="bg-neutral-100 px-1 py-0.5 rounded">YYYYMMDD 매장명 금액[원]</code></div>
          <div>지급완료된 월에 들어온 늦은 글은 자동으로 다음 미지급 월로 이월됩니다</div>
        </div>

        {/* 실지급액 입력 모달 */}
        {actualModalOpen && actualModalMember && (() => {
          const systemAmount = groupedRows.find(g => g.name === actualModalMember && g.year === year && g.month === month)?.total || 0;
          const inputAmount = actualModalAmount.trim() === "" ? systemAmount : parseInt(actualModalAmount.replace(/,/g, "")) || 0;
          const diff = inputAmount - systemAmount;

          return (
            <div
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
              onClick={() => !actualModalSaving && setActualModalOpen(false)}
            >
              <div
                className="bg-white rounded-lg shadow-xl w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-5 border-b border-neutral-200">
                  <h2 className="text-lg font-semibold text-neutral-900">
                    {actualModalMember}님 실제 지급액
                  </h2>
                  <p className="text-xs text-neutral-500 mt-1">
                    {year}년 {month}월
                  </p>
                </div>

                <div className="p-5 space-y-4">
                  <div className="text-sm">
                    <span className="text-neutral-500">시스템 계산: </span>
                    <span className="font-medium text-neutral-900 tabular-nums">{formatKRW(systemAmount)}</span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      실제 지급액
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={actualModalAmount}
                        onChange={(e) => setActualModalAmount(e.target.value)}
                        placeholder={String(systemAmount)}
                        className="flex-1 text-sm border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 tabular-nums"
                      />
                      <span className="text-sm text-neutral-500">원</span>
                    </div>
                    <p className="text-xs text-neutral-400 mt-1">
                      비워두면 시스템 금액 사용
                    </p>
                  </div>

                  {actualModalAmount.trim() !== "" && (
                    <div className="text-sm">
                      <span className="text-neutral-500">차이: </span>
                      <span className={`font-medium tabular-nums ${diff < 0 ? "text-red-600" : diff > 0 ? "text-emerald-600" : "text-neutral-900"}`}>
                        {diff > 0 ? "+" : ""}{formatKRW(diff)}
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      메모 (선택)
                    </label>
                    <textarea
                      value={actualModalMemo}
                      onChange={(e) => setActualModalMemo(e.target.value)}
                      placeholder='예: "1만원 차감 합의", "추가 지급분 포함"'
                      rows={3}
                      className="w-full text-sm border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-none"
                    />
                  </div>
                </div>

                <div className="p-5 border-t border-neutral-200 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setActualModalOpen(false)}
                    disabled={actualModalSaving}
                    className="text-sm px-4 py-2 rounded border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={submitActualModal}
                    disabled={actualModalSaving}
                    className="text-sm px-4 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {actualModalSaving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}