import {
  Fragment,
  useEffect,
  useRef,
} from "react";

import {
  MessageSquare,
  Send,
  UserRound,
} from "lucide-react";
import Button from "../common/Button.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import {
  DEFAULT_RATING,
  MAX_RECRUITING_RESERVES_PER_SIDE as MAX_RESERVE_PLAYERS_PER_SIDE,
  SIDE_LABEL_TEXT as SIDE_LABELS,
} from "../../lib/constants.js";


import {
  ROOM_CHAT_MESSAGE_MAX_LENGTH as CHAT_MESSAGE_MAX_LENGTH,
} from "../../lib/roomChat.js";
import {
  formatRecruitingMessageTime as formatWhen,
} from "../../lib/recruitingPage.js";
import {
  getEntryMmr,
  getRoomSlotDisplayPosition,
  getRoomSlotBadge,
  getRoomSlotTeamName,
  getVisualPartyKey,
  groupPartySlots,
  PlayerRoomSlot,
} from "./RecruitingRoomCore.jsx";

export const ROOM_CHAT_BOTTOM_THRESHOLD_PX = 64;

export function isRoomChatNearBottom(node, threshold = ROOM_CHAT_BOTTOM_THRESHOLD_PX) {
  if (!node) return true;
  return node.scrollHeight - node.scrollTop - node.clientHeight <= threshold;
}

export function shouldAutoScrollRoomChat(initialized, nearBottom) {
  return !initialized || nearBottom;
}

