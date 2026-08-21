import { Link } from "react-router-dom";
import { MessageCircle, Moon, ShieldCheck, Sun, Unlink2 } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import RefereeHoverCard from "../components/referee/RefereeHoverCard.jsx";
import { REFEREE_TRUST_MIN } from "../lib/constants.js";
import { getCourtHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { DISCORD_NOTIFICATION_EVENTS, getDiscordAvatarClassName, getDiscordAvatarStyle } from "../lib/discord.js";
import ExternalNotificationSettingsCard from "../components/settings/ExternalNotificationSettingsCard.jsx";

export default function SettingsPrimaryColumn({ controller }) {
  const {
    app,
    privacyDraft,
    setPrivacyDraft,
    themeDraft,
    themeSaveStatus,
    homeGuideCardDraft,
    setHomeGuideCardDraft,
    homeGuideCardSavePending,
    generalSettingsSavePending,
    setHomeGuideCardSaveStatus,
    favoriteQuery,
    setFavoriteQuery,
    favoriteListType,
    setFavoriteListType,
    discordLinked,
    discordChannel,
    discordProfileUrl,
    queuedDiscordDeliveries,
    discordLinkError,
    discordLinkPending,
    discordSaveStatus,
    discordDraft,
    setDiscordDraft,
    favoritePlayers,
    favoriteTeams,
    favoriteCourts,
    favoriteReferees,
    favoriteListConfig,
    favoriteSearchIdleItems,
    favoriteActionPendingKey,
    favoriteActionError,
    favoriteSearchResetKey,
    toggleFavoriteItem,
    renderFavoriteSearchItem,
    canOpenAdminMenu,
    themeDirty,
    generalSettingsDirty,
    generalSettingsStatus,
    selectTheme,
    connectDiscord,
    saveGeneralSettings,
  } = controller;
  return (
<div className="page-stack settings-main-column">
          <Card as="fieldset" className="section-card settings-fieldset-card settings-nav-card">
            <legend className="section-title-row">
              <div>
                <h2>세부 설정</h2>
                <p className="eyebrow">Setting pages</p>
              </div>
            </legend>
            <div className="settings-nav-grid">
              <Button as={Link} variant="secondary" to="/app/settings/favorites"><strong>즐겨찾기</strong><span>프로필/팀/구장/심판</span></Button>
              <Button as={Link} variant="secondary" to="/app/settings/courts"><strong>구장 신청</strong><span>주소 검색/등록 요청</span></Button>
              <Button as={Link} variant="secondary" to="/app/settings/referee"><strong>심판</strong><span>룰북/시험/등록 요청</span></Button>
            </div>
          </Card>

          <Card as="fieldset" className="section-card settings-fieldset-card theme-choice-card">
            <legend className="section-title-row">
              <div>
                <h2>밝기</h2>
                <p className="eyebrow">화면 테마</p>
              </div>
            </legend>
            <div
              className="ui-segmented-control segmented-control"
              role="radiogroup"
              aria-label="화면 테마"
            >
              <button
                type="button"
                className={themeDraft === "light" ? "active" : ""}
                aria-pressed={themeDraft === "light"}
                onPointerUp={(event) => event.currentTarget.blur()}
                onClick={() => selectTheme("light")}
              >
                <Sun size={15} aria-hidden="true" /> 라이트
              </button>
              <button
                type="button"
                className={themeDraft === "dark" ? "active" : ""}
                aria-pressed={themeDraft === "dark"}
                onPointerUp={(event) => event.currentTarget.blur()}
                onClick={() => selectTheme("dark")}
              >
                <Moon size={15} aria-hidden="true" /> 다크
              </button>
            </div>
            <div className="settings-save-row">
              <small>{themeSaveStatus || (themeDirty ? "변경 있음" : "저장됨")}</small>
            </div>
          </Card>

          <Card as="fieldset" className="section-card settings-fieldset-card favorite-management-card">
            <legend className="section-title-row">
              <div>
                <h2>즐겨찾기 설정</h2>
                <p className="eyebrow">Favorites</p>
              </div>
            </legend>
            <SearchPicker
              key={favoriteSearchResetKey}
              value={favoriteQuery}
              onChange={setFavoriteQuery}
              placeholder="이름 또는 해시태그 검색"
              items={[]}
              remoteSearchType="all"
              idleItems={favoriteSearchIdleItems}
              idleTitle="저장한 즐겨찾기"
              title="즐겨찾기 검색 결과"
              emptyText="검색 결과 없음"
              showIdleOnFocus
              floating
              fieldClassName="favorite-search-row"
              renderItem={renderFavoriteSearchItem}
            />
            {favoriteActionError ? <small role="status" className="form-warning">{favoriteActionError}</small> : null}
            <div className="ui-choice-group favorite-type-grid ui-design-borderless-list ui-design-borderless-surface">
              {Object.entries(favoriteListConfig).map(([type, config]) => (
                <button
                  key={type}
                  type="button"
                  className={favoriteListType === type ? "ui-choice-tile active" : "ui-choice-tile"}
                  aria-pressed={favoriteListType === type}
                  onClick={() => setFavoriteListType((current) => (current === type ? "" : type))}
                >
                  <span>{config.label}</span>
                  <strong>{config.count}/10</strong>
                </button>
              ))}
            </div>
            {favoriteListType ? (
              <div className="favorite-chip-list">
                {favoriteListType === "player" ? favoritePlayers.map((player) => (
                  <div key={player.id} className="favorite-mini-row">
                    <PlayerHoverCard as="span" user={player} teams={app.state.teams} className="favorite-mini-chip">
                      <ProfileEmblem user={player} className="small" />
                      <span>{getUserHashtag(player)}</span>
                    </PlayerHoverCard>
                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(favoriteActionPendingKey)} onClick={() => { void toggleFavoriteItem("player", app.actions.toggleFavoritePlayer, player); }}>{favoriteActionPendingKey === `player:${player.id}` ? "저장 중" : "해제"}</Button>
                  </div>
                )) : null}
                {favoriteListType === "team" ? favoriteTeams.map((team) => (
                  <div key={team.id} className="favorite-mini-row">
                    <TeamHoverCard as="span" team={team} className="favorite-mini-chip">
                      <TeamEmblem team={team} size="xs" />
                      <span>{getTeamHashtag(team)}</span>
                    </TeamHoverCard>
                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(favoriteActionPendingKey)} onClick={() => { void toggleFavoriteItem("team", app.actions.toggleFavoriteTeam, team); }}>{favoriteActionPendingKey === `team:${team.id}` ? "저장 중" : "해제"}</Button>
                  </div>
                )) : null}
                {favoriteListType === "court" ? favoriteCourts.map((court) => (
                  <div key={court.id} className="favorite-mini-row">
                    <CourtHoverCard court={court} className="favorite-mini-chip">
                      <span className="team-dot" />
                      <span>{getCourtHashtag(court)}</span>
                    </CourtHoverCard>
                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(favoriteActionPendingKey)} onClick={() => { void toggleFavoriteItem("court", app.actions.toggleFavoriteCourt, court); }}>{favoriteActionPendingKey === `court:${court.id}` ? "저장 중" : "해제"}</Button>
                  </div>
                )) : null}
                {favoriteListType === "referee" ? favoriteReferees.map((referee) => (
                  <div key={referee.id} className="favorite-mini-row">
                    <RefereeHoverCard user={referee} matches={app.state.matches} minTrust={REFEREE_TRUST_MIN} className="favorite-mini-chip">
                      <ShieldCheck size={14} />
                      <span>{getUserHashtag(referee)}</span>
                    </RefereeHoverCard>
                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(favoriteActionPendingKey)} onClick={() => { void toggleFavoriteItem("referee", app.actions.toggleFavoriteReferee, referee); }}>{favoriteActionPendingKey === `referee:${referee.id}` ? "저장 중" : "해제"}</Button>
                  </div>
                )) : null}
                {favoriteListConfig[favoriteListType]?.count ? null : <em>{favoriteListConfig[favoriteListType]?.label} 즐겨찾기 없음</em>}
              </div>
            ) : null}
          </Card>

          <ExternalNotificationSettingsCard app={app} discordLinked={discordLinked} />

          <Card as="fieldset" className="section-card settings-fieldset-card discord-link-card">
            <legend className="section-title-row">
              <div>
                <h2>디스코드 알림</h2>
                <p className="eyebrow">Discord</p>
              </div>
            </legend>
            <div className="settings-fieldset-status-row">
              <Badge tone={discordLinked && !discordDraft.unlink && discordDraft.enabled ? "green" : "neutral"}>
                {discordLinked && !discordDraft.unlink && discordDraft.enabled ? "DM ON" : "앱 알림"}
              </Badge>
            </div>
            <div className="contract-grid single ui-support-grid">
              {discordLinked ? (
                <div className="discord-profile-line">
                  <span className={getDiscordAvatarClassName(app.currentUser, "avatar small")} style={getDiscordAvatarStyle(app.currentUser)}>
                    {app.currentUser.name.slice(0, 1)}
                  </span>
                  <strong>{app.currentUser.name}</strong>
                  <a className="discord-link-badge" href={discordProfileUrl} target="_blank" rel="noreferrer">
                    <MessageCircle size={14} /> 연동됨
                  </a>
                </div>
              ) : null}
              <div>
                <span>연동 상태</span>
                <strong>{discordDraft.unlink ? "해제 예정" : discordLinked ? "연동됨" : "미연동"}</strong>
              </div>
              <div>
                <span>알림 경로</span>
                <strong>{discordLinked && !discordDraft.unlink && discordDraft.enabled ? "앱 + Discord DM" : "앱 내부"}</strong>
              </div>
              {discordLinked ? (
                <div>
                  <span>DM 대기</span>
                  <strong>{queuedDiscordDeliveries.length}개</strong>
                </div>
              ) : null}
            </div>
            {discordLinkError ? <p className="form-warning">{discordLinkError}</p> : null}
            <div className="settings-toggle-grid ui-design-choice-list">
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(discordLinked && !discordDraft.unlink && discordDraft.enabled)}
                  disabled={generalSettingsSavePending || !discordLinked || discordDraft.unlink}
                  onChange={(event) => setDiscordDraft((current) => ({ ...current, enabled: event.target.checked }))}
                />
                Discord DM
              </label>
              {DISCORD_NOTIFICATION_EVENTS.map((option) => (
                <label key={option.id}>
                  <input
                    type="checkbox"
                    checked={Boolean(discordDraft.events?.[option.id])}
                    disabled={generalSettingsSavePending || !discordLinked || discordDraft.unlink || !discordDraft.enabled}
                    onChange={() => setDiscordDraft((current) => ({
                      ...current,
                      events: {
                        ...current.events,
                        [option.id]: !current.events?.[option.id],
                      },
                    }))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <div className="ui-action-row settings-address-actions">
              {discordLinked ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={generalSettingsSavePending}
                  onClick={() => setDiscordDraft((current) => ({
                    ...current,
                    unlink: !current.unlink,
                    enabled: current.unlink ? Boolean(discordChannel.enabled) : false,
                  }))}
                >
                  <Unlink2 size={15} /> {discordDraft.unlink ? "해제 취소" : "연동 해제"}
                </Button>
              ) : (
                <Button type="button" variant="secondary" disabled={generalSettingsSavePending || discordLinkPending} onClick={connectDiscord}>
                  {discordLinkPending ? "연동 준비 중" : "Discord 연동"}
                </Button>
              )}
            </div>
            {discordSaveStatus ? <small>{discordSaveStatus}</small> : null}
          </Card>

          <Card as="fieldset" className="section-card settings-fieldset-card settings-privacy-card settings-preference-card">
            <legend className="section-title-row">
              <div>
                <h2>표시 설정</h2>
                <p className="eyebrow">Display</p>
              </div>
            </legend>

            <div className="settings-preference-group settings-home-guide-group">
              <div className="settings-preference-heading">
                <strong>홈 안내 카드</strong>
              </div>
              <div className="settings-toggle-grid ui-design-choice-list">
                <label>
                  <input
                    type="checkbox"
                    checked={homeGuideCardDraft}
                    disabled={generalSettingsSavePending || homeGuideCardSavePending}
                    onChange={(event) => {
                      setHomeGuideCardDraft(event.target.checked);
                      setHomeGuideCardSaveStatus("");
                    }}
                  />
                  홈에서 안내 카드 표시
                </label>
              </div>
            </div>

            <div className="settings-preference-group">
              <div className="settings-preference-heading">
                <strong>프로필 표시</strong>
              </div>
              <div className="settings-toggle-grid ui-design-choice-list">
                <label>
                  <input
                    type="checkbox"
                    checked={privacyDraft.regionRanking !== false}
                    disabled={generalSettingsSavePending}
                    onChange={(event) => setPrivacyDraft((current) => ({ ...current, regionRanking: event.target.checked }))}
                  />
                  지역 랭킹에 표시
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={privacyDraft.teamHistory !== false}
                    disabled={generalSettingsSavePending}
                    onChange={(event) => setPrivacyDraft((current) => ({ ...current, teamHistory: event.target.checked }))}
                  />
                  소속팀 히스토리 표시
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={privacyDraft.statSummary !== false}
                    disabled={generalSettingsSavePending}
                    onChange={(event) => setPrivacyDraft((current) => ({ ...current, statSummary: event.target.checked }))}
                  />
                  개인 통계 공개
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={privacyDraft.communityPosts !== false}
                    disabled={generalSettingsSavePending}
                    onChange={(event) => setPrivacyDraft((current) => ({ ...current, communityPosts: event.target.checked }))}
                  />
                  작성 게시글 공개
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={privacyDraft.communityComments !== false}
                    disabled={generalSettingsSavePending}
                    onChange={(event) => setPrivacyDraft((current) => ({ ...current, communityComments: event.target.checked }))}
                  />
                  작성 댓글 공개
                </label>
              </div>
            </div>

            <div className="settings-save-row">
              <small>{generalSettingsStatus}</small>
              <Button type="button" variant="primary" onClick={saveGeneralSettings} disabled={!generalSettingsDirty || generalSettingsSavePending || homeGuideCardSavePending}>
                {generalSettingsSavePending ? "저장 중" : "저장"}
              </Button>
            </div>
          </Card>

          {canOpenAdminMenu ? (
            <Card as="fieldset" className="section-card settings-fieldset-card admin-menu-card">
              <legend className="section-title-row">
                <div>
                  <h2>관리자 메뉴</h2>
                  <p className="eyebrow">Operations</p>
                </div>
              </legend>
              <div className="contract-grid single ui-support-grid">
                <div>
                  <span>정렬 기준</span>
                  <strong>구장 · 플레이어 · 경기</strong>
                </div>
                <div>
                  <span>처리 대상</span>
                  <strong>신고 · 기록 · 구장요청</strong>
                </div>
              </div>
              <Button as={Link} variant="secondary" to="/app/admin?section=courts">구장 신청 관리 열기</Button>
            </Card>
          ) : null}

        </div>
  );
}
