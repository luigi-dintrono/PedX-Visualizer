export function relationshipEvidence(filename: string, row: Record<string, string>, metric: string): null | {
  factor: string; category: string; value: string; effect: string; effectSize: number;
  description: string; n: number; cities: number; ciLow: number; ciHigh: number; qValue: number | null;
};
