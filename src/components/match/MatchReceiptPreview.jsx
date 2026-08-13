import { MapPin } from "lucide-react";
import {
  createMatchReceiptViewModel,
  getMatchReceiptFormatLabel,
  getMatchReceiptPhotoStyle,
  getMatchReceiptTeamNameScale,
} from "../../lib/matchReceipt.js";
import QrCode from "../common/QrCode.jsx";

function ReceiptScoreDigits({ value }) {
  return (
    <strong className="match-receipt-score-digits" aria-hidden="true">
      {Array.from(String(value)).map((digit, index) => (
        <i
          className="match-receipt-score-digit"
          key={`${digit}-${index}`}
          style={{ "--receipt-score-digit": Number(digit) }}
        />
      ))}
    </strong>
  );
}

export default function MatchReceiptPreview({
  draft,
  photoUrl = "",
  matchUrl = "",
  publicId = "",
  photoGestureHandlers = {},
}) {
  const model = createMatchReceiptViewModel(draft, { matchUrl, publicId });
  const backgroundUrl = photoUrl || model.defaultPhotoUrl;
  const posterTeams = [
    { name: model.homeTeam, tier: model.homeTier, neutralMarkUrl: model.neutralTeamMarkUrls.home },
    { name: model.awayTeam, tier: model.awayTier, neutralMarkUrl: model.neutralTeamMarkUrls.away },
  ];

  return (
    <article
      className="match-receipt-card"
      style={{
        "--receipt-home": model.homeColor,
        "--receipt-away": model.awayColor,
        "--receipt-paper-texture": `url("${model.paperGrainUrl}")`,
        "--receipt-paper-grain": `url("${model.paperGrainUrl}")`,
        "--receipt-score-digits": `url("${model.scoreDigitsUrl}")`,
        ...getMatchReceiptPhotoStyle(model, undefined, { defaultPhoto: !photoUrl }),
      }}
      aria-label="경기 영수증 미리보기"
    >
      <div
        className={`match-receipt-photo${photoUrl ? " is-editable" : " is-default"}`}
        aria-label={photoUrl ? "영수증 배경 사진 편집" : undefined}
        {...photoGestureHandlers}
      >
        {!photoUrl ? <img className="match-receipt-photo-backdrop" src={backgroundUrl} alt="" aria-hidden="true" /> : null}
        <img className="match-receipt-photo-image" src={backgroundUrl} alt="" />
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
                image.src = "/assets/boxtier_letter_dark.png";
                return;
              }
              image.hidden = true;
              image.nextElementSibling?.removeAttribute("hidden");
            }}
          />
          <strong hidden>BOXTIER</strong>
        </span>
        <span>{model.serial}</span>
      </header>
      <div className="match-receipt-verified">★ <i /> {model.verified ? "BOXTIER VERIFIED" : "MATCH RECEIPT"} <i /> ★</div>
      <div className="match-receipt-team-watermarks" aria-hidden="true">
        {posterTeams.map((team, index) => (
          <span key={index}>
            <img
              className={model.showTeamTierEmblems && team.tier ? "" : "is-neutral"}
              src={model.showTeamTierEmblems && team.tier ? team.tier.outlineSrc : team.neutralMarkUrl}
              alt=""
            />
          </span>
        ))}
      </div>
      <section className="match-receipt-poster-score">
        <span>{model.matchNatureLabel}</span>
        <div aria-label={`${model.homeScore} 대 ${model.awayScore}`}>
          <ReceiptScoreDigits value={model.homeScore} />
          <span>:</span>
          <ReceiptScoreDigits value={model.awayScore} />
        </div>
      </section>
      <section className="match-receipt-poster-teams">
        {posterTeams.map((team, index) => (
          <div key={index} style={{ "--receipt-team-name-size": `${4.8 * getMatchReceiptTeamNameScale(team.name)}cqw` }}>
            <strong>{team.name || (index ? "AWAY TEAM" : "HOME TEAM")}</strong>
            <img
              className={`match-receipt-team-tier${model.showTeamTierEmblems && team.tier ? "" : " is-neutral"}`}
              src={model.showTeamTierEmblems && team.tier ? team.tier.outlineSrc : team.neutralMarkUrl}
              alt=""
              aria-hidden="true"
            />
            {model.showTeamTierEmblems && team.tier ? <span>{`TEAM TIER · ${team.tier.label}`}</span> : null}
          </div>
        ))}
      </section>
      <footer className="match-receipt-ticket">
        <img className="match-receipt-ticket-paper" src={model.paperUrl} alt="" aria-hidden="true" />
        <div className="match-receipt-ticket-place">
          <MapPin aria-hidden="true" />
          <strong>{model.locationLabel || "경기 장소"}</strong>
          <span className="match-receipt-ticket-date">{model.playedOn.replaceAll("-", ".")}</span>
        </div>
        <div className="match-receipt-ticket-game">
          {model.personalTier ? (
            <div className="match-receipt-personal-tier-mark" aria-hidden="true">
              <img className="match-receipt-personal-tier is-watermark" src={model.personalTier.outlineSrc} alt="" />
              <small className="match-receipt-personal-tier-label">MY TIER · {model.personalTier.label}</small>
            </div>
          ) : null}
          <strong>{model.hasPersonalStats ? "MY GAME" : "GAME INFO"}</strong>
          {model.hasPersonalStats ? (
            <span className="match-receipt-personal-stats">
              <b><em>{model.personalPoints ?? 0}</em><small>PTS</small></b>
              <b><em>{model.personalRebounds ?? 0}</em><small>REB</small></b>
            </span>
          ) : (
            <span className="match-receipt-game-info">
              <b>{getMatchReceiptFormatLabel(model.format)}</b>
              <small>{model.matchNatureLabel}</small>
            </span>
          )}
          {model.comment ? <span className="match-receipt-ticket-caption">{model.comment}</span> : null}
        </div>
        <div className="match-receipt-ticket-qr">
          <strong>{matchUrl ? "경기 기록 보기" : "boxtier.kr"}</strong>
          {matchUrl ? (
            <a href={matchUrl} aria-label="경기 기록 열기">
              <QrCode value={matchUrl} label="경기 열기 QR 코드" className="match-receipt-qr" branded />
            </a>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
