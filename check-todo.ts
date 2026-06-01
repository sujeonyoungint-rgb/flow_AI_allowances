// check-todo.ts
import * as fs from "fs";
import * as path from "path";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
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
  const userId = env.FLOW_USER_ID;

  // ⚠️ 할일이 많은 프로젝트 ID로 바꾸세요
  // 예시: 슈피맨-부산(임정은)-BSN = 2771079
  const PROJECT_ID = "2771079";

  const url = new URL(`https://api.flow.team/v1/posts/projects/${PROJECT_ID}`);
  url.searchParams.set("userId", userId);
  url.searchParams.set("pageSize", "100");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-flow-api-key": apiKey,
    },
  });

  const json = await res.json();

  if (!res.ok || !json.response?.success) {
    console.error("API 실패:", JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const posts = json.response.data?.posts || [];

  // templateType별 분포
  const typeCount: Record<string, number> = {};
  posts.forEach((p: any) => {
    typeCount[p.templateType] = (typeCount[p.templateType] || 0) + 1;
  });
  console.log("\n=== templateType 분포 ===");
  console.log(typeCount);

  // 할일(templateType=2) 샘플 3개 - 모든 필드 다 출력
  const todos = posts.filter((p: any) => p.templateType === "2");
  console.log(`\n=== 할일(templateType=2) 총 ${todos.length}건 ===\n`);

  if (todos.length === 0) {
    console.log("이 프로젝트에 할일이 없네요. 다른 프로젝트로 바꿔보세요.");
    return;
  }

  console.log("샘플 3건 전체 필드:\n");
  todos.slice(0, 3).forEach((p: any, i: number) => {
    console.log(`\n--- 할일 ${i + 1} ---`);
    console.log(JSON.stringify(p, null, 2));
  });

  // 진척도 관련 필드만 정리
  console.log("\n\n=== 진척도 관련 필드 요약 ===");
  console.log("(여기서 어떤 필드가 진척도를 나타내는지 확인)\n");
  todos.slice(0, 10).forEach((p: any, i: number) => {
    console.log(`${i + 1}. "${p.title?.slice(0, 30)}..."`);
    console.log(`   subTaskCount: ${p.subTaskCount}`);
    console.log(`   taskStatus: ${p.taskStatus}`);
    console.log(`   checkedYn: ${p.checkedYn}`);
    // 혹시 다른 필드가 있을까봐 전체 키 출력
    console.log(`   전체 키: ${Object.keys(p).join(", ")}`);
    console.log();
  });

  // 파일로도 저장
  fs.writeFileSync("todo-sample.json", JSON.stringify({
    typeCount,
    totalTodos: todos.length,
    samples: todos.slice(0, 5),
  }, null, 2), "utf-8");
  console.log("파일 저장: todo-sample.json (개발자/참고용)");
}

main().catch(err => {
  console.error("에러:", err);
  process.exit(1);
});