import { Link } from "react-router-dom";
import { CalendarDays, ChevronDown, ChevronUp, ClipboardCheck, Clock3, PlusCircle, ShieldCheck, X } from "lucide-react";
import Button from "../components/common/Button.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import MatchListCard from "../components/match/MatchListCard.jsx";
import MmrRangeSelector from "../components/match/MmrRangeSelector.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { MATCH_MODES, PLAYER_POSITIONS, REGIONS, isSameRegion } from "../lib/constants.js";
import { REGION_TREE } from "../lib/profileSetup.js";
import { getRecruitingListCardLobby, getRecruitingRoomOwnerId, hasPendingRecruitingInvitation, isRecruitingPostForUser, isNationalRecruitingPost, isPaidRecruitingCourt } from "../lib/recruiting.js";
import { getRecruitingTeamRepresentativePlayerIds as getTeamRepresentativePlayerIds } from "../lib/teamPartyRoster.js";
import { getRoomCompetitionLabel, getRoomRefereeLabel, getRoomVisibilityLabel, getRoomScheduleLabel } from "../lib/matchUtils.js";
import { getDefaultRecruitingTitle as getDefaultTitle, getRecruitingCardTitle } from "../lib/recruitingPage.js";
import { QueueRoomBoard, RecruitingRoomLoadFailedView, RecruitingRoomLoadingView, RecruitingRoomModal, getRecruitingRoomListStatus, getRecruitingRoomTypeLabel } from "../components/recruiting/RecruitingRoomModal.jsx";

