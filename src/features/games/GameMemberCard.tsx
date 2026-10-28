import { RemoveEquipmentForm } from './RemoveEquipmentForm';
import { MemberStatistics } from './MemberStatistics';
import type { CatalogItem, Character, InventoryItem, StatisticsSummary } from '../../api';
import { formatDice } from '../../lib/dice';
import { Card } from '../../components/ui/Card';
import { AssignEquipmentForm } from './AssignEquipmentForm';

export type GameMember = { id: number; name: string; playerName: string; status: 'pending' | 'accepted' | 'declined'; participating?: boolean; statistics?: StatisticsSummary; character?: Character; items?: InventoryItem[] };

export function GameMemberCard({ member: m, gameId, catalog, pending, onAssigned, onKick }: {
  member: GameMember; gameId: number; catalog: CatalogItem[]; pending: boolean; onAssigned: () => Promise<void>; onKick?: () => void;
}) {
  return <Card title={m.name} eyebrow={`WŁAŚCICIEL: ${m.playerName}`} actions={m.participating && onKick ? <button className="text-button danger-button" disabled={pending} onClick={onKick} aria-label={`Wyrzuć ${m.name} z sesji`}>Wyrzuć</button> : undefined}>
    {!m.participating && <p>Poza sesją</p>}
    {m.character && <>
      <p className="gm-member-meta">{m.character.class.replace(/\s*\([^)]*\)/g, '')} · Poziom <strong>{m.character.level}</strong></p>
      {m.statistics && <MemberStatistics stats={m.statistics} />}
      <details className="session-inventory"><summary>Postać i ekwipunek ({m.items?.length ?? 0})</summary>
        <p>{[m.character.species, m.character.subclass].filter(Boolean).join(' · ')}</p><p>Pochodzenie: {m.character.background || 'Do uzupełnienia'}</p>
        {m.items?.length ? <ul>{m.items.map(item => <li key={item.id}><strong>{item.name}</strong> × {item.quantity} · {item.equipped ? 'Założony' : 'Plecak'}<p>{item.weight == null ? 'Waga: —' : `Waga: ${item.weight} lb`} · Wartość: {item.cost || '—'}</p><p className="item-description">{formatDice(item.description)}</p><RemoveEquipmentForm gameId={gameId} characterId={m.character!.id} characterName={m.name} item={item} disabled={pending} onRemoved={onAssigned} /></li>)}</ul> : <p>Brak przedmiotów.</p>}
        <AssignEquipmentForm gameId={gameId} characterId={m.character.id} characterName={m.name} items={catalog} disabled={pending} onAssigned={onAssigned} />
      </details>
    </>}
  </Card>;
}
