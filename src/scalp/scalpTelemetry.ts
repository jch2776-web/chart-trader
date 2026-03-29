/**
 * Scalp telemetry — structured event log for signal/order lifecycle replay.
 *
 * Events are stored in a capped ring buffer (MAX_EVENTS).
 * The module is stateless per instance: create one per scalp session.
 */

import type { ScalpTelemetryEvent } from './types';

const MAX_EVENTS = 500;

export interface ScalpTelemetry {
  /** Append a new event. */
  emit(event: ScalpTelemetryEvent): void;
  /** Return all events (newest-first). */
  getAll(): ScalpTelemetryEvent[];
  /** Return the N most recent events. */
  getRecent(n: number): ScalpTelemetryEvent[];
  /** Clear the event buffer. */
  clear(): void;
  /** Return count of events by type. */
  summary(): Record<string, number>;
}

export function createScalpTelemetry(): ScalpTelemetry {
  const _events: ScalpTelemetryEvent[] = [];

  function emit(event: ScalpTelemetryEvent): void {
    _events.push(event);
    if (_events.length > MAX_EVENTS) _events.splice(0, _events.length - MAX_EVENTS);
  }

  function getAll(): ScalpTelemetryEvent[] {
    return [..._events].reverse();
  }

  function getRecent(n: number): ScalpTelemetryEvent[] {
    return _events.slice(-n).reverse();
  }

  function clear(): void {
    _events.length = 0;
  }

  function summary(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const ev of _events) {
      counts[ev.type] = (counts[ev.type] ?? 0) + 1;
    }
    return counts;
  }

  return { emit, getAll, getRecent, clear, summary };
}
