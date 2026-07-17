import type { SubmitMerchantKycDto } from './dto/kyc.dto.js';

export function maskMerchantKycSnapshot(
  snapshot: SubmitMerchantKycDto,
): SubmitMerchantKycDto {
  return {
    ...snapshot,
    business_certification: {
      ...snapshot.business_certification,
      registration_number: maskLast(
        snapshot.business_certification.registration_number,
        4,
      ),
      tax_id: maskLast(snapshot.business_certification.tax_id, 4),
    },
    pic_identity: {
      ...snapshot.pic_identity,
      identity_number: maskLast(snapshot.pic_identity.identity_number, 4, 4),
    },
    pic_contact: {
      ...snapshot.pic_contact,
      phone: maskLast(snapshot.pic_contact.phone, 3),
    },
  };
}

export function maskLast(
  value: string,
  visibleCharacters: number,
  asterisks = 3,
): string {
  const visible = value.slice(-visibleCharacters);
  return `${'*'.repeat(asterisks)}${visible}`;
}
