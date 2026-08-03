// Shared referee exam bank and grading policy.
export const REFEREE_EXAM_VERSION = "rankball-referee-2026-07";
export const REFEREE_EXAM_SIZE = 30;
export const REFEREE_EXAM_PASS_SCORE = 24;

import { BASE_QUESTIONS } from "./refereeExamQuestions.js";

function rotateChoices(question, shift) {
  const choices = question.choices.map((choice, index) => ({ choice, correct: index === question.answerIndex }));
  const offset = shift % choices.length;
  const rotated = [...choices.slice(offset), ...choices.slice(0, offset)];
  return {
    choices: rotated.map((item) => item.choice),
    answerIndex: rotated.findIndex((item) => item.correct),
  };
}

const REFEREE_EXAM_BANK = Array.from({ length: 600 }, (_, index) => {
  const base = BASE_QUESTIONS[index % BASE_QUESTIONS.length];
  const round = Math.floor(index / BASE_QUESTIONS.length) + 1;
  const rotated = rotateChoices(base, round + index);
  return {
    id: `ref-${String(index + 1).padStart(3, "0")}`,
    category: base.category,
    stem: round === 1 ? base.stem : `${base.stem} [상황 ${round}]`,
    choices: rotated.choices,
    answerIndex: rotated.answerIndex,
    explanation: base.explanation,
  };
});
export const REFEREE_EXAM_BANK_SIZE = REFEREE_EXAM_BANK.length;
const REFEREE_EXAM_BANK_BY_ID = new Map(REFEREE_EXAM_BANK.map((question) => [question.id, question]));

function hashSeed(seed = "") {
  return Array.from(String(seed)).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function seededRandom(seed) {
  let value = Math.abs(hashSeed(seed)) || 1;
  return () => {
    value = (value * 48271) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function buildRefereeExamSet(seed = Date.now(), count = REFEREE_EXAM_SIZE) {
  const random = seededRandom(seed);
  return [...REFEREE_EXAM_BANK]
    .map((question) => ({ question, sort: random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, count)
    .map((item, index) => ({ ...item.question, number: index + 1 }));
}

function toPublicQuestion(question) {
  const { answerIndex, explanation, ...publicQuestion } = question;
  return publicQuestion;
}

export function createRefereeExamSet(seed = Date.now(), count = REFEREE_EXAM_SIZE) {
  const questions = buildRefereeExamSet(seed, count);
  return {
    questionIds: questions.map((question) => question.id),
    questions: questions.map(toPublicQuestion),
  };
}

export function hasCompleteRefereeExamAnswers(questionIds = [], answers = {}, count = REFEREE_EXAM_SIZE) {
  if (!Array.isArray(questionIds) || questionIds.length !== count || new Set(questionIds).size !== count) return false;
  if (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.keys(answers).length !== count) return false;
  return questionIds.every((questionId) => (
    Object.hasOwn(answers, questionId) &&
    Number.isInteger(answers[questionId]) &&
    answers[questionId] >= 0 &&
    answers[questionId] <= 3
  ));
}

export function gradeRefereeExam(seed = Date.now(), answers = {}, count = REFEREE_EXAM_SIZE) {
  const questions = Array.isArray(seed) ? seed : buildRefereeExamSet(seed, count);
  const reviewed = questions.map((question) => {
    const selectedIndex = Number(answers[question.id]);
    return {
      id: question.id,
      selectedIndex: Number.isInteger(selectedIndex) ? selectedIndex : -1,
      answerIndex: question.answerIndex,
      explanation: question.explanation,
      correct: selectedIndex === question.answerIndex,
    };
  });
  const score = reviewed.filter((item) => item.correct).length;
  return {
    score,
    total: questions.length,
    passed: score >= REFEREE_EXAM_PASS_SCORE,
    reviewed,
    reviewedById: Object.fromEntries(reviewed.map((item) => [item.id, item])),
  };
}

export function gradeRefereeExamByQuestionIds(questionIds = [], answers = {}) {
  const questions = questionIds
    .map((questionId) => REFEREE_EXAM_BANK_BY_ID.get(questionId))
    .filter(Boolean);
  return gradeRefereeExam(questions, answers, questions.length);
}
