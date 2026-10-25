type EmptyStateProps = { symbol: string; title: string; description: string };

export function EmptyState({ symbol, title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-symbol" aria-hidden="true">{symbol}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
