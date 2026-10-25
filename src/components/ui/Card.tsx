import type { ReactNode } from 'react';

type CardProps = { title: string; children: ReactNode; eyebrow?: string; actions?: ReactNode };

export function Card({ title, children, eyebrow, actions }: CardProps) {
  return (
    <section className="card">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      {actions ? <div className="card-heading"><h2>{title}</h2>{actions}</div> : <h2>{title}</h2>}
      {children}
    </section>
  );
}
