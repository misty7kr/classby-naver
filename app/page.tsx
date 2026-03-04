"use client";

import { useEffect, useMemo, useState } from "react";

type Season =
  | "evergreen" | "exam_6w" | "exam_2w" | "exam_post"
  | "vac_4w" | "vac_in" | "vac_post";

type Intent = "info" | "problem" | "compare" | "consult" | "homefeed";

// apiMode:
//   "openai"    → Pass1(GPT) + Pass2 인간화(GPT)
//   "anthropic" → Pass1(Claude) + Pass2 인간화(Claude)
//   "hybrid"    → Pass1(GPT) + Pass2 인간화(Claude) — 최고 품질
type ApiMode = "openai" | "anthropic" | "hybrid";

type TopicTemplate = {
  id: string; season: Season; intent: Intent;
  needsSchool?: boolean; titleTemplate: string; tags: string[];
};
type TopicCard = {
  id: string; intent: Intent; title: string;
  tags: string[]; needsSchool?: boolean;
};
type GenerateResult = {
  titles: string[]; body: string; hashtags: string[]; humanized?: boolean;
};

const SUBJECTS = [
  { value: "kor", label: "국어" }, { value: "eng", label: "영어" },
  { value: "math", label: "수학" }, { value: "sci", label: "과학" },
  { value: "soc", label: "사회" }, { value: "essay", label: "논술" },
  { value: "coding", label: "코딩" },
] as const;

const GRADES = [
  { value: "elem", label: "초등" }, { value: "mid", label: "중등" },
  { value: "high", label: "고등" },
] as const;

const GOALS = [
  { value: "school_exam", label: "내신" }, { value: "csat", label: "수능/모의고사" },
  { value: "performance", label: "수행평가" }, { value: "descriptive", label: "서술형" },
] as const;

const SEASONS: { value: Season; label: string }[] = [
  { value: "evergreen", label: "상시형" },
  { value: "exam_6w",   label: "시험 6주 전" },
  { value: "exam_2w",   label: "시험 2주 전" },
  { value: "exam_post", label: "시험 직후" },
  { value: "vac_4w",    label: "방학 4주 전" },
  { value: "vac_in",    label: "방학 중(특강)" },
  { value: "vac_post",  label: "방학 직후" },
];

// Pass1 모델 allowlist — provider별로 분리
const OPENAI_MODELS = [
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini (기본 · 빠름 · 저렴)" },
  { value: "gpt-4.1",      label: "gpt-4.1 (고품질 · 중간 비용)" },
  { value: "gpt-5.2",      label: "gpt-5.2 (최고품질 · Tier 제한 있음)" },
] as const;

const ANTHROPIC_MODELS = [
  { value: "claude-sonnet-4-5", label: "claude-sonnet-4-5 (기본 · 균형)" },
  { value: "claude-opus-4-5",   label: "claude-opus-4-5 (고품질 · 느림)" },
] as const;

type OpenAIModel    = (typeof OPENAI_MODELS)[number]["value"];
type AnthropicModel = (typeof ANTHROPIC_MODELS)[number]["value"];

const API_MODE_OPTIONS: { value: ApiMode; label: string; desc: string; detail: string; badge?: string }[] = [
  {
    value: "openai",
    label: "OpenAI만 사용",
    desc: "초안 생성 + 인간화 모두 GPT로 처리합니다.",
    detail: "OpenAI API Key 1개만 있으면 됩니다.",
  },
  {
    value: "anthropic",
    label: "Claude만 사용",
    desc: "초안 생성 + 인간화 모두 Claude로 처리합니다.",
    detail: "Anthropic API Key 1개만 있으면 됩니다.",
  },
  {
    value: "hybrid",
    label: "혼합 모드",
    desc: "GPT로 구조를 잡고, Claude로 문체를 다듬습니다.",
    detail: "GPT는 형식과 구조를 정확히 지키고, Claude는 문장을 자연스럽게 만드는 데 강합니다. 두 모델의 장점을 조합해 결과물 퀄리티가 가장 높습니다. OpenAI + Anthropic API Key 2개가 필요합니다.",
    badge: "고품질 추천",
  },
];

const NO_EXAM_ALLOWED_SEASONS: Season[] = ["evergreen", "vac_4w", "vac_in", "vac_post"];
const NO_EXAM_ALLOWED_GOALS = ["performance", "descriptive"] as const;
const ELEM_ALLOWED_SEASONS: Season[]   = ["evergreen", "vac_4w", "vac_in", "vac_post"];
const isExamSeason = (s: Season) => s === "exam_6w" || s === "exam_2w" || s === "exam_post";

const MIX_12: Record<Season, Record<Intent, number>> = {
  evergreen: { info: 3, problem: 3, compare: 2, consult: 1, homefeed: 2 },
  exam_6w:   { info: 3, problem: 3, compare: 2, consult: 1, homefeed: 2 },
  exam_2w:   { info: 2, problem: 4, compare: 2, consult: 1, homefeed: 2 },
  exam_post: { info: 4, problem: 3, compare: 2, consult: 1, homefeed: 2 },
  vac_4w:    { info: 3, problem: 3, compare: 2, consult: 1, homefeed: 2 },
  vac_in:    { info: 2, problem: 3, compare: 2, consult: 2, homefeed: 2 },
  vac_post:  { info: 4, problem: 2, compare: 2, consult: 1, homefeed: 2 },
};

