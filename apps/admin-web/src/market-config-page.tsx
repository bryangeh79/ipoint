import {
  createIdempotencyKey,
  type AdminMarketDetailDto,
} from '@ipoint/api-client';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  FormField,
  Input,
  PageHeader,
  Select,
} from '@ipoint/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminMarketOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  canManageMarket,
  canViewMarket,
  describeMarketReadError,
  describeMarketWriteError,
  marketCurrencyValid,
  marketLocaleValid,
  marketNameValid,
  marketTimezoneValid,
  type MarketConfigDraft,
  type MarketPageErrorCopy,
} from './market-config-model.js';
import {
  MarketBlockedNotice,
  MarketErrorState,
  MarketPermissionDeniedState,
  MarketStatusBadge,
  MarketConfigSkeleton,
} from './market-config-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';

/**
 * P7-S6E Admin Market Configuration page (secured market owner).
 *
 * - Selected-market registry read (`market.read`, all Admin roles,
 *   marketScoped): code, name, status, currency code, IANA timezone,
 *   default locale and timestamps. A market that is not ACTIVE is
 *   blocked (`configured: false`, no fallback).
 * - Controlled update (`market.manage`, SUPER_ADMIN only, marketScoped,
 *   step-up required server-side): name (1..200), currencyCode (3
 *   uppercase letters), timezone (valid IANA), defaultLocale
 *   (BCP-47-style), and status ACTIVE → INACTIVE with an explicit
 *   deactivation confirmation and the server's dependency gate. The
 *   reason is mandatory and the Idempotency-Key is generated
 *   automatically per submit (same key + same payload replays the
 *   original result server-side).
 *
 * UI affordances are never authorization — the server enforces
 * permission, market scope, step-up, reason, idempotency and the
 * deactivation dependency gate.
 */

type ConfigLoad =
  | { status: 'loading' }
  | { status: 'ready'; config: AdminMarketDetailDto }
  | ({ status: 'error' } & MarketPageErrorCopy);

interface ActionMessage {
  tone: 'success' | 'error';
  text: string;
}

