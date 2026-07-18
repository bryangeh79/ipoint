import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import {
  KycService,
  MEMBER_KYC_LEVEL_2_CONSENT_VERSION,
  MEMBER_KYC_MAX_FILE_SIZE_BYTES,
} from './kyc.service.js';
import type { CreateKycDraftDto } from './kyc.dto.js';

const accountId = randomUUID();
const memberId = randomUUID();
const marketId = randomUUID();
const caseId = randomUUID();
const now = new Date('2026-07-18T08:00:00.000Z');

function kycCase(status = 'DRAFT') {
  return {
    id: caseId,
    memberId,
    marketId,
    status,
    version: 1,
    levelRequested: 'LEVEL_2',
    legalFullName: 'Alice Member',
    identificationType: 'NATIONAL_ID',
    identificationNumber: 'A123456789',
    dateOfBirth: '1990-01-02',
    nationality: 'MY',
    residentialAddress: { line1: '1 Member Street', city: 'Kuala Lumpur' },
    accountCountrySnapshot: null,
    submissionMarketId: null,
    consentVersion: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedByAdminUserId: null,
    decisionReason: null,
    reverificationRequiredAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function documentRow(checksum = 'a'.repeat(64)) {
  return {
    id: randomUUID(),
    memberKycCaseId: caseId,
    memberId,
    marketId,
    documentType: 'IDENTITY_FRONT',
    objectKey: `metadata-only/${randomUUID()}`,
    originalFilename: 'metadata-only',
    contentType: 'application/pdf',
    byteSize: '1024',
    sha256: checksum,
    scanStatus: 'PENDING',
    classification: 'PRIVATE_KYC',
    createdAt: now,
    archivedAt: null,
  };
}

interface FakeOptions {
  selects?: unknown[][];
  returning?: unknown[][];
}

function createService(options: FakeOptions = {}) {
  const selects = [...(options.selects ?? [])];
  const returning = [...(options.returning ?? [])];

  function query(result: unknown[]) {
    const promise = Promise.resolve(result);
    const builder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn(() => promise),
      limit: vi.fn(() => promise),
      for: vi.fn(() => promise),
      then: promise.then.bind(promise),
    };
    return builder;
  }

  function mutation() {
    const promise = Promise.resolve([]);
    const builder = {
      values: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn(() => Promise.resolve(returning.shift() ?? [])),
      then: promise.then.bind(promise),
    };
    return builder;
  }

  const db = {
    select: vi.fn(() => query(selects.shift() ?? [])),
    insert: vi.fn(() => mutation()),
    update: vi.fn(() => mutation()),
  };
  const database = {
    db,
    runTransaction: vi.fn((callback: (tx: typeof db) => unknown) =>
      callback(db),
    ),
  };
  return {
    service: new KycService(database as unknown as DatabaseService),
    db,
  };
}

const validDocument = {
  documentType: 'IDENTITY_FRONT' as const,
  mimeType: 'application/pdf',
  size: 1024,
  checksum: 'a'.repeat(64),
};

describe('KycService', () => {
  it('returns the initial NOT_STARTED state', async () => {
    const { service } = createService({ selects: [[{ id: memberId }], []] });
    await expect(service.getStatus(accountId)).resolves.toMatchObject({
      id: null,
      status: 'NOT_STARTED',
      documents: [],
    });
  });

  it('creates a DRAFT case', async () => {
    const draft = kycCase();
    const { service } = createService({
      selects: [[{ id: memberId }], [], [{ marketId }], []],
      returning: [[draft]],
    });
    await expect(service.createDraft(accountId, {})).resolves.toMatchObject({
      id: caseId,
      status: 'DRAFT',
    });
  });

  it.each(['SUSPENDED', 'CLOSED'] as const)(
    'prevents a %s member from creating or modifying KYC',
    async (status) => {
      const create = createService({
        selects: [[{ id: memberId, status }]],
      });
      await expect(
        create.service.createDraft(accountId, {}),
      ).rejects.toMatchObject({ code: `MEMBER_${status}` });
      expect(create.db.insert).not.toHaveBeenCalled();
      expect(create.db.update).not.toHaveBeenCalled();

      const modify = createService({
        selects: [[{ id: memberId, status }]],
      });
      await expect(
        modify.service.updateDraft(accountId, { legalFullName: 'Blocked' }),
      ).rejects.toMatchObject({ code: `MEMBER_${status}` });
      expect(modify.db.update).not.toHaveBeenCalled();
    },
  );

  it('updates DRAFT fields and masks the identification number', async () => {
    const updated = { ...kycCase(), identificationNumber: 'NEW987654321' };
    const { service } = createService({
      selects: [[{ id: memberId }], [kycCase()], []],
      returning: [[updated]],
    });
    const result = await service.updateDraft(accountId, {
      legalFullName: 'Updated Member',
      identificationNumber: 'NEW987654321',
    });
    expect(result.identificationNumber).toBe('****4321');
  });

  it('rejects an invalid identification number', async () => {
    const { service } = createService({
      selects: [[{ id: memberId }], [kycCase()]],
    });
    await expect(
      service.updateDraft(accountId, { identificationNumber: '$$' }),
    ).rejects.toMatchObject({ code: 'KYC_IDENTIFICATION_NUMBER_INVALID' });
  });

  it('submits a complete DRAFT and captures account/market/consent snapshots', async () => {
    const submitted = {
      ...kycCase('SUBMITTED'),
      accountCountrySnapshot: 'MY',
      submissionMarketId: marketId,
      consentVersion: MEMBER_KYC_LEVEL_2_CONSENT_VERSION,
      submittedAt: now,
    };
    const { service } = createService({
      selects: [
        [{ id: memberId }],
        [],
        [kycCase()],
        [documentRow()],
        [{ accountCountry: 'MY' }],
        [{ marketId }],
        [documentRow()],
      ],
      returning: [[{ id: randomUUID() }], [submitted]],
    });
    const result = await service.submit(accountId, {
      idempotencyKey: 'submit-1',
    });
    expect(result).toMatchObject({
      status: 'SUBMITTED',
      accountCountrySnapshot: 'MY',
      submissionMarketId: marketId,
      consentVersion: MEMBER_KYC_LEVEL_2_CONSENT_VERSION,
    });
  });

  it('fails submission when required fields are missing', async () => {
    const incomplete = {
      ...kycCase(),
      legalFullName: null,
      identificationNumber: null,
    };
    const { service } = createService({
      selects: [[{ id: memberId }], [], [incomplete], []],
      returning: [[{ id: randomUUID() }]],
    });
    await expect(
      service.submit(accountId, { idempotencyKey: 'missing-fields' }),
    ).rejects.toMatchObject({ code: 'KYC_MISSING_REQUIRED_FIELDS' });
  });

  it('adds document metadata to a DRAFT', async () => {
    const doc = documentRow();
    const { service } = createService({
      selects: [
        [{ id: memberId }],
        [kycCase()],
        [{ value: 0 }],
        [],
        [kycCase()],
        [doc],
      ],
    });
    const result = await service.addDocument(accountId, validDocument);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      mimeType: 'application/pdf',
      checksum: validDocument.checksum,
    });
  });

  it('rejects an invalid MIME type', async () => {
    const { service } = createService({ selects: [[{ id: memberId }]] });
    await expect(
      service.addDocument(accountId, {
        ...validDocument,
        mimeType: 'text/plain',
      }),
    ).rejects.toMatchObject({ code: 'KYC_INVALID_FILE_TYPE' });
  });

  it('rejects an oversized file', async () => {
    const { service } = createService({ selects: [[{ id: memberId }]] });
    await expect(
      service.addDocument(accountId, {
        ...validDocument,
        size: MEMBER_KYC_MAX_FILE_SIZE_BYTES + 1,
      }),
    ).rejects.toMatchObject({ code: 'KYC_FILE_TOO_LARGE' });
  });

  it('rejects a duplicate checksum', async () => {
    const { service } = createService({
      selects: [
        [{ id: memberId }],
        [kycCase()],
        [{ value: 1 }],
        [{ id: randomUUID() }],
      ],
    });
    await expect(
      service.addDocument(accountId, validDocument),
    ).rejects.toMatchObject({ code: 'KYC_DUPLICATE_DOCUMENT' });
  });

  it('supports committing a DRAFT then submitting it in sequence', async () => {
    const draft = kycCase();
    const submitted = {
      ...draft,
      status: 'SUBMITTED',
      accountCountrySnapshot: 'MY',
      submissionMarketId: marketId,
      consentVersion: MEMBER_KYC_LEVEL_2_CONSENT_VERSION,
      submittedAt: now,
    };
    const { service } = createService({
      selects: [
        [{ id: memberId }],
        [],
        [{ marketId }],
        [],
        [{ id: memberId }],
        [],
        [draft],
        [documentRow()],
        [{ accountCountry: 'MY' }],
        [{ marketId }],
        [documentRow()],
      ],
      returning: [[draft], [{ id: randomUUID() }], [submitted]],
    });
    expect((await service.createDraft(accountId, {})).status).toBe('DRAFT');
    expect(
      (await service.submit(accountId, { idempotencyKey: 'sequence-submit' }))
        .status,
    ).toBe('SUBMITTED');
  });

  it('resubmits from MORE_INFO_REQUIRED', async () => {
    const current = kycCase('MORE_INFO_REQUIRED');
    const submitted = {
      ...current,
      status: 'SUBMITTED',
      version: 2,
      accountCountrySnapshot: 'MY',
      submissionMarketId: marketId,
      consentVersion: MEMBER_KYC_LEVEL_2_CONSENT_VERSION,
      submittedAt: now,
    };
    const { service } = createService({
      selects: [
        [{ id: memberId }],
        [],
        [current],
        [documentRow()],
        [{ accountCountry: 'MY' }],
        [{ marketId }],
        [documentRow()],
      ],
      returning: [[{ id: randomUUID() }], [submitted]],
    });
    await expect(
      service.resubmit(accountId, { idempotencyKey: 'resubmit-1' }),
    ).resolves.toMatchObject({ status: 'SUBMITTED' });
  });

  it('rejects resubmission from REJECTED', async () => {
    const { service } = createService({
      selects: [[{ id: memberId }], [], [kycCase('REJECTED')]],
      returning: [[{ id: randomUUID() }]],
    });
    await expect(
      service.resubmit(accountId, { idempotencyKey: 'bad-resubmit' }),
    ).rejects.toMatchObject({ code: 'KYC_INVALID_STATE' });
  });

  it('returns the cached result for the same idempotency key', async () => {
    const cached = {
      id: caseId,
      status: 'SUBMITTED',
      levelRequested: 'LEVEL_2',
      documents: [],
    };
    const payload = { idempotencyKey: 'cached-submit' };
    const requestHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    const { service } = createService({
      selects: [
        [{ id: memberId }],
        [{ requestHash, response: cached, statusCode: 200 }],
      ],
    });
    await expect(service.submit(accountId, payload)).resolves.toEqual(cached);
  });

  it('rejects a different payload reused with the same idempotency key', async () => {
    const originalPayload = { idempotencyKey: 'reused', marker: 'original' };
    const requestHash = createHash('sha256')
      .update(JSON.stringify(originalPayload))
      .digest('hex');
    const { service } = createService({
      selects: [
        [{ id: memberId }],
        [{ requestHash, response: { status: 'DRAFT' }, statusCode: 200 }],
      ],
    });
    const changedPayload = {
      idempotencyKey: 'reused',
      marker: 'changed',
    } as CreateKycDraftDto;
    await expect(
      service.createDraft(accountId, changedPayload),
    ).rejects.toMatchObject({ code: 'KYC_IDEMPOTENCY_CONFLICT' });
  });
});
