export const MAX_ITEM_QUANTITY = 9999;
export const MAX_EQUIPMENT_GRANTS = 450;

export function splitGold(gold, recipientCount) {
  if (recipientCount === 0) return [];
  const share = Math.floor(gold / recipientCount);
  const remainder = gold % recipientCount;
  return Array.from({ length: recipientCount }, (_, index) => share + Number(index < remainder));
}
