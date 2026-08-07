import {
  ApiError,
  createIdempotencyKey,
  type AdminMerchantBranchDetailDto,
  type AdminPackageCatalogDto,
  type AdminPackageProfileDto,
  type AdminPackageVersionDto,
  type AdminSpecialPercentageListDto,
} from '@ipoint/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  SearchField,
  Select,
  Table,
} from '@ipoint/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminApi } from './admin-api.js';
import { adminMerchantApi, adminPackageOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  canAssignPackages,
  canCreateSpecialPercentages,
  canManageSpecialPercentages,
  canManageStandardPackages,
  describePackageReadError,
  describeSpecialPercentageWriteError,
  formatPackageTimestamp,
  formatPackageWindow,
  orderPackageProfiles,
  packageRateValid,
  packageWindowValid,
  specialPercentageFormValid,
  versionActivateable,
  type PackagePageErrorCopy,
} from './package-config-model.js';
import {
  PackageCatalogSkeleton,
  PackageEmptyState,
  PackageErrorState,
  PackagePermissionDeniedState,
  PackageVersionStatusBadge,
  SpecialPercentageManageBlockedNotice,
} from './package-config-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';

/**
 * P7-S6A Merchant Package Configuration page (frozen contract §7.3).
 *
 * - Standard packages A–F with their forward-only versions (read via the
 *   Phase 7 adapter; version creation/activation via the frozen Phase 1
 *   owner commands with Idempotency-Keys — the owner normalizes exact
 *   decimals and rejects window overlap).
 * - Special percentages: privileged SUPER_ADMIN read (step-up + audited)
 *   and — since D-051 closed the owner gap — creation through the secured
 *   Phase 1 owner command: mandatory reason (durable on the row + atomic
 *   immutable audit), auto Idempotency-Key, exact-decimal rate.
 * - Explicit per-merchant reassignment: assign a new version and set the
 *   default are separate audited owner actions; new versions never move
 *   existing assignments (pinning), and there is no batch migration.
 *
 * All rates are exact decimal strings and are never parsed client-side.
 * UI affordances are never authorization — the server enforces permission,
 * market, and state.
 */

type CatalogLoad =
  | { status: 'loading' }
  | { status: 'ready'; catalog: AdminPackageCatalogDto }
  | ({ status: 'error' } & PackagePageErrorCopy);

type SpecialsLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; list: AdminSpecialPercentageListDto }
  | ({ status: 'error' } & PackagePageErrorCopy);

type MerchantLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; detail: AdminMerchantBranchDetailDto }
  | ({ status: 'error' } & PackagePageErrorCopy);

interface ActionMessage {
  tone: 'success' | 'error';
  text: string;
}

interface DraftVersion {
  rate: string;
  effectiveFrom: string;
  effectiveTo: string;
}

/** Special-percentage create draft (D-051 secured owner command). */
interface SpecialPercentageDraft {
  rate: string;
  description: string;
  reason: string;
}

