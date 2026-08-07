import { RedemptionFulfilmentOpsError } from './admin-redemption-fulfilment-ops.types.js';

/** The market does not exist. */
export function redemptionMarketNotFoundError(): RedemptionFulfilmentOpsError {
  return new RedemptionFulfilmentOpsError(
    'REDEMPTION_MARKET_NOT_FOUND',
    'The market was not found.',
  );
}

/** The order does not exist. */
export function redemptionOrderNotFoundError(
  orderId: string,
): RedemptionFulfilmentOpsError {
  return new RedemptionFulfilmentOpsError(
    'REDEMPTION_ORDER_NOT_FOUND',
    `Redemption order not found: ${orderId}`,
    { orderId },
  );
}

/** The fulfilment record does not exist. */
export function redemptionFulfilmentNotFoundError(
  fulfilmentId: string,
): RedemptionFulfilmentOpsError {
  return new RedemptionFulfilmentOpsError(
    'REDEMPTION_FULFILMENT_NOT_FOUND',
    `Fulfilment not found: ${fulfilmentId}`,
    { fulfilmentId },
  );
}

/** The refund request does not exist. */
export function redemptionRefundNotFoundError(
  refundRequestId: string,
): RedemptionFulfilmentOpsError {
  return new RedemptionFulfilmentOpsError(
    'REDEMPTION_REFUND_NOT_FOUND',
    `Refund request not found: ${refundRequestId}`,
    { refundRequestId },
  );
}

/** The requested queue status is not one of the six operational queues. */
export function redemptionQueueStatusInvalidError(
  status: string,
): RedemptionFulfilmentOpsError {
  return new RedemptionFulfilmentOpsError(
    'REDEMPTION_QUEUE_STATUS_INVALID',
    `Unknown fulfilment queue status: ${status}.`,
    { status },
  );
}

/** A mandatory reason is required for this operation. */
export function redemptionReasonRequiredError(): RedemptionFulfilmentOpsError {
  return new RedemptionFulfilmentOpsError(
    'REDEMPTION_REASON_REQUIRED',
    'A reason is required for this operation.',
  );
}
