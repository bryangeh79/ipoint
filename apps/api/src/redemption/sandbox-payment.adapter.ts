import { Injectable } from '@nestjs/common';
import type { ShippingPaymentAdapter } from './shipping-payment.port.js';
import type {
  PaymentIntentRequest,
  PaymentIntentResponse,
  PaymentConfirmRequest,
  PaymentConfirmResponse,
  PaymentVoidRequest,
  PaymentVoidResponse,
} from './shipping-payment.port.js';

/**
 * Sandbox/Test Payment Adapter.
 *
 * Simulates a fiat payment provider for development and testing.
 * Production must use a real payment adapter with production credentials.
 *
 * - createIntent: Returns a provider intent with status 'REQUIRES_CONFIRMATION'
 * - confirmIntent: Simulates successful payment confirmation
 * - voidIntent: Simulates successful void/refund
 */
@Injectable()
export class SandboxPaymentAdapter implements ShippingPaymentAdapter {
  readonly providerName = 'sandbox';

  async createIntent(
    request: PaymentIntentRequest,
  ): Promise<PaymentIntentResponse> {
    // Simulate a small delay for payment processing
    await this.delay(100);

    return {
      provider: this.providerName,
      providerIntentId: `sandbox_intent_${request.idempotencyKey.slice(0, 12)}`,
      providerStatus: 'REQUIRES_CONFIRMATION',
      clientSecret: `sandbox_secret_${request.idempotencyKey.slice(0, 12)}`,
      amount: request.amount,
      currency: request.currency,
    };
  }

  async confirmIntent(
    _request: PaymentConfirmRequest,
  ): Promise<PaymentConfirmResponse> {
    void _request; // Intentional: unused in sandbox
    await this.delay(100);

    return {
      status: 'SUCCEEDED',
      providerTransactionId: `sandbox_txn_${Date.now()}`,
    };
  }

  async voidIntent(_request: PaymentVoidRequest): Promise<PaymentVoidResponse> {
    void _request; // Intentional: unused in sandbox
    await this.delay(50);

    return {
      status: 'VOIDED',
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
