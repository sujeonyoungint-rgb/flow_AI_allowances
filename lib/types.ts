// Flow API 응답
export interface FlowPost {
  projectId: string;
  postId: string;
  templateType: string;
  registerName: string;
  registeredDateTime: string;
  title: string;
  content: string;
  htmlContent: string;
}

export interface FlowApiResponse {
  response: {
    success: boolean;
    code: number;
    message: string;
    data?: {
      projectId: string;
      hasNext: boolean;
      lastCursor: number;
      posts: FlowPost[];
    };
    error?: { code: string; message: string };
  };
}

// 우리 DB의 게시글
export interface Post {
  post_id: string;
  project_id: string;
  member_name: string;
  flow_title: string;
  flow_content: string | null;
  flow_register_name: string | null;
  flow_registered_datetime: string;
  flow_fetched_at: string;
  parsed_date: string | null;
  parsed_store: string | null;
  parsed_amount: number | null;
  parsed_note: string | null;
  is_parsed: boolean;
  settlement_year: number | null;
  settlement_month: number | null;
  is_locked: boolean;
  locked_amount: number | null;
  is_amount_modified: boolean;
  is_deleted_from_flow: boolean;
  deleted_detected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberSettlement {
  id: string;
  year: number;
  month: number;
  member_name: string;
  total_amount: number;
  post_count: number;
  is_reviewed: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  is_paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  actual_amount: number | null;
  memo: string | null;
  actual_updated_at: string | null;
  actual_updated_by: string | null;
  created_at: string;
}

export interface ParsedTitle {
  valid: boolean;
  year?: number;
  month?: number;
  day?: number;
  dateStr?: string;
  store?: string;
  amount?: number;
  note?: string;
}

export interface ProjectMapping {
  projectId: string;
  memberName: string;
}