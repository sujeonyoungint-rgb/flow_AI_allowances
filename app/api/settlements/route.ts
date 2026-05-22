import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// 월별 정산 상태 조회 (담당자별 1행)
export async function GET(req: NextRequest) {
  const supabase = await createClient();  // ← 추가
  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get("year") || "");
  const month = parseInt(searchParams.get("month") || "");
  if (!year || !month) return NextResponse.json({ error: "year, month required" }, { status: 400 });

  const { data, error } = await supabase
    .from("member_settlements")
    .select("*")
    .eq("year", year)
    .eq("month", month);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settlements: data || [] });
}

// 검토완료 또는 지급완료 처리
export async function POST(req: NextRequest) {
  const supabase = await createClient();  // ← 추가
  const body = await req.json();
const { action, year, month, member_name, total_amount, post_count } = body;

// 로그인 사용자 정보
const { data: { user } } = await supabase.auth.getUser();
const actor = user?.email || "unknown";

  if (!["review", "pay"].includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  if (!year || !month || !member_name) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // 기존 행 조회
  const { data: existing } = await supabase
    .from("member_settlements")
    .select("*")
    .eq("year", year).eq("month", month).eq("member_name", member_name)
    .maybeSingle();

  // === 검토완료 ===
  if (action === "review") {
    if (existing?.is_reviewed) {
      return NextResponse.json({ error: "이미 검토완료된 항목입니다" }, { status: 409 });
    }

    // 1) settlements 기록
    const { error: e1 } = await supabase
      .from("member_settlements")
      .upsert({
        year, month, member_name,
        total_amount, post_count,
        is_reviewed: true,
        reviewed_at: new Date().toISOString(),
        reviewed_by: actor || "확인자",
      }, { onConflict: "year,month,member_name" });
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

    // 2) 해당 월의 모든 미잠금 게시글을 잠그고 locked_amount 기록
    const { error: e2 } = await supabase
      .from("posts")
      .update({
        is_locked: true,
        locked_amount: undefined, // 아래 RPC가 필요. 일단 raw로 처리
      })
      .eq("settlement_year", year)
      .eq("settlement_month", month)
      .eq("member_name", member_name)
      .eq("is_locked", false);
    // locked_amount = parsed_amount로 설정 필요 → SQL로 처리
    // Supabase는 raw SQL 함수 호출이 필요한데, 간단히 select 후 개별 update로 대체
    const { data: toLock } = await supabase
      .from("posts")
      .select("post_id, parsed_amount")
      .eq("settlement_year", year)
      .eq("settlement_month", month)
      .eq("member_name", member_name)
      .eq("is_parsed", true);

    if (toLock && toLock.length > 0) {
      // 개별 update (적은 양이라 성능 무관)
      for (const p of toLock) {
        await supabase
          .from("posts")
          .update({ is_locked: true, locked_amount: p.parsed_amount, is_amount_modified: false })
          .eq("post_id", p.post_id);
      }
    }

    return NextResponse.json({ ok: true });
  }

  // === 지급완료 ===
  if (action === "pay") {
    if (!existing?.is_reviewed) {
      return NextResponse.json({ error: "검토완료 먼저 해야 합니다" }, { status: 400 });
    }
    if (existing?.is_paid) {
      return NextResponse.json({ error: "이미 지급완료된 항목입니다" }, { status: 409 });
    }
    const { error } = await supabase
      .from("member_settlements")
      .update({
        is_paid: true,
        paid_at: new Date().toISOString(),
        paid_by: actor || "자금집행자",
      })
      .eq("year", year).eq("month", month).eq("member_name", member_name);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
}