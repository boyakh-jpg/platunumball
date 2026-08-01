import { Link } from "react-router-dom";
import { CalendarDays, ChevronDown, ChevronUp, ClipboardCheck, PlusCircle } from "lucide-react";
import Button from "../components/common/Button.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import MatchListCard from "../components/match/MatchListCard.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { MATCH_MODES } from "../lib/constants.js";
import { REGION_TREE } from "../lib/profileSetup.js";
import { getRecruitingListCardLobby, getRecruitingRoomOwnerId, hasPendingRecruitingInvitation, isRecruitingPostForUser, isNationalRecruitingPost, isPaidRecruitingCourt } from "../lib/recruiting.js";
import { getRoomCompetitionLabel, getRoomRefereeLabel, getRoomVisibilityLabel, getRoomScheduleLabel } from "../lib/matchUtils.js";
import { getRecruitingCardTitle } from "../lib/recruitingPage.js";
import { QueueRoomBoard, RecruitingRoomLoadFailedView, RecruitingRoomLoadingView, RecruitingRoomModal, getRecruitingRoomListStatus, getRecruitingRoomTypeLabel } from "../components/recruiting/RecruitingRoomModal.jsx";

export default function RecruitingPageView({
  scopedPosts, rankedCount, friendlyCount, queueControlsOpen, posts,
  setQueueControlsOpen, regionFilterSido, selectRegionSido, selectedRegionDistrict, selectRegionDistrict,
  regionDistrictOptions, queue, setQueue, modeFilter, setModeFilter,
  startDateOptions, startFilter, selectStartFilter, startFilterLabel, app,
  userById, teamById, myTeamIds, courtById, courtByName,
  targetPostId, openSelectedPost, queueListLoading, selectedPostDetailFailed, closeSelectedPost,
  selectedPostRefreshRef, requestSelectedPostDetail, selectedPostId, selectedPost, selectedPostDetailLoading,
  navigate, location, setSelectedPostId, selectedPostPending,
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

    </div>
  );
}
