import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PageHeader,
  Card,
  Badge,
  Alert,
  Button,
  EmptyState,
  Skeleton,
} from '@ipoint/ui';
import {
  Users,
  Share2,
  Copy,
  Check,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  describeApiError,
  type MemberAgentActivationStatusDto,
  type MemberCommissionLedgerPageDto,
  type MemberCommissionSummaryDto,
  type MemberReferralTreeDto,
} from '@ipoint/api-client';
import { memberTeamApi } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';
import { trimAmount } from '../utils/amount';

type FetchState = 'idle' | 'loading' | 'error' | 'success';

const LEDGER_PAGE_SIZE = 20;

const AGENT_STATUS_TONE: Record<
  string,
  'success' | 'warning' | 'error' | 'neutral'
> = {
  ACTIVE: 'success',
  PENDING_PAYMENT: 'warning',
  PAYMENT_CONFIRMED: 'warning',
  COURSE_PENDING: 'warning',
  COURSE_COMPLETED: 'warning',
  PENDING_APPROVAL: 'warning',
  SUSPENDED: 'error',
  REJECTED: 'error',
  DEACTIVATED: 'neutral',
  NOT_APPLIED: 'neutral',
};

const COMMISSION_POSTING_TONE: Record<
  string,
  'success' | 'warning' | 'error' | 'neutral'
