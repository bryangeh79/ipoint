import {
  createIdempotencyKey,
  type AdminCommissionRateListDto,
} from '@ipoint/api-client';
import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
  Table,
} from '@ipoint/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminCommissionOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  canManageCommissionRates,
  canViewCommissionRates,
  commissionEffectiveDateFuture,
  commissionGenerationsFor,
  commissionPercentageWithinLimit,
  commissionRateGrammarValid,
  commissionRateTypeFor,
  describeCommissionReadError,
  describeCommissionWriteError,
  formatCommissionUtc,
  formatCommissionWindow,
  marketLocalTomorrow,
  orderCommissionHistory,
  resolveLocalMidnightUtc,
  type CommissionPageErrorCopy,
} from './commission-config-model.js';
import {
  CommissionEmptyState,
  CommissionErrorState,
  CommissionManageBlockedNotice,
  CommissionMarketBlockedNotice,
  CommissionRateSkeleton,
  CommissionWindowStatusBadge,
} from './commission-config-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';

/**
 * P7-S6D Admin Commission Rate Configuration page (D-054 §16 / D-055 §8).
 *
 * - Selected-market commission rate configuration: the frozen taxonomy
 *   (commission types × generations × rate types, server-provided) and
 *   every (commission_type, generation) definition with the current
 *   effective version (owner logical half-open resolution), the scheduled
 *   future versions and the full immutable history — exact decimal rates
 *   with full technical precision, the ≤6-decimal display value and the
 *   projected effective windows in market-local time AND resolved UTC.
 *   Read via the Phase 7 adapter (`commission.rate.read`, Finance admin
 *   roles). A market that is not ACTIVE is blocked — no fallback.
 * - Creating a rate version is SUPER_ADMIN-only
 *   (`commission.rate.manage`, marketScoped): commission type +
 *   generation (per the frozen taxonomy), FIXED amount vs PERCENTAGE
 *   (validated client-side as a UI affordance: exact decimals, ≤10
 *   technical decimals, percentage ≤100%), activation only at a strictly
 *   future market-local 00:00 (the picker shows the market-local wall
 *   time AND the resolved UTC), a mandatory reason, and an
 *   Idempotency-Key (same key + same payload replays the original
 *   result). The server delegates the insert to the secured Phase 5
 *   owner command (`RateManagementService.createRateVersion`) and records
 *   the privileged audit.
 *
 * All rates are exact decimal strings and are never parsed client-side.
 * UI affordances are never authorization — the server enforces permission,
 * market, taxonomy and state.
 */

type ConfigLoad =
  | { status: 'loading' }
  | { status: 'ready'; config: AdminCommissionRateListDto }
  | ({ status: 'error' } & CommissionPageErrorCopy);

interface ActionMessage {
  tone: 'success' | 'error';
  text: string;
}

