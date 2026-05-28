import { NextResponse } from "next/server";
import { FlowApiResponse, FlowPost, ProjectMapping } from "@/lib/types";
import { getProjects, CLIENT_CONFIG } from "@/lib/config";
import { parseTitle, parseFlowDateTime } from "@/lib/utils";
import { createClient } from "@/lib/supabase-server";
// 단일 프로젝트 전체 게시글 fetch
async function fetchProjectPosts(
  projectId: string,
  userId: string,
  apiKey: string
): Promise<FlowPost[]> {
  const allPosts: FlowPost[] = [];
  let cursor = 0;
  const pageSize = 100;
  const MAX_PAGES = 50;

  for (let i = 0; i < MAX_PAGES; i++) {
    const url = new URL(`https://api.flow.team/v1/posts/projects/${projectId}`);
    url.searchParams.set("userId", userId);
    url.searchParams.set("cursor", String(cursor));
    url.searchParams.set("pageSize", String(pageSize));

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-flow-api-key": apiKey,
      },
      cache: "no-store",
    });

    const json: FlowApiResponse = await res.json();
    if (!json.response.success || !json.response.data) {
      throw new Error(
        `[Project ${projectId}] ${json.response.error?.message || "Flow API error"}`
      );
    }
    allPosts.push(...json.response.data.posts);
    if (!json.response.data.hasNext || json.response.data.lastCursor === -1) break;
    cursor = json.response.data.lastCursor;
  }
  return allPosts;
}

// 정산월 결정:
// - 기본은 제목 날짜의 달
// - 그 달이 지급완료됐고, 글이 "지급완료 시각 이후"에 등록됐으면 → 다음 미지급 월로 이월
// - 지급 전에 등록된 글이면 이월하지 않고 제 달에 그대로 둠
function determineSettlementMonth(
  parsedYear: number,
  parsedMonth: number,
  memberName: string,
  registeredDate: Date | null,
  paidMonthsMap: Map<string, Date | null>, // key: "name:YYYY-MM" → paid_at
  currentYear: number,
  currentMonth: number
): { year: number; month: number } {
  let y = parsedYear;
  let m = parsedMonth;

  for (let i = 0; i < 24; i++) {
    const key = `${memberName}:${y}-${String(m).padStart(2, "0")}`;
    const paidAt = paidMonthsMap.get(key);

    // 이 달이 지급완료가 아니면 → 여기 확정
    if (paidAt === undefined) {
      // 미래 월 방지
      if (y > currentYear || (y === currentYear && m > currentMonth)) {
        return { year: currentYear, month: currentMonth };
      }
      return { year: y, month: m };
    }

    // 이 달이 지급완료임. 글이 지급 시각 이전에 등록됐으면 → 이월 안 함, 제 달 유지
    if (registeredDate && paidAt && registeredDate <= paidAt) {
      return { year: y, month: m };
    }

    // 글이 지급 시각 이후에 등록됨(늦은 글) → 다음 달로 이월
    m++;
    if (m > 12) { m = 1; y++; }
  }

  return { year: currentYear, month: currentMonth };
}

