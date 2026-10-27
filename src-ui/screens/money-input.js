import { escapeHtml } from "../lib/ui.js";

/**
 * A "$" amount field with ±10% step buttons (see app/money-input.js).
 * `inputAttributes` carries the field's own data-* attributes.
 */
export function renderMoneyInput({ value, inputAttributes = "", ariaLabel = "Amount in US dollars", disabled = false }) {
  const amount = (Number(value) || 0).toFixed(2);
  return `
    <div class="money-input${disabled ? " is-disabled" : ""}">
      <span class="money-input__prefix" aria-hidden="true">$</span>
      <input class="field__input money-input__field" type="text" inputmode="decimal" autocomplete="off"
        value="${escapeHtml(amount)}" aria-label="${escapeHtml(ariaLabel)}" data-money-input ${inputAttributes} ${disabled ? "disabled" : ""} />
      <span class="money-input__steps">
        <button type="button" class="money-input__step" data-money-step="up" aria-label="Increase by 10%" tabindex="-1" ${disabled ? "disabled" : ""}>
          <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 5 5 1l4 4" /></svg>
        </button>
        <button type="button" class="money-input__step" data-money-step="down" aria-label="Decrease by 10%" tabindex="-1" ${disabled ? "disabled" : ""}>
          <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
        </button>
      </span>
    </div>`;
}
