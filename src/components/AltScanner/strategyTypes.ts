import type { ScanCandidate, ScanInterval, ScanDirection, ScanOptions } from './breakoutScanner';

export type ScanFn = (
  symbols: string[],
  interval: ScanInterval,
  direction: ScanDirection,
  onProgress: (done: number, total: number) => void,
  onResult: (candidate: ScanCandidate) => void,
  signal?: AbortSignal,
  options?: ScanOptions,
) => Promise<void>;

export interface ScanStrategy {
  id: string;
  label: string;
  scan: ScanFn;
}
