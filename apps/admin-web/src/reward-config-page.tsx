import {
  createIdempotencyKey,
  type AdminRewardRuleListDto,
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
import { adminRewardOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  canScheduleRewardRules,
  canViewRewardRules,
  describeRewardReadError,
  describeRewardWriteError,
  formatRewardUtc,
  formatRewardWindow,
  marketLocalTomorrow,
  orderRewardRules,
  resolveLocalMidnightUtc,
  rewardEffectiveDateFuture,
  rewardRateGrammarValid,
  rewardRateWithinGovernance,
  rewardRateWithinPackageMax,
  type RewardPageErrorCopy,
} from './reward-config-model.js';
import {
  RewardEmptyState,
  RewardErrorState,
  RewardScheduleBlockedNotice,
  RewardScheduleSkeleton,
  RewardWindowStatusBadge,
} from './reward-config-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';

/**
 * P7-S6B Admin Reward Configuration page (frozen contract §7.1, decisions
 * P7-OD-04 / P7-OD-05, D-046).
 *
 * - Selected-market reward schedule: every rule version with exact `%/day`
 *   decimal rates, the §7.1 package references (A 0.0125, B 0.025,
 *   C/D/E/F 0.05 %/day maxima) and the projected effective windows in
 *   market-local time AND resolved UTC. Read via the Phase 7 adapter
 *   (`reward.rule.read`, all admin roles).
 * - Scheduling a new version is SUPER_ADMIN-only
 *   (`reward.rule.schedule`, marketScoped): rate validated client-side as
 *   a UI affordance (0%–0.05%/day, at most six decimals, package A–F
 *   maxima), activation only at a strictly future market-local 00:00
 *   (the picker shows the market-local wall time AND the resolved UTC),
 *   a mandatory reason, and an Idempotency-Key (same key + same payload
 *   replays the original result). The server delegates the insert to the
 *   frozen Phase 3 owner command and records the privileged audit.
 *
 * All rates are exact decimal strings and are never parsed client-side.
 * UI affordances are never authorization — the server enforces permission,
 * market, and state.
 */

type ScheduleLoad =
  | { status: 'loading' }
  | { status: 'ready'; schedule: AdminRewardRuleListDto }
  | ({ status: 'error' } & RewardPageErrorCopy);

interface ActionMessage {
  tone: 'success' | 'error';
  text: string;
}

export function useRewardSchedule(marketId: string | undefined): {
  load: ScheduleLoad;
  retry: () => void;
} {
  const [load, setLoad] = useState<ScheduleLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminRewardOpsApi
      .listRules(marketId)
      .then((schedule) => {
        if (!cancelled) setLoad({ status: 'ready', schedule });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoad({ status: 'error', ...describeRewardReadError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, retryKey]);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return { load, retry };
}

interface ScheduleDraft {
  package_reference: string;
  rate: string;
  effective_date: string;
  reason: string;
}

export function RewardConfigPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const environment = useAdminWriteEnvironment();
  const canWrite = canPerformSensitiveAdminWrite(environment);
  const { load: scheduleLoad, retry: retrySchedule } =
    useRewardSchedule(marketId);

  const [draft, setDraft] = useState<ScheduleDraft>({
    package_reference: 'C',
    rate: '',
    effective_date: '',
    reason: '',
  });
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const canSchedule = canScheduleRewardRules(permissions) && canWrite;

  const timezone =
    scheduleLoad.status === 'ready' ? scheduleLoad.schedule.timezone : 'UTC';

  // Resolved-UTC preview of the chosen activation (display helper only).
  const resolvedPreview = useMemo(() => {
    const midnight = resolveLocalMidnightUtc(draft.effective_date, timezone);
    if (!midnight) return null;
    return {
      utc: formatRewardUtc(midnight.toISOString()),
      local: `${draft.effective_date} 00:00:00`,
    };
  }, [draft.effective_date, timezone]);

  const packageMax =
    scheduleLoad.status === 'ready'
      ? scheduleLoad.schedule.packages.find(
          (entry) => entry.code === draft.package_reference,
        )?.max_rate_per_day
      : undefined;

  const rules = useMemo(() => {
    if (scheduleLoad.status !== 'ready') return [];
    return orderRewardRules(scheduleLoad.schedule.rules);
  }, [scheduleLoad]);

  async function scheduleRate() {
    if (!marketId || !canSchedule) return;
    if (!rewardRateGrammarValid(draft.rate)) {
      setMessage({
        tone: 'error',
        text: 'Rate must be a non-negative decimal string with at most 6 decimal places.',
      });
      return;
    }
    if (!rewardRateWithinGovernance(draft.rate)) {
      setMessage({
        tone: 'error',
        text: 'A reward rate above 0.05% per day requires a new governance decision.',
      });
      return;
    }
    if (
      packageMax !== undefined &&
      !rewardRateWithinPackageMax(draft.rate, packageMax)
    ) {
      setMessage({
        tone: 'error',
        text: `The reward rate exceeds the ${draft.package_reference} package maximum of ${packageMax}% per day.`,
      });
      return;
    }
    if (!rewardEffectiveDateFuture(draft.effective_date, timezone)) {
      setMessage({
        tone: 'error',
        text: 'Reward rates activate only at a strictly future market-local 00:00.',
      });
      return;
    }
    if (draft.reason.trim().length === 0) {
      setMessage({
        tone: 'error',
        text: 'A reason is mandatory for every scheduled reward rate.',
      });
      return;
    }
    try {
      const key = createIdempotencyKey();
      await adminRewardOpsApi.createRule(
        marketId,
        {
          package_reference: draft.package_reference as
            | 'A'
            | 'B'
            | 'C'
            | 'D'
            | 'E'
            | 'F',
          rate: draft.rate.trim(),
          effective_date: draft.effective_date,
          reason: draft.reason.trim(),
        },
        key,
      );
      setMessage({
        tone: 'success',
        text: `Reward rate scheduled for package ${draft.package_reference}.`,
      });
      setDraft({
        package_reference: 'C',
        rate: '',
        effective_date: '',
        reason: '',
      });
      retrySchedule();
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: describeRewardWriteError(error) });
    }
  }

  const minDate = marketLocalTomorrow(timezone);

  return (
    <div className="admin-page">
      <PageHeader
        title="Reward rate configuration"
        description="Selected-market reward schedule with §7.1 package references. Rates are exact decimals (%/day, 0%–0.05%); every version activates at a future market-local 00:00 and scheduling is Super Admin only."
      />

      {message ? (
        <Alert tone={message.tone} title="Reward configuration" role="status">
          {message.text}
        </Alert>
      ) : null}

      {/* ── Schedule ────────────────────────────────────────────────── */}
      <section aria-label="Reward schedule">
        <h2 className="admin-reward-section">Reward schedule</h2>
        {scheduleLoad.status === 'loading' ? <RewardScheduleSkeleton /> : null}
        {scheduleLoad.status === 'error' ? (
          <RewardErrorState
            title={scheduleLoad.title}
            description={scheduleLoad.description}
            onRetry={retrySchedule}
          />
        ) : null}
        {scheduleLoad.status === 'ready' && rules.length === 0 ? (
          <RewardEmptyState />
        ) : null}
        {scheduleLoad.status === 'ready' && rules.length > 0 ? (
          <Card>
            <Table aria-label="Reward schedule">
              <thead>
                <tr>
                  <th scope="col">Package</th>
                  <th scope="col">Rate (%/day)</th>
                  <th scope="col">Window status</th>
                  <th scope="col">Effective window (market-local)</th>
                  <th scope="col">Resolved UTC</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td data-testid={`reward-package-${rule.id}`}>
                      {rule.package_reference ?? '—'}
                    </td>
                    <td data-testid={`reward-rate-${rule.id}`}>
                      {rule.reward_rate}
                    </td>
                    <td>
                      <RewardWindowStatusBadge status={rule.window_status} />
                    </td>
                    <td>{formatRewardWindow(rule)}</td>
                    <td>
                      <span className="admin-reward-muted">
                        {rule.effective_from_utc}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : null}
      </section>

      {/* ── §7.1 package references ─────────────────────────────────── */}
      <section aria-label="Package rate maxima">
        <h2 className="admin-reward-section">Package rate maxima (§7.1)</h2>
        {scheduleLoad.status === 'ready' ? (
          <Card>
            <p className="admin-reward-muted">
              A version for a package cannot exceed its locked maximum; the
              global governance ceiling is 0.05%/day.
            </p>
            <Table aria-label="Package rate maxima">
              <thead>
                <tr>
                  <th scope="col">Package</th>
                  <th scope="col">Max rate (%/day)</th>
                </tr>
              </thead>
              <tbody>
                {scheduleLoad.schedule.packages.map((entry) => (
                  <tr key={entry.code}>
                    <td data-testid={`reward-max-${entry.code}`}>
                      {entry.code}
                    </td>
                    <td>{entry.max_rate_per_day}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : null}
      </section>

      {/* ── Schedule action (SUPER_ADMIN only) ──────────────────────── */}
      <section aria-label="Schedule a reward rate">
        <h2 className="admin-reward-section">Schedule a reward rate</h2>
        {!canViewRewardRules(permissions) ? (
          <RewardErrorState
            title="Permission denied"
            description="The server did not grant the reward.rule.read permission for this market."
            onRetry={retrySchedule}
          />
        ) : null}
        {canViewRewardRules(permissions) && !canSchedule ? (
          <RewardScheduleBlockedNotice />
        ) : null}
        {canViewRewardRules(permissions) && canSchedule ? (
          <Card>
            {scheduleLoad.status !== 'ready' ? (
              <RewardScheduleSkeleton rows={2} />
            ) : (
              <div className="admin-reward-form">
                <FormField label="Package reference" htmlFor="reward-package">
                  <Select
                    id="reward-package"
                    aria-label="Package reference"
                    value={draft.package_reference}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        package_reference: event.target.value,
                      }))
                    }
                  >
                    {['A', 'B', 'C', 'D', 'E', 'F'].map((code) => (
                      <option key={code} value={code}>
                        Package {code}
                        {packageMax !== undefined &&
                        code === draft.package_reference
                          ? ` (max ${packageMax}%/day)`
                          : ''}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Rate (%/day)" htmlFor="reward-rate">
                  <Input
                    id="reward-rate"
                    aria-label="Rate percent per day"
                    placeholder="e.g. 0.0125"
                    value={draft.rate}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        rate: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField
                  label="Activation date (market-local)"
                  htmlFor="reward-effective-date"
                >
                  <Input
                    id="reward-effective-date"
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
                    data-testid="reward-utc-preview"
                  >
                    Activates {resolvedPreview.local} ({timezone}) ={' '}
                    {resolvedPreview.utc} UTC
                  </p>
                ) : null}
                <FormField label="Reason (mandatory)" htmlFor="reward-reason">
                  <Input
                    id="reward-reason"
                    aria-label="Reason"
                    placeholder="Why is this rate being scheduled?"
                    value={draft.reason}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <Button variant="primary" onClick={() => void scheduleRate()}>
                  Schedule reward rate (Super Admin, audited)
                </Button>
              </div>
            )}
          </Card>
        ) : null}
      </section>
    </div>
  );
}
