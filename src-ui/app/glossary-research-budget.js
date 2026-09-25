// Spending control for Glossary Research.
//
// Every model request reserves its worst-case cost *before* it is sent: all
// input priced at the cache-write rate (the most expensive input rate) plus
// the full output cap at the output rate (thinking counts as output). A request
// that cannot be reserved is not sent, so the limit holds with requests in
// flight. When the answer arrives the reservation is replaced by the cost of
// the reported usage. A request whose outcome is unknown (dropped stream,
// cancellation mid-answer) keeps its whole reservation, because the provider
// may have billed it.
//
// Prices: USD per million tokens, standard tier. Sources: Anthropic model
// table (claude-api reference, 2026-06-24) and OpenAI pricing page
// (developers.openai.com/api/docs/pricing, read 2026-09-23). Cache writes are
// 1.25x input on both. Keep PRICES_CHECKED current when prices change.

export const PRICES_CHECKED = "2026-09-25";

const PRICES = {
  claude: {
    "claude-opus-5-5": { input: 4, cached: 0.2, cacheWrite: 5, output: 20 },
    "claude-opus-5": { input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },
    "claude-opus-4-8": { input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },
    "claude-fable-5-1": { input: 10, cached: 0.25, cacheWrite: 12.5, output: 50 },
    "claude-fable-5": { input: 10, cached: 1, cacheWrite: 12.5, output: 50 },
    "claude-sonnet-5": { input: 2, cached: 0.2, cacheWrite: 2.5, output: 10 },
    "claude-haiku-4-5": { input: 1, cached: 0.1, cacheWrite: 1.25, output: 5 },
  },
  openai: {
    "gpt-6-astra": { input: 10, cached: 1, cacheWrite: 12.5, output: 50 },
    "gpt-6-sol": { input: 2, cached: 0.2, cacheWrite: 2.5, output: 10 },
    "gpt-6-luna": { input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5 },
  },
};

export const RESEARCH_PROVIDERS = [
  { id: "claude", name: "Claude" },
  { id: "openai", name: "OpenAI" },
];

export function researchProviderSupported(providerId) {
  return RESEARCH_PROVIDERS.some((provider) => provider.id === providerId);
}

/** Price table for a model, or null when the limit cannot be enforced. */
export function modelPrices(providerId, modelId) {
  const table = PRICES[providerId];
  if (!table) {
    return null;
  }
  const id = String(modelId ?? "").trim();
  return table[id] ?? null;
}

export function researchModelsWithPrices(providerId) {
  return Object.keys(PRICES[providerId] ?? {});
}

/** Deliberately high token estimate that also holds for CJK text. */
export function estimateTokens(text) {
  const value = String(text ?? "");
  const bytes = new TextEncoder().encode(value).length;
  return Math.ceil(Math.max(value.length / 2.8, bytes / 3.2)) + 16;
}

export function worstCaseCost(prices, instructions, content, maxOutputTokens) {
  const tokensIn = estimateTokens(instructions) + estimateTokens(content);
  return (tokensIn * prices.cacheWrite + maxOutputTokens * prices.output) / 1_000_000;
}

export function usageCost(prices, usage) {
  const input = Number(usage?.inputTokens) || 0;
  const cached = Number(usage?.cachedTokens) || 0;
  const written = Number(usage?.cacheWriteTokens) || 0;
  const output = Number(usage?.outputTokens) || 0;
  const ordinary = Math.max(0, input - cached - written);
  return (
    ordinary * prices.input
    + cached * prices.cached
    + written * prices.cacheWrite
    + output * prices.output
  ) / 1_000_000;
}

export class BudgetExceededError extends Error {
  constructor(needed, spent, reserved, limit) {
    super(
      `The next request could cost up to $${needed.toFixed(4)}; $${spent.toFixed(4)} is spent, `
        + `$${reserved.toFixed(4)} is in flight, and the limit is $${limit.toFixed(2)}.`,
    );
    this.name = "BudgetExceededError";
    this.needed = needed;
    this.spent = spent;
    this.reserved = reserved;
    this.limit = limit;
  }
}

export function createBudget(limitUsd, records = []) {
  const budget = {
    limit: Number(limitUsd),
    spent: records.reduce((sum, record) => sum + (Number(record.costUsd) || 0), 0),
    reserved: 0,
    records: [...records],
    /** Whether `amount` fits now (false may only mean: wait for in-flight work). */
    fitsNow(amount) {
      return budget.spent + budget.reserved + amount <= budget.limit + 1e-9;
    },
    /** Whether `amount` could ever fit once in-flight work settles. */
    fitsAtAll(amount) {
      return budget.spent + amount <= budget.limit + 1e-9;
    },
    reserve(amount) {
      if (!budget.fitsNow(amount)) {
        throw new BudgetExceededError(amount, budget.spent, budget.reserved, budget.limit);
      }
      budget.reserved += amount;
    },
    settle(reserved, actual, record) {
      budget.reserved = Math.max(0, budget.reserved - reserved);
      budget.spent += actual;
      const entry = { ...record, costUsd: Math.round(actual * 1e6) / 1e6 };
      budget.records.push(entry);
      return entry;
    },
    remaining() {
      return budget.limit - budget.spent - budget.reserved;
    },
  };
  return budget;
}
