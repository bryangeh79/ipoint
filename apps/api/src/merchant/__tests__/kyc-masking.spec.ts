import { describe, expect, it } from 'vitest';
import { maskLast, maskMerchantKycSnapshot } from '../kyc-masking.js';

describe('merchant KYC masking', () => {
  it('retains only the configured suffix', () => {
    expect(maskLast('ABC123456', 4, 4)).toBe('****3456');
    expect(maskLast('+60123456789', 3)).toBe('***789');
  });

  it('masks sensitive values while preserving approved display fields', () => {
    const result = maskMerchantKycSnapshot({
      business_certification: {
        registration_number: 'REG-12345678',
        business_name_registered: 'Example Sdn Bhd',
        business_type: 'private_limited',
        tax_id: 'TAX-87654321',
        registered_address: '1 Test Street',
        proof_of_registration_document_id:
          '00000000-0000-4000-8000-000000000001',
      },
      pic_identity: {
        full_name: 'Bryan Example',
        identity_type: 'nric',
        identity_number: '900101101234',
        date_of_birth: '1990-01-01',
        nationality: 'MY',
        proof_of_identity_document_id: '00000000-0000-4000-8000-000000000002',
        proof_of_address_document_id: '00000000-0000-4000-8000-000000000003',
      },
      pic_contact: { email: 'owner@example.com', phone: '+60123456789' },
    });

    expect(result.business_certification.registration_number).toBe('***5678');
    expect(result.business_certification.tax_id).toBe('***4321');
    expect(result.pic_identity.identity_number).toBe('****1234');
    expect(result.pic_contact.phone).toBe('***789');
    expect(result.pic_contact.email).toBe('owner@example.com');
    expect(result.pic_identity.full_name).toBe('Bryan Example');
  });
});
