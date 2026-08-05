import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, BookOpenCheck, CalendarDays, ClipboardCheck, PlusCircle } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import MatchCard from "../components/match/MatchCard.jsx";
import RecentMatchRow from "../components/match/RecentMatchRow.jsx";
import HomeRightRail from "../components/home/HomeRightRail.jsx";
import { isHomeGuideCardVisible } from "../data/settingsMappers.js";
import { assetUrl } from "../lib/assets.js";
import { getRoomScheduleLabel } from "../lib/matchUtils.js";
import { getProfileIcon } from "../lib/profileIcons.js";

const FOUNDING_PLAYER_ICON = getProfileIcon("341-founding-player-s0");

export default function HomePageView({
  query, setQuery, searchResults, mapRemoteHomeSearchItem, homeFavoriteSearchItems,
  renderHomeSearchItem, SEARCH_PREVIEW_LIMIT, SEARCH_DETAIL_LIMIT, user, getPlayerRatingSummary,
  nextUpcomingMatch, openMatchRoom, nextUpcomingLine, upcomingItems, recentFiveWins,
  mySeasonIndex, app, registeredCourts, myCompletedMatches, getUserResult,
  latestMyMatches, getUserMatchLine, acceptHomeRecruitingInvitation, actionItems, declineHomeRecruitingInvitation,
  homeNoticeItems, localRivals, mySeasonRow, myTeamCount, myTeams,
  openActionRoom, placementComplete, priorityItems, priorityNoticeItems, processingInviteId, inviteActionError,
  rankSpotlightLabel, seasonProgress, topRankers, homeRoomOverlays,
}) {
  return (
    <div className="page-stack rank-home">
      <Card className="home-search-panel rank-search-card">
        <SearchPicker
          value={query}
          onChange={setQuery}
          placeholder="이름, 팀명, 코트명, 해시태그를 바로 검색"
          items={searchResults}
          remoteSearchType="all"
          mapRemoteItem={mapRemoteHomeSearchItem}
          idleItems={homeFavoriteSearchItems}
          idleTitle="즐겨찾기"
          showIdleOnFocus
          floating
          floatingHeightLimit={380}
          preferAboveOnMobile
          renderItem={renderHomeSearchItem}
          limit={SEARCH_PREVIEW_LIMIT}
          detailLimit={SEARCH_DETAIL_LIMIT}
          fieldClassName="home-search-box"
          resultsClassName="home-global-search-results"
        />
        <div className="home-search-actions">
          <Button as={Link} to="/app/create" className="home-search-create ui-button-block"><PlusCircle size={18} /> 매칭 만들기</Button>
          <Button as={Link} to="/app/create?intent=record" variant="secondary" className="home-search-create ui-button-block"><ClipboardCheck size={18} /> 경기 기록하기</Button>
        </div>
      </Card>

      <div className="page-stack home-left-rail">
        <section className="rank-summary-grid ui-page-hero ui-design-app-hero">
          <div className="home-rank-board-head">
            <div className="rank-hero-top ui-page-hero__copy">
              <div>
                <p className="eyebrow">내 랭크 보드</p>
                <h1>{user.name}님의 오늘 코트 현황</h1>
                <p>{user.region} · {user.position} · 통합 {getPlayerRatingSummary(user)}</p>
              </div>
            </div>
            <aside className="home-hero-board ui-liquid-glass" aria-label="내 코트 요약">
              <Link
                className="home-hero-next"
                to={nextUpcomingMatch ? `/app/matches?match=${nextUpcomingMatch.id}` : "/app/recruiting"}
                onClick={nextUpcomingMatch ? (event) => {
                  event.preventDefault();
                  openMatchRoom(nextUpcomingMatch.id);
                } : undefined}
              >
                <span><CalendarDays size={16} /> {nextUpcomingMatch ? "NEXT MATCH" : "COURT OPEN"}</span>
                <strong>{nextUpcomingLine ? `${nextUpcomingLine.side.name} vs ${nextUpcomingLine.opponent.name}` : "예정된 경기 없음"}</strong>
                <em>{nextUpcomingMatch ? `${getRoomScheduleLabel(nextUpcomingMatch)} · ${nextUpcomingMatch.court || "구장 미정"}` : "새 매칭을 찾아 다음 경기를 잡으세요."}</em>
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
              <div className="home-hero-stats">
                <span><strong>{upcomingItems.length}</strong><em>확정 경기</em></span>
                <span><strong>{recentFiveWins}승</strong><em>최근 5경기</em></span>
                <span><strong>{mySeasonIndex >= 0 ? `${mySeasonIndex + 1}위` : "대기"}</strong><em>지역 순위</em></span>
              </div>
            </aside>
          </div>
        </section>

        <Card
          as={Link}
          to={user.foundingPlayer ? "/app/profile#icons" : "/app/signup"}
          className="home-guide-card home-season-zero-card"
          aria-label={user.foundingPlayer ? "FOUNDING PLAYER 시즌 제로 업적 아이콘 선택" : "시즌 제로 특전 받기"}
        >
          <span className="home-guide-card__icon">
            <img src={assetUrl(FOUNDING_PLAYER_ICON.src)} alt="" width="40" height="40" decoding="async" />
          </span>
          <span className="home-guide-card__copy">
            <small>SEASON ZERO · EARLY PLAYER</small>
            <strong>{user.foundingPlayer ? "FOUNDING PLAYER 특전 지급 완료" : "프로필 완성하고 창립 선수 특전 받기"}</strong>
          </span>
          <span className="home-guide-card__path" aria-hidden="true">
            <b>JOIN</b>
            <i>→</i>
            <b>PROFILE</b>
            <i>→</i>
            <b>S0</b>
          </span>
          <span className="home-guide-card__link">
            {user.foundingPlayer ? "아이콘 선택" : "특전 받기"}
            <ArrowRight size={18} aria-hidden="true" />
          </span>
        </Card>

        {isHomeGuideCardVisible(app.state.settings) ? (
          <Card
            as={Link}
            to="/app/guide"
            className="home-guide-card"
            aria-label="BOXTIER 처음 사용 설명 보기"
          >
            <span className="home-guide-card__icon">
              <BookOpenCheck size={24} aria-hidden="true" />
            </span>
            <span className="home-guide-card__copy">
              <small>FIRST STEP · 13단계 안내</small>
              <strong>처음 사용하시나요?</strong>
            </span>
            <span className="home-guide-card__path" aria-hidden="true">
              <b>PLAY</b>
              <i>→</i>
              <b>RECORD</b>
              <i>→</i>
              <b>TIER</b>
            </span>
            <span className="home-guide-card__link">
              사용 설명
              <ArrowRight size={18} aria-hidden="true" />
            </span>
          </Card>
        ) : null}

        <div className="content-grid home-dashboard-grid rank-dashboard-grid">
          <div className="page-stack home-primary-stack">
            <Card className={`match-focus-card home-upcoming-card ui-design-category-surface${upcomingItems.length ? "" : " is-empty"}`}>
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Upcoming</p>
                  <h2>내 확정 경기</h2>
                </div>
                <Badge tone={upcomingItems.length ? "orange" : "neutral"}>{upcomingItems.length}개</Badge>
              </div>
              {upcomingItems.length ? (
                <div className="match-stack">
                  {upcomingItems.slice(0, 3).map((entry) => {
                    return <MatchCard key={entry.id} match={entry.item} teams={app.state.teams} courts={registeredCourts} onOpen={openMatchRoom} />;
                  })}
                  {upcomingItems.length > 3 ? (
                    <Button as={Link} to="/app/matches" variant="secondary" size="sm" className="home-upcoming-more">전체 보기</Button>
                  ) : null}
                </div>
              ) : (
                <div className="ui-empty-state-compact">확정 경기 없음</div>
              )}
            </Card>

            <Card className="section-card home-recent-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Recent Matches</p>
                  <h2>내 최근 전적</h2>
                </div>
                <Badge tone={myCompletedMatches.length ? "green" : "neutral"}>{myCompletedMatches.length}경기</Badge>
              </div>
              {myCompletedMatches.length ? (
                <>
                  <div className="recent-result-strip">
                    {myCompletedMatches.slice(0, 8).map((match) => {
                      const result = getUserResult(match, user.id);
                      return (
                        <Link
                          key={match.id}
                          to={`/app/matches?match=${match.id}`}
                          className={`recent-result-pill result-${result.toLowerCase()}`}
                          onClick={(event) => {
                            event.preventDefault();
                            openMatchRoom(match.id);
                          }}
                        >
                          {result}
                        </Link>
                      );
                    })}
                  </div>
                  <div className="recent-match-list">
                    {latestMyMatches.map((match) => {
                      const line = getUserMatchLine(match, user.id);
                      return (
                        <RecentMatchRow
                          key={match.id}
                          record={match}
                          result={line.result}
                          side={line.side}
                          opponent={line.opponent}
                          score={line.score}
                          opponentScore={line.opponentScore}
                          teams={app.state.teams}
                          to={`/app/matches?match=${match.id}`}
                          onOpen={() => openMatchRoom(match.id)}
                        />
                      );
                    })}
                  </div>
                </>
              ) : <div className="ui-empty-state-compact home-panel-empty">최근 확정 경기 없음</div>}
            </Card>
          </div>
        </div>
      </div>

      <HomeRightRail
        acceptHomeRecruitingInvitation={acceptHomeRecruitingInvitation}
        actionItems={actionItems}
        app={app}
        declineHomeRecruitingInvitation={declineHomeRecruitingInvitation}
        homeNoticeItems={homeNoticeItems}
        localRivals={localRivals}
        mySeasonIndex={mySeasonIndex}
        mySeasonRow={mySeasonRow}
        myTeamCount={myTeamCount}
        myTeams={myTeams}
        openActionRoom={openActionRoom}
        placementComplete={placementComplete}
        priorityItems={priorityItems}
        priorityNoticeItems={priorityNoticeItems}
        processingInviteId={processingInviteId}
        inviteActionError={inviteActionError}
        rankSpotlightLabel={rankSpotlightLabel}
        recentFiveWins={recentFiveWins}
        seasonProgress={seasonProgress}
        topRankers={topRankers}
        user={user}
      />

      {homeRoomOverlays}

    </div>
  );
}
