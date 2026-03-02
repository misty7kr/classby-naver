import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type Intent = "info" | "problem" | "compare" | "consult";
type Subject = "kor" | "eng" | "math" | "sci" | "soc" | "essay" | "coding";
type GradeBand = "elem" | "mid" | "high";
type Goal = "school_exam" | "csat" | "performance" | "descriptive";

type Payload = {
  apiKey: string;
  model?: string; // 기본값: gpt-4.1-mini
  input: {
    region: string;
    subject: Subject | string;
    gradeBand: GradeBand | string;
    goal: Goal | string;
    season: string;
    schoolName?: string;
    topicTitle: string;
    intent: Intent | string;
  };
};

type BlogPostOutput = {
  titles: string[];
  body: string;
  hashtags: string[];
};

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const DEFAULT_MODEL = "gpt-4.1-mini";
const HUMANIZE_MODEL = "gpt-4.1-mini";
const MIN_BODY_LENGTH = 700;

// ─────────────────────────────────────────────
// Label Maps
// ─────────────────────────────────────────────

const SUBJECT_LABEL: Record<string, string> = {
  kor: "국어",
  eng: "영어",
  math: "수학",
  sci: "과학",
  soc: "사회",
  essay: "논술",
  coding: "코딩",
};

const GRADE_LABEL: Record<string, string> = {
  elem: "초등",
  mid: "중등",
  high: "고등",
};

const GOAL_LABEL: Record<string, string> = {
  school_exam: "내신",
  csat: "수능/모의고사",
  performance: "수행평가",
  descriptive: "서술형",
};

const INTENT_GUIDE: Record<string, string> = {
  info: `
[글 구조: 정보 제공형]
- 도입: 독자가 궁금해할 핵심 정보를 한 문장으로 예고
- 본문: 개념 설명 → 구체적 방법/팁 → 주의사항 순서
- 소제목은 "~란?", "~하는 방법", "~할 때 주의점" 패턴 활용
- FAQ는 "자주 묻는 정보성 질문" 위주
`.trim(),

  problem: `
[글 구조: 문제 해결형]
- 도입: 독자의 고민/어려움에 강하게 공감
- 본문: 문제 원인 분석 → 해결 방법 3~4가지 → 실천 체크리스트
- 소제목은 "왜 ~가 어려울까?", "이렇게 해보세요", "체크리스트" 패턴
- FAQ는 "막히는 상황별 Q&A" 위주
`.trim(),

  compare: `
[글 구조: 비교형]
- 도입: "A vs B, 어떤 게 맞을까?" 식의 선택 상황 제시
- 본문: 각 선택지 장단점 비교표 또는 나열 → 상황별 추천
- 소제목은 "A의 특징", "B의 특징", "나에게 맞는 선택은?" 패턴
- FAQ는 "선택 기준이 되는 질문" 위주
`.trim(),

  consult: `
[글 구조: 상담 유도형]
- 도입: 독자 상황에 깊이 공감하는 문장으로 시작
- 본문: 공감 → 일반적 해결 방향 제시 → "개인 상황마다 다를 수 있음" 강조
- 소제목은 "이런 고민 있으신가요?", "보통 이런 경우에는", "먼저 확인해볼 것들" 패턴
- FAQ는 "상담 전 자주 하는 질문" 위주
- CTA를 다른 글보다 조금 더 자연스럽게 배치
`.trim(),
};

// ─────────────────────────────────────────────
// Core keyword
// ─────────────────────────────────────────────

function makeCoreKeyword(input: Payload["input"]): string {
  const subject = SUBJECT_LABEL[input.subject] ?? input.subject;
  const grade = GRADE_LABEL[input.gradeBand] ?? input.gradeBand;
  const goal = GOAL_LABEL[input.goal] ?? input.goal;

  return input.schoolName?.trim()
    ? `${input.region} ${input.schoolName.trim()} ${grade} ${subject} ${goal}`
    : `${input.region} ${grade} ${subject} ${goal}`;
}

