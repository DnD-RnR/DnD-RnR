import { Card } from '../../components/ui/Card';

const actions = [
  ['Atak', 'Wykonaj atak bronią lub cios bez użycia broni.'],
  ['Doskok', 'Do końca tej tury zyskaj dodatkowy ruch równy twojej Szybkości.'],
  ['Wycofanie', 'Twój ruch do końca tej tury nie prowokuje ataków okazyjnych.'],
  ['Unik', 'Do początku swojej następnej tury ataki przeciwko tobie mają utrudnienie, a rzuty obronne na Zręczność wykonujesz z ułatwieniem. Tracisz tę korzyść, jeśli jesteś Obezwładniony lub twoja Szybkość wynosi 0.'],
  ['Pomoc', 'Pomóż innej istocie w teście cechy lub rzucie na atak albo udziel jej pierwszej pomocy.'],
  ['Ukrycie', 'Wykonaj test Zręczności (Skradanie się).'],
  ['Wpływanie', 'Wykonaj test Charyzmy (Oszustwo, Zastraszanie, Występ lub Perswazja) albo Mądrości (Obchodzenie się ze zwierzętami), aby zmienić nastawienie istoty.'],
  ['Magia', 'Rzuć czar, użyj magicznego przedmiotu lub magicznej zdolności.'],
  ['Przygotowanie', 'Przygotuj się do wykonania akcji w odpowiedzi na określony przez ciebie wyzwalacz.'],
  ['Przeszukiwanie', 'Wykonaj test Mądrości (Wnikliwość, Medycyna, Percepcja lub Sztuka przetrwania).'],
  ['Studiowanie', 'Wykonaj test Inteligencji (Arkana, Historia, Śledztwo, Natura lub Religia).'],
  ['Użycie przedmiotu', 'Użyj niemagicznego przedmiotu.'],
] as const;

function ActionList({ entries }: { entries: readonly (readonly [string, string])[] }) {
  return (
    <ul className="combat-action-list">
      {entries.map(([name, description]) => (
        <li key={name}>
          <details>
            <summary>{name}</summary>
            <p>{description}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function CombatTab() {
  return (
    <div className="combat-tab">
      <div className="inventory-section-heading">
        <div>
          <p className="eyebrow">KARTA BOHATERA</p>
          <h2>Walka</h2>
        </div>
      </div>
      <div className="combat-sections">
        <Card title="Akcja" eyebrow="TURA">
          <ActionList entries={actions} />
        </Card>
        <Card title="Akcja bonusowa" eyebrow="TURA">
          <ActionList entries={[]} />
        </Card>
        <Card title="Reakcja" eyebrow="POZA TURĄ">
          <ActionList entries={[
            ['Atak okazyjny', 'Możesz wykonać atak okazyjny, gdy widziana przez ciebie istota opuszcza twój zasięg, wykorzystując do tego akcję, akcję bonusową, reakcję lub jedną ze swoich Szybkości. Aby wykonać atak okazyjny, użyj reakcji i wykonaj jeden atak wręcz bronią lub cios bez użycia broni przeciwko prowokującej istocie. Atak następuje bezpośrednio przed opuszczeniem przez nią twojego zasięgu.'],
          ]} />
        </Card>
      </div>
    </div>
  );
}
