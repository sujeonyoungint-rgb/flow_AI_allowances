"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">월별 수당 정산</h1>
          <p className="text-sm text-neutral-500 mt-1">로그인이 필요합니다</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-neutral-200 p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">이메일</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full text-sm border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              placeholder="email@company.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">비밀번호</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full text-sm border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 text-sm bg-neutral-900 text-white rounded px-3 py-2 hover:bg-neutral-800 disabled:opacity-50"
          >
            <LogIn size={14} />
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <p className="text-xs text-neutral-400 text-center mt-4">
          계정이 필요하면 관리자에게 문의하세요
        </p>
      </div>
    </div>
  );
}