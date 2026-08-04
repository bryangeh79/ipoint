import type {
  AdminMerchantBranchDetailDto,
  AdminPackageCatalogDto,
  AdminSpecialPercentageListDto,
} from '@ipoint/api-client';

/**
 * P7-S6A package-configuration page-test fixtures. Rates are exact decimal
 * strings exactly as the server returns them (numeric(12,6)).
 */

export const packageOpsMarketA = '11111111-1111-4111-8111-111111111111';

export const packageCatalogFixture: AdminPackageCatalogDto = {
  marketId: packageOpsMarketA,
  items: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      code: 'A',
      name: 'Standard Package A',
      description: 'Standard merchant service-fee package A.',
      versions: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          profile_id: '22222222-2222-4222-8222-222222222222',
          rate: '2.500000',
          status: 'ACTIVE',
          effective_from: '1970-01-01T00:00:00.000Z',
          effective_to: null,
          created_at: '2026-07-01T00:00:00.000Z',
        },
        {
          id: '33333333-3333-4333-8333-333333333334',
          profile_id: '22222222-2222-4222-8222-222222222222',
          rate: '3.000000',
          status: 'DRAFT',
          effective_from: '2027-01-01T00:00:00.000Z',
          effective_to: '2027-06-01T00:00:00.000Z',
          created_at: '2026-07-02T00:00:00.000Z',
        },
      ],
    },
    {
      id: '22222222-2222-4222-8222-222222222223',
      code: 'B',
      name: 'Standard Package B',
      description: 'Standard merchant service-fee package B.',
      versions: [
        {
          id: '33333333-3333-4333-8333-333333333335',
          profile_id: '22222222-2222-4222-8222-222222222223',
          rate: '5.000000',
          status: 'ACTIVE',
          effective_from: '1970-01-01T00:00:00.000Z',
          effective_to: null,
          created_at: '2026-07-01T00:00:00.000Z',
        },
      ],
    },
  ],
};

export const specialPercentagesFixture: AdminSpecialPercentageListDto = {
  marketId: packageOpsMarketA,
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      rate: '12.500000',
      description: 'Special launch partner',
      created_by_admin_user_id: 'admin-1',
      created_at: '2026-07-03T00:00:00.000Z',
    },
  ],
};

export const merchantBranchDetailFixture: AdminMerchantBranchDetailDto = {
  branch_id: '55555555-5555-4555-8555-555555555555',
  merchant_id: 'MERCH-0001',
  market_id: packageOpsMarketA,
  profile: {
    branch_id: '55555555-5555-4555-8555-555555555555',
    merchant_id: 'MERCH-0001',
    market_id: packageOpsMarketA,
    display_name: 'Acme Package Co',
    primary_email: 'owner@example.com',
    phone: '+60123456789',
    address: '1 Jalan Test',
    about: null,
    business_hours: null,
    website: null,
    whatsapp: null,
    socials: null,
    logo_object_key: null,
    banner_object_key: null,
    gallery: [],
  },
  application: {
    application_id: 'app-1',
    status: 'APPROVED',
    operational_status: 'ACTIVE',
    submissions: [],
    reviews: [],
  },
  kyc: {
    current: null,
    previous: null,
  },
  packages: {
    items: [
      {
        assignment_id: '66666666-6666-4666-8666-666666666666',
        service_fee_profile_id: '22222222-2222-4222-8222-222222222222',
        service_fee_profile_code: 'A',
        service_fee_profile_name: 'Standard Package A',
        service_fee_version_id: '33333333-3333-4333-8333-333333333333',
        rate: '2.500000',
        effective_from: '1970-01-01T00:00:00.000Z',
        effective_to: null,
        special_percentage_id: null,
        special_percentage_rate: null,
        special_percentage_description: null,
        status: 'ACTIVE',
        is_default: true,
        version: 1,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    ],
    limit: 20,
    offset: 0,
  },
  mcp: null,
};
