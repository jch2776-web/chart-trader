export type TradeDirection = 'long' | 'short' | 'both';
export type ExecutionMode = 'auto' | 'alert';
export type Leverage = number;  // 1–125

export interface TradeSettings {
  leverage: Leverage;
  marginPct: number;          // 1–50 (% of balance)
  direction: TradeDirection;
  executionMode: ExecutionMode;
  active: boolean;
  muteWhenViewing?: boolean;   // suppress Telegram while this ticker is on screen
  telegramCooldownMs?: number; // 0 = always send; if candle.time is older than this, skip
}

export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface ActivityLog {
  id: string;
  timestamp: number;
  type: 'info' | 'signal' | 'order' | 'error';
  message: string;
}