const TOPIC_TEMPLATES: TopicTemplate[] = [
  // evergreen
  { id: "ev-i-1", season: "evergreen", intent: "info",    titleTemplate: "{region} {grade} {subject} {goal}, 점수가 갈리는 핵심 3가지", tags: ["checklist"] },
  { id: "ev-i-2", season: "evergreen", intent: "info",    titleTemplate: "{grade} {subject} 공부 순서, 이것부터 해야 합니다", tags: ["sequence"] },
  { id: "ev-i-3", season: "evergreen", intent: "info",    titleTemplate: "{subject} 서술형 점수를 올리는 구조(감점 포인트 포함)", tags: ["descriptive"] },
  { id: "ev-i-4", season: "evergreen", intent: "info",    titleTemplate: "{subject} 주간 학습 루틴 예시(현실형)", tags: ["routine"] },
  { id: "ev-p-1", season: "evergreen", intent: "problem", titleTemplate: "{grade} {subject} 성적이 안 오르는 진짜 이유", tags: ["root-cause"] },
  { id: "ev-p-2", season: "evergreen", intent: "problem", titleTemplate: "{subject} 열심히 해도 결과가 그대로인 경우(대부분 여기서 갈립니다)", tags: ["myth"] },
  { id: "ev-p-3", season: "evergreen", intent: "problem", titleTemplate: "{subject} 문제는 푸는데 점수가 안 나오는 이유", tags: ["strategy-gap"] },
  { id: "ev-p-4", season: "evergreen", intent: "problem", titleTemplate: "{subject} 오답을 해도 실력이 안 느는 학생의 공통점", tags: ["wrong-note"] },
  { id: "ev-c-1", season: "evergreen", intent: "compare", titleTemplate: "{region} {subject} 학원 선택 기준 5가지(상담 전에 체크)", tags: ["selection"] },
  { id: "ev-c-2", season: "evergreen", intent: "compare", titleTemplate: "대형 수업 vs 소수정예, {subject}에서 차이가 나는 지점", tags: ["class-type"] },
  { id: "ev-c-3", season: "evergreen", intent: "compare", titleTemplate: "숙제 중심 vs 관리 중심, {subject}에서 결과가 달라지는 이유", tags: ["management"] },
  { id: "ev-s-1", season: "evergreen", intent: "consult", titleTemplate: "{region} {grade} {subject} 상담을 고민하는 분들께(체크리스트)", tags: ["cta-soft"] },
  // exam_6w
  { id: "e6-i-1", season: "exam_6w", intent: "info",    titleTemplate: "{subject} 시험 대비, 지금부터 준비해야 하는 순서", tags: ["plan"] },
  { id: "e6-i-2", season: "exam_6w", intent: "info",    titleTemplate: "{goal} 대비, 범위 확정 전 준비 전략", tags: ["scope"] },
  { id: "e6-i-3", season: "exam_6w", intent: "info",    titleTemplate: "{subject} 서술형/수행 대비는 언제부터 시작해야 할까", tags: ["timing"] },
  { id: "e6-i-4", season: "exam_6w", intent: "info",    titleTemplate: "{region} {grade} 시험 대비 루틴(주간 플랜)", tags: ["weekly"] },
  { id: "e6-p-1", season: "exam_6w", intent: "problem", titleTemplate: "시험 준비를 일찍 시작해도 성적이 안 오르는 이유", tags: ["early"] },
  { id: "e6-p-2", season: "exam_6w", intent: "problem", titleTemplate: "{subject}에서 '기초'가 무너지면 벌어지는 일", tags: ["foundation"] },
  { id: "e6-p-3", season: "exam_6w", intent: "problem", titleTemplate: "{subject} 오답노트를 써도 효과가 없는 경우", tags: ["wrong-note"] },
  { id: "e6-p-4", season: "exam_6w", intent: "problem", titleTemplate: "{grade} 시험에서 시간 관리가 안 되는 학생의 특징", tags: ["time"] },
  { id: "e6-c-1", season: "exam_6w", intent: "compare", titleTemplate: "{subject} 내신 대비, '관리'가 중요한 이유", tags: ["management"] },
  { id: "e6-c-2", season: "exam_6w", intent: "compare", titleTemplate: "{subject} 시험 대비 수업, '진도'보다 중요한 것", tags: ["quality"] },
  { id: "e6-c-3", season: "exam_6w", intent: "compare", titleTemplate: "시험 대비 상담에서 꼭 물어봐야 할 질문 5가지", tags: ["questions"] },
  { id: "e6-s-1", season: "exam_6w", intent: "consult", titleTemplate: "{region} {subject} 시험 대비 상담 체크리스트(과장 없이)", tags: ["cta-soft"] },
  // exam_2w
  { id: "e2-i-1", season: "exam_2w", intent: "info",    titleTemplate: "시험 2주 전, {subject} 점수 올리는 현실적인 방법", tags: ["2w"] },
  { id: "e2-i-2", season: "exam_2w", intent: "info",    titleTemplate: "{subject} 시험 직전 오답 정리 루틴(실전형)", tags: ["wrong"] },
  { id: "e2-i-3", season: "exam_2w", intent: "info",    titleTemplate: "{subject} 서술형 감점 줄이는 체크리스트", tags: ["descriptive"] },
  { id: "e2-p-1", season: "exam_2w", intent: "problem", titleTemplate: "시험 직전인데 점수가 안 오를 때(대부분 여기서 막힙니다)", tags: ["bottleneck"] },
  { id: "e2-p-2", season: "exam_2w", intent: "problem", titleTemplate: "{subject}에서 '아는 문제'가 틀리는 이유", tags: ["careless"] },
  { id: "e2-p-3", season: "exam_2w", intent: "problem", titleTemplate: "{subject} 시험 때 시간이 부족한 학생의 해결 순서", tags: ["time"] },
  { id: "e2-p-4", season: "exam_2w", intent: "problem", titleTemplate: "{subject} 시험 직전 절대 하면 안 되는 것 3가지", tags: ["dont"] },
  { id: "e2-p-5", season: "exam_2w", intent: "problem", titleTemplate: "{goal}에서 점수가 갈리는 '마지막 10점' 전략", tags: ["last10"] },
  { id: "e2-c-1", season: "exam_2w", intent: "compare", titleTemplate: "시험 직전, 학원 클리닉이 효과적인 학생 유형", tags: ["clinic"] },
  { id: "e2-c-2", season: "exam_2w", intent: "compare", titleTemplate: "{subject} 시험 대비에서 '관리'가 체감되는 순간", tags: ["management"] },
  { id: "e2-s-1", season: "exam_2w", intent: "consult", titleTemplate: "시험 2주 전, {region} {subject} 상담 전에 확인할 것", tags: ["cta-soft"] },
  { id: "e2-s-2", season: "exam_2w", intent: "consult", titleTemplate: "{region} {grade} {subject} 시험 직전 관리 방식(간단 안내)", tags: ["cta-soft"] },
  // exam_post
  { id: "ep-i-1", season: "exam_post", intent: "info",    titleTemplate: "시험 끝난 후 {subject}, 반드시 해야 할 3가지", tags: ["post"] },
  { id: "ep-i-2", season: "exam_post", intent: "info",    titleTemplate: "이번 시험 결과로 약점 찾는 방법({subject})", tags: ["analysis"] },
  { id: "ep-i-3", season: "exam_post", intent: "info",    titleTemplate: "기말/다음 시험 대비를 지금 시작해야 하는 이유", tags: ["next"] },
  { id: "ep-i-4", season: "exam_post", intent: "info",    titleTemplate: "{subject} 오답 분석, '틀린 이유' 분류가 핵심입니다", tags: ["wrong"] },
  { id: "ep-i-5", season: "exam_post", intent: "info",    titleTemplate: "{grade} {subject} 시험 후 루틴 리셋 방법", tags: ["reset"] },
  { id: "ep-p-1", season: "exam_post", intent: "problem", titleTemplate: "시험이 끝나면 공부를 쉬는 게 맞을까? ({subject})", tags: ["rest"] },
  { id: "ep-p-2", season: "exam_post", intent: "problem", titleTemplate: "성적이 아쉬웠다면 {subject}에서 먼저 고칠 1가지", tags: ["fix1"] },
  { id: "ep-p-3", season: "exam_post", intent: "problem", titleTemplate: "이번 시험에서 유독 감점이 컸던 지점({subject})", tags: ["deduct"] },
  { id: "ep-p-4", season: "exam_post", intent: "problem", titleTemplate: "{subject} 실수 줄이기: 다음 시험에서 달라지는 습관", tags: ["habits"] },
  { id: "ep-c-1", season: "exam_post", intent: "compare", titleTemplate: "시험 후, {subject} 학원 상담에서 꼭 확인할 것", tags: ["questions"] },
  { id: "ep-c-2", season: "exam_post", intent: "compare", titleTemplate: "{subject} 성적 관리, '수업'보다 '피드백'이 중요할 때", tags: ["feedback"] },
  { id: "ep-s-1", season: "exam_post", intent: "consult", titleTemplate: "시험 후 점검 상담: {region} {subject} 체크리스트", tags: ["cta-soft"] },
  // vac_4w
  { id: "v4-i-1", season: "vac_4w", intent: "info",    titleTemplate: "방학 4주 전, {subject}를 잡아야 하는 이유", tags: ["vac-plan"] },
  { id: "v4-i-2", season: "vac_4w", intent: "info",    titleTemplate: "방학은 선행 vs 복습? {subject} 기준으로 정리", tags: ["prepost"] },
  { id: "v4-i-3", season: "vac_4w", intent: "info",    titleTemplate: "방학 4주 학습 플랜 예시({subject})", tags: ["weekly"] },
  { id: "v4-i-4", season: "vac_4w", intent: "info",    titleTemplate: "방학 동안 격차가 벌어지는 이유({subject})", tags: ["gap"] },
  { id: "v4-p-1", season: "vac_4w", intent: "problem", titleTemplate: "방학 계획을 세워도 실패하는 이유({subject})", tags: ["fail"] },
  { id: "v4-p-2", season: "vac_4w", intent: "problem", titleTemplate: "방학에 이것만 하면 손해입니다({subject})", tags: ["dont"] },
  { id: "v4-p-3", season: "vac_4w", intent: "problem", titleTemplate: "방학 특강이 필요한 학생 유형({subject})", tags: ["need"] },
  { id: "v4-c-1", season: "vac_4w", intent: "compare", titleTemplate: "방학 특강 선택 기준 5가지({subject})", tags: ["selection"] },
  { id: "v4-c-2", season: "vac_4w", intent: "compare", titleTemplate: "{subject} 방학 수업, 진도형 vs 관리형 차이", tags: ["class-type"] },
  { id: "v4-c-3", season: "vac_4w", intent: "compare", titleTemplate: "방학에 학원 옮겨야 하는 신호({subject})", tags: ["switch"] },
  { id: "v4-s-1", season: "vac_4w", intent: "consult", titleTemplate: "방학 준비 상담 전 체크리스트({region} {subject})", tags: ["cta-soft"] },
  { id: "v4-s-2", season: "vac_4w", intent: "consult", titleTemplate: "{region} {subject} 방학 특강 안내(부드러운 톤)", tags: ["cta-soft"] },
  // vac_in
  { id: "vi-i-1", season: "vac_in", intent: "info",    titleTemplate: "방학 중 {subject} 루틴 유지하는 방법(현실형)", tags: ["routine"] },
  { id: "vi-i-2", season: "vac_in", intent: "info",    titleTemplate: "방학 특강 기간, {subject} 오답 관리가 성패를 가릅니다", tags: ["wrong"] },
  { id: "vi-i-3", season: "vac_in", intent: "info",    titleTemplate: "방학 중 {subject} 주간 점검표(체크리스트)", tags: ["checklist"] },
  { id: "vi-p-1", season: "vac_in", intent: "problem", titleTemplate: "방학 중반부터 무너지는 이유({subject})", tags: ["mid-slump"] },
  { id: "vi-p-2", season: "vac_in", intent: "problem", titleTemplate: "특강을 들어도 성적이 안 오르는 경우({subject})", tags: ["no-gain"] },
  { id: "vi-p-3", season: "vac_in", intent: "problem", titleTemplate: "{subject} 선행만 하고 내신이 흔들리는 이유", tags: ["risk"] },
  { id: "vi-p-4", season: "vac_in", intent: "problem", titleTemplate: "방학 중 {subject}에서 실수 줄이는 습관", tags: ["habits"] },
  { id: "vi-c-1", season: "vac_in", intent: "compare", titleTemplate: "특강: 진도 수업 vs 클리닉, {subject}에서 더 중요한 건?", tags: ["clinic"] },
  { id: "vi-c-2", season: "vac_in", intent: "compare", titleTemplate: "{subject} 관리 방식이 다른 학원의 차이", tags: ["management"] },
  { id: "vi-s-1", season: "vac_in", intent: "consult", titleTemplate: "방학 특강 상담에서 꼭 확인할 질문({subject})", tags: ["cta-soft"] },
  { id: "vi-s-2", season: "vac_in", intent: "consult", titleTemplate: "{region} {subject} 방학 관리 방식(간단 안내)", tags: ["cta-soft"] },
  { id: "vi-s-3", season: "vac_in", intent: "consult", titleTemplate: "방학 중간 점검 상담이 필요한 학생 유형({subject})", tags: ["cta-soft"] },
  // vac_post
  { id: "vp-i-1", season: "vac_post", intent: "info",    titleTemplate: "방학 끝난 직후, {subject} 성과 점검 방법", tags: ["review"] },
  { id: "vp-i-2", season: "vac_post", intent: "info",    titleTemplate: "개학 후 바로 성적이 갈리는 이유({subject})", tags: ["gap"] },
  { id: "vp-i-3", season: "vac_post", intent: "info",    titleTemplate: "방학 이후 {subject} 루틴 유지법", tags: ["routine"] },
  { id: "vp-i-4", season: "vac_post", intent: "info",    titleTemplate: "{goal} 대비, 방학에서 놓친 구간 메우는 순서", tags: ["sequence"] },
  { id: "vp-i-5", season: "vac_post", intent: "info",    titleTemplate: "방학 특강 이후 관리 전략({subject})", tags: ["aftercare"] },
  { id: "vp-p-1", season: "vac_post", intent: "problem", titleTemplate: "방학 때 했는데도 성적이 안 오르는 이유({subject})", tags: ["no-gain"] },
  { id: "vp-p-2", season: "vac_post", intent: "problem", titleTemplate: "개학 후 흔들리는 학생의 공통점({subject})", tags: ["wobble"] },
  { id: "vp-p-3", season: "vac_post", intent: "problem", titleTemplate: "{subject} 실수가 다시 늘어나는 이유(루틴 점검)", tags: ["habits"] },
  { id: "vp-c-1", season: "vac_post", intent: "compare", titleTemplate: "개학 후 {subject} 학원 상담에서 확인할 것", tags: ["questions"] },
  { id: "vp-c-2", season: "vac_post", intent: "compare", titleTemplate: "{subject} 관리: 숙제형 vs 피드백형, 차이가 나는 지점", tags: ["feedback"] },
  { id: "vp-s-1", season: "vac_post", intent: "consult", titleTemplate: "개학 직후 {region} {subject} 점검 상담 체크리스트", tags: ["cta-soft"] },
  { id: "vp-s-2", season: "vac_post", intent: "consult", titleTemplate: "{region} {subject} 학습 루틴 재설정 안내(부드럽게)", tags: ["cta-soft"] },
  // 학교별
  { id: "sch-i-1", season: "exam_6w",   intent: "info",    needsSchool: true, titleTemplate: "{region} {school} {subject} 시험 대비, 범위 확정 전 준비법", tags: ["school", "scope"] },
  { id: "sch-p-1", season: "exam_2w",   intent: "problem", needsSchool: true, titleTemplate: "{region} {school} {subject} 시험 2주 전, 점수가 안 오를 때 먼저 볼 것", tags: ["school", "2w"] },
  { id: "sch-s-1", season: "exam_post", intent: "consult", needsSchool: true, titleTemplate: "{region} {school} 시험 후 점검 상담 체크리스트({subject})", tags: ["school", "cta-soft"] },
  // 홈피드형 (공감형 · 모든 시즌 공용)
  { id: "hf-1", season: "evergreen", intent: "homefeed", titleTemplate: "{subject} 열심히 하는데 성적이 그대로인 아이의 공통점", tags: ["hf-effort"] },
  { id: "hf-2", season: "evergreen", intent: "homefeed", titleTemplate: "학원 보내는데 왜 점수가 안 오를까, 솔직하게 써봤어요", tags: ["hf-honest"] },
  { id: "hf-3", season: "evergreen", intent: "homefeed", titleTemplate: "{grade} {subject}, 상담 오는 학부모들이 제일 많이 하는 말", tags: ["hf-consult"] },
  { id: "hf-4", season: "evergreen", intent: "homefeed", titleTemplate: "오늘 수업에서 있었던 일 하나", tags: ["hf-story"] },
  { id: "hf-5", season: "evergreen", intent: "homefeed", titleTemplate: "{subject} 잘하는 아이들에게 공통적으로 있는 것", tags: ["hf-common"] },
  { id: "hf-6", season: "evergreen", intent: "homefeed", titleTemplate: "아이 성적표 받고 나서 드는 생각들", tags: ["hf-result"] },
  { id: "hf-e1", season: "exam_6w",   intent: "homefeed", titleTemplate: "시험 6주 전, 지금 이 시기가 제일 중요한 이유", tags: ["hf-timing"] },
  { id: "hf-e2", season: "exam_2w",   intent: "homefeed", titleTemplate: "시험 2주 전 학부모들이 가장 많이 하는 실수", tags: ["hf-mistake"] },
  { id: "hf-e3", season: "exam_post", intent: "homefeed", titleTemplate: "시험 끝나고 쉬게 두는 게 맞을까요", tags: ["hf-after"] },
  { id: "hf-v1", season: "vac_in",    intent: "homefeed", titleTemplate: "방학 특강, 솔직히 효과 있을까요", tags: ["hf-camp"] },
  { id: "hf-v2", season: "vac_post",  intent: "homefeed", titleTemplate: "방학 끝나고 아이가 달라졌다는 분들의 공통점", tags: ["hf-after-vac"] },
];

