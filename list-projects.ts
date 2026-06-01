// list-projects.ts
import * as fs from "fs";
import * as path from "path";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error(".env.local 파일이 없어요");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  const env: Record<string, string> = {};

  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });

  return env;
}

async function main() {
  const env = loadEnv();
  const apiKey = env.FLOW_API_KEY;

  if (!apiKey) {
    console.error("FLOW_API_KEY 없음");
    process.exit(1);
  }

  const allProjects: any[] = [];
  let cursor = 0;
  const pageSize = 100;

  for (let i = 0; i < 50; i++) {
    const url = new URL("https://api.flow.team/v1/projects");
    if (cursor > 0) {
      url.searchParams.set("cursor", String(cursor));
    }

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-flow-api-key": apiKey,
      },
    });

    const json = await res.json();

    if (!res.ok || !json.response?.success) {
      console.error("API 호출 실패:");
      console.error(JSON.stringify(json, null, 2));
      process.exit(1);
    }

    const inner = json.response.data?.projects;
    if (!inner || !Array.isArray(inner.projects)) {
      console.error("예상치 못한 응답 구조");
      process.exit(1);
    }

    allProjects.push(...inner.projects);
    if (!inner.hasNext || inner.lastCursor === -1) break;
    cursor = inner.lastCursor;
  }

  const output = {
    endpoint: "GET https://api.flow.team/v1/projects",
    auth: {
      header: "x-flow-api-key",
      note: "API 키만으로 인증, userId 파라미터 없음",
    },
    queryParams: {
      cursor: "0-based 페이지네이션 시작 위치",
      pageSize: "한 페이지 항목 수 (최대 100)",
    },
    responseStructure: {
      "response.success": "boolean",
      "response.data.projects.hasNext": "boolean",
      "response.data.projects.lastCursor": "number",
      "response.data.projects.projects": "array (실제 목록)",
    },
    projectFields: {
      projectId: "string",
      title: "string",
      projectUrl: "string",
    },
    totalCount: allProjects.length,
    projects: allProjects.map(p => ({
      projectId: p.projectId,
      title: p.title,
      projectUrl: p.projectUrl,
    })),
  };

  console.log(`총 ${allProjects.length}개 프로젝트 조회 완료`);

  fs.writeFileSync("flow-projects.json", JSON.stringify(output, null, 2), "utf-8");
  console.log("파일 저장: flow-projects.json");
}

main().catch(err => {
  console.error("에러:", err);
  process.exit(1);
});