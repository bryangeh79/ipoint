import {
  createIdempotencyKey,
  type AdminRedemptionRateListDto,
} from '@ipoint/api-client';
import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Table,
} from '@ipoint/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminRedemptionOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  canManageRedemptionRates,
  canViewRedemptionRates,
  describeRedemptionReadError,
  describeRedemptionWriteError,
  formatRedemptionUtc,
  formatRedemptionWindow,
  marketLocalTomorrow,
  orderRedemptionRates,
  redemptionEffectiveDateFuture,
  redemptionRateGrammarValid,
  redemptionRateWithinBounds,
  resolveLocalMidnightUtc,
  type RedemptionPageErrorCopy,
} from './redemption-config-model.js';
import {
  RedemptionEmptyState,
  RedemptionErrorState,
  RedemptionManageBlockedNotice,
  RedemptionMarketBlockedNotice,
  RedemptionRateSkeleton,
  RedemptionWindowStatusBadge,
} from './redemption-config-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';

/**
 * P7-S6C Admin Redemption Rate Configuration page (frozen contract §7.2,
 * D-046).
 *
 * - Selected-market redemption rate configuration: the approved §7.2
 *   per-market bounds (initial / minimum / maximum / currency / display
 *   unit) and every `POINTS_PER_CURRENCY` version with full technical
 *   precision, the ≤6-decimal display value and the projected effective
 *   windows in market-local time AND resolved UTC. Read via the Phase 7
 *   adapter (`redemption.rate.read`, all admin roles).
 * - A market WITHOUT an approved configuration shows the explicit blocked
 *   state — the surface never falls back to Malaysia or any other market.
 * - Configuring a rate is SUPER_ADMIN-only (`redemption.rate.manage`,
 *   marketScoped): rate validated client-side as a UI affordance (at most
 *   ten technical decimals, within the approved per-market minimum/maximum
 *   bounds), activation only at a strictly future market-local 00:00 (the
 *   picker shows the market-local wall time AND the resolved UTC), a
 *   mandatory reason, and an Idempotency-Key (same key + same payload
 *   replays the original result). The server delegates the insert to the
 *   frozen Phase 6 owner command and records the privileged audit.
 *
 * All rates are exact decimal strings and are never parsed client-side.
 * UI affordances are never authorization — the server enforces permission,
 * market, and state.
 */

type ConfigLoad =
  | { status: 'loading' }
  | { status: 'ready'; config: AdminRedemptionRateListDto }
  | ({ status: 'error' } & RedemptionPageErrorCopy);

interface ActionMessage {
  tone: 'success' | 'error';
  text: string;
}