> = {
  EARNED: 'success',
  REVERSED: 'error',
  COMPENSATED: 'warning',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function TeamPage() {
  const { t } = useTranslation();
  const abortController = useAbortController();

  const [tree, setTree] = useState<MemberReferralTreeDto | null>(null);
  const [agentStatus, setAgentStatus] =
    useState<MemberAgentActivationStatusDto | null>(null);
  const [referralState, setReferralState] = useState<FetchState>('idle');
  const [referralError, setReferralError] = useState<string | null>(null);
  const [isMarketGate, setIsMarketGate] = useState(false);

  const [summary, setSummary] = useState<MemberCommissionSummaryDto | null>(
    null,
  );
  const [summaryState, setSummaryState] = useState<FetchState>('idle');

  const [ledger, setLedger] = useState<MemberCommissionLedgerPageDto | null>(
    null,
  );
  const [ledgerState, setLedgerState] = useState<FetchState>('idle');
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const [copied, setCopied] = useState(false);

  const fetchReferral = useCallback(async () => {
    setReferralState('loading');
    setReferralError(null);
    setIsMarketGate(false);
    try {
      const [treeResult, statusResult] = await Promise.all([
        memberTeamApi.referralTree(),
        memberTeamApi.agentStatus(),
      ]);
      if (abortController.signal.aborted) return;
      setTree(treeResult);
      setAgentStatus(statusResult);
      setReferralState('success');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const description = describeApiError(err);
      setIsMarketGate(description.kind === 'market');
      setReferralError(description.detail);
      setReferralState('error');
    }
  }, [abortController]);

  const fetchSummary = useCallback(async () => {
    setSummaryState('loading');
    try {
      const result = await memberTeamApi.commissionSummary();
      if (abortController.signal.aborted) return;
      setSummary(result);
      setSummaryState('success');
    } catch {
      if (abortController.signal.aborted) return;
      setSummaryState('error');
    }
  }, [abortController]);

  const fetchLedger = useCallback(
    async (nextOffset: number) => {
      setLedgerState('loading');
      setLedgerError(null);
      try {
        const result = await memberTeamApi.commissionLedger({
          limit: LEDGER_PAGE_SIZE,
          offset: nextOffset,
        });
        if (abortController.signal.aborted) return;
        setLedger(result);
        setOffset(result.offset);
        setLedgerState('success');
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLedgerError(t('team.loadError'));
        setLedgerState('error');
      }
    },
    [abortController, t],
  );

  useEffect(() => {
    void fetchReferral();
    void fetchSummary();
    void fetchLedger(0);
  }, [fetchReferral, fetchSummary, fetchLedger]);

  const handleCopyCode = useCallback(async () => {
    if (!tree) return;
    const ok = await copyText(tree.myCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [tree]);

  const handlePreviousPage = useCallback(() => {
    if (offset > 0) void fetchLedger(Math.max(0, offset - LEDGER_PAGE_SIZE));
  }, [offset, fetchLedger]);

  const handleNextPage = useCallback(() => {
    if (ledger && offset + LEDGER_PAGE_SIZE < ledger.total) {
      void fetchLedger(offset + LEDGER_PAGE_SIZE);
    }
  }, [offset, ledger, fetchLedger]);

  const handleRetryReferral = useCallback(() => {
    void fetchReferral();
  }, [fetchReferral]);

  const handleRetryLedger = useCallback(() => {
    void fetchLedger(offset);
  }, [offset, fetchLedger]);

  const ledgerTotalPages = ledger
    ? Math.max(1, Math.ceil(ledger.total / LEDGER_PAGE_SIZE))
    : 0;
  const currentPage = ledger ? Math.floor(offset / LEDGER_PAGE_SIZE) + 1 : 0;

  return (
    <>
      <PageHeader title={t('team.title')} description={t('team.subtitle')} />

      {isMarketGate ? (
        <Alert tone="warning" title={t('errors.marketAccess')}>
          <p>{t('errors.marketAccessDescription')}</p>
        </Alert>
      ) : null}

      {/* Referral + agent status */}
      <Card className="ip-team-referral">
        <div className="ip-team-referral__header">
          <Users size={20} aria-hidden="true" />
          <h2 className="ip-section-title">{t('team.referralTitle')}</h2>
        </div>

        {referralState === 'idle' || referralState === 'loading' ? (
          <div aria-label={t('common.loading')}>
            <Skeleton width="100%" height="72px" />
            <Skeleton width="100%" height="72px" />
          </div>
        ) : null}

        {referralState === 'error' ? (
          <Alert tone="error" title={t('team.loadError')}>
            <p>{referralError}</p>
            <Button variant="secondary" size="sm" onClick={handleRetryReferral}>
              {t('common.retry')}
            </Button>
          </Alert>
        ) : null}

        {referralState === 'success' && tree ? (
          <div className="ip-team-referral__body">
            <div
              className="ip-team-referral__code"
              data-testid="team-referral-code"
            >
              <Share2 size={18} aria-hidden="true" />
              <div>
                <span className="ip-text-sm ip-text-muted">
                  {t('team.referralCode')}
                </span>
                <strong>{tree.myCode}</strong>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCopyCode()}
                aria-label={t('team.copyCode')}
              >
                {copied ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Copy size={16} aria-hidden="true" />
                )}
                {copied ? t('team.copied') : t('team.copyCode')}
              </Button>
            </div>

            <div className="ip-team-referral__referrer">
              <span className="ip-text-sm ip-text-muted">
                {t('team.referrer')}
              </span>
              {tree.referrer ? (
                <span>
                  <strong>{tree.referrer.maskedReference}</strong>
                  {tree.referrer.isAgent ? (
                    <Badge tone="brand">{t('team.agentBadge')}</Badge>
                  ) : null}
                </span>
              ) : (
                <span className="ip-text-muted">{t('team.noReferrer')}</span>
              )}
            </div>

            <div
              className="ip-team-referral__counts"
              data-testid="team-referral-counts"
            >
              <div>
                <strong>{tree.referrals.g1Count}</strong>
                <span className="ip-text-sm ip-text-muted">
                  {t('team.directReferrals')}
                </span>
              </div>
              <div>
                <strong>{tree.referrals.g2Count}</strong>
                <span className="ip-text-sm ip-text-muted">
                  {t('team.indirectReferrals')}
                </span>
              </div>
              <div>
                <strong>{tree.referrals.g1Agents}</strong>
                <span className="ip-text-sm ip-text-muted">
                  {t('team.g1Agents')}
                </span>
              </div>
              <div>
                <strong>{tree.referrals.g2Agents}</strong>
                <span className="ip-text-sm ip-text-muted">
                  {t('team.g2Agents')}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Agent status */}
      <Card className="ip-team-agent">
        <div className="ip-team-agent__header">
          <ShieldCheck size={20} aria-hidden="true" />
          <h2 className="ip-section-title">{t('team.agentStatusTitle')}</h2>
        </div>
        {referralState === 'success' && agentStatus ? (
          <div className="ip-team-agent__body" data-testid="team-agent-status">
            <div>
              <Badge tone={AGENT_STATUS_TONE[agentStatus.status] ?? 'neutral'}>
                {t(`team.agentStatus.${agentStatus.status}`)}
              </Badge>
              <span className="ip-text-sm ip-text-muted">
                {agentStatus.market}
              </span>
            </div>
            {agentStatus.activationFee !== null ? (
              <div>
                <span className="ip-text-sm ip-text-muted">
                  {t('team.activationFee')}
                </span>
                <strong>
                  {agentStatus.activationFeeCurrency}{' '}
                  {trimAmount(agentStatus.activationFee)}
                </strong>
              </div>
            ) : null}
            {agentStatus.activatedAt ? (
              <span className="ip-text-sm ip-text-muted">
                {t('team.activatedAt')}: {formatDate(agentStatus.activatedAt)}
              </span>
            ) : null}
          </div>
        ) : null}
        {referralState === 'success' && !agentStatus ? (
          <EmptyState
            icon={<ShieldCheck size={40} />}
            title={t('team.notApplied')}
            description={t('team.notAppliedDescription')}
          />
        ) : null}
      </Card>

      {/* Commission summary */}
      <Card className="ip-team-summary">
        <div className="ip-team-summary__header">
          <h2 className="ip-section-title">{t('team.commissionSummary')}</h2>
        </div>
        {summaryState === 'idle' || summaryState === 'loading' ? (
          <div aria-label={t('common.loading')}>
            <Skeleton width="100%" height="64px" />
          </div>
        ) : null}
        {summaryState === 'error' ? (
          <Alert tone="warning" title={t('team.summaryUnavailable')}>
            <p>{t('team.summaryUnavailableDescription')}</p>
          </Alert>
        ) : null}
        {summaryState === 'success' && summary ? (
          <div
            className="ip-team-summary__body"
            data-testid="team-commission-summary"
          >
            {summary.markets.length === 0 ? (
              <p className="ip-text-muted">{t('team.noCommission')}</p>
            ) : (
              <ul className="ip-team-summary__markets">
                {summary.markets.map((market) => (
                  <li key={market.market}>
                    <span className="ip-text-sm ip-text-muted">
                      {t('team.marketTotal', { market: market.market })}
                    </span>
                    <strong>
                      {market.currency} {trimAmount(market.totalEarned)}
                    </strong>
                    <span className="ip-text-sm ip-text-muted">
                      {t('team.entryCount', { count: market.entryCount })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="ip-team-summary__grand-total">
              <span>{t('team.grandTotal')}</span>
              <strong>
                {summary.currency} {trimAmount(summary.grandTotal)}
              </strong>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Commission ledger */}
      <Card className="ip-team-ledger">
        <h2 className="ip-section-title">{t('team.commissionLedger')}</h2>

        {ledgerState === 'idle' || ledgerState === 'loading' ? (
          <div aria-label={t('common.loading')}>
            <Skeleton width="100%" height="56px" />
            <Skeleton width="100%" height="56px" />
          </div>
        ) : null}

        {ledgerState === 'error' ? (
          <Alert tone="error" title={t('team.loadError')}>
            <p>{ledgerError}</p>
            <Button variant="secondary" size="sm" onClick={handleRetryLedger}>
              {t('common.retry')}
            </Button>
          </Alert>
        ) : null}

        {ledgerState === 'success' && ledger && ledger.entries.length === 0 ? (
          <EmptyState
            icon={<Users size={40} />}
            title={t('team.noCommission')}
            description={t('team.noCommissionDescription')}
          />
        ) : null}

        {ledgerState === 'success' && ledger && ledger.entries.length > 0 ? (
          <>
            <ul className="ip-team-ledger__list">
              {ledger.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="ip-team-ledger__row"
                  data-testid="team-ledger-entry"
                >
                  <div className="ip-team-ledger__row-main">
                    <Badge
                      tone={
                        COMMISSION_POSTING_TONE[entry.postingStatus] ??
                        'neutral'
                      }
                    >
                      {entry.postingStatus}
                    </Badge>
                    <div>
                      <strong>{entry.publicReference}</strong>
                      <span className="ip-text-sm ip-text-muted">
                        {entry.sourceType} · {entry.entryType} · {entry.market}
                      </span>
                    </div>
                  </div>
                  <div className="ip-team-ledger__row-amount">
                    <strong>
                      {entry.currency} {trimAmount(entry.amount)}
                    </strong>
                    <span className="ip-text-sm ip-text-muted">
                      {formatDate(entry.effectiveTime)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="ip-team-ledger__pagination">
              <span className="ip-text-sm ip-text-muted">
                {t('team.showing', {
                  from: offset + 1,
                  to: Math.min(offset + LEDGER_PAGE_SIZE, ledger.total),
                  total: ledger.total,
                })}
              </span>
              <div className="ip-team-ledger__pagination-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePreviousPage}
                  disabled={offset <= 0}
                  aria-label={t('team.previous')}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  {t('team.previous')}
                </Button>
                <span className="ip-text-sm ip-text-muted">
                  {t('team.pageOf', {
                    page: currentPage,
                    total: ledgerTotalPages,
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={offset + LEDGER_PAGE_SIZE >= ledger.total}
                  aria-label={t('team.next')}
                >
                  {t('team.next')}
                  <ChevronRight size={16} aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </Card>
    </>
  );
}
