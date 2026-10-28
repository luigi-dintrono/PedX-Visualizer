export interface MetricDefinition {
  name: string; property: string; flag?: string; sample?: string; minN: number;
  unit: string; validityKey?: string; referenceOnly?: boolean;
}
export const METRICS: Record<string, MetricDefinition>;
export function finite(value: unknown): number | null;
export function displayValue(value: unknown, unit: string, decimals?: number): string;
export function knownRate(values: unknown[]): { value: number | null; n: number };
export function comparableValue(row: Record<string, unknown> | null, metric: string): number | null;