export function useRedemptionConfig(marketId: string | undefined): {
  load: ConfigLoad;
  retry: () => void;
} {
  const [load, setLoad] = useState<ConfigLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminRedemptionOpsApi
      .listRates(marketId)
      .then((config) => {
        if (!cancelled) setLoad({ status: 'ready', config });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoad({ status: 'error', ...describeRedemptionReadError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, retryKey]);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return { load, retry };
}

interface RateDraft {
  rate_value: string;
  effective_date: string;
  reason: string;
}

export function RedemptionConfigPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const environment = useAdminWriteEnvironment();
  const canWrite = canPerformSensitiveAdminWrite(environment);
  const { load: configLoad, retry: retryConfig } =
    useRedemptionConfig(marketId);

  const [draft, setDraft] = useState<RateDraft>({
    rate_value: '',
    effective_date: '',
    reason: '',
  });
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const canManage = canManageRedemptionRates(permissions) && canWrite;

  const timezone =
    configLoad.status === 'ready' ? configLoad.config.timezone : 'UTC';
  const bounds =
    configLoad.status === 'ready' ? configLoad.config.config : null;
  const configured =
    configLoad.status === 'ready' ? configLoad.config.configured : false;
  const marketCode =
    configLoad.status === 'ready' ? configLoad.config.market_code : '';

  // Resolved-UTC preview of the chosen activation (display helper only).
  const resolvedPreview = useMemo(() => {
    const midnight = resolveLocalMidnightUtc(draft.effective_date, timezone);
    if (!midnight) return null;
    return {
      utc: formatRedemptionUtc(midnight.toISOString()),
      local: `${draft.effective_date} 00:00:00`,
    };
  }, [draft.effective_date, timezone]);

  const rates = useMemo(() => {
    if (configLoad.status !== 'ready') return [];
    return orderRedemptionRates(configLoad.config.rates);
  }, [configLoad]);

  async function configureRate() {
    if (!marketId || !canManage) return;
    if (bounds === null) {
      setMessage({
        tone: 'error',
        text: 'This market has no approved redemption rate configuration.',
      });
      return;
    }
    if (!redemptionRateGrammarValid(draft.rate_value)) {
      setMessage({
        tone: 'error',
        text: 'Rate must be a non-negative decimal string with at most 10 decimal places.',
      });
      return;
    }
    if (
      !redemptionRateWithinBounds(
        draft.rate_value,
        bounds.minimum_rate,
        bounds.maximum_rate,
      )
    ) {
      setMessage({
        tone: 'error',
        text: `Rate must be between ${bounds.minimum_rate} and ${bounds.maximum_rate} ${bounds.display_unit} (approved bounds for this market).`,
      });
      return;
    }
    if (!redemptionEffectiveDateFuture(draft.effective_date, timezone)) {
      setMessage({
        tone: 'error',
        text: 'Redemption rates activate only at a strictly future market-local 00:00.',
      });
      return;
    }
    if (draft.reason.trim().length === 0) {
      setMessage({
        tone: 'error',
        text: 'A reason is mandatory for every configured redemption rate.',
      });
      return;
    }
    try {
      const key = createIdempotencyKey();
      await adminRedemptionOpsApi.createRate(
        marketId,
        {
          rate_value: draft.rate_value.trim(),
          effective_date: draft.effective_date,
          reason: draft.reason.trim(),
        },
        key,
      );
      setMessage({
        tone: 'success',
        text: `Redemption rate ${draft.rate_value.trim()} scheduled.`,
      });
      setDraft({ rate_value: '', effective_date: '', reason: '' });
      retryConfig();
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: describeRedemptionWriteError(error) });
    }
  }

  const minDate = marketLocalTomorrow(timezone);

  return (
    <div className="admin-page">
      <PageHeader
        title="Redemption rate configuration"
        description="Selected-market redemption rate (§7.2). Rates are exact decimals (local currency per 1 iPoint, ≤10 technical decimals); the UI shows at most 6. Versions are immutable, activate at a future market-local 00:00, and never reprice historical quotes or orders. Markets without an approved configuration stay blocked — no fallback."
      />

      {message ? (
        <Alert
          tone={message.tone}
          title="Redemption configuration"
          role="status"
        >
          {message.text}
        </Alert>
      ) : null}

      {/* ── Configuration bounds ───────────────────────────────────── */}
      <section aria-label="Approved rate bounds">
        <h2 className="admin-reward-section">Approved configuration (§7.2)</h2>
        {configLoad.status === 'loading' ? (
          <RedemptionRateSkeleton rows={2} />
        ) : null}
        {configLoad.status === 'error' ? (
          <RedemptionErrorState
            title={configLoad.title}
            description={configLoad.description}
            onRetry={retryConfig}
          />
        ) : null}
        {configLoad.status === 'ready' ? (
          configured && bounds !== null ? (
            <Card>
              <p className="admin-reward-muted">
                Every configured rate must stay within the approved minimum and
                maximum for this market. Technical precision is up to{' '}
                {bounds.technical_decimals} decimals; the UI displays up to{' '}
                {bounds.display_decimals}.
              </p>
              <Table aria-label="Approved redemption rate bounds">
                <thead>
                  <tr>
                    <th scope="col">Initial</th>
                    <th scope="col">Minimum</th>
                    <th scope="col">Maximum</th>
                    <th scope="col">Currency</th>
                    <th scope="col">Display unit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td data-testid="redemption-config-initial">
                      {bounds.initial_rate}
                    </td>
                    <td data-testid="redemption-config-min">
                      {bounds.minimum_rate}
                    </td>
                    <td data-testid="redemption-config-max">
                      {bounds.maximum_rate}
                    </td>
                    <td>{bounds.currency}</td>
                    <td>{bounds.display_unit}</td>
                  </tr>
                </tbody>
              </Table>
            </Card>
          ) : (
            <RedemptionMarketBlockedNotice code={marketCode} />
          )
        ) : null}
      </section>

      {/* ── Rate versions ──────────────────────────────────────────── */}
      <section aria-label="Rate versions">
        <h2 className="admin-reward-section">Rate versions</h2>
        {configLoad.status === 'loading' ? <RedemptionRateSkeleton /> : null}
        {configLoad.status === 'ready' && rates.length === 0 ? (
          <RedemptionEmptyState />
        ) : null}
        {configLoad.status === 'ready' && rates.length > 0 ? (
          <Card>
            <p className="admin-reward-muted">
              Quotes and orders keep the rate version they were locked to at
              quote time — a new version never reprices history.
            </p>
            <Table aria-label="Redemption rate versions">
              <thead>
                <tr>
                  <th scope="col">Rate (display)</th>
                  <th scope="col">Full precision</th>
                  <th scope="col">Window status</th>
                  <th scope="col">Effective window (market-local)</th>
                  <th scope="col">Resolved UTC</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id}>
                    <td data-testid={`redemption-rate-${rate.id}`}>
                      {rate.display_rate}
                    </td>
                    <td>
                      <span
                        className="admin-reward-muted"
                        title="Full technical precision (storage/API)"
                        data-testid={`redemption-full-${rate.id}`}
                      >
                        {rate.rate_value}
                      </span>
                    </td>
                    <td>
                      <RedemptionWindowStatusBadge
                        status={rate.window_status}
                      />
                    </td>
                    <td>{formatRedemptionWindow(rate)}</td>
                    <td>
                      <span className="admin-reward-muted">
                        {rate.effective_from_utc}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : null}
      </section>

      {/* ── Configure action (SUPER_ADMIN only) ────────────────────── */}
      <section aria-label="Configure a redemption rate">
        <h2 className="admin-reward-section">Configure a redemption rate</h2>
        {!canViewRedemptionRates(permissions) ? (
          <RedemptionErrorState
            title="Permission denied"
            description="The server did not grant the redemption.rate.read permission for this market."
            onRetry={retryConfig}
          />
        ) : null}
        {canViewRedemptionRates(permissions) && !canManage ? (
          <RedemptionManageBlockedNotice />
        ) : null}
        {canViewRedemptionRates(permissions) && canManage ? (
          <Card>
            {configLoad.status !== 'ready' ? (
              <RedemptionRateSkeleton rows={2} />
            ) : !configured || bounds === null ? (
              <RedemptionMarketBlockedNotice code={marketCode} />
            ) : (
              <div className="admin-reward-form">
                <FormField
                  label="Rate (per 1 iPoint)"
                  htmlFor="redemption-rate"
                >
                  <Input
                    id="redemption-rate"
                    aria-label="Rate per 1 iPoint"
                    placeholder={`e.g. ${bounds.initial_rate} (${bounds.display_unit})`}
                    value={draft.rate_value}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        rate_value: event.target.value,
                      }))
                    }
                  />
                  <p className="admin-reward-muted">
                    Approved bounds for this market: {bounds.minimum_rate} –{' '}
                    {bounds.maximum_rate} {bounds.display_unit}; up to{' '}
                    {bounds.technical_decimals} decimals accepted.
                  </p>
                </FormField>
                <FormField
                  label="Activation date (market-local)"
                  htmlFor="redemption-effective-date"
                >
                  <Input
                    id="redemption-effective-date"
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
                    data-testid="redemption-utc-preview"
                  >
                    Activates {resolvedPreview.local} ({timezone}) ={' '}
                    {resolvedPreview.utc} UTC
                  </p>
                ) : null}
                <FormField
                  label="Reason (mandatory)"
                  htmlFor="redemption-reason"
                >
                  <Input
                    id="redemption-reason"
                    aria-label="Reason"
                    placeholder="Why is this rate being configured?"
                    value={draft.reason}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <Button variant="primary" onClick={() => void configureRate()}>
                  Configure redemption rate (Super Admin, audited)
                </Button>
              </div>
            )}
          </Card>
        ) : null}
      </section>
    </div>
  );
}