function autoSeason(): Season {
  const m = new Date().getMonth() + 1;
  if (m === 3 || m === 4) return "exam_6w";
  if (m === 5 || m === 6) return "exam_2w";
  if (m === 7) return "exam_post";
  if (m === 8) return "vac_post";
  if (m === 9 || m === 10) return "exam_6w";
  if (m === 11) return "exam_2w";
  if (m === 12) return "exam_post";
  if (m === 1) return "vac_in";
  if (m === 2) return "vac_post";
  return "evergreen";
}

function renderTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickTopics(season: Season, vars: Record<string, string>, includeSchool: boolean): TopicCard[] {
  const mix  = MIX_12[season];
  // 해당 시즌 + evergreen 풀을 합쳐서 사용 (homefeed는 evergreen으로 등록된 것 포함)
  const pool = TOPIC_TEMPLATES.filter((t) => t.season === season || t.season === "evergreen");
  const byIntent: Record<Intent, TopicTemplate[]> = { info: [], problem: [], compare: [], consult: [], homefeed: [] };
  const seenIds = new Set<string>();
  for (const t of pool) {
    if (t.needsSchool && !includeSchool) continue;
    if (seenIds.has(t.id)) continue;
    seenIds.add(t.id);
    byIntent[t.intent].push(t);
  }
  const usedTags = new Set<string>();
  const picked: TopicCard[] = [];
  (Object.keys(mix) as Intent[]).forEach((intent) => {
    const need = mix[intent];
    const candidates = [...byIntent[intent]];
    candidates.sort((a, b) => {
      const aS = a.tags.some((x) => usedTags.has(x)) ? 1 : 0;
      const bS = b.tags.some((x) => usedTags.has(x)) ? 1 : 0;
      return aS - bS;
    });
    const s0 = shuffle(candidates.filter((c) => !c.tags.some((x) => usedTags.has(x))));
    const s1 = shuffle(candidates.filter((c) =>  c.tags.some((x) => usedTags.has(x))));
    const shuffled = [...s0, ...s1];
    for (let i = 0; i < shuffled.length && picked.filter((p) => p.intent === intent).length < need; i++) {
      const c = shuffled[i];
      const title = renderTemplate(c.titleTemplate, vars).replace(/\s+/g, " ").trim();
      if (!title) continue;
      picked.push({ id: c.id, intent: c.intent, title, tags: c.tags, needsSchool: c.needsSchool });
      c.tags.forEach((x) => usedTags.add(x));
    }
  });

function intentLabel(intent: Intent) {
  return { info: "정보형", problem: "문제해결형", compare: "비교형", consult: "상담형", homefeed: "홈피드형" }[intent] ?? intent;
}
function seasonLabel(season: Season) {
  return SEASONS.find((s) => s.value === season)?.label ?? season;
}
async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function Page() {
  const [authOk, setAuthOk]         = useState(false);
  const [accessPw, setAccessPw]     = useState("");
  const [authErr, setAuthErr]       = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  async function doAuth() {
    setAuthLoading(true); setAuthErr(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: accessPw }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Auth failed (${res.status})`);
      }
      setAuthOk(true); setAccessPw("");
    } catch (e: any) { setAuthErr(e?.message || "Auth failed"); }
    finally { setAuthLoading(false); }
  }

  // API 설정
  const [apiMode, setApiMode]         = useState<ApiMode>("openai");
  const [openaiKey, setOpenaiKey]     = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState<OpenAIModel>("gpt-4.1-mini");
  const [anthropicModel, setAnthropicModel] = useState<AnthropicModel>("claude-sonnet-4-5");

  // 입력 설정
  const [region, setRegion]         = useState("송도");
  const [subject, setSubject]       = useState<(typeof SUBJECTS)[number]["value"]>("eng");
  const [gradeBand, setGradeBand]   = useState<(typeof GRADES)[number]["value"]>("mid");
  const [goal, setGoal]             = useState<(typeof GOALS)[number]["value"]>("school_exam");
  const [season, setSeason]         = useState<Season>(autoSeason());
  const [schoolMode, setSchoolMode] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [noExamMode, setNoExamMode] = useState(false);
  const [includeAcademy, setIncludeAcademy] = useState(false);

  const [selectedTopic, setSelectedTopic] = useState<TopicCard | null>(null);
  const [result, setResult]     = useState<GenerateResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [copied, setCopied]     = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (noExamMode) {
      if (isExamSeason(season)) setSeason("evergreen");
      if (!NO_EXAM_ALLOWED_GOALS.includes(goal as typeof NO_EXAM_ALLOWED_GOALS[number]))
        setGoal("performance");
      setSelectedTopic(null); setResult(null);
    }
  }, [noExamMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedTopic(null); setResult(null); setErr(null);
  }, [subject, gradeBand, goal]);

  const vars = useMemo(() => {
    const gradeLabel   = GRADES.find((g) => g.value === gradeBand)?.label ?? gradeBand;
    const subjectLabel = SUBJECTS.find((s) => s.value === subject)?.label ?? subject;
    const goalLabel    = GOALS.find((g) => g.value === goal)?.label ?? goal;
    return { region, grade: gradeLabel, subject: subjectLabel, goal: goalLabel, school: schoolName.trim() };
  }, [region, gradeBand, subject, goal, schoolName]);

  const stableTopics = useMemo(() => {
    const includeSchool = schoolMode && schoolName.trim().length > 0;
    return pickTopics(season, vars, includeSchool);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, vars, schoolMode, schoolName, refreshKey]);

  const [topics, setTopics] = useState<TopicCard[]>([]);
  useEffect(() => { setTopics(stableTopics); }, [stableTopics]);

  // Pass1 모델: apiMode에 따라 결정
  const pass1ModelValue = apiMode === "anthropic" ? anthropicModel : openaiModel;

  async function generate() {
    setErr(null); setResult(null);

    if ((apiMode === "openai" || apiMode === "hybrid") && !openaiKey.trim()) {
      setErr("OpenAI API Key를 입력해줘."); return;
    }
    if ((apiMode === "anthropic" || apiMode === "hybrid") && !anthropicKey.trim()) {
      setErr("Anthropic API Key를 입력해줘."); return;
    }
    if (!selectedTopic) { setErr("추천 주제를 하나 선택해줘."); return; }
    if (selectedTopic.needsSchool && (!schoolMode || !schoolName.trim())) {
      setErr("학교별 주제를 선택했어. 학교명을 입력해줘."); return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiMode,
          openaiKey:    openaiKey.trim() || undefined,
          anthropicKey: anthropicKey.trim() || undefined,
          pass1Model:   pass1ModelValue,
          input: {
            region, subject, gradeBand, goal, season,
            schoolName: schoolMode ? schoolName.trim() : "",
            topicTitle: selectedTopic.title,
            intent: selectedTopic.intent,
            includeAcademy,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`[${res.status}] ${data?.error ?? "생성 실패"}`);
      setResult(data as GenerateResult);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally { setLoading(false); }
  }

  // ─── Auth 화면 ───────────────────────────────
  if (!authOk) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
          <h1 className="text-xl font-bold">CLASSBY 전용</h1>
          <p className="mt-1 text-sm text-neutral-300">접근 비밀번호를 입력하세요.</p>
          <input
            type="password" value={accessPw}
            onChange={(e) => setAccessPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doAuth(); }}
            placeholder="비밀번호"
            className="mt-4 w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2"
          />
          {authErr && <div className="mt-3 text-sm text-red-300 whitespace-pre-line">{authErr}</div>}
          <button
            onClick={doAuth} disabled={authLoading || !accessPw}
            className="mt-4 w-full rounded-xl bg-white text-black font-semibold py-3 disabled:opacity-60"
          >
            {authLoading ? "확인 중..." : "입장"}
          </button>
          <div className="mt-4 text-xs text-neutral-400">비번은 관리자가 제공한 값입니다.</div>
        </div>
      </div>
    );
  }

  // ─── 메인 화면 ──────────────────────────────
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">CLASSBY 네이버 점령 MVP</h1>
          <p className="text-neutral-300 mt-1">
            추천 주제(시즌/의도 분산) → 선택 → 제목/본문/해시태그 생성 → 복사
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* ── LEFT ── */}
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
            <h2 className="text-lg font-semibold mb-4">1) 설정</h2>

            {/* API 모드 선택 */}
            <div className="mb-4">
              <label className="block text-sm text-neutral-300 mb-2">API 모드</label>
              <div className="grid grid-cols-1 gap-2">
                {API_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setApiMode(opt.value)}
                    className={[
                      "rounded-xl border px-3 py-2.5 text-left transition",
                      apiMode === opt.value
                        ? "border-white bg-neutral-800"
                        : "border-neutral-700 bg-neutral-950 hover:bg-neutral-900",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{opt.label}</span>
                      {opt.badge && (
                        <span className="text-xs bg-amber-900/60 text-amber-300 border border-amber-700 rounded-md px-1.5 py-0.5">
                          {opt.badge}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-400 mt-0.5">{opt.desc}</div>
                    {apiMode === opt.value && opt.detail && (
                      <div className="text-xs text-neutral-500 mt-1 leading-relaxed">{opt.detail}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* API Key 입력 */}
            <div className="space-y-3 mb-4">
              {(apiMode === "openai" || apiMode === "hybrid") && (
                <div>
                  <label className="block text-sm text-neutral-300 mb-1">OpenAI API Key</label>
                  <input
                    type="password" value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2"
                  />
                  {apiMode !== "hybrid" && (
                    <div className="mt-1">
                      <label className="block text-xs text-neutral-400 mb-1">Pass1 모델</label>
                      <select
                        value={openaiModel}
                        onChange={(e) => setOpenaiModel(e.target.value as OpenAIModel)}
                        className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-1.5 text-sm"
                      >
                        {OPENAI_MODELS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {(apiMode === "anthropic" || apiMode === "hybrid") && (
                <div>
                  <label className="block text-sm text-neutral-300 mb-1">Anthropic API Key</label>
                  <input
                    type="password" value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2"
                  />
                  {apiMode === "anthropic" && (
                    <div className="mt-1">
                      <label className="block text-xs text-neutral-400 mb-1">Pass1 모델</label>
                      <select
                        value={anthropicModel}
                        onChange={(e) => setAnthropicModel(e.target.value as AnthropicModel)}
                        className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-1.5 text-sm"
                      >
                        {ANTHROPIC_MODELS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                </div>
              )}
            </div>

            {/* 지역/시즌/과목 등 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-neutral-300 mb-1">지역</label>
                <input
                  value={region} onChange={(e) => setRegion(e.target.value)}
                  placeholder="예: 송도, 분당, 강남"
                  className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">
                  시즌
                  <span className="ml-1.5 text-xs text-neutral-500">현재 월 기준 자동선택</span>
                </label>
                <select
                  value={season}
                  onChange={(e) => { setSeason(e.target.value as Season); setSelectedTopic(null); }}
                  className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2"
                >
                  {SEASONS
                    .filter((s) => {
                      if (noExamMode && !NO_EXAM_ALLOWED_SEASONS.includes(s.value)) return false;
                      if (gradeBand === "elem" && !ELEM_ALLOWED_SEASONS.includes(s.value)) return false;
                      return true;
                    })
                    .map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">과목</label>
                <select
                  value={subject} onChange={(e) => setSubject(e.target.value as typeof subject)}
                  className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2"
                >
                  {SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">학년군</label>
                <select
                  value={gradeBand}
                  onChange={(e) => {
                    const next = e.target.value as typeof gradeBand;
                    setGradeBand(next);
                    if (next === "elem" && isExamSeason(season)) setSeason("evergreen");
                  }}
                  className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2"
                >
                  {GRADES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-neutral-300 mb-1">
                  목표
                  <span className="ml-1.5 text-xs text-neutral-500">글의 키워드 방향이 달라집니다</span>
                </label>
                <select
                  value={goal} onChange={(e) => setGoal(e.target.value as typeof goal)}
                  className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2"
                >
                  {GOALS
                    .filter((g) =>
                      !noExamMode ||
                      NO_EXAM_ALLOWED_GOALS.includes(g.value as typeof NO_EXAM_ALLOWED_GOALS[number])
                    )
                    .map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
            </div>

            {/* 시험 없는 학원 모드 */}
            <div className="mt-4 rounded-xl border border-neutral-800 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">시험 없는 학원 모드</div>
                  <div className="text-sm text-neutral-300">코딩·논술·예체능 등 시험과 무관한 학원. 시험 관련 시즌·목표가 숨겨집니다.</div>
                </div>
                <input type="checkbox" checked={noExamMode}
                  onChange={(e) => setNoExamMode(e.target.checked)} className="h-5 w-5" />
              </div>
              {noExamMode && (
                <p className="mt-2 text-xs text-neutral-400">
                  exam 시즌(시험 전/후) 및 내신·수능 목표가 숨겨집니다.
                </p>
              )}
            </div>

            {/* 학원 키워드 포함 */}
            <div className="mt-4 rounded-xl border border-neutral-800 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">키워드에 "학원" 포함</div>
                  <div className="text-sm text-neutral-300">
                    체크 시 핵심 키워드에 "학원"이 포함됩니다.
                    <span className="block text-xs text-neutral-500 mt-0.5">
                      예: 송도 중등 영어학원 내신
                    </span>
                  </div>
                </div>
                <input type="checkbox" checked={includeAcademy}
                  onChange={(e) => setIncludeAcademy(e.target.checked)}
                  className="h-5 w-5" />
              </div>
            </div>

            {/* 학교별 포스팅 */}
            <div className="mt-4 rounded-xl border border-neutral-800 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">학교별 포스팅</div>
                  <div className="text-sm text-neutral-300">특정 학교 학부모를 타겟할 때 사용. 키워드에 학교명이 포함됩니다.</div>
                </div>
                <input type="checkbox" checked={schoolMode}
                  onChange={(e) => { setSchoolMode(e.target.checked); setSelectedTopic(null); }}
                  className="h-5 w-5" />
              </div>
              {schoolMode && (
                <div className="mt-3">
                  <label className="block text-sm text-neutral-300 mb-1">학교명</label>
                  <input
                    value={schoolName} onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="예: 해송중, 평촌고"
                    className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2"
                  />
                </div>
              )}
            </div>

            {/* 추천 주제 */}
            <div className="mt-5">
              <h2 className="text-lg font-semibold mb-3">
                2) 추천 주제 (현재: {seasonLabel(season)})
              </h2>
              <button
                onClick={() => { setSelectedTopic(null); setResult(null); setRefreshKey((k) => k + 1); }}
                className="mb-3 w-full rounded-xl border border-neutral-700 bg-neutral-900 py-2 text-sm text-neutral-200 hover:bg-neutral-800 transition"
              >
                추천 다시 뽑기
              </button>
              <div className="grid grid-cols-1 gap-2">
                {topics.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTopic(t); setResult(null); setErr(null); }}
                    className={[
                      "rounded-xl border px-3 py-3 text-left transition",
                      selectedTopic?.id === t.id
                        ? "border-neutral-200 bg-neutral-800"
                        : "border-neutral-800 bg-neutral-950 hover:bg-neutral-900",
                    ].join(" ")}
                  >
                    <div className="text-xs text-neutral-300 mb-1">
                      {intentLabel(t.intent)} · {t.tags.join(", ")}
                    </div>
                    <div className="font-medium">{t.title}</div>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-xs text-neutral-500 text-center">
                AI 특성상 가끔 에러가 날 수 있어요. 그럴 땐 여유롭게 한 번 더 눌러주세요 😊
              </p>
              <button
                onClick={generate} disabled={loading}
                className="mt-2 w-full rounded-xl bg-white text-black font-semibold py-3 disabled:opacity-60"
              >
                {loading ? "생성 중..." : "선택한 주제로 글 생성하기"}
              </button>
              {err && <div className="mt-3 text-sm text-red-300 whitespace-pre-line">{err}</div>}
            </div>
          </section>

          {/* ── RIGHT ── */}
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
            <h2 className="text-lg font-semibold mb-4">3) 결과</h2>
            {!result ? (
              <div className="text-neutral-300">
                오른쪽에 결과가 표시돼. 먼저 왼쪽에서 주제를 선택하고 생성해줘.
              </div>
            ) : (
              <div className="space-y-5">
                <div className={[
                  "rounded-lg px-3 py-1.5 text-xs font-medium w-fit",
                  result.humanized
                    ? "bg-green-900/50 text-green-300 border border-green-800"
                    : "bg-neutral-800 text-neutral-400 border border-neutral-700",
                ].join(" ")}>
                  {result.humanized ? "인간화 완료" : "인간화 미적용 (Pass1 결과)"}
                </div>

                {/* 제목 */}
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">제목 (5개)</div>
                    <button
                      onClick={async () => {
                        await copyToClipboard(result.titles.join("\n"));
                        setCopied("제목 복사됨"); setTimeout(() => setCopied(null), 1200);
                      }}
                      className="text-sm rounded-lg border border-neutral-700 px-2 py-1 hover:bg-neutral-900"
                    >복사</button>
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-neutral-100">
                    {result.titles.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>

                {/* 본문 */}
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">본문</div>
                    <button
                      onClick={async () => {
                        await copyToClipboard(result.body);
                        setCopied("본문 복사됨"); setTimeout(() => setCopied(null), 1200);
                      }}
                      className="text-sm rounded-lg border border-neutral-700 px-2 py-1 hover:bg-neutral-900"
                    >복사</button>
                  </div>
                  <pre className="whitespace-pre-wrap text-sm text-neutral-100 leading-6">
                    {result.body}
                  </pre>
                </div>

                {/* 해시태그 */}
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">해시태그 (20개)</div>
                    <button
                      onClick={async () => {
                        await copyToClipboard(result.hashtags.join(" "));
                        setCopied("해시태그 복사됨"); setTimeout(() => setCopied(null), 1200);
                      }}
                      className="text-sm rounded-lg border border-neutral-700 px-2 py-1 hover:bg-neutral-900"
                    >복사</button>
                  </div>
                  <div className="text-sm text-neutral-100">{result.hashtags.join(" ")}</div>
                </div>

                {copied && <div className="text-sm text-green-300">{copied}</div>}
              </div>
            )}
            <div className="mt-6 text-xs text-neutral-400">
              * API 키는 서버에 저장하지 않음. 요청 시에만 전송됨.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
