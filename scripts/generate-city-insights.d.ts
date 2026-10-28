export function generateCityInsights(city: Record<string, unknown>): Array<{
  id: string; category: string; text: string; relevance_score: number; data_confidence: string;
  metrics: Record<string, unknown>;
}>;
