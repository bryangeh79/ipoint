import {
  createIdempotencyKey,
  type AdminIpointAdjustmentConfigDto,
  type AdminIpointWalletLookupDto,
} from '@ipoint/api-client';
import { Button, Card, FormField, Input, PageHeader, Select } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminIpointAdjustOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  canCreateIpointAdjustment,
  describeIpointAdjustmentReadError,
  describeIpointAdjustmentWriteError,
  ipointAdjustmentAboveSoftCap,
  ipointAdjustmentAmountValid,
  type IpointAdjustmentPageErrorCopy,
} from './ipoint-adjust-model.js';
import {
  IpointAdjustmentActionNotice,
  IpointAdjustmentErrorState,
  IpointAdjustmentMarketBlockedNotice,
  IpointAdjustmentPermissionDeniedState,
  IpointAdjustmentSkeleton,
} from './ipoint-adjust-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';

/**
 * P7-S7B Manual iPoint Adjustment — Maker create form (SEC-01 §6 /
 * P7-S1 §17, P7-OD-11).
 *
 * Double gate: the `wallet.ipoint.adjust.maker` permission (server
 * marketScoped) AND the sensitive-write environment (online desktop Admin
 * Web — no offline privileged write). The form collects the evidence
 * contract (reason code from the market catalog, explanation, case
 * reference, optional opaque attachment reference), validates the amount
 * grammar client-side as a UI affordance only, and submits with an
 * automatic Idempotency-Key (same key + same payload replays the stored
 * DRAFT; different payload returns 409). The frozen SEC-01 owner enforces
 * caps routing, evidence rules, reason-code membership and the durable
 * audit server-side.
 */

type ConfigLoad =
  | { status: 'loading' }
  | { status: 'ready'; config: AdminIpointAdjustmentConfigDto }
  | ({ status: 'error' } & IpointAdjustmentPageErrorCopy);

interface Draft {
  walletAccountId: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: string;
  reasonCode: string;
  explanation: string;
  caseReference: string;
  attachmentReference: string;
}

const EMPTY_DRAFT: Draft = {
  walletAccountId: '',
  direction: 'CREDIT',
  amount: '',
  reasonCode: '',
  explanation: '',
  caseReference: '',
  attachmentReference: '',
};

