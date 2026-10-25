import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

export function SessionsPage() {
  return <><header className="page-heading"><p className="eyebrow">DZIENNIK PRZYGÓD</p><h1>Sesje</h1><p>Kolejne spotkania i wspomnienia z poprzednich wypraw.</p></header><Card title="Spotkania drużyny"><EmptyState symbol="▦" title="Nie ma jeszcze sesji" description="W tym module powstanie harmonogram spotkań i historia rozegranych sesji." /></Card></>;
}
