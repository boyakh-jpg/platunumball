export default function PageFrame({ hero, navigation, children, className = "" }) {
  return (
    <div className={`page-stack ui-page-frame ${className}`.trim()}>
      {hero}
      {navigation}
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <header className="page-header ui-page-hero ui-design-app-hero">
      <div className="ui-page-hero__copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-action-row ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}
