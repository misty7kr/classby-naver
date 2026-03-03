import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type Intent    = "info" | "problem" | "compare" | "consult";
type Subject   = "kor" | "eng" | "math" | "sci" | "soc" | "essay" | "coding";
type GradeBand = "elem" | "mid" | "high";
type Goal      = "school_exam" | "csat" | "performance" | "descriptive";

// apiMode:
//   "openai"    → Pass1(GPT)    + Pass2 인간화(GPT)
//   "anthropic" → Pass1(Claude) + Pass2 인간화(Claude)
//   "hybrid"    → Pass1(GPT)    + Pass2 인간화(Claude) — 최고 품질
type ApiMode = "openai" | "anthropic" | "hybrid";

type Payload = {
  apiMode: ApiMode;
  openaiKey?: string;    // apiMode가 openai 또는 hybrid일 때 필수
  anthropicKey?: string; // apiMode가 anthropic 또는 hybrid일 때 필수
  pass1Model?: string;   // Pass1 모델 (미입력 시 provider별 기본값)
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

type ValidationDetail = {
  titlesOk: boolean;
  bodyOk: boolean;
  bodyLength: number;
  hashtagsOk: boolean;
  keywordOk: boolean;
  faqOk: boolean;
  headingsOk: boolean;
  firstParaChecked: string;
};

type ParseResult =
  | { success: true; data: BlogPostOutput }
  | { success: false; reason: string; detail?: ValidationDetail };

type LLMResult = { ok: boolean; text: string; status: number };

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const OPENAI_PASS1_DEFAULT     = "gpt-4.1-mini";
const ANTHROPIC_PASS1_DEFAULT  = "claude-sonnet-4-5";
const OPENAI_PASS2_MODEL       = "gpt-4.1-mini";
const ANTHROPIC_PASS2_MODEL    = "claude-haiku-4-5";

const MIN_BODY_LENGTH    = 1500;
const MAX_BODY_LENGTH    = 2200;
const MAX_FIRST_PARA_LEN = 120;

// ─────────────────────────────────────────────
// Label Maps
// ─────────────────────────────────────────────

const SUBJECT_LABEL: Record<string, string> = {
  kor: "국어", eng: "영어", math: "수학",
  sci: "과학", soc: "사회", essay: "논술", coding: "코딩",
};
const GRADE_LABEL: Record<string, string> = {
  elem: "초등", mid: "중등", high: "고등",
};
const GOAL_LABEL: Record<string, string> = {
  school_exam: "내신", csat: "수능/모의고사",
  performance: "수행평가", descriptive: "서술형",
};

// ─────────────────────────────────────────────
// Intent guides
// ─────────────────────────────────────────────

const INTENT_GUIDE: Record<string, string> = {
  info: `
[글 타입: 정보 제공형]
독자: 자녀 교육에 관심 있는 30~40대 학부모. 검색하다가 제목에서 멈춘 사람.
      전문용어보다 "우리 아이 얘기구나" 싶은 표현에 반응한다.
- 도입: 독자가 지금 궁금해할 상황을 한 문장으로 짚기 (의문형 또는 공감형 시작)
- 본문: 개념 설명 → 구체적 방법/팁 → 주의사항
- 소제목 패턴: "~란?", "~하는 방법", "~할 때 주의점"
- 현장감 표현: "보통 이런 순서로 해요", "대부분 여기서 막히더라고요" 같은 말투 사용
- FAQ: 실제로 자주 받는 정보성 질문 위주
`.trim(),

  problem: `
[글 타입: 문제 해결형]
독자: 열심히 하고 있는데 결과가 안 나와서 지쳐있는 학생/학부모.
      "왜 이럴까"라는 답을 찾고 싶은 상태.
- 도입: 독자의 고민을 구체적으로 짚어 강하게 공감 ("이런 경우 있으신가요?" 식)
- 본문: 문제 원인 분석 → 해결 방법 3~4가지 → 실천 체크리스트
- 소제목 패턴: "왜 ~가 어려울까?", "이렇게 해보세요", "체크리스트"
- 해결책은 구체적으로: "이 경우엔 보통 ~부터 바꾸는 게 효과적이에요" 식
- FAQ: 막히는 상황별 Q&A 위주
`.trim(),

  compare: `
[글 타입: 비교형]
독자: A와 B 사이에서 선택을 못 하고 있는 학부모. 결론을 원한다.
- 도입: "A vs B, 어떤 게 맞을까요?" 식으로 독자의 선택 상황을 직접 제시
- 본문: 각 선택지 장단점 → 상황별 추천
- 소제목 패턴: "A의 특징", "B의 특징", "나에게 맞는 선택은?"
- 결론은 명확하게: "이런 경우엔 A, 이런 경우엔 B가 낫습니다"로 정리
- FAQ: 선택 기준이 되는 질문 위주
`.trim(),

  consult: `
[글 타입: 상담 유도형]
독자: 상담을 해볼까 망설이는 학부모. 부담스럽지 않게 안내받고 싶은 상태.
- 도입: 독자 상황에 깊이 공감하는 문장으로 시작 (압박감 없이)
- 본문: 공감 → 일반적 해결 방향 → "개인 상황마다 다를 수 있어요" 강조
- 소제목 패턴: "이런 고민 있으신가요?", "보통 이런 경우에는", "먼저 확인해볼 것들"
- CTA는 마지막에 한 번만, 부드럽게
- FAQ: 상담 전 자주 하는 질문 위주
`.trim(),
};

// ─────────────────────────────────────────────
// Core keyword
// ─────────────────────────────────────────────

function makeCoreKeyword(input: Payload["input"]): string {
  const subject = SUBJECT_LABEL[input.subject] ?? input.subject;
  const grade   = GRADE_LABEL[input.gradeBand] ?? input.gradeBand;
  const goal    = GOAL_LABEL[input.goal] ?? input.goal;
  return input.schoolName?.trim()
    ? `${input.region} ${input.schoolName.trim()} ${grade} ${subject} ${goal}`
    : `${input.region} ${grade} ${subject} ${goal}`;
}

// ─────────────────────────────────────────────
// Pass1 prompts
// ─────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `
당신은 교육/입시 전문 블로그 콘텐츠 작가입니다. 네이버 블로그에 최적화된 글을 씁니다.

[독자]
자녀 교육에 관심 있는 30~40대 학부모. 검색하다가 제목에서 멈춘 사람.
전문용어보다 "우리 아이 얘기구나" 싶은 표현에 반응한다.

[문장 감각 — 반드시 따를 것]
- 첫 문장은 질문 또는 상황 묘사로 시작 ("이런 경우 있으신가요?" / "3월이 시작됐는데")
- 짧은 문장(10자 내외)과 긴 문장을 섞어 리듬 만들기
- "~합니다" 단독보다 "~해요", "~거든요" 같은 구어체 자연스럽게 섞기
- 수치나 현장감 있는 표현 1개 이상 포함 ("보통 6주 전부터 시작하는 경우가 많아요")
- AI 냄새 나는 나열 패턴 금지: "먼저~, 또한~, 마지막으로~" 구조 사용 금지
- 단정적 표현 완화: "학교마다, 학생마다 다를 수 있어요"를 전제로

[분량 엄수 — 가장 중요]
- 본문은 반드시 1500자 이상 2200자 이하
- 소제목이 4~6개이므로 소제목당 평균 250~350자를 써야 1500자가 됨
- 짧게 끝날 것 같으면 소제목 아래 예시, 체크리스트, 구체적 상황 묘사를 추가해서 채울 것
- 출력 전 반드시 글자 수를 세어보고 1500자 미만이면 보강 후 출력

[절대 금지]
- 과장·보장 표현 (무조건/100%/최고/완벽/확실히 보장 등)
- 광고 냄새 나는 표현

[소제목 표기 규칙]
- 반드시 【소제목】 형식으로만 표기
- 줄의 맨 앞에서만 사용 (본문 중간 인라인 금지)
- 본문 전체에 정확히 4~6개

[출력 형식]
반드시 아래 JSON만 출력. 마크다운 코드블록(\`\`\`) 포함 그 외 텍스트 절대 금지:
{
  "titles": [string 5개],
  "body": "본문 (줄바꿈 \\n 유지)",
  "hashtags": [string 20개]
}
  `.trim();
}

function buildUserPrompt(input: Payload["input"]): string {
  const subjectLabel = SUBJECT_LABEL[input.subject] ?? input.subject;
  const gradeLabel   = GRADE_LABEL[input.gradeBand] ?? input.gradeBand;
  const goalLabel    = GOAL_LABEL[input.goal] ?? input.goal;
  const intentGuide  = INTENT_GUIDE[input.intent] ?? `[글 타입: ${input.intent}]`;
  const schoolPart   = input.schoolName?.trim() ? `학교명: ${input.schoolName.trim()}\n` : "";
  const coreKeyword  = makeCoreKeyword(input);

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
핵심 키워드(문자 그대로만 사용, 변형·유사표현 금지): "${coreKeyword}"
선택 주제: ${input.topicTitle}

${intentGuide}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[작업 순서 — 반드시 이 순서대로 작성]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1. 첫 문단 작성
  - 빈 줄(\\n\\n) 이전까지가 첫 문단
  - 첫 문단 전체가 120자 이내 (줄바꿈 포함)
  - 핵심 키워드 "${coreKeyword}"를 정확히 1회만 포함 (0회·2회 모두 오류)
  - 질문 또는 상황 묘사로 시작
  - 시즌("${input.season}")에 맞는 도입

STEP 2. 소제목 4~6개 배치
  - 반드시 【소제목】 형식, 줄 맨 앞에만 배치
  - 글 타입에 맞는 패턴 사용

STEP 3. 각 소제목 아래 본문 작성
  - 소제목 아래 첫 문장은 독자 상황 공감 또는 핵심 포인트로 시작
  - 구체적인 예시 또는 체크리스트를 최소 1개 포함
  - 학교 관련 정보는 "학교마다 다를 수 있어요"를 전제로

STEP 4. FAQ 3세트 작성 (형식·순서 고정)
  Q: 질문 내용
  A: 답변 내용

  Q: 질문 내용
  A: 답변 내용

  Q: 질문 내용
  A: 답변 내용

  규칙:
  - Q와 A는 반드시 이 순서로 1쌍씩 3번 반복
  - Q:/A: 레이블을 줄 맨 앞에 사용
  - Q 3개가 몰리고 A 3개가 몰리는 구조 절대 금지

STEP 5. CTA 작성
  - 압박 없이 부드럽게 ("필요하시면 편하게 문의해 주세요" 수준)
  - ${ctaHint}

STEP 6. 자체검사 (출력 전 내부 확인)
  ☑ 첫 문단이 빈 줄(\\n\\n) 이전까지이며 전체 120자 이내인가?
  ☑ 핵심 키워드 "${coreKeyword}"가 첫 문단에 정확히 1회인가?
  ☑ 소제목이 【】 형식으로 줄 맨 앞에 4~6개인가?
  ☑ FAQ가 (Q:/A:) 순서 쌍으로 정확히 3세트인가?
  ☑ 과장 표현(무조건/100%/최고/완벽 등)이 없는가?
  ☑ 해시태그가 정확히 20개이고 모두 #으로 시작하는가?
  ☑ 본문 전체 길이가 1500~2200자인가? (실제로 세어볼 것 — 1500자 미만이면 반드시 보강 후 재출력)
  → 하나라도 ✗이면 해당 부분만 수정 후 출력

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[제목 5개 — 클릭률 높은 패턴으로]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
아래 5가지 패턴 중 각각 1개씩 (순서 고정):
1. 숫자형: "점수가 갈리는 3가지", "해야 할 것 vs 하면 안 되는 것 4가지" 식
2. 공감형: "열심히 했는데 왜 안 될까요" — 독자 상황을 직접 짚기
3. 반전형: 예상과 다른 시각 ("많이 다니는데 성적이 안 오르는 이유")
4. 시즌형: 지금 시즌("${input.season}")을 자연스럽게 녹인 제목
5. 지역형: "${input.region}"을 포함하여 로컬 검색 최적화
- 과장 표현 금지, 핵심 키워드를 자연스럽게 포함

[해시태그 20개 구성]
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
// Repair prompt
// ─────────────────────────────────────────────

function buildRepairPrompt(
  input: Payload["input"],
  detail: ValidationDetail,
  previousOutput: string
): string {
  const coreKeyword = makeCoreKeyword(input);
  const failures: string[] = [];

  if (!detail.keywordOk)
    failures.push(
      `❌ 키워드/첫 문단 오류: 첫 문단(빈 줄 이전 전체)이 120자 이내여야 하고, "${coreKeyword}"가 정확히 1회 있어야 합니다.\n   현재 첫 문단: "${detail.firstParaChecked}"`
    );
  if (!detail.faqOk)
    failures.push(`❌ FAQ 오류: (Q:/A:) 쌍이 순서대로 정확히 3세트여야 합니다. Q 3개가 몰리고 A 3개가 몰리는 구조는 오류입니다.`);
  if (!detail.headingsOk)
    failures.push(`❌ 소제목 오류: 줄 맨 앞의 【소제목】 형식 소제목이 4~6개여야 합니다.`);
  if (!detail.bodyOk)
    failures.push(`❌ 분량 오류: 본문이 ${detail.bodyLength}자입니다. 1500~2200자가 되어야 합니다.`);
  if (!detail.hashtagsOk)
    failures.push(`❌ 해시태그 오류: 정확히 20개이고 모두 #으로 시작해야 합니다.`);

  return `
아래는 이전에 생성한 블로그 글 초안입니다. 검증 결과 다음 항목이 실패했습니다:

${failures.join("\n")}

아래 초안을 수정해서 실패 항목만 고쳐주세요. 나머지는 그대로 유지하세요.
수정 후 반드시 자체검사를 다시 수행하고, 모든 항목이 통과된 경우에만 JSON을 출력하세요.

[이전 초안]
${previousOutput}

반드시 JSON만 출력하세요.
  `.trim();
}

// ─────────────────────────────────────────────
// Pass2 인간화 prompts
// ─────────────────────────────────────────────

function buildHumanizeSystemPrompt(): string {
  return `
당신은 한국어 블로그 글을 자연스러운 사람 말투로 다듬는 에디터입니다.

[인간화 구체 지침 — 반드시 따를 것]
- 본문이 1500자 미만이면: 각 소제목 아래에 독자 상황 예시, 구체적 팁, 현장감 있는 문장을 추가해서 1500자 이상으로 채울 것
- "~하는 것이 중요합니다" → "이게 생각보다 차이가 크더라고요" 식으로 구어체 전환
- 대칭 문장("A이고, B입니다") → 한 문장을 끊어서 리듬 변화 주기
- 소제목 아래 첫 문장은 반드시 독자 상황 공감 또는 핵심 포인트로 시작
- 짧은 문장(10자 내외)과 긴 문장을 섞어 단조로운 리듬 깨기
- "먼저~, 또한~, 마지막으로~" 나열 패턴이 있으면 자연스러운 흐름으로 풀어쓰기

[절대 변경 금지]
- 소제목 구조 (【소제목】 형식, 줄 맨 앞, 4~6개)
- FAQ 형식 ((Q:/A:) 쌍 순서, 3세트)
- 핵심 키워드 (첫 문단 포함, 변형 금지)
- 첫 문단 120자 이내 조건
- 해시태그 목록 (20개, 순서·내용 그대로)
- 사실 정보
- 전체 분량: 원본이 1500자 이상이면 ±10% 이내 유지. 단 원본이 1500자 미만인 경우 반드시 1500자 이상으로 보강할 것

[자체검사 — 출력 전 확인]
☑ 본문이 1500자 이상인가? (미만이면 보강 후 재출력)
☑ 첫 문단 120자 이내, 핵심 키워드 정확히 1회 유지됐는가?
☑ 소제목 【】 형식 줄 맨 앞 4~6개 유지됐는가?
☑ FAQ (Q:/A:) 쌍 3세트 유지됐는가?
☑ 해시태그 20개 유지됐는가?
→ 하나라도 ✗이면 해당 부분만 복원/보강 후 출력

[출력 형식]
입력과 동일한 JSON 구조로만 출력:
{
  "titles": [string 5개],
  "body": "인간화된 본문 (줄바꿈 \\n 유지)",
  "hashtags": [string 20개]
}
JSON 외 텍스트 절대 금지.
  `.trim();
}

function buildHumanizeUserPrompt(draft: BlogPostOutput): string {
  const bodyLength = draft.body?.length ?? 0;
  const lengthNote = bodyLength < 1500
    ? `

⚠️ 현재 본문이 ${bodyLength}자입니다. 1500자 이상이 되도록 각 소제목 아래 내용을 보강해주세요.`
    : `

현재 본문 길이: ${bodyLength}자 (적정 범위).`;
  return `아래 블로그 글 초안을 인간화해주세요.${lengthNote}

${JSON.stringify(draft, null, 2)}`;
}

// ─────────────────────────────────────────────
// LLM Callers
// ─────────────────────────────────────────────

async function callOpenAI(
  apiKey: string, model: string,
  systemPrompt: string, userPrompt: string,
  options: { temperature?: number } = {}
): Promise<LLMResult> {
  const isGpt5 = model.startsWith("gpt-5");
  const payload: Record<string, unknown> = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    text: {
      format: {
        type: "json_schema", name: "naver_blog_post", strict: true,
        schema: {
          type: "object", additionalProperties: false,
          required: ["titles", "body", "hashtags"],
          properties: {
            titles:   { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 },
            body:     { type: "string" },
            hashtags: { type: "array", items: { type: "string" }, minItems: 20, maxItems: 20 },
          },
        },
      },
    },
  };
  if (isGpt5) payload.reasoning = { effort: "low" };
  else payload.temperature = options.temperature ?? 0.75;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, text: await res.text(), status: res.status };
}

