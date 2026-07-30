import { Link } from "react-router-dom";
import { BookOpen, Send, ShieldCheck } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import { REFEREE_EXAM_COOLDOWN_DAYS, REFEREE_TRUST_MIN } from "../lib/constants.js";
import { getAdminStatusLabel } from "../lib/admin.js";
import { REFEREE_EXAM_BANK_SIZE, REFEREE_EXAM_PASS_SCORE, REFEREE_EXAM_SIZE } from "../lib/refereeExamBank.js";

export default function SettingsRefereeSection({ controller }) {
  const {
    app,
    refereeDraft,
    refereeExamQuestions,
    refereeExamOpen,
    refereeExamAnswers,
    refereeExamResult,
    refereeRequests,
    currentTrustScore,
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
  } = controller;
  return (
<Card className="section-card settings-referee-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Referee</p>
                <h2>심판 등록요청</h2>
              </div>
              <ShieldCheck size={22} />
            </div>
            <div className="referee-rulebook-panel compact ui-design-info-surface">
              <div className="referee-rulebook-head">
                <div>
                  <span className="eyebrow">Study guide</span>
                  <strong>커뮤니티 심판 룰북</strong>
                  <p>문제 원문은 숨기고 판정 기준, 개인활약 기록 기준, 상황 예시만 따로 정리했다.</p>
                </div>
                <Badge tone="blue">학습자료</Badge>
              </div>
              <Button as={Link} variant="secondary" to="/app/referee-rulebook">
                <BookOpen size={16} /> 룰북 보기
              </Button>
            </div>
            {canOpenRefereeRequestForm ? (
              <>
                <div className="referee-exam-panel ui-design-info-surface">
                  <div className="referee-exam-summary">
                    <span><strong>{REFEREE_EXAM_BANK_SIZE}</strong>문제은행</span>
                    <span><strong>{REFEREE_EXAM_SIZE}</strong>문항</span>
                    <span><strong>{REFEREE_EXAM_PASS_SCORE}</strong>점 통과</span>
                  </div>
                  <p className={`referee-exam-lock ${refereeExamLocked ? "locked" : ""}`}>
                    {refereeExamLocked
                      ? `주 1회 제한 중 · 다음 응시 가능 ${refereeExamLockLabel}`
                      : `시험 시작 후 ${REFEREE_EXAM_COOLDOWN_DAYS}일 동안 재응시할 수 없습니다.`}
                  </p>
                  {refereeExamNotice ? <p className="referee-exam-lock locked">{refereeExamNotice}</p> : null}
                  <div className="referee-exam-actions">
                    <Button type="button" variant="secondary" onClick={startRefereeExam} disabled={refereeExamLocked || (refereeExamOpen && !refereeExamResult)}>
                      {refereeExamOpen && !refereeExamResult ? "시험 진행 중" : "심판 시험 시작"}
                    </Button>
                    {refereeExamResult ? (
                      <Badge tone={refereeExamResult.passed ? "green" : "orange"}>
                        {refereeExamResult.score}/{refereeExamResult.total} · {refereeExamResult.passed ? "통과" : "미통과"}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">{answeredRefereeExamCount}/{REFEREE_EXAM_SIZE}</Badge>
                    )}
                  </div>
                  {refereeExamOpen ? (
                    <div className="referee-exam-list ui-design-borderless-list">
                      {refereeExamQuestions.map((question) => (
                        <div key={question.id} className="referee-exam-question">
                          <strong>{question.number}. {question.stem}</strong>
                          <div className="referee-exam-choice-grid">
                            {question.choices.map((choice, index) => {
                              const review = refereeExamResult?.reviewedById?.[question.id];
                              const selected = refereeExamAnswers[question.id] === index;
                              const checked = Boolean(refereeExamResult);
                              const correct = checked && review?.answerIndex === index;
                              const wrong = checked && selected && review?.answerIndex !== index;
                              return (
                                <button
                                  key={choice}
                                  type="button"
                                  className={`${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                                  onClick={() => selectRefereeExamAnswer(question.id, index)}
                                >
                                  {choice}
                                </button>
                              );
                            })}
                          </div>
                          {refereeExamResult ? <small>{refereeExamResult.reviewedById?.[question.id]?.explanation}</small> : null}
                        </div>
                      ))}
                      <Button type="button" onClick={submitRefereeExam} disabled={answeredRefereeExamCount < REFEREE_EXAM_SIZE || Boolean(refereeExamResult)}>
                        채점하기
                      </Button>
                    </div>
                  ) : null}
                </div>
                <form className="form-stack" onSubmit={submitRefereeRequest}>
                  <label>
                    신청 유형
                    <select value={refereeDraft.qualification} onChange={(event) => updateRefereeDraft({ qualification: event.target.value })}>
                      <option value="community_exam">커뮤니티 심판 시험</option>
                      <option value="official_license">정식 라이선스 보유</option>
                    </select>
                  </label>
                  <label>
                    심판 경험
                    <input value={refereeDraft.experience} placeholder="예: 동호회 20경기, 학교대회 5경기" onChange={(event) => updateRefereeDraft({ experience: event.target.value })} />
                  </label>
                  <label>
                    메모
                    <textarea value={refereeDraft.memo} placeholder="자격증, 활동 지역, 가능한 시간 등을 적어 주세요." onChange={(event) => updateRefereeDraft({ memo: event.target.value })} />
                  </label>
                  <Button type="submit" variant="secondary" disabled={refereeExamRequired && !refereeExamPassed}>
                    <Send size={16} /> 심판 등록요청
                  </Button>
                  {refereeExamRequired && !refereeExamPassed ? <small>커뮤니티 심판은 시험 통과 후 등록요청할 수 있습니다.</small> : null}
                </form>
                <div className="compact-list ui-support-list">
                  {refereeRequests.slice(0, 4).map((request) => (
                    <div key={request.id}>
                      <span>
                        {request.qualification === "official_license" ? "정식 라이선스" : "커뮤니티 시험"} · 신뢰도 {request.trustScore}
                        {request.examTotal ? ` · 시험 ${request.examScore}/${request.examTotal}` : ""}
                      </span>
                      <strong>{getAdminStatusLabel(request.status)}</strong>
                    </div>
                  ))}
                  {!refereeRequests.length ? <div><span>요청한 심판 등록이 없습니다.</span><strong>신뢰도 {app.currentUser?.trustScore ?? 0}</strong></div> : null}
                </div>
              </>
            ) : (
              <div className="tier-range-note tier-range-note-warning ui-design-borderless-surface">
                <div>
                  <span>시험 제한</span>
                  <strong>신뢰도 {REFEREE_TRUST_MIN}점 이상 필요</strong>
                  <em>현재 신뢰도 {currentTrustScore}점입니다. 룰북은 누구나 볼 수 있습니다.</em>
                </div>
                <ShieldCheck size={18} />
              </div>
            )}
      </Card>
  );
}
