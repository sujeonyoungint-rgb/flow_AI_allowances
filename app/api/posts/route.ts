import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getProjects } from "@/lib/config";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get("year") || "");
  const month = parseInt(searchParams.get("month") || "");

  if (!year || !month) {
    return NextResponse.json({ error: "year, month required" }, { status: 400 });
  }

  // 해당 월에 속하는 게시글 (삭제된 것 제외)
  const { data: monthPosts, error: e1 } = await supabase
    .from("posts")
    .select("*")
    .eq("settlement_year", year)
    .eq("settlement_month", month)
    .eq("is_deleted_from_flow", false)
    .order("parsed_date", { ascending: true });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // 잠긴 게시글 중 수정 감지된 것
  const { data: modifiedPosts, error: e2 } = await supabase
    .from("posts")
    .select("*")
    .eq("is_amount_modified", true)
    .eq("is_locked", true)
    .eq("is_deleted_from_flow", false);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  // 잠긴 게시글 중 삭제된 것 (⚠ 케이스)
  const { data: deletedLockedPosts, error: e2b } = await supabase
    .from("posts")
    .select("*")
    .eq("is_locked", true)
    .eq("is_deleted_from_flow", true);
  if (e2b) return NextResponse.json({ error: e2b.message }, { status: 500 });

  // 파싱 실패 게시글 중 현재 월에 작성된 것
  const monthStart = `${year}${String(month).padStart(2, "0")}01000000`;
  const nextMonth = month === 12 ? `${year + 1}0101000000` : `${year}${String(month + 1).padStart(2, "0")}01000000`;
  const { data: invalidPosts, error: e3 } = await supabase
    .from("posts")
    .select("*")
    .eq("is_parsed", false)
    .eq("is_deleted_from_flow", false)
    .gte("flow_registered_datetime", monthStart)
    .lt("flow_registered_datetime", nextMonth);
  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });

  const members = getProjects().map(p => p.memberName);

  return NextResponse.json({
    monthPosts: monthPosts || [],
    modifiedPosts: modifiedPosts || [],
    deletedLockedPosts: deletedLockedPosts || [],
    invalidPosts: invalidPosts || [],
    members,
  });
}