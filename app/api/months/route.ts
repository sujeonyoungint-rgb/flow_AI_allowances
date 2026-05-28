import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createClient();

  // 전체 조회 (1000행 제한 회피)
  const rows: { settlement_year: number; settlement_month: number }[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    for (let i = 0; i < 50; i++) {
      const { data: chunk, error } = await supabase
        .from("posts")
        .select("settlement_year, settlement_month")
        .not("settlement_year", "is", null)
        .not("settlement_month", "is", null)
        .eq("is_deleted_from_flow", false)
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!chunk || chunk.length === 0) break;
      rows.push(...chunk);
      if (chunk.length < PAGE) break;
      from += PAGE;
    }
  }

  // 중복 제거
  const unique = new Set<string>();
  rows.forEach(r => {
    unique.add(`${r.settlement_year}-${r.settlement_month}`);
  });

  // 현재 월도 항상 포함 (데이터 없어도 선택 가능)
  const now = new Date();
  unique.add(`${now.getFullYear()}-${now.getMonth() + 1}`);

  // 최신순 정렬
  const months = Array.from(unique)
    .map(s => {
      const [y, m] = s.split("-").map(Number);
      return { year: y, month: m };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);

  return NextResponse.json({ months });
}