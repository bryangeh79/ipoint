import type {
  AdminMerchantApplicationQueueItemDto,
  AdminMerchantBranchDetailDto,
  AdminMerchantListItemDto,
} from '@ipoint/api-client';

/**
 * P7-S5B merchant operations fixtures (test-only). Values mirror the Phase 1
 * owner endpoints and the Phase 7 branch-detail adapter shapes; KYC values
 * are already masked exactly as the owner returns them.
 */

export const merchantMarketA = '11111111-1111-4111-8111-111111111111';
export const merchantMarketB = '22222222-2222-4222-8222-222222222222';
export const merchantBranchA = '33333333-3333-4333-8333-333333333333';
export const merchantBranchB = '44444444-4444-4444-8444-444444444444';
export const merchantMcpAccountA = '55555555-5555-4555-8555-555555555555';

export function merchantApplicationQueueFixture(): AdminMerchantApplicationQueueItemDto[] {
  return [
    {
      application_id: 'app-1',
      branch_id: merchantBranchA,
      merchant_id: 'M-00000001',
      display_name: 'Kopitiam Sdn Bhd',
      application_status: 'SUBMITTED',
      operational_status: 'PENDING_APPLICATION',
      updated_at: '2026-08-01T08:30:00.000Z',
    },
    {
      application_id: 'app-2',
      branch_id: merchantBranchB,
      merchant_id: 'M-00000002',
      display_name: 'Nasi Lemak House',
      application_status: 'UNDER_REVIEW',
      operational_status: 'PENDING_APPLICATION',
      updated_at: '2026-08-01T09:00:00.000Z',
    },
  ];
}

export function merchantListFixture(): AdminMerchantListItemDto[] {
  return [
    {
      branch_id: merchantBranchA,
      merchant_id: 'M-00000001',
      name: 'Kopitiam Sdn Bhd',
      status: 'ACTIVE',
      market_id: merchantMarketA,
      created_at: '2026-07-01T00:00:00.000Z',
      application_status: 'APPROVED',
      kyc_status: 'APPROVED',
      mcp_account_id: merchantMcpAccountA,
      available_balance: '1250.00000000',
    },
    {
      branch_id: merchantBranchB,
      merchant_id: 'M-00000002',
      name: 'Nasi Lemak House',
      status: 'SUSPENDED',
      market_id: merchantMarketA,
      created_at: '2026-07-02T00:00:00.000Z',
      application_status: 'APPROVED',
      kyc_status: 'APPROVED',
      mcp_account_id: null,
      available_balance: null,
    },
  ];
}

export function merchantBranchDetailFixture(): AdminMerchantBranchDetailDto {
  return {
    branch_id: merchantBranchA,
    merchant_id: 'M-00000001',
    market_id: merchantMarketA,
    profile: {
      branch_id: merchantBranchA,
      merchant_id: 'M-00000001',
      market_id: merchantMarketA,
      display_name: 'Kopitiam Sdn Bhd',
      primary_email: 'owner@kopitiam.example',
      phone: '+60123456789',
      address: '1 Jalan Kopi, Kuala Lumpur',
      about: 'Family kopitiam.',
      business_hours: '07:00-22:00',
      website: 'https://kopitiam.example',
      whatsapp: '+60123456789',
      socials: null,
      logo_object_key: null,
      banner_object_key: null,
      gallery: [],
    },
    application: {
      application_id: 'app-1',
      status: 'APPROVED',
      operational_status: 'ACTIVE',
      submissions: [
        {
          id: 'sub-1',
          version: 1,
          submitted_at: '2026-07-10T01:00:00.000Z',
        },
      ],
      reviews: [
        {
          id: 'rev-1',
          decision: 'APPROVED',
          reason: 'Fixture approval',
          decided_at: '2026-07-11T02:00:00.000Z',
        },
      ],
    },
    kyc: {
      current: {
        submission_id: 'kyc-1',
        submission_version: 1,
        status: 'APPROVED',
        submitted_at: '2026-07-12T01:00:00.000Z',
        data: {
          business_certification: {
            legal_name: 'Kopitiam Sdn Bhd',
            registration_number: '***2345',
            tax_id: '***5678',
            country: 'MY',
          },
          pic_identity: {
            full_name: 'Ahmad Bin Ali',
            identity_number: '****1234',
            country: 'MY',
          },
          pic_contact: {
            phone: '***789',
            email: 'owner@kopitiam.example',
          },
        },
        review: {
          review_id: 'kyc-review-1',
          reviewer_id: 'admin-1',
          decision: 'APPROVED',
          reason: 'Fixture KYC approval',
          rejected_fields: [],
          reviewed_at: '2026-07-13T02:00:00.000Z',
        },
      },
      previous: null,
    },
    packages: {
      items: [
        {
          assignment_id: 'assign-1',
          service_fee_profile_id: 'sfp-1',
          service_fee_profile_code: 'A',
          service_fee_profile_name: 'Package A',
          service_fee_version_id: 'sfv-1',
          rate: '0.012500',
          effective_from: '2026-07-01T00:00:00.000Z',
          effective_to: null,
          special_percentage_id: null,
          special_percentage_rate: null,
          special_percentage_description: null,
          status: 'ACTIVE',
          is_default: true,
          version: 1,
          created_at: '2026-07-05T00:00:00.000Z',
          updated_at: '2026-07-05T00:00:00.000Z',
        },
      ],
      limit: 20,
      offset: 0,
    },
    mcp: {
      account: {
        id: merchantMcpAccountA,
        branch_id: merchantBranchA,
        market_id: merchantMarketA,
        available_balance: '1250.00000000',
        total_balance: '1250.00000000',
        status: 'ACTIVE',
        version: 1,
      },
      reconciliation: {
        account_id: merchantMcpAccountA,
        stored: {
          total: '1250.00000000',
          available: '1250.00000000',
        },
        computed: {
          total: '1250.0000000000',
          available: '1250.0000000000',
          entries: 2,
        },
        matches: true,
      },
      recent_ledger: {
        items: [
          {
            id: 'ledger-1',
            sequence: '2',
            entryType: 'TRANSACTION_DEDUCTION',
            direction: 'DEBIT',
            amount: '50.0000000000',
            balanceDelta: '-50.0000000000',
            availableDelta: '-50.0000000000',
            sourceType: 'TRANSACTION',
            sourceId: 'tx-1',
            reason: 'Fixture deduction',
            effectiveAt: '2026-07-20T03:00:00.000Z',
            createdAt: '2026-07-20T03:00:00.000Z',
          },
        ],
        limit: 10,
        offset: 0,
      },
    },
  };
}
