import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import { ConfigModule } from '../config/config.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { RedemptionModule } from './redemption.module.js';
import { RedemptionService } from './redemption.service.js';

describe('Redemption (P6)', () => {
  let app: INestApplication;
  let svc: RedemptionService;
  let db: any;

  const MKID = '00000000-0000-4000-a000-000000000010';
  const CID = '00000000-0000-4000-a000-000000000200';
  const AID = '00000000-0000-4000-a000-000000000900';
  const actor = { adminUserId: AID, ipAddress: '127.0.0.1' };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        PlatformAccessModule,
        RedemptionModule,
      ],
    }).compile();
    app = ref.createNestApplication();
    await app.init();
    svc = app.get(RedemptionService);
    db = app.get(DatabaseService).db;
    await db.execute(
      sql`INSERT INTO markets(id,code,name,status,currency_code,timezone,default_locale) VALUES(${MKID},'INTMKT','Integration Market','ACTIVE','MYR','Asia/Kuala_Lumpur','en-MY') ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO accounts(id,public_id,email,account_country,status,email_verified_at) VALUES('00000000-0000-4000-a000-000000000810','int-admin','int-admin@test.com','MY','ACTIVE',NOW()) ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO admin_users(id,account_id,display_name,status) VALUES('00000000-0000-4000-a000-000000000900','00000000-0000-4000-a000-000000000810','Integration Admin','ACTIVE') ON CONFLICT(id) DO NOTHING`,
    );
    // Seed test member + account for QT-01/QT-02 (fresh DB needs these)
    await db.execute(
      sql`INSERT INTO accounts(id,public_id,email,account_country,status,email_verified_at) VALUES('00000000-0000-4000-a000-000000000001','qt-member','qt@test.com','MY','ACTIVE',NOW()) ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO members(id,account_id,public_member_id,referral_code,status,kyc_level) VALUES('00000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','QT-MEMBER','QT-REF','ACTIVE'::member_status,'LEVEL_2'::member_kyc_level) ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO redemption_terms_acceptances(member_id,market_id,terms_version) VALUES('00000000-0000-4000-a000-000000000001',${MKID},'v1') ON CONFLICT DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO redemption_rate_versions(id,market_id,rate_type,rate_value,effective_from,created_by) VALUES('00000000-0000-4000-a000-000000000300',${MKID},'POINTS_PER_CURRENCY','0.0100000000','2026-01-01T00:00:00.000Z',${AID}) ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO redemption_catalog_items(id,market_id,sku,name,item_type,status,fiat_reference_value,fiat_currency,fulfilment_mode,inventory_mode,created_by,version) VALUES(${CID},${MKID},'TEST-SKU-001','Test Item','PHYSICAL','ACTIVE','50','MYR','PICKUP','TRACKED',${AID},1) ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO redemption_inventory(id,item_id,total_quantity,committed_quantity,fulfilled_quantity,backorder_quantity,version) VALUES('00000000-0000-4000-a000-000000000400',${CID},100,0,0,0,1) ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO redemption_pickup_locations(id,market_id,name,address,contact_name,contact_phone,is_active,created_by) VALUES('00000000-0000-4000-a000-000000000500',${MKID},'Test Pickup','{}','John','+60123456789',true,${AID}) ON CONFLICT(id) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function mbr(o?: { bal?: string; noWallet?: boolean }) {
    const m = crypto.randomUUID(),
      a = crypto.randomUUID(),
      w = crypto.randomUUID(),
      t = crypto.randomUUID().slice(0, 8);
    await db.execute(
      sql`INSERT INTO accounts(id,public_id,email,account_country,status,email_verified_at) VALUES(${a},${`m-${t}`},${`m${t}@x`},'MY','ACTIVE',NOW()) ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO members(id,account_id,public_member_id,referral_code,status,kyc_level) VALUES(${m},${a},${`MB-${t}`},${`RF-${t}`},'ACTIVE'::member_status,'LEVEL_2'::member_kyc_level) ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO redemption_terms_acceptances(member_id,market_id,terms_version) VALUES(${m},${MKID},'v1') ON CONFLICT DO NOTHING`,
    );
    if (!o?.noWallet)
      await db.execute(
        sql`INSERT INTO member_wallet_accounts(id,member_id,market_id,pending_balance,available_balance,reversed_balance,version) VALUES(${w},${m},${MKID},0,${o?.bal ?? '100000'},0,1) ON CONFLICT(id) DO NOTHING`,
      );
    return { m, w };
  }

  async function activeItem() {
    const r = await svc.createCatalogItem(actor, {
      marketId: MKID,
      sku: `SKU-AI-${Date.now()}`,
      name: 'AI',
      itemType: 'PHYSICAL',
      fiatReferenceValue: '100',
      fiatCurrency: 'MYR',
      fulfilmentMode: 'PICKUP',
      inventoryMode: 'TRACKED',
      idempotencyKey: `ai:${Date.now()}`,
    });
    await db.execute(
      sql`INSERT INTO redemption_inventory(id,item_id,total_quantity,committed_quantity,fulfilled_quantity,backorder_quantity,version) VALUES(${crypto.randomUUID()},${r.id},100,0,0,0,1) ON CONFLICT(id) DO NOTHING`,
    );
    await svc.setCatalogStatus(actor, r.id, {
      status: 'ACTIVE',
      reason: 't',
      idempotencyKey: `ai-act:${Date.now()}`,
    });
    return r.id;
  }

  it('CR-01: create', async () => {
    const r = await svc.createCatalogItem(actor, {
      marketId: MKID,
      sku: `SKU-${Date.now()}`,
      name: 'T',
      itemType: 'PHYSICAL',
      fiatReferenceValue: '100',
      fiatCurrency: 'MYR',
      fulfilmentMode: 'DELIVERY',
      inventoryMode: 'TRACKED',
      idempotencyKey: `c01:${Date.now()}`,
    });
    expect(r.name).toBe('T');
  });

  it('CR-02: duplicate SKU', async () => {
    const s = `SKU-${Date.now()}`;
    await svc.createCatalogItem(actor, {
      marketId: MKID,
      sku: s,
      name: 'A',
      itemType: 'PHYSICAL',
      fiatReferenceValue: '100',
      fiatCurrency: 'MYR',
      fulfilmentMode: 'DELIVERY',
      inventoryMode: 'TRACKED',
      idempotencyKey: `cd1:${Date.now()}`,
    });
    await expect(
      svc.createCatalogItem(actor, {
        marketId: MKID,
        sku: s,
        name: 'B',
        itemType: 'PHYSICAL',
        fiatReferenceValue: '100',
        fiatCurrency: 'MYR',
        fulfilmentMode: 'DELIVERY',
        inventoryMode: 'TRACKED',
        idempotencyKey: `cd2:${Date.now()}`,
      }),
    ).rejects.toThrow();
  });

  it('CR-03: status manage', async () => {
    const r = await svc.createCatalogItem(actor, {
      marketId: MKID,
      sku: `SKU-${Date.now()}`,
      name: 'S',
      itemType: 'PHYSICAL',
      fiatReferenceValue: '100',
      fiatCurrency: 'MYR',
      fulfilmentMode: 'DELIVERY',
      inventoryMode: 'TRACKED',
      idempotencyKey: `cs3:${Date.now()}`,
    });
    await svc.setCatalogStatus(actor, r.id, {
      status: 'DISABLED',
      reason: 't',
      idempotencyKey: `cs3d:${Date.now()}`,
    });
    await svc.setCatalogStatus(actor, r.id, {
      status: 'ARCHIVED',
      reason: 't',
      idempotencyKey: `cs3a:${Date.now()}`,
    });
  });

  it('CR-04: list items', async () => {
    const r: any = await (svc.listCatalogItems as any)(actor, MKID, {
      page: 1,
      pageSize: 10,
    });
    expect(r.items ? r.items.length : 0).toBeGreaterThanOrEqual(1);
  });

  it('CR-05: browse', async () => {
    const r: any = await svc.browseCatalog(MKID, {
      page: 1,
      pageSize: 10,
      sort: 'name:asc',
    } as any);
    expect(r.items ? r.items.length : 0).toBeGreaterThanOrEqual(1);
  });

  /** Future market-local 00:00 (Asia/Kuala_Lumpur, UTC+8). */
  function klMidnightIso(daysAhead: number): string {
    const probe = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(probe);
    const map = new Map(parts.map((part) => [part.type, part.value]));
    return new Date(
      Date.UTC(
        Number(map.get('year')),
        Number(map.get('month')) - 1,
        Number(map.get('day')),
        0,
        0,
        0,
        0,
      ) -
        8 * 60 * 60 * 1000,
    ).toISOString();
  }

  /**
   * Seed the RBAC grant chain + market grant for the integration admin so
   * the secured owner's server-side checks pass (D-053 §5).
   */
  async function ensureRateOwnerAccess(marketId: string): Promise<void> {
    await db.execute(
      sql`INSERT INTO permissions (code, description)
          VALUES ('redemption.rate.manage', 'Integration rate owner test')
          ON CONFLICT (code) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO roles (code, name, is_system)
          VALUES ('D053_RATE_INT', 'Rate Owner Integration Role', false)
          ON CONFLICT (code) DO NOTHING`,
    );
    const permRow = await db.execute(
      sql`SELECT id FROM permissions WHERE code = 'redemption.rate.manage'`,
    );
    const roleRow = await db.execute(
      sql`SELECT id FROM roles WHERE code = 'D053_RATE_INT'`,
    );
    if (permRow.rows[0]?.id && roleRow.rows[0]?.id) {
      await db.execute(
        sql`INSERT INTO role_permissions (role_id, permission_id)
            VALUES (${roleRow.rows[0].id}, ${permRow.rows[0].id})
            ON CONFLICT DO NOTHING`,
      );
      await db.execute(
        sql`INSERT INTO role_assignments (admin_user_id, role_id)
            VALUES (${AID}, ${roleRow.rows[0].id})
            ON CONFLICT DO NOTHING`,
      );
    }
    await db.execute(
      sql`INSERT INTO market_access (admin_user_id, market_id)
          VALUES (${AID}, ${marketId})
          ON CONFLICT DO NOTHING`,
    );
  }

  it('RV-01: create rate', async () => {
    const mk = crypto.randomUUID();
    const code = `M${mk.slice(0, 6).toUpperCase()}`;
    await db.execute(
      sql`INSERT INTO markets(id,code,name,status,currency_code,timezone,default_locale) VALUES(${mk},${code},'RV1','ACTIVE','MYR','Asia/Kuala_Lumpur','en-MY') ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO redemption_rate_market_rules (market_code, rate_type, initial_rate, minimum_rate, maximum_rate, currency, display_unit)
          VALUES (${code}, 'CURRENCY_PER_POINT'::redemption_rate_type, '0.0100000000', '0.0100000000', '100.0000000000', 'MYR', 'RM per 1 iPoint')
          ON CONFLICT (market_code, rate_type) DO NOTHING`,
    );
    await ensureRateOwnerAccess(mk);
    const r = await svc.createRateVersion(
      { ...actor, currentMarketId: mk },
      {
        marketId: mk,
        rateType: 'CURRENCY_PER_POINT',
        rateValue: '0.02',
        fiatCurrency: 'MYR',
        effectiveFrom: klMidnightIso(2),
        reason: 'RV-01 evidence',
        idempotencyKey: `rv1:${Date.now()}`,
      },
    );
    expect(r.rateType).toBe('CURRENCY_PER_POINT');
  });

  it('RV-02: reject overlap', async () => {
    const mk = crypto.randomUUID();
    const code = `M${mk.slice(0, 6).toUpperCase()}`;
    await db.execute(
      sql`INSERT INTO markets(id,code,name,status,currency_code,timezone,default_locale) VALUES(${mk},${code},'RV2','ACTIVE','MYR','Asia/Kuala_Lumpur','en-MY') ON CONFLICT(id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO redemption_rate_market_rules (market_code, rate_type, initial_rate, minimum_rate, maximum_rate, currency, display_unit)
          VALUES (${code}, 'POINTS_PER_CURRENCY'::redemption_rate_type, '1.0000000000', '0.0100000000', '100.0000000000', 'MYR', 'RM per 1 iPoint')
          ON CONFLICT (market_code, rate_type) DO NOTHING`,
    );
    await ensureRateOwnerAccess(mk);
    const start = klMidnightIso(2);
    await svc.createRateVersion(
      { ...actor, currentMarketId: mk },
      {
        marketId: mk,
        rateType: 'POINTS_PER_CURRENCY',
        rateValue: '0.01',
        fiatCurrency: 'MYR',
        effectiveFrom: start,
        reason: 'RV-02 seed',
        idempotencyKey: `rv2a:${Date.now()}`,
      },
    );
    await expect(
      svc.createRateVersion(
        { ...actor, currentMarketId: mk },
        {
          marketId: mk,
          rateType: 'POINTS_PER_CURRENCY',
          rateValue: '0.02',
          fiatCurrency: 'MYR',
          effectiveFrom: start,
          reason: 'RV-02 overlap attempt',
          idempotencyKey: `rv2b:${Date.now()}`,
        },
      ),
    ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_OVERLAP' });
  });

  it('RV-03: list rates', async () => {
    const r: any = await (svc.listRateVersions as any)(actor, MKID, {
      page: 1,
      pageSize: 10,
    });
    expect(r.versions ? r.versions.length : 0).toBeGreaterThanOrEqual(1);
  });

  it('PL-01: create pickup', async () => {
    const r: any = await svc.createPickupLocation(actor, {
      marketId: MKID,
      name: `P${Date.now()}`,
      address: {},
      idempotencyKey: `pl:${Date.now()}`,
    });
    expect(r.name).toContain('P');
  });

  it('PL-02: list pickups', async () => {
    const r: any = await (svc.listPickupLocations as any)(actor, MKID, {
      page: 1,
      pageSize: 10,
    });
    expect(r.locations ? r.locations.length : 0).toBeGreaterThanOrEqual(1);
  });

  it('QT-01: generate quote', async () => {
    const r = await svc.generateQuote(
      '00000000-0000-4000-a000-000000000001',
      MKID,
      CID,
      1,
    );
    expect(r.quoteId).toBeDefined();
  });

  it('QT-02: compute cost', async () => {
    const r = await svc.generateQuote(
      '00000000-0000-4000-a000-000000000001',
      MKID,
      CID,
      3,
    );
    expect(Number(r.postedPointCost)).toBeGreaterThan(0);
  });

  it('QT-03: reject inactive', async () => {
    const i = await activeItem();
    await svc.setCatalogStatus(actor, i, {
      status: 'DISABLED',
      reason: 't',
      idempotencyKey: `qi:${Date.now()}`,
    });
    await expect(
      svc.generateQuote('00000000-0000-4000-a000-000000000001', MKID, i, 1),
    ).rejects.toThrow();
  });

  async function confirm(
    memberId: string,
    itemId: string,
    key: string,
    ftype: string = 'PICKUP',
  ) {
    const q = await svc.generateQuote(memberId, MKID, itemId, 1);
    return svc.confirmOrder(
      memberId,
      MKID,
      {
        quoteId: q.quoteId,
        idempotencyKey: key,
        expectedItemVersion: 1,
        expectedTotalPoints: q.postedPointCost,
        expectedQuantity: '1',
        fulfilment: { type: ftype as any },
        termsAcceptance: { accepted: true, termsVersion: 'v1' },
      },
      { ipAddress: '127.0.0.1' },
    );
  }

  it('CO-01: wallet debit', async () => {
    const f = await mbr();
    const i = await activeItem();
    const r = await confirm(f.m, i, `c01:${Date.now()}`);
    expect(r.status).toBe('CONFIRMED');
    const w = await db.execute(
      sql`SELECT available_balance FROM member_wallet_accounts WHERE id=${f.w}`,
    );
    expect(Number(w.rows[0]!.available_balance)).toBeLessThan(100000);
  });

  it('CO-02: delivery requires a paid shipping payment', async () => {
    const f = await mbr();
    const i = await activeItem();
    await expect(
      confirm(f.m, i, `c02:${Date.now()}`, 'DELIVERY'),
    ).rejects.toThrow(/paid shipping payment is required/i);
  });

  it('CO-03: no terms', async () => {
    const f = await mbr();
    const i = await activeItem();
    const q = await svc.generateQuote(f.m, MKID, i, 1);
    await expect(
      svc.confirmOrder(
        f.m,
        MKID,
        {
          quoteId: q.quoteId,
          idempotencyKey: `c03:${Date.now()}`,
          expectedItemVersion: 1,
          expectedTotalPoints: q.postedPointCost,
          expectedQuantity: '1',
          fulfilment: { type: 'PICKUP' },
          termsAcceptance: { accepted: false, termsVersion: 'v1' },
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow();
  });

  it('CO-04: expired', async () => {
    const f = await mbr();
    const rs = JSON.stringify({
      rateVersionId: '00000000-0000-4000-a000-000000000300',
      rateType: 'POINTS_PER_CURRENCY',
      rateValue: '0.0100000000',
    });
    const e = await db.execute(
      sql`INSERT INTO redemption_quotes(member_id,market_id,catalog_item_id,status,rate_version_id,rate_snapshot,unrounded_point_cost,posted_point_cost,payload_hash,expires_at,created_at,idempotency_key) VALUES(${f.m},${MKID},${CID},'VALID'::redemption_quote_status,'00000000-0000-4000-a000-000000000300',${rs}::jsonb,'5000','5000','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NOW()-interval'1h',NOW()-interval'2h',${`c04:${Date.now()}`}) RETURNING id`,
    );
    await expect(
      svc.confirmOrder(
        f.m,
        MKID,
        {
          quoteId: e.rows[0]!.id as string,
          idempotencyKey: `c04x:${Date.now()}`,
          expectedItemVersion: 1,
          expectedTotalPoints: '5000',
          expectedQuantity: '1',
          fulfilment: { type: 'PICKUP' },
          termsAcceptance: { accepted: true, termsVersion: 'v1' },
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow(/expired/);
  });

  it('CO-05: stale version', async () => {
    const f = await mbr();
    const i = await activeItem();
    const q = await svc.generateQuote(f.m, MKID, i, 1);
    await db.execute(
      sql`UPDATE redemption_catalog_items SET version=version+1 WHERE id=${i}`,
    );
    await expect(
      svc.confirmOrder(
        f.m,
        MKID,
        {
          quoteId: q.quoteId,
          idempotencyKey: `c05:${Date.now()}`,
          expectedItemVersion: 1,
          expectedTotalPoints: q.postedPointCost,
          expectedQuantity: '1',
          fulfilment: { type: 'PICKUP' },
          termsAcceptance: { accepted: true, termsVersion: 'v1' },
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow();
  });

  it('CO-06: idempotent', async () => {
    const f = await mbr();
    const i = await activeItem();
    const q = await svc.generateQuote(f.m, MKID, i, 1);
    const k = `c06:${Date.now()}`;
    const o = {
      quoteId: q.quoteId,
      idempotencyKey: k,
      expectedItemVersion: 1,
      expectedTotalPoints: q.postedPointCost,
      expectedQuantity: '1',
      fulfilment: { type: 'PICKUP' as const },
      termsAcceptance: { accepted: true, termsVersion: 'v1' },
    };
    const r1 = await svc.confirmOrder(f.m, MKID, o, { ipAddress: '127.0.0.1' });
    const r2 = await svc.confirmOrder(f.m, MKID, o, { ipAddress: '127.0.0.1' });
    expect((r1 as any).id).toBe((r2 as any).id);
  });

  it('CO-07: consumed', async () => {
    const f = await mbr();
    const i = await activeItem();
    const q = await svc.generateQuote(f.m, MKID, i, 1);
    const pts = q.postedPointCost;
    await svc.confirmOrder(
      f.m,
      MKID,
      {
        quoteId: q.quoteId,
        idempotencyKey: `c07a:${Date.now()}`,
        expectedItemVersion: 1,
        expectedTotalPoints: pts,
        expectedQuantity: '1',
        fulfilment: { type: 'PICKUP' },
        termsAcceptance: { accepted: true, termsVersion: 'v1' },
      },
      { ipAddress: '127.0.0.1' },
    );
    await expect(
      svc.confirmOrder(
        f.m,
        MKID,
        {
          quoteId: q.quoteId,
          idempotencyKey: `c07b:${Date.now()}`,
          expectedItemVersion: 1,
          expectedTotalPoints: pts,
          expectedQuantity: '1',
          fulfilment: { type: 'PICKUP' },
          termsAcceptance: { accepted: true, termsVersion: 'v1' },
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow();
  });

  it('CO-08: tampered', async () => {
    const f = await mbr();
    const rs = JSON.stringify({
      rateVersionId: '00000000-0000-4000-a000-000000000300',
      rateType: 'POINTS_PER_CURRENCY',
      rateValue: '0.0100000000',
    });
    const t = await db.execute(
      sql`INSERT INTO redemption_quotes(member_id,market_id,catalog_item_id,status,rate_version_id,rate_snapshot,unrounded_point_cost,posted_point_cost,payload_hash,expires_at,idempotency_key) VALUES(${f.m},${MKID},${CID},'VALID'::redemption_quote_status,'00000000-0000-4000-a000-000000000300',${rs}::jsonb,'5000','5000','0000000000000000000000000000000000000000000000000000000000000000',NOW()+interval'30min',${`c08:${Date.now()}`}) RETURNING id`,
    );
    await expect(
      svc.confirmOrder(
        f.m,
        MKID,
        {
          quoteId: t.rows[0]!.id as string,
          idempotencyKey: `c08x:${Date.now()}`,
          expectedItemVersion: 1,
          expectedTotalPoints: '5000',
          expectedQuantity: '1',
          fulfilment: { type: 'PICKUP' },
          termsAcceptance: { accepted: true, termsVersion: 'v1' },
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow();
  });

  it('CO-09: point mismatch', async () => {
    const f = await mbr();
    const i = await activeItem();
    const q = await svc.generateQuote(f.m, MKID, i, 1);
    await expect(
      svc.confirmOrder(
        f.m,
        MKID,
        {
          quoteId: q.quoteId,
          idempotencyKey: `c09:${Date.now()}`,
          expectedItemVersion: 1,
          expectedTotalPoints: '1',
          expectedQuantity: '1',
          fulfilment: { type: 'PICKUP' },
          termsAcceptance: { accepted: true, termsVersion: 'v1' },
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow();
  });

  it('CO-10: sufficient', async () => {
    const f = await mbr({ bal: '50000' });
    const i = await activeItem();
    const r = await confirm(f.m, i, `c10:${Date.now()}`);
    expect(r.status).toBe('CONFIRMED');
  });

  it('CO-11: insufficient', async () => {
    const f = await mbr({ bal: '5' });
    const i = await activeItem();
    await expect(confirm(f.m, i, `c11:${Date.now()}`)).rejects.toThrow(
      /Insufficient|balance/,
    );
  });

  it('CO-12: non-negative', async () => {
    const f = await mbr({ bal: '10000' });
    const i = await activeItem();
    await confirm(f.m, i, `c12:${Date.now()}`);
    const w = await db.execute(
      sql`SELECT available_balance FROM member_wallet_accounts WHERE id=${f.w}`,
    );
    expect(Number(w.rows[0]!.available_balance)).toBeGreaterThanOrEqual(0);
  });

  it('CO-13: no wallet', async () => {
    const f = await mbr({ noWallet: true });
    const i = await activeItem();
    const q = await svc.generateQuote(f.m, MKID, i, 1);
    await expect(
      svc.confirmOrder(
        f.m,
        MKID,
        {
          quoteId: q.quoteId,
          idempotencyKey: `c13:${Date.now()}`,
          expectedItemVersion: 1,
          expectedTotalPoints: q.postedPointCost,
          expectedQuantity: '1',
          fulfilment: { type: 'PICKUP' },
          termsAcceptance: { accepted: true, termsVersion: 'v1' },
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow(/Wallet account not found/);
  });

  it('SP-01: shipping', async () => {
    const f = await mbr();
    const r: any = await svc.calculateShippingCost(f.m, MKID, CID);
    expect(r).toBeDefined();
  });

  it('SP-02: shipping 2', async () => {
    const f = await mbr();
    const r: any = await svc.calculateShippingCost(f.m, MKID, CID);
    expect(r).toBeDefined();
  });
});