async function callAnthropic(
  apiKey: string, model: string,
  systemPrompt: string, userPrompt: string,
  options: { temperature?: number } = {}
): Promise<LLMResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model, max_tokens: 4096,
      temperature: options.temperature ?? 0.75,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  return { ok: res.ok, text: await res.text(), status: res.status };
}

// ─────────────────────────────────────────────
// Output text extraction
// ─────────────────────────────────────────────

function extractText(rawResponse: string, isAnthropic: boolean): string | undefined {
  let data: unknown;
  try { data = JSON.parse(rawResponse); } catch { return undefined; }
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;

  if (isAnthropic) {
    // { content: [{ type:"text", text:"..." }] }
    if (Array.isArray(d.content)) {
      for (const block of d.content as any[]) {
        if (block?.type === "text" && typeof block?.text === "string" && block.text.trim())
          return block.text;
      }
    }
    return undefined;
  }

  // OpenAI Responses API
  if (typeof d.output_text === "string" && d.output_text.trim()) return d.output_text;
  if (Array.isArray(d.output)) {
    for (const block of d.output as any[]) {
      if (Array.isArray(block?.content)) {
        for (const item of block.content as any[]) {
          if ((item?.type === "output_text" || item?.type === "text") &&
              typeof item?.text === "string" && item.text.trim())
            return item.text;
        }
      }
    }
  }
  // Chat Completions fallback
  if (Array.isArray(d.choices)) {
    const c = (d.choices as any[])?.[0]?.message?.content;
    if (typeof c === "string" && c.trim()) return c;
  }
  return undefined;
}

