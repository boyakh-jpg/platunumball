import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import {
  createMatchReceiptViewModel,
  formatMatchReceiptScoreboardScore,
  getMatchReceiptFormatLabel,
  getMatchReceiptPhotoStyle,
  getMatchReceiptTeamNameScale,
} from "../../lib/matchReceipt.js";
import { createMatchReceiptLineArt } from "../../lib/matchReceiptEmblem.js";
import QrCode from "../common/QrCode.jsx";

const EMPTY_TEAM_LINE_ART_URLS = Object.freeze({ home: "", away: "" });

function ReceiptScoreDigits({ value, className = "match-receipt-score-digits", tone = "" }) {
  const classes = [className, tone ? `is-${tone}` : ""].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-hidden="true">
      {Array.from(String(value)).map((digit, index) => (
        <i
          className="match-receipt-score-digit"
          key={`${digit}-${index}`}
          style={{ "--receipt-score-digit": Number(digit) }}
        />
      ))}
    </span>
  );
}

function ReceiptScoreboardGlyph({ value, row }) {
  return <i className="match-receipt-scoreboard-glyph" style={{ "--receipt-scoreboard-glyph": value === ":" ? 10 : Number(value), "--receipt-scoreboard-row": row }} />;
}

function ReceiptScoreboardValue({ value, row }) {
  return (
    <span className="match-receipt-scoreboard-value">
      {Array.from(String(value)).map((digit, index) => (
        <ReceiptScoreboardGlyph value={digit} row={row} key={`${digit}-${index}`} />
      ))}
    </span>
  );
}

function ReceiptPhotoScoreboard({ homeScore, awayScore, locale }) {
  return (
    <div
      className="match-receipt-photo-scoreboard"
      role="img"
      aria-label={locale === "en" ? `Final score ${homeScore} to ${awayScore}` : `경기 종료 ${homeScore} 대 ${awayScore}`}
    >
      <span className="match-receipt-photo-scoreboard-clock" aria-hidden="true">
        <ReceiptScoreboardValue value="00" row={1} />
        <ReceiptScoreboardGlyph value=":" row={1} />
        <ReceiptScoreboardValue value="00" row={1} />
      </span>
      <span className="match-receipt-photo-scoreboard-scores" aria-hidden="true">
        <ReceiptScoreboardValue value={formatMatchReceiptScoreboardScore(homeScore)} row={0} />
        <ReceiptScoreboardGlyph value=":" row={0} />
        <ReceiptScoreboardValue value={formatMatchReceiptScoreboardScore(awayScore)} row={0} />
      </span>
    </div>
  );
}