export async function POST() {
  const supabase = await createClient();
  const apiKey = process.env.FLOW_API_KEY;
  const userId = process.env.FLOW_USER_ID;
  const projects: ProjectMapping[] = getProjects();

  if (!apiKey || !userId || projects.length === 0) {
    return NextResponse.json({ error: "Missing config" }, { status: 500 });
  }

  try {
    // 1) Flow에서 3개 프로젝트 병렬 fetch
    const fetchResults = await Promise.all(
      projects.map(async ({ projectId, memberName }) => {
        const posts = await fetchProjectPosts(projectId, userId, apiKey);
        return posts
          .filter(p => CLIENT_CONFIG.TARGET_TEMPLATE_TYPES.includes(p.templateType))
          .map(p => ({ post: p, memberName, projectId }));
      })
    );
    const allItems = fetchResults.flat();

    // 2) 기존 DB 상태 조회
    // 기존 posts 전체 조회 (1000행 제한 회피 위해 페이지네이션)
    const existingPosts: any[] = [];
    {
      const PAGE = 1000;
      let from = 0;
      for (let i = 0; i < 50; i++) {
        const { data: chunk, error: pErr } = await supabase
          .from("posts")
          .select("post_id, is_locked, locked_amount, settlement_year, settlement_month, is_deleted_from_flow")
          .range(from, from + PAGE - 1);
        if (pErr) throw new Error(pErr.message);
        if (!chunk || chunk.length === 0) break;
        existingPosts.push(...chunk);
        if (chunk.length < PAGE) break;
        from += PAGE;
      }
    }
    const existingMap = new Map<string, any>(
      existingPosts.map(p => [p.post_id, p])
    );
  

    const { data: settlements } = await supabase
      .from("member_settlements")
      .select("member_name, year, month, is_paid, paid_at")
      .eq("is_paid", true);
    const paidMonthsMap = new Map<string, Date | null>(
      (settlements || []).map(s => [
        `${s.member_name}:${s.year}-${String(s.month).padStart(2, "0")}`,
        s.paid_at ? new Date(s.paid_at) : null,
      ])
    );

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // 3) 각 게시글에 대해 upsert 데이터 준비
    const upsertRows = [];
    for (const { post, memberName, projectId } of allItems) {
      const parsed = parseTitle(post.title);
      const existing = existingMap.get(post.postId);

      let settlementYear: number | null = null;
      let settlementMonth: number | null = null;
      let isAmountModified = false;
      let isLocked = false;
      let lockedAmount: number | null = null;

      if (existing?.is_locked) {
        // 잠긴 게시글: 정산월/잠금금액 유지, 수정만 감지
        isLocked = true;
        lockedAmount = existing.locked_amount;
        settlementYear = existing.settlement_year;
        settlementMonth = existing.settlement_month;
        if (parsed.valid && lockedAmount !== parsed.amount) {
          isAmountModified = true;
        }
      } else if (parsed.valid) {
        // 미잠금: 정산월 결정 (지급 후 등록된 글만 이월)
        const registeredDate = post.registeredDateTime
          ? parseFlowDateTime(post.registeredDateTime)
          : null;
        const sm = determineSettlementMonth(
          parsed.year!, parsed.month!, memberName,
          registeredDate, paidMonthsMap, currentYear, currentMonth
        );
        settlementYear = sm.year;
        settlementMonth = sm.month;
      }

      upsertRows.push({
        post_id: post.postId,
        project_id: projectId,
        member_name: memberName,
        flow_title: post.title,
        flow_content: post.content,
        flow_register_name: post.registerName,
        flow_registered_datetime: post.registeredDateTime,
        flow_fetched_at: new Date().toISOString(),
        parsed_date: parsed.valid ? parsed.dateStr : null,
        parsed_store: parsed.valid ? parsed.store : null,
        parsed_amount: parsed.valid ? parsed.amount : null,
        parsed_note: parsed.valid ? (parsed.note || null) : null,
        is_parsed: parsed.valid,
        settlement_year: settlementYear,
        settlement_month: settlementMonth,
        is_locked: isLocked,
        locked_amount: lockedAmount,
        is_amount_modified: isAmountModified,
        updated_at: new Date().toISOString(),
      });
    }

    // 4) 배치 upsert (500개씩)
    const CHUNK = 500;
    for (let i = 0; i < upsertRows.length; i += CHUNK) {
      const chunk = upsertRows.slice(i, i + CHUNK);
      const { error } = await supabase.from("posts").upsert(chunk, { onConflict: "post_id" });
      if (error) throw new Error(error.message);
    }

    // 5) 삭제 감지: DB에 있는데 Flow에 없는 게시글 처리
    const flowPostIds = new Set(allItems.map(({ post }) => post.postId));
    const stalePostsToCheck = (existingPosts || []).filter(
      (p: any) => !flowPostIds.has(p.post_id) && !p.is_deleted_from_flow
    );

    if (stalePostsToCheck.length > 0) {
      // 미잠금 → 소프트 삭제 (단순 마킹)
      const unlockedToDelete = stalePostsToCheck.filter((p: any) => !p.is_locked).map((p: any) => p.post_id);
      // 잠금 → ⚠ 삭제 감지 마킹 (운영자 확인 필요)
      const lockedToFlag = stalePostsToCheck.filter((p: any) => p.is_locked).map((p: any) => p.post_id);

      if (unlockedToDelete.length > 0) {
        await supabase
          .from("posts")
          .update({
            is_deleted_from_flow: true,
            deleted_detected_at: new Date().toISOString(),
          })
          .in("post_id", unlockedToDelete);
      }
      if (lockedToFlag.length > 0) {
        await supabase
          .from("posts")
          .update({
            is_deleted_from_flow: true,
            deleted_detected_at: new Date().toISOString(),
          })
          .in("post_id", lockedToFlag);
      }
    }

    return NextResponse.json({
      ok: true,
      total: upsertRows.length,
      deleted_unlocked: stalePostsToCheck.filter((p: any) => !p.is_locked).length,
      deleted_locked: stalePostsToCheck.filter((p: any) => p.is_locked).length,
      members: projects.map(p => p.memberName),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}