// ─────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────

function extractFirstParagraph(body: string): string {
  return body.split(/\n\s*\n/)[0] ?? "";
}

function countHeadings(body: string): number {
  return (body.match(/^【[^】]+】/gm) ?? []).length;
}

function validateFaqPairs(body: string): boolean {
  const segments = body.split(/^Q\s*:/m);
  if (segments.length !== 4) return false;
  return segments.slice(1).every((seg) => {
    const firstA = seg.search(/^A\s*:/m);
    if (firstA === -1) return false;
    const nextQ = seg.search(/^Q\s*:/m);
    if (nextQ !== -1 && firstA > nextQ) return false;
    return true;
  });
}

function parseAndValidate(rawText: string, coreKeyword?: string): ParseResult {
  const clean = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(clean); } catch { return { success: false, reason: "JSON parse failed" }; }
  if (!parsed || typeof parsed !== "object") return { success: false, reason: "Not an object" };

  const p = parsed as any;

  const okTitles =
    Array.isArray(p.titles) && p.titles.length === 5 &&
    p.titles.every((t: any) => typeof t === "string" && t.trim());

  const bodyLength = typeof p.body === "string" ? p.body.trim().length : 0;
  const okBody = bodyLength >= MIN_BODY_LENGTH && bodyLength <= MAX_BODY_LENGTH;

  const firstPara = typeof p.body === "string" ? extractFirstParagraph(p.body) : "";
  const okFirstParaLen = firstPara.length <= MAX_FIRST_PARA_LEN;
  let keywordCount = 0;
  if (coreKeyword) {
    const kwNorm   = coreKeyword.replace(/\s/g, "");
    const paraNorm = firstPara.replace(/\s/g, "");
    const regex = new RegExp(kwNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    keywordCount = (paraNorm.match(regex) ?? []).length;
  }
  const okKeyword = !coreKeyword || (okFirstParaLen && keywordCount === 1);

  const okTags =
    Array.isArray(p.hashtags) && p.hashtags.length === 20 &&
    p.hashtags.every((h: any) => typeof h === "string" && h.trim().startsWith("#"));

  const okFaq      = typeof p.body === "string" ? validateFaqPairs(p.body) : false;
  const headingCnt = typeof p.body === "string" ? countHeadings(p.body) : 0;
  const okHeadings = headingCnt >= 4 && headingCnt <= 6;

  const detail: ValidationDetail = {
    titlesOk: okTitles, bodyOk: okBody, bodyLength,
    hashtagsOk: okTags, keywordOk: okKeyword,
    faqOk: okFaq, headingsOk: okHeadings,
    firstParaChecked: firstPara,
  };

  if (!okTitles || !okBody || !okTags || !okKeyword || !okFaq || !okHeadings)
    return { success: false, reason: "Validation failed", detail };

  return { success: true, data: p as BlogPostOutput };
}

