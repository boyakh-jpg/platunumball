import { COURT_REQUEST_TRUST_MIN } from "../../lib/constants.js";
import { REFEREE_EXAM_COOLDOWN_MS } from "../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../lib/constants.js";
import { findCourtDuplicate } from "../../lib/courts.js";
import { getCourtCanonicalName } from "../../lib/courts.js";
import { getCourtDuplicateMessage } from "../../lib/courts.js";
import { getCourtFacilityBaseName } from "../../lib/courts.js";
import { getCourtLocationMatches } from "../../lib/courts.js";
import { getCourtReservationValue } from "../../lib/courts.js";
import { getOptionalCourtCoordinate } from "../../lib/courts.js";
import { makeId } from "../rowUtils.js";
import { makeRandomCourtHashtag } from "../../lib/courts.js";
import { normalizeCourtAccessType } from "../../lib/courts.js";
import { normalizeCourtFacilityName } from "../../lib/courts.js";
import { normalizeCourtHashtag } from "../../lib/courts.js";
import { normalizeCourtKind } from "../../lib/courts.js";
import { normalizeCourtLayout } from "../../lib/courts.js";
import { normalizeCourtNamePart } from "../../lib/courts.js";
import { normalizeCourtOptionalBoolean } from "../../lib/courts.js";
import { normalizeCourtPublicAccess } from "../../lib/courts.js";
import { normalizeCourtSigungu } from "../../lib/courts.js";
import { normalizeCourtSourceUrl } from "../../lib/courts.js";
import { normalizeCourtSurfaceType } from "../../lib/courts.js";
import { normalizeCourtType } from "../../lib/courts.js";
import { normalizeStateSettings as normalizeSettings } from "../stateNormalizer.js";
import { getDisciplineBlockedState } from "./guards.js";

function getCourtAddressDong(draft = {}) {
  const direct = String(draft.addressDong ?? draft.bname ?? draft.hname ?? "").trim();
  if (direct) return direct;
  const addressText = String(draft.addressText ?? draft.roadAddress ?? draft.jibunAddress ?? "").trim();
  return addressText.match(/[가-힣0-9]+동/)?.[0] ?? "";
}

