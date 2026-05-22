"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Calendar, RefreshCw, CheckCircle2, AlertTriangle, Download,
  ChevronDown, ChevronRight, CircleDollarSign, AlertCircle
} from "lucide-react";
import * as XLSX from "xlsx";
import { formatKRW } from "@/lib/utils";
import { Post, MemberSettlement } from "@/lib/types";
import { createClient } from "@/lib/supabase-client";

export default function App() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [year, setYear] = useState(lastMonth.getFullYear());
  const [month, setMonth] = useState(lastMonth.getMonth() + 1);
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

  useEffect(() => { loadData(); }, [year, month]);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  async function loadData() {
    setLoading(true); setError(null);
    try {
      const [postsRes, settlementsRes] = await Promise.all([
        fetch(`/api/posts?year=${year}&month=${month}`),
        fetch(`/api/settlements?year=${year}&month=${month}`),
      ]);
      const postsData = await postsRes.json();
      const settlementsData = await settlementsRes.json();
      if (!postsRes.ok) throw new Error(postsData.error);
      setMonthPosts(postsData.monthPosts);
      setModifiedPosts(postsData.modifiedPosts);
      setDeletedLockedPosts(postsData.deletedLockedPosts || []);
      setInvalidPosts(postsData.invalidPosts);
      setMembers(postsData.members);
      setSettlements(settlementsData.settlements || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true); setError(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await loadData();
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

  function getSettlement(memberName: string): MemberSettlement | undefined {
    return settlements.find(s => s.member_name === memberName);
  }

  // 담당자별 그룹핑
  const byMember = useMemo(() => {
    const groups: Record<string, {
      name: string;
      items: Post[];
      invalidItems: Post[];
      carriedItems: Post[];
      modifiedItems: Post[];
      deletedItems: Post[];
      total: number;
    }> = {};
    members.forEach(name => {
      groups[name] = { name, items: [], invalidItems: [], carriedItems: [], modifiedItems: [], deletedItems: [], total: 0 };
    });
    monthPosts.forEach(p => {
      const g = groups[p.member_name];
      if (!g) return;
      g.items.push(p);
      g.total += p.parsed_amount || 0;
      if (p.parsed_date) {
        const [py, pm] = p.parsed_date.split("-").map(Number);
        if (py !== year || pm !== month) g.carriedItems.push(p);
      }
    });
    invalidPosts.forEach(p => {
      const g = groups[p.member_name];
      if (g) g.invalidItems.push(p);
    });
    modifiedPosts.forEach(p => {
      const g = groups[p.member_name];
      if (g) g.modifiedItems.push(p);
    });
    deletedLockedPosts.forEach(p => {
      const g = groups[p.member_name];
      if (g) g.deletedItems.push(p);
    });
    return groups;
  }, [monthPosts, invalidPosts, modifiedPosts, deletedLockedPosts, members, year, month]);

  const grandTotal = Object.values(byMember).reduce((s, g) => s + g.total, 0);

  async function handleReview(memberName: string) {
    const g = byMember[memberName];
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
    const g = byMember[memberName];
    const s = getSettlement(memberName);
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

  function exportCSV() {
    const rows: string[][] = [["담당자", "건수", "총수당", "검토", "지급"]];
    Object.values(byMember).forEach(g => {
      const s = getSettlement(g.name);
      rows.push([
        g.name, String(g.items.length), String(g.total),
        s?.is_reviewed ? "완료" : "대기",
        s?.is_paid ? "완료" : "대기",
      ]);
    });
    rows.push(["합계", "", String(grandTotal), "", ""]);
    rows.push([]);
    rows.push(["담당자", "날짜", "매장", "비고", "수당", "이월"]);
    Object.values(byMember).forEach(g => {
      g.items.forEach(item => {
        const isCarried = g.carriedItems.includes(item);
        rows.push([
          g.name,
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
    a.download = `정산_${year}-${String(month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportXLSX() {
    // 시트 1: 요약
    const summaryRows: any[][] = [
      ["담당자", "건수", "총수당", "검토", "지급"],
    ];
    Object.values(byMember).forEach(g => {
      const s = getSettlement(g.name);
      summaryRows.push([
        g.name,
        g.items.length,
        g.total,
        s?.is_reviewed ? "완료" : "대기",
        s?.is_paid ? "완료" : "대기",
      ]);
    });
    summaryRows.push(["합계", "", grandTotal, "", ""]);

    // 시트 2: 상세 내역
    const detailRows: any[][] = [
      ["담당자", "날짜", "매장", "비고", "수당", "이월"],
    ];
    Object.values(byMember).forEach(g => {
      g.items.forEach(item => {
        const isCarried = g.carriedItems.includes(item);
        detailRows.push([
          g.name,
          item.parsed_date || "",
          item.parsed_store || "",
          item.parsed_note || "",
          item.parsed_amount || 0,
          isCarried ? "이월" : "",
        ]);
      });
    });

    // Workbook 생성
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
    const ws2 = XLSX.utils.aoa_to_sheet(detailRows);

    // 컬럼 너비
    ws1["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 8 }];
    ws2["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 35 }, { wch: 12 }, { wch: 14 }, { wch: 8 }];

    XLSX.utils.book_append_sheet(wb, ws1, "요약");
    XLSX.utils.book_append_sheet(wb, ws2, "상세");

    XLSX.writeFile(wb, `정산_${year}-${String(month).padStart(2, "0")}.xlsx`);
  }

  function toggleExpand(name: string) {
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }));
  }
  function toggleContent(id: string) {
    setExpandedContent(prev => ({ ...prev, [id]: !prev[id] }));
  }

  const monthOptions = useMemo(() => {
    const opts = [];
    const cy = new Date().getFullYear();
    const cm = new Date().getMonth() + 1;
    for (let y = cy; y >= cy - 1; y--) {
      const maxM = y === cy ? cm : 12;
      for (let m = maxM; m >= 1; m--) opts.push({ year: y, month: m });
    }
    return opts;
  }, []);

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
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-neutral-500" />
            <select
              value={`${year}-${month}`}
              onChange={e => {
                const [y, m] = e.target.value.split("-").map(Number);
                setYear(y); setMonth(m);
              }}
              className="text-sm border border-neutral-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              {monthOptions.map(o => (
                <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                  {o.year}년 {o.month}월
                </option>
              ))}
            </select>
          </div>

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
          </div>
        </div>

        <div className="space-y-3">
          {members.map(memberName => {
            const group = byMember[memberName];
            if (!group) return null;
            const s = getSettlement(memberName);
            const isReviewed = !!s?.is_reviewed;
            const isPaid = !!s?.is_paid;
            const isOpen = expanded[memberName];

            let borderClass = "border-neutral-200";
            if (isPaid) borderClass = "border-emerald-200";
            else if (isReviewed) borderClass = "border-sky-200";

            return (
              <div key={memberName} className={`bg-white rounded-lg border ${borderClass} overflow-hidden`}>
                <div className="p-4 flex items-center gap-3">
                  <button onClick={() => toggleExpand(memberName)} className="text-neutral-400 hover:text-neutral-700">
                    {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-neutral-900">{memberName}</span>
                      {isPaid && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                          <CircleDollarSign size={10} /> 지급완료
                        </span>
                      )}
                      {!isPaid && isReviewed && (
                        <span className="inline-flex items-center gap-1 text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5">
                          <CheckCircle2 size={10} /> 검토완료
                        </span>
                      )}
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
                  <div className="text-right">
                    <div className="font-semibold text-neutral-900 tabular-nums">{formatKRW(group.total)}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleReview(memberName)}
                      disabled={isReviewed || group.items.length === 0}
                      className={`text-xs px-2.5 py-1.5 rounded border ${isReviewed
                        ? "border-sky-200 bg-sky-50 text-sky-700 cursor-not-allowed"
                        : group.items.length === 0
                          ? "border-neutral-200 text-neutral-400 cursor-not-allowed"
                          : "border-sky-600 bg-white text-sky-700 hover:bg-sky-50"
                        }`}
                    >
                      {isReviewed ? (
                        <span className="inline-flex items-center gap-1"><CheckCircle2 size={11} /> 검토</span>
                      ) : "검토완료"}
                    </button>
                    <button
                      onClick={() => handlePay(memberName)}
                      disabled={!isReviewed || isPaid}
                      className={`text-xs px-2.5 py-1.5 rounded border ${isPaid
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 cursor-not-allowed"
                        : !isReviewed
                          ? "border-neutral-200 text-neutral-400 cursor-not-allowed"
                          : "border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50"
                        }`}
                    >
                      {isPaid ? (
                        <span className="inline-flex items-center gap-1"><CircleDollarSign size={11} /> 지급</span>
                      ) : "지급완료"}
                    </button>
                  </div>
                </div>

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
                              {
                                isContentOpen && hasContent && (
                                  <div className="mt-2 ml-7 p-3 bg-white rounded border border-neutral-200 text-xs text-neutral-700 whitespace-pre-wrap">
                                    {item.flow_content}
                                  </div>
                                )
                              }
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
                )
                }
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-xs text-neutral-400 text-center space-y-1">
          <div>제목 형식: <code className="bg-neutral-100 px-1 py-0.5 rounded">YYYYMMDD 매장명 금액[원]</code></div>
          <div>지급완료된 월에 들어온 늦은 글은 자동으로 다음 미지급 월로 이월됩니다</div>
        </div>
      </div>
    </div >
  );
}