import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import type { PageId } from '../../app/navigation';

export function CampaignPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  return (
    <>
      <header className="page-heading"><p className="eyebrow">TWOJA PRZYGODA ZACZYNA SIĘ TUTAJ</p><h1>Przy stole</h1><p>Jedno miejsce na historie, bohaterów i kolejne wyprawy waszej drużyny.</p></header>
      <section className="welcome-banner"><span className="banner-symbol" aria-hidden="true">◈</span><div><p className="eyebrow">DND RNR</p><h2>Każda wielka historia<br />zaczyna się od drużyny.</h2><p>To wasza przestrzeń pomiędzy sesjami.</p></div></section>
      <div className="dashboard-grid">
        <Card title="Drużyna" eyebrow="BOHATEROWIE"><EmptyState symbol="♙" title="Miejsce dla waszych postaci" description="Tutaj pojawi się skład drużyny i najważniejsze informacje o bohaterach." /><button className="text-button" onClick={() => onNavigate('characters')}>Przejdź do postaci →</button></Card>
        <Card title="Następna sesja" eyebrow="KOLEJNA WYPRAWA"><EmptyState symbol="▦" title="Przygoda czeka" description="Tutaj znajdziesz termin kolejnego spotkania i jego szczegóły." /><button className="text-button" onClick={() => onNavigate('sessions')}>Przejdź do sesji →</button></Card>
      </div>
    </>
  );
}
