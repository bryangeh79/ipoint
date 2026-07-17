export interface MerchantListItem {
  id: string;
  name: string;
  market: string;
  application: string;
  kyc: string;
  status: string;
}

export function filterMerchants(
  rows: ReadonlyArray<MerchantListItem>,
  query: string,
  status: string,
) {
  const normalized = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (status === 'ALL' || row.status === status) &&
      (!normalized ||
        `${row.id} ${row.name} ${row.market}`
          .toLowerCase()
          .includes(normalized)),
  );
}

export function canExecuteAdjustment(input: {
  status: string;
  makerId: string;
  checkerId?: string;
  currentActorId: string;
}) {
  return (
    input.status === 'APPROVED' &&
    Boolean(input.checkerId) &&
    input.makerId !== input.checkerId &&
    input.currentActorId !== input.makerId
  );
}

export function kycDiff<T extends Record<string, string>>(
  current: T,
  previous?: T,
) {
  return Object.entries(current).map(([field, value]) => ({
    field,
    previous: previous?.[field] ?? '—',
    current: value,
    changed: previous?.[field] !== value,
  }));
}
