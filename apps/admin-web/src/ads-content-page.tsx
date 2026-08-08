import {
  ApiError,
  createIdempotencyKey,
  describeApiError,
  type AdDto,
  type AdPlacementDto,
  type AdsContentStatus,
  type ContentArticleDto,
} from '@ipoint/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminAdsContentApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';

type Mode = 'ads' | 'content';
type Item = AdDto | ContentArticleDto;
type Draft = Record<string, string | boolean>;
type Load = {
  state: 'loading' | 'error' | 'ready';
  items: Item[];
  placements: AdPlacementDto[];
  error?: string;
  offline?: boolean;
};
const NEXT: Record<AdsContentStatus, AdsContentStatus[]> = {
  DRAFT: ['SCHEDULED', 'ACTIVE', 'ARCHIVED'],
  SCHEDULED: ['DRAFT', 'ACTIVE', 'EXPIRED', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'EXPIRED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'EXPIRED', 'ARCHIVED'],
  EXPIRED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function AdsContentPage({ mode }: { mode: Mode }) {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const environment = useAdminWriteEnvironment();
  const [load, setLoad] = useState<Load>({
    state: 'loading',
    items: [],
    placements: [],
  });
  const [selected, setSelected] = useState<Item>();
  const [reason, setReason] = useState('');
  const [nextStatus, setNextStatus] = useState<AdsContentStatus | ''>('');
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  }>();
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState(() => blank(mode));
  const [placementDraft, setPlacementDraft] = useState({
    code: '',
    name: '',
    position: '0',
    reason: '',
  });
  const viewPermission = mode === 'ads' ? 'ads.view' : 'content.view';
  const managePermission = mode === 'ads' ? 'ads.manage' : 'content.manage';
  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const canView = permissions.includes(viewPermission);
  const canWrite =
    permissions.includes(managePermission) &&
    canPerformSensitiveAdminWrite(environment);

  const refresh = useCallback(async () => {
    if (!marketId || !canView) return;
    setLoad((current) => ({ ...current, state: 'loading' }));
    try {
      const listing =
        mode === 'ads'
          ? await adminAdsContentApi.listAds(marketId)
          : await adminAdsContentApi.listArticles(marketId);
      const placements = await adminAdsContentApi.placements(marketId);
      setLoad({
        state: 'ready',
        items: listing.items,
        placements: placements.items,
      });
    } catch (error) {
      const detail = describeApiError(error);
      setLoad({
        state: 'error',
        items: [],
        placements: [],
        error: detail.detail,
        offline: detail.kind === 'offline',
      });
    }
  }, [marketId, canView, mode, retry]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  function choose(item?: Item) {
    setSelected(item);
    setReason('');
    setNextStatus('');
    setDraft(item ? fromItem(mode, item) : blank(mode));
  }

  async function save() {
    if (!marketId || !canWrite || !reason.trim()) return;
    try {
      const body = payload(mode, draft, reason);
      if (mode === 'ads') {
        if (selected)
          await adminAdsContentApi.updateAd(
            marketId,
            selected.id,
            { ...body, expectedVersion: selected.version },
            createIdempotencyKey(),
          );
        else
          await adminAdsContentApi.createAd(
            marketId,
            body,
            createIdempotencyKey(),
          );
      } else if (selected)
        await adminAdsContentApi.updateArticle(
          marketId,
          selected.id,
          { ...body, expectedVersion: selected.version },
          createIdempotencyKey(),
        );
      else
        await adminAdsContentApi.createArticle(
          marketId,
          body,
          createIdempotencyKey(),
        );
      setMessage({
        tone: 'success',
        text: selected
          ? 'Changes saved and audited.'
          : 'Draft created and audited.',
      });
      choose();
      setRetry((value) => value + 1);
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) });
    }
  }

  async function transition() {
    if (!marketId || !selected || !nextStatus || !reason.trim() || !canWrite)
      return;
    try {
      if (mode === 'ads')
        await adminAdsContentApi.transitionAd(
          marketId,
          selected.id,
          nextStatus,
          selected.version,
          reason,
          createIdempotencyKey(),
        );
      else
        await adminAdsContentApi.transitionArticle(
          marketId,
          selected.id,
          nextStatus,
          selected.version,
          reason,
          createIdempotencyKey(),
        );
      setMessage({ tone: 'success', text: `Status changed to ${nextStatus}.` });
      choose();
      setRetry((value) => value + 1);
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) });
    }
  }

  async function createPlacement() {
    if (
      !marketId ||
      !canWrite ||
      !placementDraft.code.trim() ||
      !placementDraft.name.trim() ||
      !placementDraft.reason.trim()
    )
      return;
    try {
      await adminAdsContentApi.createPlacement(
        marketId,
        {
          code: placementDraft.code.trim().toUpperCase(),
          name: placementDraft.name.trim(),
          position: Number(placementDraft.position),
          reason: placementDraft.reason.trim(),
        },
        createIdempotencyKey(),
      );
      setPlacementDraft({ code: '', name: '', position: '0', reason: '' });
      setMessage({ tone: 'success', text: 'Placement created and audited.' });
      setRetry((value) => value + 1);
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) });
    }
  }

  if (!canView)
    return (
      <State
        title={'Permission denied'}
        detail={'Missing ' + viewPermission + ' for this market.'}
      />
    );
  return (
    <div className={'admin-page admin-content-ops'}>
      <PageHeader
        eyebrow={'Content Operations'}
        title={
          mode === 'ads'
            ? 'Advertising operations'
            : 'News & content publishing'
        }
        description={
          mode === 'ads'
            ? 'Market-scoped creative and scheduling. Sponsored labels stay visible; ads never alter ranking, eligibility, pricing or safety.'
            : 'Market-scoped publishing with promoted labels and controlled lifecycle transitions.'
        }
      />
      {!environment.online && (
        <Alert tone={'warning'} title={'Offline - writes disabled'}>
          Reconnect and retry. No write is queued.
        </Alert>
      )}
      {message && (
        <Alert tone={message.tone} title={'Content operation'}>
          {message.text}
        </Alert>
      )}
      {load.state === 'loading' && (
        <Card>
          <Skeleton height={'40px'} />
          <Skeleton height={'90px'} />
        </Card>
      )}
      {load.state === 'error' && (
        <State
          title={load.offline ? 'Offline' : 'Content unavailable'}
          detail={load.error ?? 'Retry.'}
          retry={() => setRetry((v) => v + 1)}
        />
      )}
      {load.state === 'ready' && (
        <>
          {mode === 'ads' && (
            <PlacementPanel
              draft={placementDraft}
              setDraft={setPlacementDraft}
              canWrite={canWrite}
              create={createPlacement}
            />
          )}
          <div className={'admin-content-ops__layout'}>
            <ListPanel
              mode={mode}
              items={load.items}
              selected={selected}
              choose={choose}
            />
            <EditorPanel
              mode={mode}
              draft={draft}
              setDraft={setDraft}
              placements={load.placements}
              selected={selected}
              reason={reason}
              setReason={setReason}
              canWrite={canWrite}
              managePermission={managePermission}
              save={save}
              nextStatus={nextStatus}
              setNextStatus={setNextStatus}
              transition={transition}
            />
          </div>
        </>
      )}
    </div>
  );
}

