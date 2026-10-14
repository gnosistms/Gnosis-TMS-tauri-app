// Dollar amount field with ±10% steps (arrow buttons and the ↑/↓ keys).
// Markup: renderMoneyInput() in screens/money-input.js. Any field-specific
// data-* attributes on the <input> keep working: every step is announced as
// a normal "input" event, so the usual input handlers update state.

export const MINIMUM_MONEY_VALUE = 0.01;

function roundToCents(value) {
  return Math.round(value * 100) / 100;
}

/**
 * One step up or down. Normally ×1.1 / ×0.9, rounded to the cent; when 10% of
 * the amount is less than one cent, the step is exactly one cent. A step
 * always changes the amount by at least a cent and never goes below $0.01.
 */
export function stepMoneyValue(value, direction) {
  const current = roundToCents(Math.max(0, Number(value) || 0));
  const sign = direction === "down" ? -1 : 1;
  let next;
  if (current * 0.1 < 0.01) {
    next = current + sign * 0.01;
  } else {
    next = roundToCents(current * (sign > 0 ? 1.1 : 0.9));
    if (next === current) next = current + sign * 0.01;
  }
  return Math.max(MINIMUM_MONEY_VALUE, roundToCents(next));
}

/** A typed amount in dollars, never below $0.01; null when not a number. */
export function parseMoneyValue(text) {
  const cleaned = String(text ?? "").replace(/[^0-9.,-]/g, "").replace(",", ".");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.max(MINIMUM_MONEY_VALUE, roundToCents(value)) : null;
}

function applyStep(input, direction) {
  const next = stepMoneyValue(parseMoneyValue(input.value) ?? 0, direction);
  input.value = next.toFixed(2);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

let registered = false;

export function registerMoneyInputEvents(root = globalThis.document) {
  if (registered || !root?.addEventListener) return;
  registered = true;
  root.addEventListener("keydown", (event) => {
    const input = event.target instanceof Element ? event.target.closest("[data-money-input]") : null;
    if (!input || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    applyStep(input, event.key === "ArrowUp" ? "up" : "down");
  });
  root.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-money-step]") : null;
    if (!button) return;
    const input = button.closest(".money-input")?.querySelector("[data-money-input]");
    if (!input || input.disabled) return;
    event.preventDefault();
    applyStep(input, button.dataset.moneyStep);
    input.focus();
  });
  // Show two decimals once the user leaves the field.
  root.addEventListener("focusout", (event) => {
    const input = event.target instanceof Element ? event.target.closest("[data-money-input]") : null;
    if (!input) return;
    const value = parseMoneyValue(input.value);
    if (value !== null && input.value !== value.toFixed(2)) {
      input.value = value.toFixed(2);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