export default function MatchReceiptPreview({
  draft,
  photoUrl = "",
  matchUrl = "",
  publicId = "",
  locale = "ko",
  showPersonalTierIdentity = true,
  photoGestureHandlers = {},
  teamLineArtUrls = EMPTY_TEAM_LINE_ART_URLS,
}) {
  const photoElementRef = useRef(null);
  const [lineArtUrls, setLineArtUrls] = useState({ home: "", away: "" });

  useEffect(() => {
    const photoElement = photoElementRef.current;
    if (!photoElement || !photoUrl) return undefined;

    const preventBrowserGesture = (event) => {
      if (event.cancelable) event.preventDefault();
    };

    photoElement.addEventListener("touchmove", preventBrowserGesture, { passive: false });
    photoElement.addEventListener("gesturestart", preventBrowserGesture, { passive: false });
    photoElement.addEventListener("gesturechange", preventBrowserGesture, { passive: false });

    return () => {
      photoElement.removeEventListener("touchmove", preventBrowserGesture);
      photoElement.removeEventListener("gesturestart", preventBrowserGesture);
      photoElement.removeEventListener("gesturechange", preventBrowserGesture);
    };
  }, [photoUrl]);

  const model = createMatchReceiptViewModel(draft, { matchUrl, publicId, showPersonalTierIdentity, locale });
  const commentLineCount = model.commentLines.length;
  useEffect(() => {
    let active = true;
    Promise.all([
      teamLineArtUrls.home || createMatchReceiptLineArt(model.teamEmblemUrls.home),
      teamLineArtUrls.away || createMatchReceiptLineArt(model.teamEmblemUrls.away),
    ]).then(([home, away]) => {
      if (active) setLineArtUrls({ home, away });
    });
    return () => { active = false; };
  }, [model.teamEmblemUrls.away, model.teamEmblemUrls.home, teamLineArtUrls.away, teamLineArtUrls.home]);
  const backgroundUrl = photoUrl || model.defaultPhotoUrl;
  const posterTeams = [
    { name: model.homeTeam, tier: model.homeTier, neutralMarkUrl: model.neutralTeamMarkUrls.home, lineArtUrl: lineArtUrls.home },
    { name: model.awayTeam, tier: model.awayTier, neutralMarkUrl: model.neutralTeamMarkUrls.away, lineArtUrl: lineArtUrls.away },
  ];
  const hasGameDetail = Boolean(model.tournamentName || model.periodScores.length);

  return (
    <article
      className="match-receipt-card"
      lang={model.locale}
      style={{
        "--receipt-home": model.homeColor,
        "--receipt-away": model.awayColor,
        "--receipt-paper-texture": `url("${model.paperGrainUrl}")`,
        "--receipt-paper-grain": `url("${model.paperGrainUrl}")`,
        "--receipt-score-digits": `url("${model.scoreDigitsUrl}")`,
        "--receipt-scoreboard-digits": `url("${model.scoreboardDigitsUrl}")`,
        ...getMatchReceiptPhotoStyle(model, undefined, { defaultPhoto: !photoUrl }),
      }}
      aria-label={model.locale === "en" ? "Game receipt preview" : "경기 영수증 미리보기"}
    >
      <div
        ref={photoElementRef}
        className={`match-receipt-photo${photoUrl ? " is-editable" : " is-default"}`}
        aria-label={photoUrl ? (model.locale === "en" ? "Edit receipt background photo" : "영수증 배경 사진 편집") : undefined}
        {...photoGestureHandlers}
      >
        <img className="match-receipt-photo-image" src={backgroundUrl} alt="" />
        {!photoUrl ? <ReceiptPhotoScoreboard homeScore={model.homeScore} awayScore={model.awayScore} locale={model.locale} /> : null}
      </div>
      <header className="match-receipt-poster-head">
        <span className="match-receipt-wordmark">
          <img
            src={model.wordmarkUrl}
            alt="BOXTIER"
            onError={(event) => {
              const image = event.currentTarget;
              if (image.dataset.localFallback !== "true") {
                image.dataset.localFallback = "true";
                image.src = "/assets/match-receipt-wordmark-v1.png";
                return;
              }
              image.hidden = true;
              image.nextElementSibling?.removeAttribute("hidden");
            }}
          />
          <strong hidden>BOXTIER</strong>
          <small>{model.outcome.label}</small>
        </span>
        <span className="match-receipt-poster-id">
          <span>{model.serial}</span>
          {model.showPersonalTierIdentity ? <span className="match-receipt-poster-profile">{model.profileHashtag}</span> : null}
        </span>
      </header>
      <div className="match-receipt-verified">★ <i /> {model.verified ? "BOXTIER VERIFIED" : model.locale === "en" ? "GAME RECEIPT" : "MATCH RECEIPT"} <i /> ★</div>
      <div className="match-receipt-team-watermarks" aria-hidden="true">
        {posterTeams.map((team, index) => (
          <span key={index}>
            <img
              className={team.lineArtUrl ? "is-custom" : model.showTeamTierEmblems && team.tier ? "" : "is-neutral"}
              src={team.lineArtUrl || (model.showTeamTierEmblems && team.tier ? team.tier.outlineSrc : team.neutralMarkUrl)}
              alt=""
            />
          </span>
        ))}
      </div>
      <section className="match-receipt-poster-score">
        <span>{model.matchNatureLabel}</span>
        <div aria-label={model.locale === "en" ? `${model.homeScore} to ${model.awayScore}` : `${model.homeScore} 대 ${model.awayScore}`}>
          <ReceiptScoreDigits value={model.homeScore} />
          <i
            className="match-receipt-score-digit match-receipt-score-colon"
            style={{ "--receipt-score-digit": 10 }}
            aria-hidden="true"
          />
          <ReceiptScoreDigits value={model.awayScore} />
        </div>
      </section>
      <section className={`match-receipt-poster-teams${hasGameDetail ? " has-game-detail" : ""}`}>
        {posterTeams.map((team, index) => (
          <div key={index} style={{ "--receipt-team-name-size": `${4.8 * getMatchReceiptTeamNameScale(team.name)}cqw` }}>
            <strong>{team.name || (index ? "TEAM B" : "TEAM A")}</strong>
            <img
              className={`match-receipt-team-tier${team.lineArtUrl ? " is-custom" : model.showTeamTierEmblems && team.tier ? "" : " is-neutral"}`}
              src={team.lineArtUrl || (model.showTeamTierEmblems && team.tier ? team.tier.outlineSrc : team.neutralMarkUrl)}
              alt=""
              aria-hidden="true"
            />
            {model.showTeamTierEmblems && team.tier ? <span>{`TEAM TIER · ${team.tier.label}`}</span> : null}
          </div>
        ))}
        {hasGameDetail ? (
          <div className="match-receipt-game-detail">
            {model.tournamentName ? <strong>{model.tournamentName}</strong> : null}
            {model.periodScores.map(([label, home, away]) => (
              <span key={label}><b>{label}</b><em>{home ?? "-"} : {away ?? "-"}</em></span>
            ))}
          </div>
        ) : null}
      </section>
      <footer className="match-receipt-ticket">
        <img className="match-receipt-ticket-paper" src={model.paperUrl} alt="" aria-hidden="true" />
        <div className="match-receipt-ticket-place">
          <MapPin aria-hidden="true" />
          <strong>{model.locationLabel || (model.locale === "en" ? "Venue" : "경기 장소")}</strong>
          <span className="match-receipt-ticket-date">{model.playedOn.replaceAll("-", ".")}</span>
        </div>
        <div className={`match-receipt-ticket-game${model.hasPersonalStats ? "" : " match-receipt-ticket-game--info"} match-receipt-ticket-game--comment-lines-${commentLineCount}`}>
          {model.personalTier ? (
            <div className="match-receipt-personal-tier-mark" aria-hidden="true">
              <img className="match-receipt-personal-tier is-watermark" src={model.personalTier.outlineSrc} alt="" />
            </div>
          ) : null}
          <strong>{model.locale === "en" ? (model.hasPersonalStats ? "MVP / Player Stats" : "Players") : (model.hasPersonalStats ? "MY GAME" : "GAME INFO")}</strong>
          {model.hasPersonalStats ? (
            <span className="match-receipt-personal-stats">
              <b><ReceiptScoreDigits value={model.personalPoints ?? 0} className="match-receipt-stat-digits" tone="paper-ink" /><small>PTS</small></b>
              <b><ReceiptScoreDigits value={model.personalRebounds ?? 0} className="match-receipt-stat-digits" tone="paper-ink" /><small>REB</small></b>
            </span>
          ) : (
            <span className="match-receipt-game-info">
              <b>{getMatchReceiptFormatLabel(model.format)}</b>
              <small>{model.matchNatureLabel}</small>
            </span>
          )}
          <span className="match-receipt-ticket-caption">{model.commentLines.join("\n") || "\u00a0"}</span>
          {model.personalTier ? <small className="match-receipt-personal-tier-label">MY TIER · {model.personalTier.label}</small> : null}
        </div>
        <div className="match-receipt-ticket-qr">
          <strong>{matchUrl ? (model.locale === "en" ? "Share Receipt" : "경기 기록 보기") : "boxtier.kr"}</strong>
          {matchUrl ? (
            <a href={matchUrl} aria-label={model.locale === "en" ? "Open game receipt" : "경기 기록 열기"}>
              <QrCode value={matchUrl} label={model.locale === "en" ? "Open game receipt QR code" : "경기 열기 QR 코드"} className="match-receipt-qr" branded />
            </a>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
