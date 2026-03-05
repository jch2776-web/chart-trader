/** How price must interact with the drawing to fire the conditional order. */
export type TriggerCondition =
  | 'break_up'    // 상향 돌파: price crosses upward through the level (all drawing types)
  | 'break_down'  // 하향 돌파: price crosses downward through the level (all drawing types)
  | 'enter_up'    // 박스 하향 진입: price enters box from below (box only)
  | 'enter_down'; // 박스 상향 진입: price enters box from above (box only)

export const TRIGGER_LABELS: Record<TriggerCondition, string> = {
  break_up:   '상향 돌파 ▲',
  break_down: '하향 돌파 ▼',
  enter_up:   '하단→박스 진입 ▲',
  enter_down: '상단→박스 진입 ▼',
};

export interface ConditionalOrderPair {
  id: string;
  ticker: string;
  drawingId: string;
  drawingLabel: string;
  triggerCondition: TriggerCondition;
  entrySide: 'BUY' | 'SELL';
  entryPrice: number;
  entryMarginPct: number;    // 1–100, % of available balance
  entryLeverage: number;     // 1–125
  entryMarginType: 'CROSSED' | 'ISOLATED';
  exitEnabled: boolean;
  exitPrice: number;
  exitQtyPct: number;        // 1–100, % of entry qty (default 100)
  status: 'active' | 'triggered' | 'failed' | 'cancelled';
  createdAt: number;
  triggeredAt?: number;
  errorMsg?: string;
}