// ─────────────────────────────────────────────
// PASS 1 prompt
// ─────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `
당신은 교육/입시 전문 블로그 콘텐츠 작가입니다. 네이버 블로그에 최적화된 글을 작성합니다.

[핵심 원칙]
- 과장·보장 표현 절대 금지 (무조건/100%/최고/완벽/확실히 보장 등)
- 학교·학생마다 다를 수 있음을 전제로 단정적 표현 완화
- 광고 냄새를 줄이고, 공감·현장감·체크리스트 중심
- 문단은 2~4줄 리듬 유지

[본문 규격]
- 1500~2200자 (한글 기준)
- 소제목 4~6개
- FAQ 3개 포함 (Q: / A: 형식)
- 마지막 CTA: 압박 없이 부드럽게 ("필요하시면 편하게 문의해 주세요" 수준)
- 첫 문단 120자 이내에 핵심 키워드 정확히 1회 포함

[출력 형식]
반드시 아래 JSON 스키마만 출력하고, 그 외 텍스트(마크다운 코드블록 포함)는 절대 출력하지 마세요:
{
  "titles": [string 5개],
  "body": "본문 (줄바꿈 \\n 유지)",
  "hashtags": [string 20개]
}
  `.trim();
}

function buildUserPrompt(input: Payload["input"]): string {
  const subjectLabel = SUBJECT_LABEL[input.subject] ?? input.subject;
  const gradeLabel = GRADE_LABEL[input.gradeBand] ?? input.gradeBand;
  const goalLabel = GOAL_LABEL[input.goal] ?? input.goal;
  const intentGuide = INTENT_GUIDE[input.intent] ?? `[글 타입: ${input.intent}]`;

  const schoolPart = input.schoolName?.trim() ? `학교명: ${input.schoolName.trim()}\n` : "";
  const coreKeyword = makeCoreKeyword(input);

  const commercialTags = input.schoolName?.trim()
    ? `#${input.region}${subjectLabel}학원, #${input.region}${gradeLabel}${subjectLabel}, #${input.region}내신대비`
    : `#${input.region}${subjectLabel}학원, #${input.region}${gradeLabel}${subjectLabel}, #${input.region}학원추천`;

  const ctaHint = input.schoolName?.trim()
    ? `"${input.schoolName.trim()} 근처 ${subjectLabel} 학원 상담" 식으로 지역+학교 조합을 자연스럽게 포함`
    : `"${input.region} ${subjectLabel} 학원 상담"을 자연스럽게 포함`;

  return `
[입력 정보]
지역: ${input.region}
${schoolPart}과목: ${subjectLabel}
학년군: ${gradeLabel}
목표: ${goalLabel}
시즌: ${input.season}
핵심 키워드: "${coreKeyword}"
선택 주제: ${input.topicTitle}

${intentGuide}

[제목 5개 요구사항]
- 패턴 다양화: 정보형 / 문제 해결형 / 체크리스트형 / 비교형 / 공감형 순서로 1개씩
- 과장 표현 금지
- 핵심 키워드를 자연스럽게 포함

[본문 요구사항]
- 첫 문단 120자 이내에 핵심 키워드 "${coreKeyword}"가 정확히 한 번 포함
- 시즌("${input.season}")에 맞는 타이밍·필요성을 자연스럽게 녹여주세요 (과장 금지)
- 학교 정보는 "학교마다 다를 수 있음"을 전제로 조심스럽게 표현
- 구체적인 체크리스트 또는 예시 1개 이상 포함
- FAQ 3개 포함 (Q: / A: 형식)
- 마지막 CTA: ${ctaHint}

[해시태그 20개 구성 기준]
- 상업성 키워드 3개 (반드시 포함): ${commercialTags}
- 지역명 포함 일반: 2개 (예: #${input.region}교육, #${input.region}공부)
- 과목+학년 조합: 3개
- 목표 관련: 2개
- 시즌 관련: 2개
- 일반 교육 키워드: 나머지 8개
- '#...' 형태, 중복 과다 금지

반드시 JSON만 출력하세요.
  `.trim();
}

