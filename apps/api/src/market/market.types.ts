export class MarketError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MarketError';
    this.code = code;
  }
}

export interface MarketInfo {
  id: string;
  code: string;
  name: string;
  isCurrent: boolean;
  isEnabled: boolean;
  sortOrder: number;
}

export interface MemberMarketResponse {
  currentMarket: MarketInfo;
  enabledMarkets: MarketInfo[];
}
