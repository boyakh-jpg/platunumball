export default function EntityProfileHero({
  className = "",
  style,
  title,
  subtitle,
  badges,
  action = null,
  leading = null,
  visual,
  identityClassName = "",
}) {
  const copy = (
    <>
      <div className="team-detail-heading-row entity-profile-hero-heading-row">
        {action}
      </div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {badges ? <div className="badge-row">{badges}</div> : null}
    </>
  );

  return (
    <section className={`entity-profile-hero ${className}`.trim()} style={style}>
      <div className="entity-profile-hero-copy">
        {leading ? (
          <div className={`entity-profile-hero-identity ${identityClassName}`.trim()}>
            {leading}
            <div>{copy}</div>
          </div>
        ) : copy}
      </div>
      <div className="entity-profile-hero-visual">{visual}</div>
    </section>
  );
}
