import { useMemo, useState } from "react";
import { REFEREE_TRUST_MIN } from "../lib/constants.js";
import { formatKoreanDateTime } from "../lib/matchUtils.js";
import { REFEREE_EXAM_SIZE, REFEREE_EXAM_VERSION } from "../lib/refereeExamBank.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  DEFAULT_REFEREE_REQUEST,
  getLatestRefereeExamAttempt,
  makeRefereeAttemptId,
} from "./settingsPageModel.js";

export default function useSettingsRefereeController({ app, currentTrustScore }) {
  const [refereeDraft, setRefereeDraft] = useState(DEFAULT_REFEREE_REQUEST);
  const [refereeExamQuestions, setRefereeExamQuestions] = useState([]);
  const [refereeExamOpen, setRefereeExamOpen] = useState(false);
  const [refereeExamAnswers, setRefereeExamAnswers] = useState({});
  const [refereeExamResult, setRefereeExamResult] = useState(null);
  const [currentRefereeExamAttemptId, setCurrentRefereeExamAttemptId] = useState("");
  const [refereeExamNotice, setRefereeExamNotice] = useState("");
  const refereeRequests = app.state.settings?.refereeRequests ?? [];
  const refereeExamAttempts = app.state.settings?.refereeExamAttempts ?? [];
  const canOpenRefereeRequestForm = currentTrustScore >= REFEREE_TRUST_MIN;
  const answeredRefereeExamCount = Object.keys(refereeExamAnswers).length;
  const refereeExamRequired = refereeDraft.qualification === "community_exam";
  const refereeExamPassed = refereeExamResult?.passed === true;
  const latestRefereeExamAttempt = useMemo(
    () => getLatestRefereeExamAttempt(refereeExamAttempts, app.currentUserId),
    [app.currentUserId, refereeExamAttempts],
  );
  const refereeExamLockedUntilMs = latestRefereeExamAttempt?.availableAfter ? new Date(latestRefereeExamAttempt.availableAfter).getTime() : 0;
  const refereeExamLocked = Number.isFinite(refereeExamLockedUntilMs) && refereeExamLockedUntilMs > Date.now();
  const refereeExamLockLabel = refereeExamLocked ? formatKoreanDateTime(latestRefereeExamAttempt.availableAfter) : "";

  const updateRefereeDraft = (patch) => setRefereeDraft((current) => ({ ...current, ...patch }));
  const startRefereeExam = async () => {
    if (!canOpenRefereeRequestForm) {
      setRefereeExamNotice(`심판 시험은 신뢰도 ${REFEREE_TRUST_MIN}점 이상부터 가능합니다.`);
      return;
    }
    if (!isSupabaseConfigured) {
      setRefereeExamNotice("심판 시험은 서버 연결 후 응시할 수 있습니다.");
      return;
    }
    if (refereeExamOpen && !refereeExamResult) {
      setRefereeExamNotice("이미 진행 중인 시험이 있습니다.");
      return;
    }
    if (refereeExamLocked) {
      setRefereeExamNotice(`심판 시험은 주 1회만 가능합니다. 다음 응시 가능: ${refereeExamLockLabel}`);
      return;
    }
    const attemptId = makeRefereeAttemptId();
    setRefereeExamNotice("시험을 불러오는 중입니다.");
    const startedAttempt = await app.actions.startRefereeExamAttempt({
      id: attemptId,
      examVersion: REFEREE_EXAM_VERSION,
    });
    const questions = Array.isArray(startedAttempt?.questions) ? startedAttempt.questions : [];
    if (!startedAttempt?.id || questions.length !== REFEREE_EXAM_SIZE) {
      setRefereeExamNotice("심판 시험을 시작하지 못했습니다.");
      return;
    }
    setCurrentRefereeExamAttemptId(startedAttempt.id);
    setRefereeExamQuestions(questions);
    setRefereeExamAnswers({});
    setRefereeExamResult(null);
    setRefereeExamNotice("");
    setRefereeExamOpen(true);
  };
  const selectRefereeExamAnswer = (questionId, answerIndex) => {
    if (refereeExamResult) return;
    setRefereeExamAnswers((current) => ({ ...current, [questionId]: answerIndex }));
  };
  const submitRefereeExam = async () => {
    if (!currentRefereeExamAttemptId) {
      setRefereeExamNotice("진행 중인 시험이 없습니다.");
      return;
    }
    const result = await app.actions.finishRefereeExamAttempt(currentRefereeExamAttemptId, { answers: refereeExamAnswers });
    if (!result) {
      setRefereeExamNotice("심판 시험 채점에 실패했습니다.");
      return;
    }
    setRefereeExamResult(result);
  };
  const submitRefereeRequest = (event) => {
    event.preventDefault();
    app.actions.submitRefereeRequest({
      ...refereeDraft,
      examVersion: REFEREE_EXAM_VERSION,
      examScore: refereeExamResult?.score ?? 0,
      examTotal: refereeExamResult?.total ?? REFEREE_EXAM_SIZE,
      examPassed: refereeDraft.qualification === "official_license" ? false : refereeExamPassed,
      examAttemptId: currentRefereeExamAttemptId,
    });
    setRefereeDraft(DEFAULT_REFEREE_REQUEST);
    setCurrentRefereeExamAttemptId("");
    setRefereeExamQuestions([]);
    setRefereeExamAnswers({});
    setRefereeExamResult(null);
    setRefereeExamOpen(false);
  };

  return {
    refereeDraft,
    refereeExamQuestions,
    refereeExamOpen,
    refereeExamAnswers,
    refereeExamResult,
    refereeRequests,
    canOpenRefereeRequestForm,
    refereeExamNotice,
    answeredRefereeExamCount,
    refereeExamRequired,
    refereeExamPassed,
    refereeExamLocked,
    refereeExamLockLabel,
    updateRefereeDraft,
    startRefereeExam,
    selectRefereeExamAnswer,
    submitRefereeExam,
    submitRefereeRequest,
  };
}