// ─────────────────────────────────────────────
// POST Handler
// ─────────────────────────────────────────────

export async function POST(req: Request) {
  const secret = process.env.CLASSBY_ACCESS_PASSWORD;
  if (!secret)
    return NextResponse.json({ error: "Server is missing CLASSBY_ACCESS_PASSWORD" }, { status: 500 });

  const cookieStore = await cookies();
  const token    = cookieStore.get("cb_auth")?.value || "";
  const expected = crypto.createHmac("sha256", secret).update("cb_auth_v1").digest("hex");
  if (token !== expected)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Payload;
  try { body = (await req.json()) as Payload; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { apiMode = "openai", openaiKey, anthropicKey, pass1Model, input } = body;

  if (!input?.topicTitle?.trim()) return NextResponse.json({ error: "Missing topicTitle" }, { status: 400 });
  if (!input?.region?.trim())     return NextResponse.json({ error: "Missing region" }, { status: 400 });

  if ((apiMode === "openai" || apiMode === "hybrid") && !openaiKey?.trim())
    return NextResponse.json({ error: "OpenAI API Key가 필요합니다" }, { status: 400 });
  if ((apiMode === "anthropic" || apiMode === "hybrid") && !anthropicKey?.trim())
    return NextResponse.json({ error: "Anthropic API Key가 필요합니다" }, { status: 400 });

  const oKey = openaiKey?.trim() ?? "";
  const aKey = anthropicKey?.trim() ?? "";

  const pass1IsAnthropic = apiMode === "anthropic";
  const resolvedPass1Model = pass1Model?.trim() ||
    (pass1IsAnthropic ? ANTHROPIC_PASS1_DEFAULT : OPENAI_PASS1_DEFAULT);

  const coreKeyword = makeCoreKeyword(input);
  const sysPr = buildSystemPrompt();
  const usrPr = buildUserPrompt(input);

  async function runPass1(temperature: number, userPrompt: string): Promise<LLMResult> {
    return pass1IsAnthropic
      ? callAnthropic(aKey, resolvedPass1Model, sysPr, userPrompt, { temperature })
      : callOpenAI(oKey, resolvedPass1Model, sysPr, userPrompt, { temperature });
  }

  function tryParse(res: LLMResult): ParseResult {
    const text = extractText(res.text, pass1IsAnthropic);
    if (!text) return { success: false, reason: "No output text extracted" };
    return parseAndValidate(text, coreKeyword);
  }

  // Pass1 첫 시도
  let pass1Res: LLMResult;
  try { pass1Res = await runPass1(0.75, usrPr); }
  catch (e: any) {
    return NextResponse.json({ error: `[Pass1] Upstream failed: ${e?.message ?? "unknown"}` }, { status: 502 });
  }
  if (!pass1Res.ok) {
    let detail: unknown = pass1Res.text;
    try { detail = JSON.parse(pass1Res.text); } catch {}
    return NextResponse.json({ error: `[Pass1] API error (${pass1Res.status})`, detail }, { status: 502 });
  }

  let pass1Result = tryParse(pass1Res);

  // 실패 시 Repair 프롬프트로 재시도
  if (!pass1Result.success) {
    const prevText = extractText(pass1Res.text, pass1IsAnthropic) ?? "";
    const repairPrompt = pass1Result.detail && prevText
      ? buildRepairPrompt(input, pass1Result.detail, prevText)
      : usrPr;

    try {
      const retryRes = await runPass1(0.4, repairPrompt);
      if (!retryRes.ok) {
        let detail: unknown = retryRes.text;
        try { detail = JSON.parse(retryRes.text); } catch {}
        return NextResponse.json({ error: `[Pass1 retry] API error (${retryRes.status})`, detail }, { status: 502 });
      }
      pass1Result = tryParse(retryRes);
    } catch {}
  }

  if (!pass1Result.success)
    return NextResponse.json(
      { error: `[Pass1] ${pass1Result.reason}`, detail: pass1Result.detail },
      { status: 500 }
    );

  const draft = pass1Result.data;

  // Pass2 인간화
  // openai    → GPT로 인간화
  // anthropic → Claude로 인간화
  // hybrid    → Claude로 인간화 (고품질 조합)
  const pass2IsAnthropic = apiMode === "anthropic" || apiMode === "hybrid";
  const hSys = buildHumanizeSystemPrompt();
  const hUsr = buildHumanizeUserPrompt(draft);

  try {
    const pass2Res = pass2IsAnthropic
      ? await callAnthropic(aKey, ANTHROPIC_PASS2_MODEL, hSys, hUsr)
      : await callOpenAI(oKey, OPENAI_PASS2_MODEL, hSys, hUsr);

    if (!pass2Res.ok) return NextResponse.json({ ...draft, humanized: false });

    const pass2Text = extractText(pass2Res.text, pass2IsAnthropic);
    if (!pass2Text) return NextResponse.json({ ...draft, humanized: false });

    const pass2Result = parseAndValidate(pass2Text, coreKeyword);
    if (!pass2Result.success) return NextResponse.json({ ...draft, humanized: false });

    return NextResponse.json({ ...pass2Result.data, humanized: true });
  } catch {
    return NextResponse.json({ ...draft, humanized: false });
  }
}