export function submitCourtRequest(state, draft = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 등록요청");
  if (disciplineBlock) return disciplineBlock;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const trustScore = Number(currentUser?.trustScore ?? 0);
  if (trustScore < COURT_REQUEST_TRUST_MIN) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 등록 제한",
          body: `구장 등록요청은 신뢰도 ${COURT_REQUEST_TRUST_MIN}점 이상부터 가능합니다. 현재 ${trustScore}점입니다.`,
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const rawName = normalizeCourtFacilityName(draft.buildingName || draft.facilityName || draft.name);
  const addressDong = getCourtAddressDong(draft);
  const courtUnit = normalizeCourtNamePart(draft.courtUnit);
  const addressText = String(draft.addressText ?? "").trim();
  const sigungu = normalizeCourtSigungu(draft.sigungu, addressText, draft.sido, draft.region);
  const facilityName = getCourtFacilityBaseName(rawName, sigungu, courtUnit);
  const name = getCourtCanonicalName({ ...draft, name: facilityName, facilityName, sigungu, courtUnit }, state);
  const canonicalBaseName = name;
  const lat = getOptionalCourtCoordinate(draft.lat, -90, 90);
  const lng = getOptionalCourtCoordinate(draft.lng, -180, 180);
  if (!facilityName || !sigungu || !addressText || lat === null || lng === null) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 등록 보류",
          body: "구장명과 핀 기준 실제 주소·좌표는 필요합니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const sameLocationCourts = getCourtLocationMatches({ ...draft, name, canonicalBaseName, addressText }, state);
  if (sameLocationCourts.length && !courtUnit) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "코트 구분 필요",
          body: "같은 장소에 등록된 구장이 있습니다. 물리적으로 다른 코트라면 번호나 구분을 입력해 주세요.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const duplicateCourt = findCourtDuplicate({ ...draft, name, canonicalBaseName, addressText }, state);
  if (duplicateCourt) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 중복",
          body: getCourtDuplicateMessage(duplicateCourt),
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const hashtag = normalizeCourtHashtag(draft.hashtag) || makeRandomCourtHashtag(state);
  const type = normalizeCourtType(draft.type);
  const accessType = normalizeCourtAccessType(draft.accessType, draft.reservation);
  const publicAccess = normalizeCourtPublicAccess(draft.publicAccess);

  const request = {
    id: makeId("cr"),
    status: "pending",
    requestedBy: state.currentUserId,
    requestedByTrustScore: trustScore,
    name,
    baseName: facilityName,
    buildingName: normalizeCourtFacilityName(draft.buildingName),
    facilityName,
    courtUnit,
    canonicalBaseName,
    hashtag,
    region: String(draft.region ?? "").trim() || addressDong || currentUser?.region || "미정",
    sido: String(draft.sido ?? "").trim(),
    sigungu,
    type,
    addressText,
    roadAddress: String(draft.roadAddress ?? "").trim(),
    jibunAddress: String(draft.jibunAddress ?? "").trim(),
    addressDong,
    searchAddressText: String(draft.searchAddressText ?? "").trim(),
    zonecode: String(draft.zonecode ?? "").trim(),
    detailAddress: String(draft.detailAddress ?? "").trim(),
    locationNote: String(draft.locationNote ?? "").trim(),
    lat,
    lng,
    courtKind: normalizeCourtKind(draft.courtKind),
    surfaceType: normalizeCourtSurfaceType(draft.surfaceType),
    courtLayout: normalizeCourtLayout(draft.courtLayout),
    accessType,
    publicAccess,
    reservation: getCourtReservationValue({ accessType }),
    lighting: type === "야외" ? normalizeCourtOptionalBoolean(draft.lighting) : null,
    paid: normalizeCourtOptionalBoolean(draft.paid),
    sourceUrl: normalizeCourtSourceUrl(draft.sourceUrl),
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      courtRequests: [request, ...(state.settings?.courtRequests ?? [])],
    }),
    notifications: [
      {
        id: makeId("n"),
        title: "구장 등록요청",
        body: `${request.name} 등록요청이 접수됐습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

function getLatestRefereeExamAttempt(settings = {}, userId) {
  return [...(settings.refereeExamAttempts ?? [])]
    .filter((attempt) => attempt.userId === userId)
    .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime())[0] ?? null;
}

function hashAttemptSeed(value = "") {
  return Array.from(String(value)).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0).toString(36);
}

function getRefereeExamLockNotification(availableAfter) {
  return {
    id: makeId("n"),
    title: "심판 시험 제한",
    body: `심판 시험은 주 1회만 가능합니다. 다음 응시 가능: ${new Date(availableAfter).toLocaleString("ko-KR")}`,
    tone: "orange",
  };
}

export function startRefereeExamAttempt(state, draft = {}) {
  const now = Date.now();
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const trustScore = Number(currentUser?.trustScore ?? 0);
  if (trustScore < REFEREE_TRUST_MIN) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 시험 제한",
          body: `심판 시험은 신뢰도 ${REFEREE_TRUST_MIN}점 이상부터 가능합니다. 현재 ${trustScore}점입니다.`,
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const latestAttempt = getLatestRefereeExamAttempt(state.settings, state.currentUserId);
  const lockedUntil = latestAttempt?.availableAfter ? new Date(latestAttempt.availableAfter).getTime() : 0;
  if (Number.isFinite(lockedUntil) && lockedUntil > now) {
    return {
      ...state,
      notifications: [getRefereeExamLockNotification(latestAttempt.availableAfter), ...state.notifications],
    };
  }

  const startedAt = new Date(now).toISOString();
  const attempt = {
    id: String(draft.id || makeId("rea")),
    userId: state.currentUserId,
    status: "started",
    examVersion: String(draft.examVersion ?? ""),
    seedHash: hashAttemptSeed(draft.seed),
    startedAt,
    availableAfter: new Date(now + REFEREE_EXAM_COOLDOWN_MS).toISOString(),
  };

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      refereeExamAttempts: [attempt, ...(state.settings?.refereeExamAttempts ?? [])],
    }),
  };
}

export function finishRefereeExamAttempt(state, attemptId, result = {}) {
  const attempts = state.settings?.refereeExamAttempts ?? [];
  const target = attempts.find((attempt) => attempt.id === attemptId && attempt.userId === state.currentUserId);
  if (!target) return state;

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      refereeExamAttempts: attempts.map((attempt) => (
        attempt.id === attemptId
          ? {
              ...attempt,
              status: result.passed ? "passed" : "failed",
              score: Math.max(0, Number(result.score ?? 0)),
              total: Math.max(0, Number(result.total ?? 0)),
              passed: Boolean(result.passed),
              finishedAt: new Date().toISOString(),
            }
          : attempt
      )),
    }),
  };
}

export function submitRefereeRequest(state, draft = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "심판 등록요청");
  if (disciplineBlock) return disciplineBlock;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const trustScore = Number(currentUser?.trustScore ?? 0);
  if (trustScore < REFEREE_TRUST_MIN) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 등록 제한",
          body: `심판 등록요청은 신뢰도 ${REFEREE_TRUST_MIN}점 이상부터 가능합니다. 현재 ${trustScore}점입니다.`,
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const qualification = draft.qualification === "official_license" ? "official_license" : "community_exam";
  const experience = String(draft.experience ?? "").trim();
  const memo = String(draft.memo ?? "").trim();
  const examScore = Math.max(0, Number(draft.examScore ?? 0));
  const examTotal = Math.max(0, Number(draft.examTotal ?? 0));
  const passedAttempt = (state.settings?.refereeExamAttempts ?? []).find((attempt) => (
    attempt.id === draft.examAttemptId &&
    attempt.userId === state.currentUserId &&
    attempt.examVersion === draft.examVersion &&
    attempt.passed === true
  ));

  if (qualification === "community_exam" && !passedAttempt) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 등록 보류",
          body: "통과한 심판 시험 기록이 있어야 커뮤니티 심판 등록요청이 가능합니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const request = {
    id: makeId("rr"),
    status: "pending",
    requestedBy: state.currentUserId,
    qualification,
    experience,
    memo,
    examVersion: String(draft.examVersion ?? ""),
    examScore,
    examTotal,
    examPassed: qualification === "community_exam" ? true : Boolean(draft.examPassed),
    examAttemptId: passedAttempt?.id ?? "",
    trustScore,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      refereeRequests: [request, ...(state.settings?.refereeRequests ?? [])],
    }),
    notifications: [
      {
        id: makeId("n"),
        title: "심판 등록요청",
        body: `${currentUser?.name ?? "플레이어"} 심판 등록요청을 접수했습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}
