import { useEffect, useMemo, useRef, useState } from "react";
import { REFEREE_TRUST_MIN } from "../lib/constants.js";
import { formatKoreanDateTime } from "../lib/matchUtils.js";
import { hasCompleteRefereeExamAnswers, REFEREE_EXAM_SIZE, REFEREE_EXAM_VERSION } from "../lib/refereeExamBank.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  DEFAULT_REFEREE_REQUEST,
  getLatestRefereeExamAttempt,
  getResumableRefereeExamAttempt,
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
  const [refereeActionPending, setRefereeActionPending] = useState("");
  const [refereeClock, setRefereeClock] = useState(() => Date.now());
  const refereeActionPendingRef = useRef("");
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
  const resumableRefereeExamAttempt = useMemo(
    () => getResumableRefereeExamAttempt(refereeExamAttempts, app.currentUserId),
    [app.currentUserId, refereeExamAttempts],
  );
  const refereeExamLockedUntilMs = latestRefereeExamAttempt?.availableAfter ? new Date(latestRefereeExamAttempt.availableAfter).getTime() : 0;
  const refereeExamLocked = !resumableRefereeExamAttempt && Number.isFinite(refereeExamLockedUntilMs) && refereeExamLockedUntilMs > refereeClock;
  const refereeExamLockLabel = refereeExamLocked ? formatKoreanDateTime(latestRefereeExamAttempt.availableAfter) : "";

  useEffect(() => {
    if (!Number.isFinite(refereeExamLockedUntilMs) || refereeExamLockedUntilMs <= 0) return undefined;
    const remaining = refereeExamLockedUntilMs - Date.now();
    if (remaining <= 0) {
      if (refereeClock < refereeExamLockedUntilMs) setRefereeClock(Date.now());
      return undefined;
    }
    const timer = window.setTimeout(() => setRefereeClock(Date.now()), Math.min(remaining + 50, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [refereeClock, refereeExamLockedUntilMs]);

  useEffect(() => {
    if (!resumableRefereeExamAttempt || currentRefereeExamAttemptId || refereeExamOpen || refereeExamResult) return;
    setCurrentRefereeExamAttemptId(resumableRefereeExamAttempt.id);
    setRefereeExamQuestions(resumableRefereeExamAttempt.questions);
    setRefereeExamAnswers({});
    setRefereeExamNotice("중단된 심판 시험을 이어서 진행합니다.");
    setRefereeExamOpen(true);
  }, [currentRefereeExamAttemptId, refereeExamOpen, refereeExamResult, resumableRefereeExamAttempt]);

  const beginRefereeAction = (action) => {
    if (refereeActionPendingRef.current) return false;
    refereeActionPendingRef.current = action;
    setRefereeActionPending(action);
    return true;
  };
  const endRefereeAction = () => {
    refereeActionPendingRef.current = "";
    setRefereeActionPending("");
  };

  const updateRefereeDraft = (patch) => setRefereeDraft((current) => ({ ...current, ...patch }));
  const startRefereeExam = async () => {
    if (refereeActionPendingRef.current) return;
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
    if (resumableRefereeExamAttempt) {
      setCurrentRefereeExamAttemptId(resumableRefereeExamAttempt.id);
      setRefereeExamQuestions(resumableRefereeExamAttempt.questions);
      setRefereeExamAnswers({});
      setRefereeExamResult(null);
      setRefereeExamNotice("중단된 심판 시험을 이어서 진행합니다.");
      setRefereeExamOpen(true);
      return;
    }
    if (refereeExamLocked) {
      setRefereeExamNotice(`심판 시험은 주 1회만 가능합니다. 다음 응시 가능: ${refereeExamLockLabel}`);
      return;
    }
    if (!beginRefereeAction("start")) return;
    const attemptId = makeRefereeAttemptId();
    setRefereeExamNotice("시험을 불러오는 중입니다.");
    try {
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
    } catch {
      setRefereeExamNotice("심판 시험을 시작하지 못했습니다.");
    } finally {
      endRefereeAction();
    }
  };
  const selectRefereeExamAnswer = (questionId, answerIndex) => {
    if (refereeExamResult || refereeActionPendingRef.current) return;
    setRefereeExamAnswers((current) => ({ ...current, [questionId]: answerIndex }));
  };
  const submitRefereeExam = async () => {
    if (refereeActionPendingRef.current) return;
    if (!currentRefereeExamAttemptId) {
      setRefereeExamNotice("진행 중인 시험이 없습니다.");
      return;
    }
    const questionIds = refereeExamQuestions.map((question) => question.id);
    if (!hasCompleteRefereeExamAnswers(questionIds, refereeExamAnswers)) {
      setRefereeExamNotice(`모든 ${REFEREE_EXAM_SIZE}문항에 답해 주세요.`);
      return;
    }
    if (!beginRefereeAction("finish")) return;
    setRefereeExamNotice("심판 시험을 채점하는 중입니다.");
    try {
      const result = await app.actions.finishRefereeExamAttempt(currentRefereeExamAttemptId, { answers: refereeExamAnswers });
      if (!result) {
        setRefereeExamNotice("심판 시험 채점에 실패했습니다.");
        return;
      }
      setRefereeExamResult(result);
      setRefereeExamNotice("");
    } catch {
      setRefereeExamNotice("심판 시험 채점에 실패했습니다.");
    } finally {
      endRefereeAction();
    }
  };
  const submitRefereeRequest = async (event) => {
    event.preventDefault();
    if (!beginRefereeAction("request")) return;
    setRefereeExamNotice("심판 등록요청 저장 중입니다.");
    try {
      const result = await app.actions.submitRefereeRequest({
        ...refereeDraft,
        examVersion: REFEREE_EXAM_VERSION,
        examScore: refereeExamResult?.score ?? 0,
        examTotal: refereeExamResult?.total ?? REFEREE_EXAM_SIZE,
        examPassed: refereeDraft.qualification === "official_license" ? false : refereeExamPassed,
        examAttemptId: currentRefereeExamAttemptId,
      });
      if (!result || result.ok === false) {
        setRefereeExamNotice("심판 등록요청을 저장하지 못했습니다. 입력 내용을 확인해 주세요.");
        return;
      }
      setRefereeDraft(DEFAULT_REFEREE_REQUEST);
      setCurrentRefereeExamAttemptId("");
      setRefereeExamQuestions([]);
      setRefereeExamAnswers({});
      setRefereeExamResult(null);
      setRefereeExamOpen(false);
      setRefereeExamNotice("심판 등록요청이 접수됐습니다.");
    } catch {
      setRefereeExamNotice("심판 등록요청을 저장하지 못했습니다. 입력 내용을 확인해 주세요.");
    } finally {
      endRefereeAction();
    }
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
    refereeActionPending,
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
