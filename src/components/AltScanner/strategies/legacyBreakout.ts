import { runBreakoutScan } from '../breakoutScanner';
import type { ScanStrategy } from '../strategyTypes';

export const legacyBreakoutStrategy: ScanStrategy = {
  id: 'breakout',
  label: '기존 돌파',
  scan: runBreakoutScan,
};
