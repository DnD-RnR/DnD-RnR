import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

export function NotesPage() {
  return <><header className="page-heading"><p className="eyebrow">KRONIKA DRUŻYNY</p><h1>Notatki</h1><p>Ważne tropy, poznane postacie i historie warte zapamiętania.</p></header><Card title="Wasze zapiski"><EmptyState symbol="✎" title="Pierwsza strona jest jeszcze pusta" description="W tym module powstaną notatki drużyny i zapiski z kampanii." /></Card></>;
}