export function SideRoster({
  sideName,
  side,
  userById,
  teams,
  hostPlayerId = "",
  currentUserId = "",
  showCaptainBadge = false,
  roomState = {},
  sideLeaderId = "",
  pendingLeader = null,
  slotPositions = {},
  canInvite = false,
  inviteLabel = "초대",
  canManageEntry = null,
  onInviteSlot,
  onSelfSlotAction,
}) {
  const activeSlots = [];
  const seenPlayerIds = new Set();
  (side.entries ?? []).forEach((entry) => {
    (entry.players ?? []).forEach((playerId) => {
      if (!playerId || seenPlayerIds.has(playerId)) return;
      seenPlayerIds.add(playerId);
      activeSlots.push({
        entry,
        playerId,
        user: userById[playerId],
        partyKey: getVisualPartyKey(entry, sideName),
      });
    });
  });
  const activeSlotGroups = groupPartySlots(activeSlots);
  const pendingLeaderVisible = Boolean(pendingLeader?.playerId && pendingLeader?.user && !activeSlots.length && side.filled < side.capacity);
  const openSlots = Math.max(0, side.capacity - side.filled - Number(pendingLeaderVisible));
  const slotTrackCount = Math.max(1, Number(side.capacity) || activeSlots.length || 1);
  const displayedSideLeaderId = (
    activeSlots.some(({ playerId }) => playerId === hostPlayerId)
    || (side.fillSlots ?? []).some(({ playerId }) => playerId === hostPlayerId)
  ) ? "" : sideLeaderId;
  const renderActiveSlot = ({ entry, playerId, user }) => {
    const teamName = getRoomSlotTeamName(entry, teams);
    const isSelfSlot = playerId === currentUserId;
    const canOpenAction = Boolean(onSelfSlotAction) && (isSelfSlot || Boolean(canManageEntry?.(entry)));
    const displayPosition = getRoomSlotDisplayPosition(user, slotPositions, playerId, entry);
    return (
      <PlayerRoomSlot
        key={`${sideName}-${entry.id}-${playerId}`}
        user={user}
        teams={teams}
        status={entry.status}

        title={entry.status === "ready" ? "출전" : "대기"}
        detail={teamName}
        mmr={user?.ratings?.integrated ?? getEntryMmr(entry)}
        position={displayPosition}
        badge={getRoomSlotBadge(playerId, entry, hostPlayerId, showCaptainBadge, roomState, { sideLeaderId: displayedSideLeaderId })}
        onSelfAction={canOpenAction ? (event) => onSelfSlotAction?.(sideName, false, playerId, entry.id, event) : null}
      />
    );
  };
  return (
    <section className="arena-side-roster">
      <header>
        <div>
          <span>{SIDE_LABELS[sideName]}</span>
          <strong>{side.filled}/{side.capacity}</strong>
        </div>
      </header>
      <div className="arena-room-slot-row" style={{ "--slot-count": slotTrackCount }}>
        {activeSlotGroups.map((group) => (
          group.type === "party" ? (
            <div
              key={`${sideName}-${group.partyKey}`}
              className="arena-room-party-group"
              style={{ "--party-slot-count": group.slots.length, gridColumn: `span ${group.slots.length}` }}
            >
              {group.slots.map(renderActiveSlot)}
            </div>
          ) : renderActiveSlot(group.slots[0])
        ))}
        {pendingLeaderVisible ? (
          <PlayerRoomSlot
            user={pendingLeader.user}
            teams={teams}
            status="waiting"
            title="초대 대기"
            detail={pendingLeader.teamName}
            mmr={pendingLeader.user.ratings?.integrated ?? DEFAULT_RATING}
            badge={getRoomSlotBadge(pendingLeader.playerId, null, hostPlayerId, showCaptainBadge, roomState, { sideLeaderId: pendingLeader.playerId })}
          />
        ) : null}
        {Array.from({ length: openSlots }).map((_item, index) => {
          const slotKey = `${sideName}-active-${index}`;
          return (
            <Fragment key={slotKey}>
              <div className="arena-room-player-slot-wrap">
                <button
                  type="button"
                  className={canInvite ? "arena-room-player-slot empty invite" : "arena-room-player-slot empty"}
                  disabled={!canInvite}
                  onClick={(event) => onInviteSlot?.(sideName, false, slotKey, event)}
                >
                  <UserRound size={17} />
                  <span>빈 슬롯</span>
                  {canInvite ? <em>{inviteLabel}</em> : null}
                </button>
              </div>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

export function ReserveLine({
  sideName,
  candidates,
  playingIds,
  lobby,
  userById,
  teams,
  hostPlayerId = "",
  currentUserId = "",
  showCaptainBadge = false,
  roomState = {},
  sideLeaderId = "",
  slotPositions = {},
  canInvite = false,
  inviteLabel = "초대",
  canManageEntry = null,
  capacity = MAX_RESERVE_PLAYERS_PER_SIDE,
  onInviteSlot,
  onSelfSlotAction,
}) {
  if (capacity <= 0) return null;
  const playingSet = new Set(playingIds);
  const slots = candidates.slice(0, capacity);
  const openSlots = Math.max(0, capacity - slots.length);
  const slotTrackCount = capacity;
  const displayedSideLeaderId = (
    playingSet.has(hostPlayerId)
    || candidates.some(({ playerId }) => playerId === hostPlayerId)
  ) ? "" : sideLeaderId;
  const reserveSlots = slots.map((candidate) => {
    const entry = (lobby.entries ?? []).find((item) => item.id === candidate.entryId);
    return {
      candidate,
      entry,
      partyKey: getVisualPartyKey(entry, sideName),
    };
  });
  const reserveSlotGroups = groupPartySlots(reserveSlots);
  const renderReserveSlot = ({ candidate, entry }) => {
    const user = userById[candidate.playerId];
    if (!user) return null;
    const isSelfSlot = candidate.playerId === currentUserId;
    const canOpenAction = Boolean(onSelfSlotAction) && (isSelfSlot || Boolean(canManageEntry?.(entry)));
    const displayPosition = getRoomSlotDisplayPosition(user, slotPositions, candidate.playerId, entry);
    return (
      <PlayerRoomSlot
        key={`${sideName}-${candidate.playerId}`}
        user={user}
        teams={teams}
        status={candidate.status}
        title="후보"
        detail={getRoomSlotTeamName(entry, teams)}
        mmr={user.ratings?.integrated ?? DEFAULT_RATING}
        position={displayPosition}
        badge={getRoomSlotBadge(candidate.playerId, entry, hostPlayerId, showCaptainBadge, roomState, { showPartyBadge: false, sideLeaderId: displayedSideLeaderId })}
        onSelfAction={canOpenAction ? (event) => onSelfSlotAction?.(sideName, true, candidate.playerId, candidate.entryId, event) : null}
      />
    );
  };
  return (
    <div className={`arena-reserve-line ${sideName === "teamB" ? "team-b" : "team-a"}`}>
      <strong>{SIDE_LABELS[sideName]} 후보 {Math.min(candidates.length, capacity)}/{capacity}</strong>
      <div className="arena-room-reserve-row" style={{ "--slot-count": slotTrackCount }}>
        {reserveSlotGroups.map((group) => (
          group.type === "party" ? (
            <div
              key={`${sideName}-reserve-${group.partyKey}`}
              className="arena-room-party-group"
              style={{ "--party-slot-count": group.slots.length, gridColumn: `span ${group.slots.length}` }}
            >
              {group.slots.map(renderReserveSlot)}
            </div>
          ) : renderReserveSlot(group.slots[0])
        ))}
        {Array.from({ length: openSlots }).map((_item, index) => {
          const slotKey = `${sideName}-reserve-${index}`;
          return (
            <Fragment key={slotKey}>
              <div className="arena-room-player-slot-wrap">
                <button
                  type="button"
                  className={canInvite ? "arena-room-player-slot empty invite" : "arena-room-player-slot empty"}
                  disabled={!canInvite}
                  onClick={(event) => onInviteSlot?.(sideName, true, slotKey, event)}
                >
                  <UserRound size={17} />
                  <span>후보</span>
                  {canInvite ? <em>{inviteLabel}</em> : null}
                </button>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function RoomChat({
  messages,
  userById,
  teams,
  currentUserId = "",
  value,
  canChat,
  publicPreview = false,
  readOnly = false,
  locked = false,
  sending = false,
  cooldown = false,
  error = "",
  onChange,
  onSubmit,
  onVisibleChange = null,
}) {
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const chatPositionInitializedRef = useRef(false);
  const chatNearBottomRef = useRef(true);
  const latestMessage = messages.at(-1);
  const latestMessageKey = latestMessage ? `${latestMessage.id || ""}:${latestMessage.createdAt || ""}:${latestMessage.body || ""}` : "";
  const inputDisabled = !canChat || sending || cooldown || locked;

  useEffect(() => {
    const node = listRef.current;
    if (!node) return undefined;
    const shouldScroll = shouldAutoScrollRoomChat(
      chatPositionInitializedRef.current,
      chatNearBottomRef.current,
    );
    chatPositionInitializedRef.current = true;
    if (!shouldScroll) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
      chatNearBottomRef.current = true;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [messages.length, latestMessageKey]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof onVisibleChange !== "function") return undefined;
    if (typeof IntersectionObserver === "undefined") {
      onVisibleChange(true);
      return () => onVisibleChange(false);
    }
    const observer = new IntersectionObserver(([entry]) => {
      onVisibleChange(Boolean(entry?.isIntersecting));
    }, { threshold: 0.1 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      onVisibleChange(false);
    };
  }, [onVisibleChange]);

  return (
    <div className="arena-room-chat" ref={rootRef}>
      <header>
        <span><MessageSquare size={16} /> 방 채팅</span>
        <strong>{publicPreview ? "로그인 필요" : locked ? "경기 종료됨" : messages.length}</strong>
      </header>
      <div
        className="arena-chat-list"
        ref={listRef}
        onScroll={(event) => {
          chatNearBottomRef.current = isRoomChatNearBottom(event.currentTarget);
        }}
      >
        {publicPreview ? (
          <div className="arena-chat-empty">채팅은 로그인 후 확인할 수 있습니다</div>
        ) : messages.length ? messages.map((message) => {
          const user = userById[message.userId];
          return (
            <div
              key={message.id || `${message.userId}-${message.createdAt}`}
              className={`arena-chat-message${message.userId === currentUserId ? " is-mine" : ""}`}
            >
              <PlayerHoverCard user={user} teams={teams} as="span">
                <ProfileEmblem user={user} className="small" />
              </PlayerHoverCard>
              <span>
                <strong>{user?.name ?? "알 수 없음"} <em>{formatWhen(message.createdAt)}</em></strong>
                <b>{message.body}</b>
              </span>
            </div>
          );
        }) : (
          <div className="arena-chat-empty">아직 채팅 없음</div>
        )}
      </div>
      {!readOnly ? (
        <form className="arena-chat-form" onSubmit={onSubmit}>
          <input
            value={value}
            disabled={inputDisabled}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value)}
            placeholder={locked ? "경기 종료됨" : canChat ? "방 전체에 보낼 메시지" : "참여 후 채팅 가능"}
          />
          <Button type="submit" disabled={inputDisabled || !value.trim()}>
            <Send size={16} /> 전송
          </Button>
          <small className={error ? "arena-chat-helper error" : "arena-chat-helper"}>
            {error || `${value.length}/${CHAT_MESSAGE_MAX_LENGTH}`}
          </small>
        </form>
      ) : null}
    </div>
  );
}