export function IpointAdjustCreatePage() {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const environment = useAdminWriteEnvironment();
  const canWrite = canPerformSensitiveAdminWrite(environment);
  const canCreate = canCreateIpointAdjustment(permissions, canWrite);

  const [load, setLoad] = useState<ConfigLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [walletMatches, setWalletMatches] = useState<
    AdminIpointWalletLookupDto[]
  >([]);
  const [walletSearch, setWalletSearch] = useState('');
  const [walletSearchError, setWalletSearchError] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  const loadConfig = useCallback(async () => {
    if (!marketId) return;
    setLoad({ status: 'loading' });
    try {
      const config =
        await adminIpointAdjustOpsApi.getAdjustmentConfig(marketId);
      setLoad({ status: 'ready', config });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeIpointAdjustmentReadError(error) });
    }
  }, [marketId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig, retryKey]);

  const retryConfig = useCallback(() => setRetryKey((value) => value + 1), []);

  const searchWallets = useCallback(async () => {
    if (!marketId || walletSearch.trim().length === 0) return;
    try {
      const matches = await adminIpointAdjustOpsApi.searchWallets(
        marketId,
        walletSearch.trim(),
      );
      setWalletMatches(matches);
      setWalletSearchError(null);
    } catch (error: unknown) {
      setWalletMatches([]);
      setWalletSearchError(describeIpointAdjustmentWriteError(error));
    }
  }, [marketId, walletSearch]);

  const configured = load.status === 'ready' ? load.config.configured : false;
  const marketCode = load.status === 'ready' ? load.config.marketCode : '';
  const softCap =
    load.status === 'ready' ? load.config.rule?.softCap : undefined;
  const hardCap =
    load.status === 'ready' ? load.config.rule?.hardCap : undefined;
  const reasonCodes = load.status === 'ready' ? load.config.reasonCodes : [];

  const aboveSoft =
    configured && softCap
      ? ipointAdjustmentAboveSoftCap(draft.amount, softCap)
      : false;
  const highRiskReason = reasonCodes.find(
    (reason) => reason.code === draft.reasonCode,
  )?.isHighRisk;

  async function createRequest() {
    if (!marketId || !canCreate) return;
    if (!draft.walletAccountId) {
      setMessage({
        tone: 'error',
        text: 'Select a wallet from the search results first.',
      });
      return;
    }
    if (!ipointAdjustmentAmountValid(draft.amount)) {
      setMessage({
        tone: 'error',
        text: 'Amount must be a positive exact decimal string with at most 10 decimal places.',
      });
      return;
    }
    if (!draft.reasonCode) {
      setMessage({
        tone: 'error',
        text: 'Select a reason code from the market catalog.',
      });
      return;
    }
    if (draft.explanation.trim().length === 0) {
      setMessage({
        tone: 'error',
        text: 'A detailed explanation is required (1..2000 characters).',
      });
      return;
    }
    if (draft.caseReference.trim().length === 0) {
      setMessage({
        tone: 'error',
        text: 'A case/ticket reference is required (1..200 characters).',
      });
      return;
    }
    if (
      (aboveSoft || highRiskReason) &&
      draft.attachmentReference.trim().length === 0
    ) {
      setMessage({
        tone: 'error',
        text: 'An attachment reference is required above the soft cap or for high-risk reason codes.',
      });
      return;
    }
    try {
      const key = createIdempotencyKey();
      const created = await adminIpointAdjustOpsApi.createAdjustment(
        marketId,
        {
          walletAccountId: draft.walletAccountId,
          direction: draft.direction,
          amount: draft.amount.trim(),
          reasonCode: draft.reasonCode,
          explanation: draft.explanation.trim(),
          caseReference: draft.caseReference.trim(),
          ...(draft.attachmentReference.trim()
            ? { attachmentReference: draft.attachmentReference.trim() }
            : {}),
        },
        key,
      );
      setMessage({
        tone: 'success',
        text: `Adjustment request ${created.state} created (${created.direction} ${created.amount}). Submit it from the queue to send it for checker review.`,
      });
      setDraft(EMPTY_DRAFT);
      setWalletMatches([]);
      setWalletSearch('');
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: describeIpointAdjustmentWriteError(error),
      });
    }
  }

  return (
    <div className="admin-page">
      <PageHeader
        title="Create a manual iPoint adjustment"
        description="Maker screen (wallet.ipoint.adjust.maker, online desktop Admin Web): search a wallet in the selected market, set the direction and exact amount, and record the evidence contract (reason code from the market catalog, explanation, case reference, attachment reference when required). The request is created as a durable DRAFT with an automatic Idempotency-Key; the frozen SEC-01 owner enforces caps routing, evidence rules and the immutable audit server-side."
      />

      {message ? (
        <IpointAdjustmentActionNotice tone={message.tone} text={message.text} />
      ) : null}

      {load.status === 'loading' ? <IpointAdjustmentSkeleton rows={3} /> : null}
      {load.status === 'error' ? (
        <IpointAdjustmentErrorState
          title={load.title}
          description={load.description}
          onRetry={retryConfig}
        />
      ) : null}
      {load.status === 'ready' && !canCreate ? (
        <IpointAdjustmentPermissionDeniedState permission="wallet.ipoint.adjust.maker" />
      ) : null}
      {load.status === 'ready' && canCreate && !configured ? (
        <IpointAdjustmentMarketBlockedNotice marketCode={marketCode} />
      ) : null}
      {load.status === 'ready' && canCreate && configured ? (
        <Card>
          <div className="admin-reward-form">
            <p className="admin-reward-muted" data-testid="ipoint-caps-hint">
              Market {marketCode} caps — soft: {softCap}, hard: {hardCap}.
              {aboveSoft
                ? ' This amount is above the soft cap: a Super Admin checker is required and execution stays disabled until secure evidence storage is enabled.'
                : ' Amounts at or below the soft cap can be checked by a Finance Approver.'}
            </p>

            <FormField
              label="Wallet search"
              hint="Search by member public id, display name or member id."
              htmlFor="ipoint-wallet-search"
            >
              <Input
                id="ipoint-wallet-search"
                aria-label="Wallet search"
                placeholder="e.g. pub_abc123"
                value={walletSearch}
                onChange={(event) => setWalletSearch(event.target.value)}
              />
              <Button
                variant="secondary"
                onClick={() => void searchWallets()}
                disabled={walletSearch.trim().length === 0}
              >
                Search wallets
              </Button>
            </FormField>
            {walletSearchError ? (
              <p className="admin-reward-muted" role="alert">
                {walletSearchError}
              </p>
            ) : null}
            {walletMatches.length > 0 ? (
              <Select
                aria-label="Select wallet"
                value={draft.walletAccountId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    walletAccountId: event.target.value,
                  }))
                }
              >
                <option value="">Select a wallet…</option>
                {walletMatches.map((wallet) => (
                  <option key={wallet.walletId} value={wallet.walletId}>
                    {wallet.memberPublicId}
                    {wallet.displayName ? ` — ${wallet.displayName}` : ''} —
                    balance {wallet.availableBalance}
                  </option>
                ))}
              </Select>
            ) : null}

            <FormField label="Direction" htmlFor="ipoint-direction">
              <Select
                id="ipoint-direction"
                aria-label="Direction"
                value={draft.direction}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    direction: event.target.value as 'CREDIT' | 'DEBIT',
                  }))
                }
              >
                <option value="CREDIT">CREDIT (add to wallet)</option>
                <option value="DEBIT">DEBIT (exact-opposite correction)</option>
              </Select>
            </FormField>

            <FormField
              label="Amount (exact decimal)"
              hint="Positive, at most 10 decimal places."
              htmlFor="ipoint-amount"
            >
              <Input
                id="ipoint-amount"
                aria-label="Amount"
                placeholder="e.g. 5000"
                value={draft.amount}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
              />
            </FormField>

            <FormField label="Reason code" htmlFor="ipoint-reason-code">
              <Select
                id="ipoint-reason-code"
                aria-label="Reason code"
                value={draft.reasonCode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    reasonCode: event.target.value,
                  }))
                }
              >
                <option value="">Select a reason code…</option>
                {reasonCodes.map((reason) => (
                  <option key={reason.code} value={reason.code}>
                    {reason.code} — {reason.label}
                    {reason.isHighRisk ? ' (high risk)' : ''}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Explanation (mandatory)"
              htmlFor="ipoint-explanation"
            >
              <Input
                id="ipoint-explanation"
                aria-label="Explanation"
                placeholder="Detailed explanation of the adjustment…"
                value={draft.explanation}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    explanation: event.target.value,
                  }))
                }
              />
            </FormField>

            <FormField
              label="Case / ticket reference (mandatory)"
              htmlFor="ipoint-case-reference"
            >
              <Input
                id="ipoint-case-reference"
                aria-label="Case reference"
                placeholder="e.g. CASE-2026-001"
                value={draft.caseReference}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    caseReference: event.target.value,
                  }))
                }
              />
            </FormField>

            <FormField
              label="Attachment reference (opaque, when required)"
              hint="Required above the soft cap or for high-risk reason codes. Never file contents."
              htmlFor="ipoint-attachment-reference"
            >
              <Input
                id="ipoint-attachment-reference"
                aria-label="Attachment reference"
                placeholder="Opaque reference (≤500 chars)"
                value={draft.attachmentReference}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    attachmentReference: event.target.value,
                  }))
                }
              />
            </FormField>

            <Button variant="primary" onClick={() => void createRequest()}>
              Create adjustment request (Maker, audited)
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