export function useMarketConfig(marketId: string | undefined): {
  load: ConfigLoad;
  retry: () => void;
} {
  const [load, setLoad] = useState<ConfigLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminMarketOpsApi
      .getMarket(marketId)
      .then((config) => {
        if (!cancelled) setLoad({ status: 'ready', config });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoad({ status: 'error', ...describeMarketReadError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, retryKey]);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return { load, retry };
}

export function MarketConfigPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const environment = useAdminWriteEnvironment();
  const canWriteEnvironment = canPerformSensitiveAdminWrite(environment);
  const { load: configLoad, retry: retryConfig } = useMarketConfig(marketId);

  const current = configLoad.status === 'ready' ? configLoad.config : undefined;

  const [draft, setDraft] = useState<MarketConfigDraft>({
    name: '',
    currencyCode: '',
    timezone: '',
    defaultLocale: '',
    status: 'ACTIVE',
    reason: '',
    deactivationConfirmed: false,
  });
  const [message, setMessage] = useState<ActionMessage | null>(null);

  // Seed the draft from the server row once it loads.
  useEffect(() => {
    if (configLoad.status === 'ready') {
      setDraft((previous) => ({
        ...previous,
        name: configLoad.config.name,
        currencyCode: configLoad.config.currency_code,
        timezone: configLoad.config.timezone,
        defaultLocale: configLoad.config.default_locale,
        status: configLoad.config.status,
      }));
    }
  }, [configLoad]);

  const canView = canViewMarket(permissions);
  const canWrite = canManageMarket(permissions) && canWriteEnvironment;

  // Only fields that actually differ from the server row are sent.
  const changedFields = useMemo(() => {
    if (!current) return {};
    const fields: Record<string, unknown> = {};
    if (draft.name.trim() !== current.name) fields.name = draft.name.trim();
    if (draft.currencyCode.trim() !== current.currency_code) {
      fields.currencyCode = draft.currencyCode.trim();
    }
    if (draft.timezone.trim() !== current.timezone) {
      fields.timezone = draft.timezone.trim();
    }
    if (draft.defaultLocale.trim() !== current.default_locale) {
      fields.defaultLocale = draft.defaultLocale.trim();
    }
    if (draft.status !== current.status) fields.status = draft.status;
    return fields;
  }, [current, draft]);

  const deactivating =
    current?.status === 'ACTIVE' && draft.status === 'INACTIVE';
  const hasChanges = Object.keys(changedFields).length > 0;

  const fieldsValid = useMemo(() => {
    if (!current) return false;
    if (!marketNameValid(draft.name)) return false;
    if (!marketCurrencyValid(draft.currencyCode)) return false;
    if (!marketTimezoneValid(draft.timezone)) return false;
    if (!marketLocaleValid(draft.defaultLocale)) return false;
    return true;
  }, [current, draft]);

  const formValid =
    fieldsValid &&
    hasChanges &&
    draft.reason.trim().length > 0 &&
    (!deactivating || draft.deactivationConfirmed);

  async function submitUpdate() {
    if (!marketId || !current || !canWrite) return;
    if (!formValid) return;
    try {
      const key = createIdempotencyKey();
      await adminMarketOpsApi.updateMarket(
        marketId,
        {
          ...changedFields,
          reason: draft.reason.trim(),
          ...(deactivating ? { deactivationConfirmed: true } : {}),
        },
        key,
      );
      setMessage({
        tone: 'success',
        text: deactivating
          ? `Market ${current.market_code} deactivated.`
          : `Market ${current.market_code} updated.`,
      });
      setDraft((previous) => ({ ...previous, reason: '' }));
      retryConfig();
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: describeMarketWriteError(error) });
    }
  }

  return (
    <div className="admin-page">
      <PageHeader
        title="Market configuration"
        description="Selected-market registry (market.read, all Admin roles). Managed only by Super Admin (market.manage, step-up required): name, currency code, IANA timezone, default locale and the ACTIVE ↔ INACTIVE status with explicit confirmation and a dependency gate. Markets that are not ACTIVE stay blocked — no fallback."
      />

      {message ? (
        <Alert tone={message.tone} title="Market configuration" role="status">
          {message.text}
        </Alert>
      ) : null}

      {configLoad.status === 'loading' ? <MarketConfigSkeleton /> : null}
      {configLoad.status === 'error' ? (
        <MarketErrorState
          title={configLoad.title}
          description={configLoad.description}
          onRetry={retryConfig}
        />
      ) : null}
      {configLoad.status === 'ready' && !canView ? (
        <MarketPermissionDeniedState permission="market.read" />
      ) : null}
      {configLoad.status === 'ready' && canView && !current?.configured ? (
        <MarketBlockedNotice marketCode={current?.market_code ?? ''} />
      ) : null}

      {configLoad.status === 'ready' && canView && current?.configured ? (
        <Card>
          <div className="admin-market-meta">
            <p>
              <strong>Market code:</strong> {current.market_code}
            </p>
            <p>
              <strong>Status:</strong>{' '}
              <MarketStatusBadge status={current.status} />
            </p>
            <p>
              <strong>Created:</strong>{' '}
              {new Date(current.created_at).toISOString()}
            </p>
            <p>
              <strong>Last updated:</strong>{' '}
              {new Date(current.updated_at).toISOString()}
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitUpdate();
            }}
            aria-label="Market configuration form"
          >
            <FormField
              label="Market name"
              hint="Trimmed, 1..200 characters."
              htmlFor="market-name"
            >
              <Input
                id="market-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }))
                }
                data-testid="market-name-input"
              />
            </FormField>

            <FormField
              label="Currency code"
              hint="ISO 4217, exactly 3 uppercase letters."
              htmlFor="market-currency"
            >
              <Input
                id="market-currency"
                value={draft.currencyCode}
                maxLength={3}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    currencyCode: event.target.value.toUpperCase(),
                  }))
                }
                data-testid="market-currency-input"
              />
            </FormField>

            <FormField
              label="Timezone"
              hint="Valid IANA timezone identifier."
              htmlFor="market-timezone"
            >
              <Input
                id="market-timezone"
                value={draft.timezone}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    timezone: event.target.value,
                  }))
                }
                data-testid="market-timezone-input"
              />
            </FormField>

            <FormField
              label="Default locale"
              hint="BCP-47-style locale, e.g. en-MY."
              htmlFor="market-locale"
            >
              <Input
                id="market-locale"
                value={draft.defaultLocale}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    defaultLocale: event.target.value,
                  }))
                }
                data-testid="market-locale-input"
              />
            </FormField>

            <FormField label="Status" htmlFor="market-status">
              <Select
                id="market-status"
                value={draft.status}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    status: event.target.value as 'ACTIVE' | 'INACTIVE',
                    ...(event.target.value === 'ACTIVE'
                      ? { deactivationConfirmed: false }
                      : {}),
                  }))
                }
                data-testid="market-status-select"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </Select>
            </FormField>

            {deactivating ? (
              <div className="admin-market-deactivation" role="note">
                <p className="admin-market-deactivation__copy">
                  Deactivating the market is a one-way transition on this
                  surface: while INACTIVE the market can no longer be a Current
                  Admin Market, and the owner blocks the transition while active
                  merchants, members or configuration references depend on it.
                </p>
                <Checkbox
                  label="I confirm the deactivation of this market."
                  checked={draft.deactivationConfirmed}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      deactivationConfirmed: event.target.checked,
                    }))
                  }
                  data-testid="market-deactivation-confirm"
                />
              </div>
            ) : null}

            <FormField
              label="Reason"
              hint="Mandatory for every update (1..500 characters)."
              htmlFor="market-reason"
            >
              <Input
                id="market-reason"
                value={draft.reason}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    reason: event.target.value,
                  }))
                }
                data-testid="market-reason-input"
              />
            </FormField>

            {!canWriteEnvironment && (
              <p className="admin-reward-muted">
                Sensitive market writes require the full online desktop web
                flow.
              </p>
            )}

            <Button
              type="submit"
              disabled={!canWrite || !formValid}
              data-testid="market-submit-button"
            >
              {deactivating ? 'Deactivate market' : 'Save market'}
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
