/**
 * Shipping Payment Provider Adapter Interface.
 *
 * This interface defines the contract for integrating with fiat payment
 * providers to handle shipping fee payments for physical goods redemption.
 *
 * The provider adapter is injected into the RedemptionService via dependency
 * injection. A sandbox/test adapter is provided for development.
 *
 * Production credentials are a Deployment Blocker and must be configured
 * through environment variables.
 */
export interface PaymentIntentRequest {
  memberId: string;
  marketId: string;
  quoteId: string;
  currency: string;
  amount: string;
  idempotencyKey: string;
  requestHash: string;
  description?: string;
}

export interface PaymentIntentResponse {
  provider: string;
  providerIntentId: string;
  providerStatus: string;
  clientSecret: string | null;
  amount: string;
  currency: string;
}

export interface PaymentConfirmRequest {
  providerIntentId: string;
  paymentId: string;
}

export interface PaymentConfirmResponse {
  status: string;
  providerTransactionId?: string;
}

export interface PaymentVoidRequest {
  providerIntentId: string;
  paymentId: string;
  reason?: string;
}

export interface PaymentVoidResponse {
  status: string;
}

export const SHIPPING_PAYMENT_ADAPTER = 'SHIPPING_PAYMENT_ADAPTER';

export interface ShippingPaymentAdapter {
  readonly providerName: string;

  /**
   * Create a payment intent for a shipping fee.
   * Returns provider-specific intent details including a client secret
   * that the frontend uses to complete payment.
   */
  createIntent(request: PaymentIntentRequest): Promise<PaymentIntentResponse>;

  /**
   * Confirm a payment intent after the frontend completes the payment.
   * The provider verifies the payment and returns the final status.
   */
  confirmIntent(
    request: PaymentConfirmRequest,
  ): Promise<PaymentConfirmResponse>;

  /**
   * Void/cancel a payment intent when an order fails or is cancelled.
   * This releases any pending authorization on the customer's card.
   * Auto-called on confirm failure.
   */
  voidIntent(request: PaymentVoidRequest): Promise<PaymentVoidResponse>;
}
