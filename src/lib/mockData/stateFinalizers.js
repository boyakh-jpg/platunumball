import { toHashtag } from "../handles.js";
import { DELETED_SYNTHETIC_COURT_IDS } from "./baseState.js";

export function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function normalizeDemoUserHashtag(user = {}) {
  const source = user.hashtag ?? user.handle ?? user.id;
  const legacyBrandHandle = String(source ?? "").match(/^[@#]?rankball(\d+)$/i);
  const hashtag = toHashtag(legacyBrandHandle ? `player${legacyBrandHandle[1]}` : source, user.id);
  return {
    ...user,
    handle: hashtag,
    hashtag,
  };
}

export function withCanonicalUserHashtags(state) {
  return {
    ...state,
    users: (state.users ?? []).map(normalizeDemoUserHashtag),
  };
}

export function withoutDeletedSyntheticCourts(state) {
  const clearDeletedCourtId = (item = {}) => (
    DELETED_SYNTHETIC_COURT_IDS.has(item.courtId)
      ? { ...item, courtId: null }
      : item
  );
  return {
    ...state,
    matches: (state.matches ?? []).map(clearDeletedCourtId),
    recruitingPosts: (state.recruitingPosts ?? []).map(clearDeletedCourtId),
    tournaments: (state.tournaments ?? []).map(clearDeletedCourtId),
    settings: {
      ...(state.settings ?? {}),
      favoriteCourtIds: (state.settings?.favoriteCourtIds ?? [])
        .filter((courtId) => !DELETED_SYNTHETIC_COURT_IDS.has(courtId)),
      approvedCourts: (state.settings?.approvedCourts ?? [])
        .filter((court) => !DELETED_SYNTHETIC_COURT_IDS.has(court?.id)),
    },
  };
}

export function withDemoRefereeQualifications(state) {
  const demoReferees = [
    { userId: "u1", grade: "official", matchCount: 26, reportCount: 0, thumbsUp: 41 },
    { userId: "u11", grade: "gold", matchCount: 18, reportCount: 1, thumbsUp: 24 },
  ];
  const refereeIds = new Set(demoReferees.map((item) => item.userId));
  const refereeAppointmentsToAdd = demoReferees.map((item) => ({
    id: `demo-referee-${item.userId}`,
    role: "referee",
    grade: item.grade,
    userId: item.userId,
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2030-12-31T23:59:59.000Z",
    appointedBy: "u1",
    reason: "데모 심판 테스트 계정",
    createdAt: "2026-06-17T09:00:00.000Z",
  }));
  const refereeAppointments = state.settings?.refereeAppointments ?? [];
  const existingRefereeAppointmentIds = new Set(refereeAppointments.map((appointment) => appointment.id));
  const existingRefereeAppointmentUserIds = new Set(refereeAppointments.map((appointment) => appointment.userId));

  return {
    ...state,
    users: (state.users ?? []).map((user) => {
      if (!refereeIds.has(user.id)) return user;
      const demoReferee = demoReferees.find((item) => item.userId === user.id);
      return {
        ...user,
        refereeGrade: user.refereeGrade ?? demoReferee.grade,
        refereeProfile: {
          grade: demoReferee.grade,
          status: "active",
          matchCount: demoReferee.matchCount,
          reportCount: demoReferee.reportCount,
          thumbsUp: demoReferee.thumbsUp,
          ...(user.refereeProfile ?? {}),
        },
      };
    }),
    settings: {
      ...(state.settings ?? {}),
      refereeAppointments: [
        ...refereeAppointmentsToAdd.filter((appointment) => (
          !existingRefereeAppointmentIds.has(appointment.id) &&
          !existingRefereeAppointmentUserIds.has(appointment.userId)
        )),
        ...refereeAppointments,
      ],
    },
  };
}
