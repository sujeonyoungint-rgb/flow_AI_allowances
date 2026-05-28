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

  if (!["review", "pay", "updateActual", "cancelReview", "cancelPay"].includes(action)) {
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

    // 2) 해당 월의 파싱된 미잠금 게시글을 모두 잠그고 locked_amount = parsed_amount 기록
    const { data: toLock } = await supabase
      .from("posts")
      .select("post_id, parsed_amount")
      .eq("settlement_year", year)
      .eq("settlement_month", month)
      .eq("member_name", member_name)
      .eq("is_parsed", true)
      .eq("is_locked", false);

    if (toLock && toLock.length > 0) {
      for (const p of toLock) {
        const { error: lockErr } = await supabase
          .from("posts")
          .update({
            is_locked: true,
            locked_amount: p.parsed_amount,
            is_amount_modified: false,
          })
          .eq("post_id", p.post_id);
        if (lockErr) return NextResponse.json({ error: lockErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, locked: toLock?.length || 0 });
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

  // === 실제지급액 수정 ===
  if (action === "updateActual") {
    if (!existing?.is_reviewed) {
      return NextResponse.json({ error: "검토완료 후에만 입력 가능합니다" }, { status: 400 });
    }
    const { actual_amount, memo } = body;
    const parsedActual = 
      actual_amount === null || actual_amount === undefined || actual_amount === ""
        ? null 
        : Number(actual_amount);
    
    const { error } = await supabase
      .from("member_settlements")
      .update({
        actual_amount: parsedActual,
        memo: memo || null,
        actual_updated_at: new Date().toISOString(),
        actual_updated_by: actor,
      })
      .eq("year", year).eq("month", month).eq("member_name", member_name);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
// === 검토취소 ===
  if (action === "cancelReview") {
    if (!existing?.is_reviewed) {
      return NextResponse.json({ error: "검토되지 않은 항목입니다" }, { status: 400 });
    }
    if (existing.is_paid) {
      return NextResponse.json(
        { error: "지급완료된 항목은 검토취소할 수 없습니다. 먼저 지급취소하세요" },
        { status: 400 }
      );
    }

    // 1) settlement 레코드 검토 해제
    const { error: e1 } = await supabase
      .from("member_settlements")
      .update({
        is_reviewed: false,
        reviewed_at: null,
        reviewed_by: null,
      })
      .eq("year", year)
      .eq("month", month)
      .eq("member_name", member_name);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

    // 2) 해당 월/담당자 게시글 잠금 해제
    const { error: e2 } = await supabase
      .from("posts")
      .update({
        is_locked: false,
        locked_amount: null,
        is_amount_modified: false,
      })
      .eq("settlement_year", year)
      .eq("settlement_month", month)
      .eq("member_name", member_name)
      .eq("is_locked", true);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  // === 지급취소 ===
  if (action === "cancelPay") {
    if (!existing?.is_paid) {
      return NextResponse.json({ error: "지급되지 않은 항목입니다" }, { status: 400 });
    }

    const { error } = await supabase
      .from("member_settlements")
      .update({
        is_paid: false,
        paid_at: null,
        paid_by: null,
      })
      .eq("year", year)
      .eq("month", month)
      .eq("member_name", member_name);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }
}