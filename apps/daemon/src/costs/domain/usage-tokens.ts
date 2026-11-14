/** What a message used, as the price table reads it. */
export interface UsageTokens {
  model: string;
  /** `standard` or `fast`. */
  speed: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}