// ─────────────────────────────────────────────
// PASS 2 prompt
// ─────────────────────────────────────────────

function buildHumanizeSystemPrompt(): string {
  return `
당신은 한국어 블로그 글을 자연스러운 사람 말투로 다듬는 에디터입니다.

[절대 변경 금지]
- 소제목 구조, FAQ 형식
- 핵심 키워드 (첫 문단 포함)
- 해시태그 목록
- 사실 정보
- 전체 분량 (±10% 이내 유지)

[출력 형식]
입력과 동일한 JSON 구조로만 출력하세요:
{
  "titles": [string 5개],
  "body": "인간화된 본문 (줄바꿈 \\n 유지)",
  "hashtags": [string 20개]
}
JSON 외 텍스트 절대 금지.
  `.trim();
}

function buildHumanizeUserPrompt(draft: BlogPostOutput): string {
  return `아래 블로그 글 초안을 인간화해주세요.\n\n${JSON.stringify(draft, null, 2)}`;
}

// ─────────────────────────────────────────────
// OpenAI call
// ─────────────────────────────────────────────

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options: { temperature?: number } = {}
): Promise<{ ok: boolean; text: string; status: number }> {
  const isGpt5 = model.startsWith("gpt-5");

  const payload: Record<string, unknown> = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "naver_blog_post",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["titles", "body", "hashtags"],
          properties: {
            titles: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 },
            body: { type: "string" },
            hashtags: { type: "array", items: { type: "string" }, minItems: 20, maxItems: 20 },
          },
        },
      },
    },
  };

  if (isGpt5) payload.reasoning = { effort: "low" };
  else payload.temperature = options.temperature ?? 0.75;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  return { ok: response.ok, text, status: response.status };
}

function extractOutputText(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;

  if (typeof d.output_text === "string" && d.output_text.trim()) return d.output_text;

  if (Array.isArray(d.output)) {
    for (const block of d.output as any[]) {
      if (Array.isArray(block?.content)) {
        for (const item of block.content as any[]) {
          const isTextType = item?.type === "output_text" || item?.type === "text";
          if (isTextType && typeof item?.text === "string" && item.text.trim()) return item.text;
        }
      }
    }
  }

  if (Array.isArray(d.choices)) {
    const choices = d.choices as any[];
    const content = choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content;
  }

  return undefined;
}

type ParseResult =
  | { success: true; data: BlogPostOutput }
  | { success: false; reason: string; detail?: unknown };

function parseAndValidate(rawText: string, coreKeyword?: string): ParseResult {
  const clean = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    return { success: false, reason: "JSON parse failed" };
  }
  if (!parsed || typeof parsed !== "object") return { success: false, reason: "Not an object" };

  const p = parsed as any;

  const okTitles =
    Array.isArray(p.titles) && p.titles.length === 5 && p.titles.every((t: any) => typeof t === "string" && t.trim());

  const okBody = typeof p.body === "string" && p.body.trim().length >= MIN_BODY_LENGTH;

  const firstParagraph = typeof p.body === "string" ? (p.body.split(/\n\n|\n/)[0] ?? "") : "";
  const first120 = firstParagraph.slice(0, 120);
  const okKeyword =
    !coreKeyword ||
    first120.includes(coreKeyword) ||
    first120.replace(/\s/g, "").includes(coreKeyword.replace(/\s/g, ""));

  const okTags =
    Array.isArray(p.hashtags) && p.hashtags.length === 20 && p.hashtags.every((h: any) => typeof h === "string" && h.trim().startsWith("#"));

  if (!okTitles || !okBody || !okTags || !okKeyword) {
    return {
      success: false,
      reason: "Validation failed",
      detail: {
        titlesOk: okTitles,
        bodyOk: okBody,
        bodyLength: typeof p.body === "string" ? p.body.length : 0,
        hashtagsOk: okTags,
        keywordOk: okKeyword,
        first120Checked: first120,
      },
    };
  }

  return { success: true, data: p as BlogPostOutput };
}

