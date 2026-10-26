/** Pure, versioned baseline strategies. Replace these without touching orders. */
export interface RecommendationStrategy {
  score(input: {
    pastQuantity: number;
    preferenceMatches: number;
    preferredSlot: boolean;
  }): number;
}
export const recommendationStrategy: RecommendationStrategy = {
  score: ({ pastQuantity, preferenceMatches, preferredSlot }) =>
    Math.min(pastQuantity, 10) * 3 +
    preferenceMatches * 8 +
    (preferredSlot ? 5 : 0),
};
export interface DemandStrategy {
  predict(
    samples: number[],
  ): { expected: number; low: number; high: number } | null;
}
export const demandStrategy: DemandStrategy = {
  predict(samples) {
    if (samples.length < 4) return null;
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const deviation = Math.sqrt(
      samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length,
    );
    return {
      expected: Math.round(mean),
      low: Math.max(0, Math.floor(mean - 2 * deviation)),
      high: Math.ceil(mean + 2 * deviation),
    };
  },
};
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function dietaryTypes(preference: string): string[] {
  return (
    (
      {
        VEGETARIAN: ["VEG", "VEGAN", "JAIN"],
        VEGAN: ["VEGAN"],
        EGGETARIAN: ["VEG", "VEGAN", "JAIN", "EGG"],
        JAIN: ["JAIN"],
      } as Record<string, string[]>
    )[preference] ?? ["VEG", "NON_VEG", "EGG", "VEGAN", "JAIN"]
  );
}
