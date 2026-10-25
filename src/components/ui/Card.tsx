import type { ReactNode } from 'react';

type CardProps = { title: string; children: ReactNode; eyebrow?: string };

export function Card({ title, children, eyebrow }: CardProps) {
  return (
    <section className="card">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {children}
    </section>
  );
}