// ─────────────────────────────────────────────
// POST Handler
// ─────────────────────────────────────────────

export async function POST(req: Request) {
  // 🔒 Gate 먼저 (환경변수 + 쿠키 체크)
  const secret = process.env.CLASSBY_ACCESS_PASSWORD;
  if (!secret) {
    return NextResponse.json({ error: "Server is missing CLASSBY_ACCESS_PASSWORD" }, { status: 500 });
  }

  const cookieStore = await cookies(); // ✅ Next 최신 타입 대응
  const token = cookieStore.get("cb_auth")?.value || "";
  const expected = crypto.createHmac("sha256", secret).update("cb_auth_v1").digest("hex");

  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1) parse
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const apiKey = body?.apiKey?.trim();
  if (!apiKey) return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
  if (!body?.input?.topicTitle?.trim()) return NextResponse.json({ error: "Missing topicTitle" }, { status: 400 });
  if (!body?.input?.region?.trim()) return NextResponse.json({ error: "Missing region" }, { status: 400 });

  const model = body.model?.trim() || DEFAULT_MODEL;
  const coreKeyword = makeCoreKeyword(body.input);

  async function runPass1(temperature: number) {
    return await callOpenAI(apiKey, model, buildSystemPrompt(), buildUserPrompt(body.input), { temperature });
  }

  // PASS1
  let pass1Res: { ok: boolean; text: string; status: number };
  try {
    pass1Res = await runPass1(0.75);
  } catch (e: any) {
    return NextResponse.json({ error: `[Pass1] Upstream failed: ${e?.message ?? "unknown"}` }, { status: 502 });
  }

  if (!pass1Res.ok) {
    let detail: unknown = pass1Res.text;
    try { detail = JSON.parse(pass1Res.text); } catch {}
    return NextResponse.json({ error: `[Pass1] OpenAI error (${pass1Res.status})`, detail }, { status: 502 });
  }

  function tryParse(res: { text: string }) {
    let data: unknown;
    try { data = JSON.parse(res.text); } catch { return null; }
    const text = extractOutputText(data);
    if (!text) return null;
    return parseAndValidate(text, coreKeyword);
  }

  let pass1Result = tryParse(pass1Res);

  if (!pass1Result || !pass1Result.success) {
    try {
      pass1Res = await runPass1(0.4);
      if (!pass1Res.ok) {
        let detail: unknown = pass1Res.text;
        try { detail = JSON.parse(pass1Res.text); } catch {}
        return NextResponse.json({ error: `[Pass1 retry] OpenAI error (${pass1Res.status})`, detail }, { status: 502 });
      }
      pass1Result = tryParse(pass1Res);
    } catch {}
  }

  if (!pass1Result || !pass1Result.success) {
    return NextResponse.json(
      { error: `[Pass1] ${pass1Result?.reason ?? "parse failed"}`, detail: (pass1Result as any)?.detail },
      { status: 500 }
    );
  }

  const draft = pass1Result.data;

  // PASS2 (fail → return draft)
  try {
    const pass2Res = await callOpenAI(apiKey, HUMANIZE_MODEL, buildHumanizeSystemPrompt(), buildHumanizeUserPrompt(draft));
    if (!pass2Res.ok) return NextResponse.json({ ...draft, humanized: false });

    const pass2Data = JSON.parse(pass2Res.text);
    const pass2Text = extractOutputText(pass2Data);
    if (!pass2Text) return NextResponse.json({ ...draft, humanized: false });

    const pass2Result = parseAndValidate(pass2Text);
    if (!pass2Result.success) return NextResponse.json({ ...draft, humanized: false });

    return NextResponse.json({ ...pass2Result.data, humanized: true });
  } catch {
    return NextResponse.json({ ...draft, humanized: false });
  }
}