export default function RecruitingPageView({
  scopedPosts, rankedCount, friendlyCount, queueControlsOpen, posts,
  setQueueControlsOpen, regionFilterSido, selectRegionSido, selectedRegionDistrict, selectRegionDistrict,
  regionDistrictOptions, queue, setQueue, modeFilter, setModeFilter,
  startDateOptions, startFilter, selectStartFilter, startFilterLabel, app,
  userById, teamById, myTeamIds, courtById, courtByName,
  targetPostId, openSelectedPost, queueListLoading, selectedPostDetailFailed, closeSelectedPost,
  selectedPostRefreshRef, requestSelectedPostDetail, selectedPostId, selectedPost, selectedPostDetailLoading,
  navigate, location, setSelectedPostId, selectedPostPending, composeOpen,
  setComposeOpen, submit, draft, myTeams, update,
  draftRange, draftRangePolicy, draftInstant, minScheduleDate, maxScheduleDate,
  registeredCourts, draftCapacity, selectedHostPlayerIds, canPostRecruiting, hasSchedule,
  scheduleAllowed, draftTimingStatus,
}) {
  return (
    <div className="page-stack arena-recruit-page">
      <section className="arena-recruit-hero ui-design-app-hero">
        <div className="arena-hero-copy">
          <span className="arena-kicker">MATCH QUEUE</span>
          <h1>대기 매칭</h1>
          <p>공개 모집방을 확인할 수 있으며, 개인전과 팀전은 방을 만들 때 선택합니다.</p>
        </div>
        <div className="arena-hero-panel ui-liquid-glass">
          <div className="arena-hero-stats ui-liquid-glass-segments">
            <span><strong>{scopedPosts.length}</strong>OPEN</span>
            <span><strong>{rankedCount}</strong>RANKED</span>
            <span><strong>{friendlyCount}</strong>FRIENDLY</span>
          </div>
          <div className="arena-hero-actions">
            <Button as={Link} to="/app/create" className="ui-button-block">
              <PlusCircle size={18} /> 매칭 만들기
            </Button>
            <Button as={Link} to="/app/create?intent=record" className="ui-button-block">
              <ClipboardCheck size={18} /> 경기 기록하기
            </Button>
          </div>
        </div>
      </section>

      <section className={queueControlsOpen ? "arena-queue-controls ui-design-soft-surface" : "arena-queue-controls ui-design-soft-surface collapsed"}>
        <div className="arena-queue-controls-head">
          <div>
            <span className="arena-kicker">QUEUE FILTER</span>
            <strong>매치방 · {posts.length}개 표시</strong>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="button-icon section-disclosure-button"
            aria-expanded={queueControlsOpen}
            aria-controls="recruiting-queue-filters"
            aria-label={queueControlsOpen ? "필터 접기" : "필터 펼치기"}
            title={queueControlsOpen ? "필터 접기" : "필터 펼치기"}
            onClick={() => setQueueControlsOpen((current) => !current)}
          >
            {queueControlsOpen ? <ChevronUp size={18} strokeWidth={2.5} /> : <ChevronDown size={18} strokeWidth={2.5} />}
          </Button>
        </div>

        {queueControlsOpen ? (
          <>
            <section id="recruiting-queue-filters" className="arena-filter-bar" aria-label="필터">
              <label className="arena-filter-select arena-region-sido-filter">
                <select aria-label="시도" value={regionFilterSido} onChange={selectRegionSido}>
                  {REGION_TREE.map((region) => <option key={region.sido} value={region.sido}>{region.sido}</option>)}
                </select>
              </label>
              <label className="arena-filter-select arena-region-district-filter">
                <select aria-label="시군구" value={selectedRegionDistrict} onChange={selectRegionDistrict}>
                  {regionDistrictOptions.map((district) => <option key={district} value={district}>{district}</option>)}
                </select>
              </label>
              <div className="segmented-control compact-segments arena-filter-segment">
                <button type="button" className={queue === "all" ? "active" : ""} onClick={() => setQueue("all")}>전체</button>
                <button type="button" className={queue === "ranked" ? "active" : ""} onClick={() => setQueue("ranked")}>정규전</button>
                <button type="button" className={queue === "friendly" ? "active" : ""} onClick={() => setQueue("friendly")}>친선전</button>
              </div>
              <label className="arena-filter-select arena-mode-filter">
                <select aria-label="경기 방식" value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
                  <option value="all">전체 방식</option>
                  {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                </select>
              </label>
              <div className="arena-start-date-filter" aria-label="start date">
                {startDateOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={[
                      startFilter === option.id ? "active" : "",
                      option.weekend === "sat" ? "sat" : "",
                      option.weekend === "sun" ? "sun" : "",
                    ].filter(Boolean).join(" ")}
                    aria-pressed={startFilter === option.id}
                    onClick={() => selectStartFilter(option.id)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.subLabel}</span>
                  </button>
                ))}
              </div>
              <span className="arena-filter-count">{posts.length}개 표시</span>
            </section>
          </>
        ) : (
          <div id="recruiting-queue-filters" className="arena-queue-summary">
            <span>{`${regionFilterSido} ${selectedRegionDistrict}`}</span>
            <span>{queue === "ranked" ? "정규전" : queue === "friendly" ? "친선전" : "전체"}</span>
            <span>{modeFilter === "all" ? "전체 방식" : MATCH_MODES.find((mode) => mode.id === modeFilter)?.label ?? modeFilter}</span>
            <span>{startFilterLabel}</span>
          </div>
        )}
      </section>

      <section className="arena-recruit-list" aria-label="매치 큐 목록">
        {posts.length ? posts.map((post) => {
          const lobby = getRecruitingListCardLobby(post, app.state);
          const roomOwnerId = getRecruitingRoomOwnerId(post);
          const host = userById[roomOwnerId] ?? userById[post.playerId];
          const hostTeam = post.teamId ? teamById[post.teamId] : null;
          const targetTeam = post.targetTeamId ? teamById[post.targetTeamId] : null;
          const hostName = host?.name ?? post.hostName ?? "방장";
          const hostTeamName = hostTeam?.name ?? post.hostTeamName ?? "";
          const mine = roomOwnerId === app.currentUser.id;
          const myRoom = isRecruitingPostForUser(post, app.currentUser.id, myTeamIds);
          const invited = hasPendingRecruitingInvitation(post, app.currentUser.id);
          const roomTag = "";
          const refereeLabel = getRoomRefereeLabel(post);
          const roomStatus = getRecruitingRoomListStatus(lobby, { post });
          const roomTitle = getRecruitingCardTitle(post);
          const postCourt = courtById[post.courtId] ?? courtByName[post.court] ?? null;

          return (
            <MatchListCard
              id={`recruiting-room-${post.id}`}
              key={post.id}
              className={`${myRoom ? "arena-my-room" : ""} ${invited ? "arena-invited-room" : ""} ${targetPostId === post.id ? "arena-target-room" : ""}`}
              status={roomStatus}
              mode={post.mode}
              visibility={getRoomVisibilityLabel(post)}
              roomType={getRecruitingRoomTypeLabel(post, lobby)}
              competition={getRoomCompetitionLabel(post)}
              referee={refereeLabel}
              extraBadges={[
                roomTag ? { kind: "relation", label: roomTag } : null,
                targetTeam ? { kind: "target", label: <>희망 상대 <TeamHoverCard team={targetTeam} as="span">{targetTeam.name}</TeamHoverCard></> } : null,
                !targetTeam && post.targetTeamName ? { kind: "target", label: `희망 상대 ${post.targetTeamName}` } : null,
                isNationalRecruitingPost(post, app.state) ? { kind: "national", label: "전국 노출" } : null,
                isPaidRecruitingCourt(post, postCourt) ? { kind: "cost", tone: "orange", label: "유료 구장" } : null,
              ].filter(Boolean)}
              title={roomTitle}
              meta={(
                <>
                  <CalendarDays size={15} />
                  {getRoomScheduleLabel(post)} · <CourtHoverCard court={postCourt} courtName={post.court}>{post.court}</CourtHoverCard> ·{" "}
                  {hostTeam ? (
                    <TeamHoverCard team={hostTeam} as="span">{hostTeam.name}</TeamHoverCard>
                  ) : post.teamId && hostTeamName ? (
                    <span>{hostTeamName}</span>
                  ) : (
                    <PlayerHoverCard user={host} teams={app.state.teams} as="span">{hostName}</PlayerHoverCard>
                  )}
                </>
              )}
              summary={<QueueRoomBoard post={post} lobby={lobby} />}
              actionLabel={roomStatus.actionLabel}
              onOpen={() => openSelectedPost(post.id)}
              onAction={() => openSelectedPost(post.id)}
            />
          );
        }) : queueListLoading ? (
          <EmptyState
            tone="loading"
            title="매치방 불러오는 중"
            description="선택한 지역과 날짜의 공개방을 확인하고 있습니다."
          />
        ) : (
          <EmptyState
            title="조건에 맞는 매치방 없음"
            description="필터를 변경하거나 새 매치방을 만들어 보세요."
          />
        )}
      </section>

      {!app.recruitingPagination?.exhausted ? (
        <div className="om-load-more">
          <button type="button" className="button button-secondary button-md" disabled={app.recruitingPagination?.loading} onClick={() => app.actions.loadMoreRecruiting?.()}>
            {app.recruitingPagination?.loading ? "불러오는 중" : "더 보기"}
          </button>
          {app.recruitingPagination?.loadMoreError ? <span>모집방을 더 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</span> : null}
        </div>
      ) : null}

      {selectedPostDetailFailed ? (
        <RecruitingRoomLoadFailedView
          onClose={closeSelectedPost}
          onRetry={() => {
            selectedPostRefreshRef.current = "";
            requestSelectedPostDetail(selectedPostId);
          }}
        />
      ) : selectedPost && !selectedPostDetailLoading ? (
        <RecruitingRoomModal
          app={app}
          post={selectedPost}
          skipInitialDetailLoad
          onClose={closeSelectedPost}
          onOpenMatch={(matchId) => navigate(`/app/matches?match=${encodeURIComponent(matchId)}`, {
            state: { matchModalReturnTo: `${location.pathname}${location.search}` },
          })}
          onJoined={(postId) => {
            setSelectedPostId(postId);
            if (targetPostId !== postId) {
              navigate(`/app/recruiting?post=${encodeURIComponent(postId)}`, { replace: true });
            }
          }}
        />
      ) : selectedPostPending || selectedPostDetailLoading ? (
        <RecruitingRoomLoadingView onClose={closeSelectedPost} />
      ) : null}

      {composeOpen ? (
        <div className="arena-compose-backdrop" role="presentation" onMouseDown={() => setComposeOpen(false)}>
          <aside className="arena-compose-drawer" role="dialog" aria-modal="true" aria-label="매치방 만들기" onMouseDown={(event) => event.stopPropagation()}>
            <div className="arena-drawer-head">
              <div>
                <span className="arena-kicker">CREATE ROOM</span>
                <h2>매치방 만들기</h2>
              </div>
              <button type="button" className="arena-icon-button" aria-label="닫기" onClick={() => setComposeOpen(false)}><X size={20} /></button>
            </div>

            <form className="arena-compose-form" onSubmit={submit}>
              <div className="segmented-control compact-segments">
                <button
                  type="button"
                  className={draft.hostJoinMode === "team" ? "active" : ""}
                  onClick={() => {
                    const team = myTeams[0] ?? null;
                    update({
                      hostJoinMode: "team",
                      teamId: team?.id ?? "",
                      playerIds: getTeamRepresentativePlayerIds(team, app.currentUser.id),
                    });
                  }}
                >
                  내 팀으로 열기
                </button>
                <button type="button" className={draft.hostJoinMode === "player" ? "active" : ""} onClick={() => update({ hostJoinMode: "player", teamId: "", playerIds: [] })}>개인으로 열기</button>
              </div>

              <div className="segmented-control compact-segments">
                <button type="button" className={!draft.ranked ? "active" : ""} onClick={() => update({ ranked: false })}>친선전</button>
                <button type="button" className={draft.ranked ? "active" : ""} onClick={() => update({ ranked: true })}>정규전</button>
              </div>

              {draft.ranked ? (
                <div className="arena-range-control">
                  <div>
                    <span>정규전 허용구간</span>
                    <strong>{draftRange.label}</strong>
                    <em>{draftRange.detail}</em>
                  </div>
                  <MmrRangeSelector value={draft.mmrRangeMode} onChange={(mmrRangeMode) => update({ mmrRangeMode })} />
                  <small>{draftRangePolicy.detail} · 확정 경기만 서버 검증 후 반영</small>
                </div>
              ) : null}

              <label>
                제목
                <input value={draft.title} placeholder={getDefaultTitle(draft)} onChange={(event) => update({ title: event.target.value })} />
              </label>

              <div className="field-block">
                <span className="field-label">시간 옵션</span>
                <div className="segmented-control compact-segments">
                  <button type="button" className={draft.timingType === "scheduled" ? "active" : ""} onClick={() => update({ timingType: "scheduled" })}>일정 지정</button>
                  <button type="button" className={draft.timingType === "instant" ? "active" : ""} onClick={() => update({ timingType: "instant" })}>즉시</button>
                </div>
                <small>{draftInstant ? "지금 모집을 시작하며, 정원이 차면 바로 확정됩니다." : "공개 예약방은 5일 이내이면서 시작까지 4시간 이상 남은 일정만 만들 수 있습니다."}</small>
              </div>

              <div className="arena-field-grid">
                {!draftInstant ? (
                  <>
                    <label>
                      날짜
                      <input type="date" required min={minScheduleDate} max={maxScheduleDate} value={draft.scheduledDate} onChange={(event) => update({ scheduledDate: event.target.value })} />
                    </label>
                    <label>
                      시간
                      <input type="time" required value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
                    </label>
                  </>
                ) : (
                  <div className="arena-mini-note">
                    <div>
                      <span>일정</span>
                      <strong>즉시</strong>
                      <em>날짜/시간 입력 없음</em>
                    </div>
                    <Clock3 size={22} />
                  </div>
                )}
              </div>

              <div className="arena-field-grid three">
                <label>
                  지역
                  <select
                    value={draft.region}
                    onChange={(event) => {
                      const region = event.target.value;
                      const court = registeredCourts.find((item) => isSameRegion(item.region, region)) ?? null;
                      update({ region, courtId: court?.id ?? draft.courtId ?? "", court: court?.name ?? draft.court });
                    }}
                  >
                    {REGIONS.map((region) => <option key={region}>{region}</option>)}
                  </select>
                </label>
                <label>
                  방식
                  <select value={draft.mode} onChange={(event) => update({ mode: event.target.value })}>
                    {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                  </select>
                </label>
                <label>
                  장소
                  <select
                    value={draft.court}
                    onChange={(event) => {
                      const court = courtByName[event.target.value] ?? null;
                      update({ courtId: court?.id ?? "", court: event.target.value, ...(court?.region ? { region: court.region } : {}) });
                    }}
                  >
                    {registeredCourts.filter((court) => isSameRegion(court.region, draft.region) || draft.region === "전체").map((court) => (
                      <option key={court.id} value={court.name}>{court.region} · {court.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="arena-field-grid">
                {draft.hostJoinMode === "team" ? (
                  <div className="arena-party-field">
                    <label>
                      내 파티 팀
                      <select
                        value={draft.teamId}
                        onChange={(event) => {
                          const teamId = event.target.value;
                          const team = myTeams.find((item) => item.id === teamId) ?? null;
                          update({
                            teamId,
                            playerIds: getTeamRepresentativePlayerIds(team, app.currentUser.id),
                          });
                        }}
                      >
                        {myTeams.length ? myTeams.map((team) => (
                          <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>
                        )) : <option value="">내 팀 없음</option>}
                      </select>
                    </label>
                  </div>
                ) : (
                  <label>
                    내 포지션
                    <select value={draft.position} onChange={(event) => update({ position: event.target.value })}>
                      {PLAYER_POSITIONS.map((position) => <option key={position}>{position}</option>)}
                    </select>
                  </label>
                )}
                <div className="arena-mini-note">
                  <div>
                    <span>슬롯</span>
                    <strong>{draftCapacity} vs {draftCapacity}</strong>
                    <em>{draft.hostJoinMode === "team" ? `대표 ${selectedHostPlayerIds.length}명만 배치` : "개인 1명이 A사이드에 배치"}</em>
                  </div>
                  <ShieldCheck size={22} />
                </div>
              </div>

              <label>
                메모
                <textarea value={draft.memo} onChange={(event) => update({ memo: event.target.value })} />
              </label>

              <div className="arena-submit-row">
                <span className={canPostRecruiting ? "queue-note" : "form-warning"}>
                  <ShieldCheck size={17} /> {canPostRecruiting ? "등록 가능" : hasSchedule ? (scheduleAllowed ? "팀/팀원 선택 필요" : draftTimingStatus.detail) : "날짜/시간/장소 필요"}
                </span>
                <Button type="submit" disabled={!canPostRecruiting}><PlusCircle size={18} /> 등록</Button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