function PlacementPanel({
  draft,
  setDraft,
  canWrite,
  create,
}: {
  draft: { code: string; name: string; position: string; reason: string };
  setDraft: React.Dispatch<
    React.SetStateAction<{
      code: string;
      name: string;
      position: string;
      reason: string;
    }>
  >;
  canWrite: boolean;
  create: () => Promise<void>;
}) {
  const field = (key: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Card className={'admin-content-ops__placement'}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div>
          <h2>Ad placements</h2>
          <p>Create a market-owned slot before assigning campaign creative.</p>
        </div>
        <Input
          aria-label={'Placement code'}
          placeholder={'HOME_HERO'}
          value={draft.code}
          onChange={(event) => field('code', event.target.value)}
        />
        <Input
          aria-label={'Placement name'}
          placeholder={'Home hero'}
          value={draft.name}
          onChange={(event) => field('name', event.target.value)}
        />
        <Input
          aria-label={'Placement position'}
          type={'number'}
          min={0}
          value={draft.position}
          onChange={(event) => field('position', event.target.value)}
        />
        <Input
          aria-label={'Placement reason'}
          placeholder={'Required audit reason'}
          value={draft.reason}
          onChange={(event) => field('reason', event.target.value)}
        />
        <Button
          type={'submit'}
          disabled={
            !canWrite ||
            !draft.code.trim() ||
            !draft.name.trim() ||
            !draft.reason.trim()
          }
        >
          Add placement
        </Button>
      </form>
    </Card>
  );
}