export function useCommissionConfig(marketId: string | undefined): {
  load: ConfigLoad;
  retry: () => void;
} {
  const [load, setLoad] = useState<ConfigLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminCommissionOpsApi
      .listRates(marketId)
      .then((config) => {
        if (!cancelled) setLoad({ status: 'ready', config });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoad({ status: 'error', ...describeCommissionReadError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, retryKey]);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return { load, retry };
}

interface RateDraft {
  commission_type: string;
  generation: number;
  rate_value: string;
  effective_date: string;
  reason: string;
}

export function CommissionConfigPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const environment = useAdminWriteEnvironment();
  const canWrite = canPerformSensitiveAdminWrite(environment);
  const { load: configLoad, retry: retryConfig } =
    useCommissionConfig(marketId);

  const [draft, setDraft] = useState<RateDraft>({
    commission_type: 'AGENT_UPGRADE',
    generation: 1,
    rate_value: '',
    effective_date: '',
    reason: '',
  });
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const canManage = canManageCommissionRates(permissions) && canWrite;

  const timezone =
    configLoad.status === 'ready' ? configLoad.config.timezone : 'UTC';
  const configured =
    configLoad.status === 'ready' ? configLoad.config.configured : false;
  const marketCode =
    configLoad.status === 'ready' ? configLoad.config.market_code : '';
  const currency =
    configLoad.status === 'ready' ? configLoad.config.currency : '';
  const taxonomy =
    configLoad.status === 'ready' ? configLoad.config.taxonomy : [];

  const draftRateType = commissionRateTypeFor(draft.commission_type, taxonomy);
  const draftGenerations = commissionGenerationsFor(
    draft.commission_type,
    taxonomy,
  );

  // Resolved-UTC preview of the chosen activation (display helper only).
  const resolvedPreview = useMemo(() => {
    const midnight = resolveLocalMidnightUtc(draft.effective_date, timezone);
    if (!midnight) return null;
    return {
      utc: formatCommissionUtc(midnight.toISOString()),
      local: `${draft.effective_date} 00:00:00`,
    };
  }, [draft.effective_date, timezone]);

  // Definitions ordered newest-first history per definition.
  const definitions = useMemo(() => {
    if (configLoad.status !== 'ready') return [];
    return configLoad.config.definitions.map((definition) => ({
      ...definition,
      history: orderCommissionHistory(definition.history),
    }));
  }, [configLoad]);

  async function createRate() {
    if (!marketId || !canManage) return;
    if (!commissionRateGrammarValid(draft.rate_value)) {
      setMessage({
        tone: 'error',
        text: 'Rate must be a non-negative decimal string with at most 10 decimal places.',
      });
      return;
    }
    if (
      draftRateType === 'PERCENTAGE' &&
      !commissionPercentageWithinLimit(draft.rate_value)
    ) {
      setMessage({
        tone: 'error',
        text: 'A percentage rate cannot exceed 100%.',
      });
      return;
    }
    if (!commissionEffectiveDateFuture(draft.effective_date, timezone)) {
      setMessage({
        tone: 'error',
        text: 'Commission rates activate only at a strictly future market-local 00:00.',
      });
      return;
    }
    if (draft.reason.trim().length === 0) {
      setMessage({
        tone: 'error',
        text: 'A reason is mandatory for every created commission rate.',
      });
      return;
    }
    if (!draftRateType) {
      setMessage({
        tone: 'error',
        text: 'The selected commission type is not part of the frozen taxonomy.',
      });
      return;
    }
    try {
      const key = createIdempotencyKey();
      await adminCommissionOpsApi.createRate(
        marketId,
        {
          commission_type: draft.commission_type as
            | 'AGENT_UPGRADE'
            | 'MEMBER_CONSUMPTION'
            | 'MERCHANT_RECRUITMENT'
            | 'AGENT_ACTIVATION_FEE',
          generation: draft.generation,
          rate_type: draftRateType as 'FIXED' | 'PERCENTAGE',
          rate_value: draft.rate_value.trim(),
          effective_date: draft.effective_date,
          reason: draft.reason.trim(),
        },
        key,
      );
      setMessage({
        tone: 'success',
        text: `${draft.commission_type} generation ${draft.generation} rate ${draft.rate_value.trim()} scheduled.`,
      });
      setDraft({
        commission_type: 'AGENT_UPGRADE',
        generation: 1,
        rate_value: '',
        effective_date: '',
        reason: '',
      });
      retryConfig();
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: describeCommissionWriteError(error) });
    }
  }

  const minDate = marketLocalTomorrow(timezone);

  return (
    <div className="admin-page">
      <PageHeader
        title="Commission rate configuration"
        description="Selected-market commission rates (frozen taxonomy). Rates are exact decimals (FIXED in the market currency, PERCENTAGE up to 100%, ≤10 technical decimals); the UI shows at most 6. Versions are immutable, activate at a future market-local 00:00, and never reprice historical commissions. Markets that are not ACTIVE stay blocked — no fallback."
      />

      {message ? (
        <Alert
          tone={message.tone}
          title="Commission configuration"
          role="status"
        >
          {message.text}
        </Alert>
      ) : null}

      {/* ── Configuration table (per type / generation) ─────────────── */}
      <section aria-label="Commission rate versions">
        <h2 className="admin-reward-section">Rate versions</h2>
        {configLoad.status === 'loading' ? <CommissionRateSkeleton /> : null}
        {configLoad.status === 'error' ? (
          <CommissionErrorState
            title={configLoad.title}
            description={configLoad.description}
            onRetry={retryConfig}
          />
        ) : null}
        {configLoad.status === 'ready' && !configured ? (
          <CommissionMarketBlockedNotice code={marketCode} />
        ) : null}
        {configLoad.status === 'ready' &&
        configured &&
        definitions.length === 0 ? (
          <CommissionEmptyState />
        ) : null}
        {configLoad.status === 'ready' &&
        configured &&
        definitions.length > 0 ? (
          <Card>
            <p className="admin-reward-muted">
              Every commission type has a frozen rate type and generation set.
              FIXED rates are denominated in {currency}; PERCENTAGE rates cannot
              exceed 100%. The current effective version is resolved by the
              owner (latest start ≤ now wins).
            </p>
            <Table aria-label="Commission rate versions">
              <thead>
                <tr>
                  <th scope="col">Type / Generation</th>
                  <th scope="col">Rate type</th>
                  <th scope="col">Rate (display)</th>
                  <th scope="col">Full precision</th>
                  <th scope="col">Window status</th>
                  <th scope="col">Effective window (market-local)</th>
                  <th scope="col">Resolved UTC</th>
                </tr>
              </thead>
              <tbody>
                {definitions.map((definition) => {
                  const versions = definition.history;
                  if (versions.length === 0) {
                    return (
                      <tr
                        key={`${definition.commission_type}-${definition.generation}`}
                      >
                        <td
                          data-testid={`commission-definition-${definition.commission_type}-${definition.generation}`}
                        >
                          {definition.commission_type} G{definition.generation}
                        </td>
                        <td>{definition.rate_type}</td>
                        <td colSpan={5} className="admin-reward-muted">
                          Not configured yet — no rate version exists for this
                          definition.
                        </td>
                      </tr>
                    );
                  }
                  return versions.map((version) => (
                    <tr
                      key={version.id}
                      data-testid={`commission-version-${version.id}`}
                    >
                      <td>
                        {definition.commission_type} G{definition.generation}
                        {version.id === definition.current?.id ? (
                          <span
                            className="admin-reward-muted"
                            data-testid={`commission-current-${definition.commission_type}-${definition.generation}`}
                          >
                            {' '}
                            (current)
                          </span>
                        ) : null}
                      </td>
                      <td>{version.rate_type}</td>
                      <td data-testid={`commission-rate-${version.id}`}>
                        {version.display_rate}
                      </td>
                      <td>
                        <span
                          className="admin-reward-muted"
                          title="Full technical precision (storage/API)"
                          data-testid={`commission-full-${version.id}`}
                        >
                          {version.rate_value}
                        </span>
                      </td>
                      <td>
                        <CommissionWindowStatusBadge
                          status={version.window_status}
                        />
                      </td>
                      <td>{formatCommissionWindow(version)}</td>
                      <td>
                        <span className="admin-reward-muted">
                          {version.effective_from_utc}
                        </span>
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </Table>
          </Card>
        ) : null}
      </section>

      {/* ── Create action (SUPER_ADMIN only) ────────────────────────── */}
      <section aria-label="Create a commission rate">
        <h2 className="admin-reward-section">Create a commission rate</h2>
        {!canViewCommissionRates(permissions) ? (
          <CommissionErrorState
            title="Permission denied"
            description="The server did not grant the commission.rate.read permission for this market."
            onRetry={retryConfig}
          />
        ) : null}
        {canViewCommissionRates(permissions) && !canManage ? (
          <CommissionManageBlockedNotice />
        ) : null}
        {canViewCommissionRates(permissions) && canManage ? (
          <Card>
            {configLoad.status !== 'ready' ? (
              <CommissionRateSkeleton rows={2} />
            ) : !configured ? (
              <CommissionMarketBlockedNotice code={marketCode} />
            ) : (
              <div className="admin-reward-form">
                <FormField label="Commission type" htmlFor="commission-type">
                  <Select
                    id="commission-type"
                    aria-label="Commission type"
                    value={draft.commission_type}
                    onChange={(event) => {
                      const nextType = event.target.value;
                      const generations = commissionGenerationsFor(
                        nextType,
                        taxonomy,
                      );
                      setDraft((current) => ({
                        ...current,
                        commission_type: nextType,
                        generation: generations[0] ?? 0,
                      }));
                    }}
                  >
                    {taxonomy.map((entry) => (
                      <option
                        key={entry.commission_type}
                        value={entry.commission_type}
                      >
                        {entry.commission_type}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Generation" htmlFor="commission-generation">
                  <Select
                    id="commission-generation"
                    aria-label="Generation"
                    value={String(draft.generation)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        generation: Number(event.target.value),
                      }))
                    }
                  >
                    {draftGenerations.map((generation) => (
                      <option key={generation} value={String(generation)}>
                        Generation {generation}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField
                  label={`Rate (${draftRateType ?? ''}${draftRateType === 'FIXED' ? ` — ${currency}` : ' %'})`}
                  htmlFor="commission-rate"
                >
                  <Input
                    id="commission-rate"
                    aria-label="Rate"
                    placeholder={
                      draftRateType === 'PERCENTAGE'
                        ? 'e.g. 1.5 (percent)'
                        : `e.g. 388 (${currency})`
                    }
                    value={draft.rate_value}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        rate_value: event.target.value,
                      }))
                    }
                  />
                  <p className="admin-reward-muted">
                    {draftRateType === 'FIXED'
                      ? `FIXED rate denominated in ${currency}; up to 10 decimals accepted.`
                      : 'PERCENTAGE rate up to 100%; up to 10 decimals accepted.'}
                  </p>
                </FormField>
                <FormField
                  label="Activation date (market-local)"
                  htmlFor="commission-effective-date"
                >
                  <Input
                    id="commission-effective-date"
                    aria-label="Activation date"
                    type="date"
                    min={minDate}
                    value={draft.effective_date}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        effective_date: event.target.value,
                      }))
                    }
                  />
                </FormField>
                {resolvedPreview ? (
                  <p
                    className="admin-reward-muted"
                    data-testid="commission-utc-preview"
                  >
                    Activates {resolvedPreview.local} ({timezone}) ={' '}
                    {resolvedPreview.utc} UTC
                  </p>
                ) : null}
                <FormField
                  label="Reason (mandatory)"
                  htmlFor="commission-reason"
                >
                  <Input
                    id="commission-reason"
                    aria-label="Reason"
                    placeholder="Why is this rate being created?"
                    value={draft.reason}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <Button variant="primary" onClick={() => void createRate()}>
                  Create commission rate (Super Admin, audited)
                </Button>
              </div>
            )}
          </Card>
        ) : null}
      </section>
    </div>
  );
}