export function usePackageCatalog(marketId: string | undefined): {
  load: CatalogLoad;
  retry: () => void;
} {
  const [load, setLoad] = useState<CatalogLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminPackageOpsApi
      .packageCatalog(marketId)
      .then((catalog) => {
        if (!cancelled) setLoad({ status: 'ready', catalog });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoad({ status: 'error', ...describePackageReadError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, retryKey]);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return { load, retry };
}

export function PackageConfigPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const environment = useAdminWriteEnvironment();
  const canWrite = canPerformSensitiveAdminWrite(environment);
  const { load: catalogLoad, retry: retryCatalog } =
    usePackageCatalog(marketId);

  const [profileDraft, setProfileDraft] = useState<DraftVersion>({
    rate: '',
    effectiveFrom: '',
    effectiveTo: '',
  });

  // Special percentages (privileged SUPER_ADMIN surface, step-up gated).
  const [specials, setSpecials] = useState<SpecialsLoad>({ status: 'idle' });
  const [stepUpChallenge, setStepUpChallenge] = useState<string | null>(null);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpToken, setStepUpToken] = useState<string | undefined>();
  const [specialDraft, setSpecialDraft] = useState<SpecialPercentageDraft>({
    rate: '',
    description: '',
    reason: '',
  });
  const canViewSpecials = canManageSpecialPercentages(permissions);
  // Double gate (mirrors the accepted S6D commission page): the
  // SUPER_ADMIN-only permission AND the sensitive-write environment.
  const canCreateSpecial = canCreateSpecialPercentages(permissions) && canWrite;

  const loadSpecials = useCallback(
    async (token?: string) => {
      if (!marketId) return;
      setSpecials({ status: 'loading' });
      try {
        const list = await adminPackageOpsApi.specialPercentages(
          marketId,
          token,
        );
        setSpecials({ status: 'ready', list });
      } catch (error: unknown) {
        if (
          error instanceof ApiError &&
          error.body.code === 'MFA_STEP_UP_REQUIRED'
        ) {
          try {
            const started = await adminApi.beginStepUp({
              action_class: 'merchant.special_package.manage',
              market_id: marketId,
            });
            setStepUpChallenge(started.step_up_challenge_id);
            setStepUpCode('');
            setSpecials({ status: 'idle' });
          } catch (stepUpError: unknown) {
            setSpecials({
              status: 'error',
              ...describePackageReadError(stepUpError),
            });
          }
          return;
        }
        setSpecials({ status: 'error', ...describePackageReadError(error) });
      }
    },
    [marketId],
  );

  useEffect(() => {
    if (canViewSpecials && stepUpToken) void loadSpecials(stepUpToken);
  }, [canViewSpecials, stepUpToken, loadSpecials]);

  async function verifyStepUp() {
    if (!stepUpChallenge || stepUpCode.trim().length !== 6) return;
    try {
      const verified = await adminApi.verifyStepUp({
        challenge_id: stepUpChallenge,
        code: stepUpCode.trim(),
      });
      setStepUpToken(verified.step_up_token);
      setStepUpChallenge(null);
      setStepUpCode('');
    } catch (error: unknown) {
      setSpecials({ status: 'error', ...describePackageReadError(error) });
    }
  }

  async function createSpecialPercentage() {
    if (!marketId || !canCreateSpecial) return;
    if (!specialPercentageFormValid(specialDraft)) {
      setMessage({
        tone: 'error',
        text: 'Rate must be an exact decimal >0% and ≤100% (max 6 decimals); description and a 1–500 character reason are required.',
      });
      return;
    }
    // The create is a step-up-gated privileged write: without a verified
    // step-up token, start the verification flow first.
    if (!stepUpToken) {
      void loadSpecials();
      setMessage({
        tone: 'error',
        text: 'Verify your identity first, then submit the form again.',
      });
      return;
    }
    try {
      const key = createIdempotencyKey();
      await adminPackageOpsApi.createSpecialPercentage(
        marketId,
        {
          rate: specialDraft.rate.trim(),
          description: specialDraft.description.trim(),
          reason: specialDraft.reason.trim(),
        },
        key,
        stepUpToken,
      );
      setMessage({
        tone: 'success',
        text: `Special percentage ${specialDraft.rate.trim()} created (reason recorded in the immutable audit).`,
      });
      setSpecialDraft({ rate: '', description: '', reason: '' });
      await loadSpecials(stepUpToken);
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: describeSpecialPercentageWriteError(error),
      });
    }
  }

  // Per-merchant explicit reassignment (owner commands, audited).
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<
    Array<{ branch_id: string; name: string }>
  >([]);
  const [merchant, setMerchant] = useState<MerchantLoad>({ status: 'idle' });
  const [selectedBranch, setSelectedBranch] = useState<string | undefined>();
  const [assignVersionId, setAssignVersionId] = useState('');
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const canAssign = canAssignPackages(permissions) && canWrite;
  const canManage = canManageStandardPackages(permissions) && canWrite;

  async function runSearch() {
    if (!marketId || !query.trim()) return;
    setSearching(true);
    setMessage(null);
    try {
      const list = await adminMerchantApi.merchantList(marketId, {
        query: query.trim(),
        limit: 10,
        offset: 0,
      });
      setMatches(
        list.items.map((item) => ({
          branch_id: item.branch_id,
          name: item.name,
        })),
      );
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: describePackageReadError(error).title,
      });
    } finally {
      setSearching(false);
    }
  }

  async function openMerchant(branchId: string) {
    if (!marketId) return;
    setSelectedBranch(branchId);
    setMerchant({ status: 'loading' });
    setMessage(null);
    try {
      const detail = await adminMerchantApi.merchantBranchDetail(
        marketId,
        branchId,
      );
      setMerchant({ status: 'ready', detail });
    } catch (error: unknown) {
      setMerchant({ status: 'error', ...describePackageReadError(error) });
    }
  }

  async function createVersion(profile: AdminPackageProfileDto) {
    if (!marketId || !canManage) return;
    const rate = profileDraft.rate;
    const effectiveFrom = profileDraft.effectiveFrom;
    const effectiveTo = profileDraft.effectiveTo;
    if (!packageRateValid(rate)) {
      setMessage({
        tone: 'error',
        text: 'Rate must be a decimal string >0% and <=100%.',
      });
      return;
    }
    if (!packageWindowValid(effectiveFrom, effectiveTo)) {
      setMessage({
        tone: 'error',
        text: 'Effective window is invalid: end must be after start.',
      });
      return;
    }
    try {
      const key = createIdempotencyKey();
      await adminPackageOpsApi.createPackageVersion(
        marketId,
        profile.id,
        {
          rate: rate.trim(),
          effective_from: new Date(effectiveFrom).toISOString(),
          ...(effectiveTo
            ? { effective_to: new Date(effectiveTo).toISOString() }
            : {}),
        },
        key,
      );
      setMessage({
        tone: 'success',
        text: `Draft version created for package ${profile.code}.`,
      });
      setProfileDraft({ rate: '', effectiveFrom: '', effectiveTo: '' });
      retryCatalog();
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: describePackageWriteError(error) });
    }
  }

  async function activateVersion(
    profile: AdminPackageProfileDto,
    version: AdminPackageVersionDto,
  ) {
    if (!marketId || !canManage) return;
    try {
      const key = createIdempotencyKey();
      await adminPackageOpsApi.activatePackageVersion(
        marketId,
        profile.id,
        version.id,
        key,
      );
      setMessage({
        tone: 'success',
        text: `Version ${version.rate} activated.`,
      });
      retryCatalog();
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: describePackageWriteError(error) });
    }
  }

  async function assignVersion() {
    if (!marketId || !selectedBranch || !assignVersionId || !canAssign) {
      return;
    }
    try {
      const key = createIdempotencyKey();
      await adminPackageOpsApi.assignMerchantPackage(
        marketId,
        selectedBranch,
        { service_fee_version_id: assignVersionId, is_default: true },
        key,
      );
      setAssignVersionId('');
      await openMerchant(selectedBranch);
      setMessage({
        tone: 'success',
        text: 'Package assigned. The previous assignment stays pinned in history.',
      });
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: describePackageWriteError(error) });
    }
  }

  async function setDefault(assignmentId: string) {
    if (!marketId || !selectedBranch || !canAssign) return;
    try {
      const key = createIdempotencyKey();
      await adminPackageOpsApi.setDefaultMerchantPackage(
        marketId,
        selectedBranch,
        assignmentId,
        key,
      );
      await openMerchant(selectedBranch);
      setMessage({ tone: 'success', text: 'Default package updated.' });
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: describePackageWriteError(error) });
    }
  }

  const profiles = useMemo(() => {
    if (catalogLoad.status !== 'ready') return [];
    return orderPackageProfiles(catalogLoad.catalog.items);
  }, [catalogLoad]);

  const assignableVersions = useMemo(() => {
    if (catalogLoad.status !== 'ready') return [];
    return catalogLoad.catalog.items.flatMap((profile) =>
      profile.versions.map((version) => ({ ...version, code: profile.code })),
    );
  }, [catalogLoad]);

  const assignments =
    merchant.status === 'ready' ? merchant.detail.packages.items : [];

  return (
    <div className="admin-page">
      <PageHeader
        title="Merchant package configuration"
        description="Standard packages, special percentages, and explicit per-merchant reassignment. Rates are exact decimals; new versions never move existing assignments."
      />

      {message ? (
        <Alert tone={message.tone} title="Package configuration" role="status">
          {message.text}
        </Alert>
      ) : null}

      {/* ── Standard packages ─────────────────────────────────────────── */}
      <section aria-label="Standard packages">
        <h2 className="admin-package-section">Standard packages</h2>
        {catalogLoad.status === 'loading' ? <PackageCatalogSkeleton /> : null}
        {catalogLoad.status === 'error' ? (
          <PackageErrorState
            title={catalogLoad.title}
            description={catalogLoad.description}
            onRetry={retryCatalog}
          />
        ) : null}
        {catalogLoad.status === 'ready' && profiles.length === 0 ? (
          <PackageEmptyState />
        ) : null}
        {catalogLoad.status === 'ready' && profiles.length > 0 ? (
          <div className="admin-package-grid">
            {profiles.map((profile) => (
              <Card key={profile.id}>
                <h3 className="admin-package-card__title">
                  Package {profile.code}
                </h3>
                <p className="admin-package-muted">{profile.name}</p>
                {profile.description ? (
                  <p className="admin-package-muted">{profile.description}</p>
                ) : null}
                <Table aria-label={`Versions of package ${profile.code}`}>
                  <thead>
                    <tr>
                      <th scope="col">Rate</th>
                      <th scope="col">Status</th>
                      <th scope="col">Effective window</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.versions.map((version) => (
                      <tr key={version.id}>
                        <td data-testid={`rate-${profile.code}-${version.id}`}>
                          {version.rate}
                        </td>
                        <td>
                          <PackageVersionStatusBadge status={version.status} />
                        </td>
                        <td>{formatPackageWindow(version)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {canManage ? (
                  <div className="admin-package-form">
                    <FormField
                      label={`New version rate (%) for ${profile.code}`}
                      htmlFor={`rate-${profile.code}`}
                    >
                      <Input
                        id={`rate-${profile.code}`}
                        aria-label={`Rate for package ${profile.code}`}
                        placeholder="e.g. 2.5"
                        value={profileDraft.rate}
                        onChange={(event) =>
                          setProfileDraft((draft) => ({
                            ...draft,
                            rate: event.target.value,
                          }))
                        }
                      />
                    </FormField>
                    <FormField
                      label="Effective from"
                      htmlFor={`from-${profile.code}`}
                    >
                      <Input
                        id={`from-${profile.code}`}
                        aria-label={`Effective from for ${profile.code}`}
                        type="datetime-local"
                        value={profileDraft.effectiveFrom}
                        onChange={(event) =>
                          setProfileDraft((draft) => ({
                            ...draft,
                            effectiveFrom: event.target.value,
                          }))
                        }
                      />
                    </FormField>
                    <FormField
                      label="Effective to (optional)"
                      htmlFor={`to-${profile.code}`}
                    >
                      <Input
                        id={`to-${profile.code}`}
                        aria-label={`Effective to for ${profile.code}`}
                        type="datetime-local"
                        value={profileDraft.effectiveTo}
                        onChange={(event) =>
                          setProfileDraft((draft) => ({
                            ...draft,
                            effectiveTo: event.target.value,
                          }))
                        }
                      />
                    </FormField>
                    <Button
                      variant="primary"
                      onClick={() => void createVersion(profile)}
                    >
                      Create draft version
                    </Button>
                    {profile.versions
                      .filter((version) => versionActivateable(version))
                      .map((version) => (
                        <Button
                          key={version.id}
                          variant="secondary"
                          onClick={() => void activateVersion(profile, version)}
                        >
                          Activate {version.rate}
                        </Button>
                      ))}
                  </div>
                ) : (
                  <p className="admin-package-muted">
                    Version changes need the merchant.package.manage permission
                    on the online desktop Admin Web.
                  </p>
                )}
              </Card>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Special percentages ───────────────────────────────────────── */}
      <section aria-label="Special percentages">
        <h2 className="admin-package-section">Special percentages</h2>
        {!canViewSpecials ? (
          <PackagePermissionDeniedState permission="merchant.special_package.manage" />
        ) : null}
        {canViewSpecials && stepUpChallenge ? (
          <Card>
            <h3 className="admin-package-card__title">
              Verify to view special percentages
            </h3>
            <FormField
              label="Authentication code"
              htmlFor="special-percentage-code"
            >
              <Input
                id="special-percentage-code"
                aria-label="Special percentage verification code"
                value={stepUpCode}
                onChange={(event) => setStepUpCode(event.target.value)}
                maxLength={6}
              />
            </FormField>
            <Button variant="primary" onClick={() => void verifyStepUp()}>
              Verify
            </Button>
          </Card>
        ) : null}
        {canViewSpecials && !stepUpChallenge && specials.status === 'idle' ? (
          <Button variant="secondary" onClick={() => void loadSpecials()}>
            View special percentages
          </Button>
        ) : null}
        {specials.status === 'loading' ? (
          <PackageCatalogSkeleton rows={2} />
        ) : null}
        {specials.status === 'error' ? (
          <PackageErrorState
            title={specials.title}
            description={specials.description}
            onRetry={() => void loadSpecials()}
          />
        ) : null}
        {specials.status === 'ready' ? (
          <Card>
            <h3 className="admin-package-card__title">
              Special percentages (Super Admin, audited)
            </h3>
            {specials.list.items.length === 0 ? (
              <p className="admin-package-muted">
                No special percentages exist for this market.
              </p>
            ) : (
              <Table aria-label="Special percentages">
                <thead>
                  <tr>
                    <th scope="col">Rate</th>
                    <th scope="col">Description</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {specials.list.items.map((item) => (
                    <tr key={item.id}>
                      <td data-testid={`special-rate-${item.id}`}>
                        {item.rate}
                      </td>
                      <td>{item.description ?? '—'}</td>
                      <td>{formatPackageTimestamp(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ) : null}

        {/* ── Create action (D-051 secured owner command) ─────────────── */}
        {canViewSpecials && !canCreateSpecial ? (
          <SpecialPercentageManageBlockedNotice />
        ) : null}
        {canViewSpecials && canCreateSpecial ? (
          <Card>
            <h3 className="admin-package-card__title">
              Create a special percentage (Super Admin, audited)
            </h3>
            {!stepUpToken && !stepUpChallenge ? (
              <p className="admin-package-muted">
                Creating a special percentage is a step-up-gated privileged
                write. Verify your identity first.
              </p>
            ) : null}
            {!stepUpToken && !stepUpChallenge ? (
              <Button variant="secondary" onClick={() => void loadSpecials()}>
                Verify to create
              </Button>
            ) : null}
            {stepUpToken ? (
              <div className="admin-package-form">
                <FormField
                  label="Rate (%) — exact decimal, >0 and ≤100, max 6 decimals"
                  htmlFor="special-rate"
                >
                  <Input
                    id="special-rate"
                    aria-label="Special percentage rate"
                    placeholder="e.g. 12.5"
                    value={specialDraft.rate}
                    onChange={(event) =>
                      setSpecialDraft((draft) => ({
                        ...draft,
                        rate: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Description" htmlFor="special-description">
                  <Input
                    id="special-description"
                    aria-label="Special percentage description"
                    placeholder="e.g. Special launch partner"
                    value={specialDraft.description}
                    onChange={(event) =>
                      setSpecialDraft((draft) => ({
                        ...draft,
                        description: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField
                  label="Reason (mandatory, 1–500 characters)"
                  htmlFor="special-reason"
                >
                  <Input
                    id="special-reason"
                    aria-label="Special percentage reason"
                    placeholder="Why is this special percentage being created?"
                    value={specialDraft.reason}
                    onChange={(event) =>
                      setSpecialDraft((draft) => ({
                        ...draft,
                        reason: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <Button
                  variant="primary"
                  onClick={() => void createSpecialPercentage()}
                >
                  Create special percentage (Super Admin, audited)
                </Button>
              </div>
            ) : null}
          </Card>
        ) : null}
      </section>

      {/* ── Per-merchant reassignment ─────────────────────────────────── */}
      <section aria-label="Merchant reassignment">
        <h2 className="admin-package-section">Merchant reassignment</h2>
        <Alert tone="info" title="Assignments are pinned" role="status">
          New package versions never move existing merchant assignments.
          Reassigning a merchant is an explicit, audited action — there is no
          automatic batch migration.
        </Alert>
        <div className="admin-package-search">
          <SearchField
            aria-label="Search merchants"
            placeholder="Search merchants by name or ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch();
            }}
          />
          <Button
            variant="secondary"
            onClick={() => void runSearch()}
            disabled={searching}
          >
            Search
          </Button>
        </div>
        {matches.length > 0 ? (
          <div className="admin-package-matches">
            {matches.map((match) => (
              <Button
                key={match.branch_id}
                variant="secondary"
                onClick={() => void openMerchant(match.branch_id)}
              >
                {match.name}
              </Button>
            ))}
          </div>
        ) : null}
        {merchant.status === 'loading' ? (
          <PackageCatalogSkeleton rows={3} />
        ) : null}
        {merchant.status === 'error' ? (
          <PackageErrorState
            title={merchant.title}
            description={merchant.description}
            onRetry={() =>
              selectedBranch ? void openMerchant(selectedBranch) : undefined
            }
          />
        ) : null}
        {merchant.status === 'ready' ? (
          <Card>
            <h3 className="admin-package-card__title">Current assignments</h3>
            {assignments.length === 0 ? (
              <p className="admin-package-muted">No package assignments.</p>
            ) : (
              <Table aria-label="Merchant package assignments">
                <thead>
                  <tr>
                    <th scope="col">Rate</th>
                    <th scope="col">Status</th>
                    <th scope="col">Default</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => (
                    <tr key={assignment.assignment_id}>
                      <td>
                        {assignment.rate ??
                          assignment.special_percentage_rate ??
                          '—'}
                      </td>
                      <td>
                        <Badge>{assignment.status}</Badge>
                      </td>
                      <td>{assignment.is_default ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {canAssign ? (
              <div className="admin-package-form">
                <FormField
                  label="Assign a version to this merchant"
                  htmlFor="assign-version"
                >
                  <Select
                    id="assign-version"
                    aria-label="Assign version"
                    value={assignVersionId}
                    onChange={(event) => setAssignVersionId(event.target.value)}
                  >
                    <option value="">Select a version…</option>
                    {assignableVersions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.code} — {version.rate} ({version.status})
                      </option>
                    ))}
                  </Select>
                </FormField>
                <Button
                  variant="primary"
                  onClick={() => void assignVersion()}
                  disabled={!assignVersionId}
                >
                  Assign package (explicit, audited)
                </Button>
                {assignments
                  .filter((assignment) => !assignment.is_default)
                  .map((assignment) => (
                    <Button
                      key={`default-${assignment.assignment_id}`}
                      variant="secondary"
                      onClick={() => void setDefault(assignment.assignment_id)}
                    >
                      Set default
                    </Button>
                  ))}
              </div>
            ) : (
              <p className="admin-package-muted">
                Reassignment needs the merchant.package.assign permission on the
                online desktop Admin Web.
              </p>
            )}
          </Card>
        ) : null}
      </section>
    </div>
  );
}

function describePackageWriteError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PACKAGE_EFFECTIVE_WINDOW_OVERLAP':
        return 'The effective window overlaps another version of this package.';
      case 'PACKAGE_VERSION_NOT_ASSIGNABLE':
        return 'That version is not active for this market.';
      case 'IDEMPOTENCY_KEY_CONFLICT':
        return 'The request was retried with a different payload. Refresh and retry.';
      case 'PACKAGE_MARKET_MISMATCH':
        return 'The package does not belong to this market.';
      case 'PACKAGE_VERSION_TRANSITION_INVALID':
        return 'The version cannot change to that status.';
      case 'PACKAGE_VERSION_IN_ACTIVE_USE':
        return 'An actively assigned version cannot be cancelled.';
      case 'PERMISSION_DENIED':
        return 'The server denied this action.';
      case 'NETWORK_OFFLINE':
        return 'You are offline. Retry when connected.';
    }
  }
  return 'The action could not be completed. Retry, or try again later.';
}