function ListPanel({
  mode,
  items,
  selected,
  choose,
}: {
  mode: Mode;
  items: Item[];
  selected?: Item;
  choose: (item?: Item) => void;
}) {
  return (
    <section>
      <div className={'admin-content-ops__heading'}>
        <h2>{mode === 'ads' ? 'Ad inventory' : 'Editorial queue'}</h2>
        <Button variant={'secondary'} onClick={() => choose()}>
          New draft
        </Button>
      </div>
      {items.length === 0 ? (
        <Card>
          <EmptyState
            title={'Nothing in this market'}
            description={
              'Create the first controlled draft. Nothing publishes automatically.'
            }
          />
        </Card>
      ) : (
        <div className={'admin-content-ops__list'}>
          {items.map((item) => (
            <button
              key={item.id}
              type={'button'}
              className={selected?.id === item.id ? 'is-selected' : ''}
              onClick={() => choose(item)}
            >
              <span>
                <strong>{item.title}</strong>
                <small>
                  {mode === 'ads'
                    ? ((item as AdDto).placement_code ?? 'Ad')
                    : (item as ContentArticleDto).slug}
                </small>
              </span>
              <Status status={item.status} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

interface EditorProps {
  mode: Mode;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  placements: AdPlacementDto[];
  selected?: Item;
  reason: string;
  setReason: (value: string) => void;
  canWrite: boolean;
  managePermission: string;
  save: () => Promise<void>;
  nextStatus: AdsContentStatus | '';
  setNextStatus: (value: AdsContentStatus | '') => void;
  transition: () => Promise<void>;
}

function EditorPanel(props: EditorProps) {
  const {
    mode,
    draft,
    setDraft,
    placements,
    selected,
    reason,
    setReason,
    canWrite,
    managePermission,
    save,
    nextStatus,
    setNextStatus,
    transition,
  } = props;
  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2>{selected ? 'Detail & edit' : 'Create draft'}</h2>
        <Fields
          mode={mode}
          draft={draft}
          setDraft={setDraft}
          placements={placements}
        />
        <FormField
          label={'Reason'}
          hint={'Required and stored in audit evidence.'}
          htmlFor={'ops-reason'}
        >
          <Textarea
            id={'ops-reason'}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
        <Button
          type={'submit'}
          disabled={
            !canWrite || !reason.trim() || selected?.status === 'ARCHIVED'
          }
        >
          {selected ? 'Save changes' : 'Create draft'}
        </Button>
        {!canWrite && (
          <p>Writes require {managePermission}, online desktop access.</p>
        )}
      </form>
      {selected && (
        <section className={'admin-content-ops__transition'}>
          <h3>Lifecycle action</h3>
          {NEXT[selected.status].length === 0 ? (
            <p>Archived records are immutable.</p>
          ) : (
            <>
              <Select
                aria-label={'Next status'}
                value={nextStatus}
                onChange={(event) =>
                  setNextStatus(event.target.value as AdsContentStatus)
                }
              >
                <option value={''}>Select next status</option>
                {NEXT[selected.status].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </Select>
              <Button
                variant={'secondary'}
                disabled={!canWrite || !nextStatus || !reason.trim()}
                onClick={() => void transition()}
              >
                Apply status
              </Button>
            </>
          )}
        </section>
      )}
    </Card>
  );
}

function Fields({
  mode,
  draft,
  setDraft,
  placements,
}: {
  mode: Mode;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  placements: AdPlacementDto[];
}) {
  const field = (key: string, value: string | boolean) =>
    setDraft((current) => ({ ...current, [key]: value }));
  if (mode === 'ads')
    return (
      <>
        <TextField
          id={'ops-title'}
          label={'Title'}
          value={draft.title}
          onChange={(value) => field('title', value)}
        />
        <FormField label={'Placement'} htmlFor={'ops-placement'}>
          <Select
            id={'ops-placement'}
            required
            value={String(draft.placementId)}
            onChange={(event) => field('placementId', event.target.value)}
          >
            <option value={''}>Select placement</option>
            {placements
              .filter((item) => item.status === 'ACTIVE')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} - {item.code}
                </option>
              ))}
          </Select>
        </FormField>
        <TextField
          id={'ops-media'}
          label={'Creative media URL'}
          type={'url'}
          value={draft.creativeMediaUrl}
          onChange={(value) => field('creativeMediaUrl', value)}
        />
        <TextField
          id={'ops-alt'}
          label={'Alternative text'}
          value={draft.creativeAltText}
          onChange={(value) => field('creativeAltText', value)}
        />
        <TextField
          id={'ops-target'}
          label={'Target URL'}
          type={'url'}
          required={false}
          value={draft.targetUrl}
          onChange={(value) => field('targetUrl', value)}
        />
        <TextField
          id={'ops-label'}
          label={'Sponsor label (always visible)'}
          value={draft.sponsorLabel}
          onChange={(value) => field('sponsorLabel', value)}
        />
        <Schedule
          start={draft.scheduleStartAt}
          end={draft.scheduleEndAt}
          setStart={(value) => field('scheduleStartAt', value)}
          setEnd={(value) => field('scheduleEndAt', value)}
        />
      </>
    );
  return (
    <>
      <TextField
        id={'ops-slug'}
        label={'Slug'}
        value={draft.slug}
        onChange={(value) => field('slug', value)}
      />
      <TextField
        id={'ops-title'}
        label={'Title'}
        value={draft.title}
        onChange={(value) => field('title', value)}
      />
      <FormField label={'Excerpt'} htmlFor={'ops-excerpt'}>
        <Textarea
          id={'ops-excerpt'}
          required
          value={String(draft.excerpt)}
          onChange={(event) => field('excerpt', event.target.value)}
        />
      </FormField>
      <FormField label={'Article body'} htmlFor={'ops-body'}>
        <Textarea
          id={'ops-body'}
          rows={8}
          required
          value={String(draft.body)}
          onChange={(event) => field('body', event.target.value)}
        />
      </FormField>
      <TextField
        id={'ops-cover'}
        label={'Cover media URL'}
        type={'url'}
        required={false}
        value={draft.coverMediaUrl}
        onChange={(value) => field('coverMediaUrl', value)}
      />
      <TextField
        id={'ops-cover-alt'}
        label={'Cover alternative text'}
        required={false}
        value={draft.coverAltText}
        onChange={(value) => field('coverAltText', value)}
      />
      <label>
        <input
          type={'checkbox'}
          checked={Boolean(draft.isPromoted)}
          onChange={(event) => field('isPromoted', event.target.checked)}
        />{' '}
        Promoted content
      </label>
      {draft.isPromoted && (
        <TextField
          id={'ops-label'}
          label={'Promoted label'}
          value={draft.sponsorLabel}
          onChange={(value) => field('sponsorLabel', value)}
        />
      )}
      <Schedule
        start={draft.publishAt}
        end={draft.unpublishAt}
        setStart={(value) => field('publishAt', value)}
        setEnd={(value) => field('unpublishAt', value)}
      />
    </>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  required = true,
}: {
  id: string;
  label: string;
  value?: string | boolean;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <FormField label={label} htmlFor={id}>
      <Input
        id={id}
        type={type}
        required={required}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

function Schedule({
  start,
  end,
  setStart,
  setEnd,
}: {
  start?: string | boolean;
  end?: string | boolean;
  setStart: (value: string) => void;
  setEnd: (value: string) => void;
}) {
  return (
    <div className={'admin-content-ops__schedule'}>
      <TextField
        id={'ops-start'}
        label={'Start (UTC)'}
        type={'datetime-local'}
        required={false}
        value={start}
        onChange={setStart}
      />
      <TextField
        id={'ops-end'}
        label={'End (UTC)'}
        type={'datetime-local'}
        required={false}
        value={end}
        onChange={setEnd}
      />
    </div>
  );
}

function Status({ status }: { status: AdsContentStatus }) {
  const tone =
    status === 'ACTIVE'
      ? 'success'
      : status === 'PAUSED'
        ? 'error'
        : status === 'DRAFT' || status === 'SCHEDULED'
          ? 'warning'
          : 'neutral';
  return (
    <Badge tone={tone}>
      {status === 'PAUSED' ? 'PAUSED - SUSPENDED' : status}
    </Badge>
  );
}

function State({
  title,
  detail,
  retry,
}: {
  title: string;
  detail: string;
  retry?: () => void;
}) {
  return (
    <div className={'admin-page'}>
      <PageHeader title={title} description={detail} />
      <Card>
        <EmptyState
          title={title}
          description={detail}
          action={
            retry ? (
              <Button variant={'secondary'} onClick={retry}>
                Retry
              </Button>
            ) : undefined
          }
        />
      </Card>
    </div>
  );
}

function blank(mode: Mode): Draft {
  return mode === 'ads'
    ? {
        title: '',
        placementId: '',
        creativeMediaUrl: '',
        creativeAltText: '',
        targetUrl: '',
        sponsorLabel: 'Sponsored',
        scheduleStartAt: '',
        scheduleEndAt: '',
      }
    : {
        slug: '',
        title: '',
        excerpt: '',
        body: '',
        coverMediaUrl: '',
        coverAltText: '',
        isPromoted: false,
        sponsorLabel: 'Promoted',
        publishAt: '',
        unpublishAt: '',
      };
}

function fromItem(mode: Mode, item: Item): Draft {
  if (mode === 'ads') {
    const ad = item as AdDto;
    return {
      title: ad.title,
      placementId: ad.placement_id,
      creativeMediaUrl: ad.creative_media_url,
      creativeAltText: ad.creative_alt_text,
      targetUrl: ad.target_url ?? '',
      sponsorLabel: ad.sponsor_label,
      scheduleStartAt: local(ad.schedule_start_at),
      scheduleEndAt: local(ad.schedule_end_at),
    };
  }
  const article = item as ContentArticleDto;
  return {
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    body: article.body,
    coverMediaUrl: article.cover_media_url ?? '',
    coverAltText: article.cover_alt_text ?? '',
    isPromoted: article.is_promoted,
    sponsorLabel: article.sponsor_label ?? 'Promoted',
    publishAt: local(article.publish_at),
    unpublishAt: local(article.unpublish_at),
  };
}

function payload(
  mode: Mode,
  draft: Draft,
  reason: string,
): Record<string, unknown> {
  if (mode === 'ads')
    return {
      placementId: String(draft.placementId),
      title: String(draft.title),
      creativeMediaUrl: String(draft.creativeMediaUrl),
      creativeAltText: String(draft.creativeAltText),
      targetUrl: nullable(draft.targetUrl),
      isSponsored: true,
      sponsorLabel: String(draft.sponsorLabel),
      scheduleStartAt: utc(draft.scheduleStartAt),
      scheduleEndAt: utc(draft.scheduleEndAt),
      reason: reason.trim(),
    };
  return {
    slug: String(draft.slug),
    title: String(draft.title),
    excerpt: String(draft.excerpt),
    body: String(draft.body),
    coverMediaUrl: nullable(draft.coverMediaUrl),
    coverAltText: nullable(draft.coverAltText),
    isPromoted: Boolean(draft.isPromoted),
    sponsorLabel: draft.isPromoted ? String(draft.sponsorLabel) : null,
    publishAt: utc(draft.publishAt),
    unpublishAt: utc(draft.unpublishAt),
    reason: reason.trim(),
  };
}

function nullable(value: string | boolean | undefined): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}
function utc(value: string | boolean | undefined): string | null {
  const text = String(value ?? '');
  return text ? new Date(text).toISOString() : null;
}
function local(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 16) : '';
}
function errorText(error: unknown): string {
  return error instanceof ApiError
    ? (error.body.code ?? 'Request failed') + ': ' + error.message
    : 'The operation failed. Refresh and retry.';
}
