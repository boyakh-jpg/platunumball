export default function EntityProfileHero({
  className = "",
  style,
  eyebrow,
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
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {badges ? <div className="badge-row">{badges}</div> : null}
    </>
  );

  return (
    <section className={`entity-profile-hero ui-page-hero ui-design-app-hero ${className}`.trim()} style={style}>
      {action ? <div className="entity-profile-hero-action">{action}</div> : null}
      <div className="entity-profile-hero-copy ui-page-hero__copy">
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
