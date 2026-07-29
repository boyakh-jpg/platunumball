import { Link } from "react-router-dom";
import TeamHoverCard from "../team/TeamHoverCard.jsx";
import MatchRecordMeta from "./MatchRecordMeta.jsx";

const RESULT_TOKEN = {
  w: "w",
  win: "w",
  "승": "w",
  l: "l",
  loss: "l",
  "패": "l",
  d: "d",
  draw: "d",
  "무": "d",
  neutral: "neutral",
};

const RESULT_LABEL = {
  w: "W",
  l: "L",
  d: "D",
  neutral: "-",
};

function MatchTeamName({ side = {}, team = null, strong = false }) {
  const content = strong ? <strong>{side.name}</strong> : side.name;
  if (!team) return <span>{content}</span>;
  return <TeamHoverCard team={team} as="span">{content}</TeamHoverCard>;
}

export default function RecentMatchRow({
  record,
  result = "D",
  side = {},
  opponent = {},
  score = 0,
  opponentScore = 0,
  teams = [],
  to = "",
  onOpen = null,
  afterCourt = null,
  detail = null,
  className = "",
}) {
  const resultToken = RESULT_TOKEN[String(result).trim().toLowerCase()] ?? "d";
  const sideTeam = teams.find((team) => team.id === side.teamId) ?? null;
  const opponentTeam = teams.find((team) => team.id === opponent.teamId) ?? null;
  const rootClassName = ["recent-match-row", "ui-design-info-surface", "ui-design-info-accent", `result-${resultToken}`, className].filter(Boolean).join(" ");
  const content = (
    <>
      <b>{RESULT_LABEL[resultToken]}</b>
      <span className="recent-match-copy">
        <span className="recent-match-matchup">
          <MatchTeamName side={side} team={sideTeam} strong />
          <span className="recent-match-vs">vs</span>
          <MatchTeamName side={opponent} team={opponentTeam} />
        </span>
        <MatchRecordMeta record={record} afterCourt={afterCourt} />
        {detail ? <small>{detail}</small> : null}
      </span>
      <i>{score}:{opponentScore}</i>
    </>
  );

  if (!to) return <div className={rootClassName}>{content}</div>;
  return (
    <Link
      to={to}
      className={rootClassName}
      onClick={(event) => {
        if (!onOpen) return;
        event.preventDefault();
        onOpen();
      }}
    >
      {content}
    </Link>
  );
}
