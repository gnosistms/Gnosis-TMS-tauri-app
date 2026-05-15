# Alphabet Index Scroll

A small vanilla JavaScript library for iOS-style alphabetical jump navigation in
any HTML scroll container.

It is intentionally separate from Gnosis TMS app code. The demos prove two
integration modes:

- `modal-demo.html`: explicit section anchors in a modal language picker.
- `app-demo.html`: automatic item discovery from `[data-index-label]` in a main
  app list.

## Usage

The reusable source is available as both an ES module and a browser global. Use
the module form in app builds:

```js
import { createAlphabetIndexScroll } from "./alphabet-index-scroll.js";

const index = createAlphabetIndexScroll({
  scrollContainer: document.querySelector(".scroll-view"),
  indexHost: document.querySelector(".scroll-frame"),
  itemSelector: "[data-index-label]",
  maxItems: 18,
});
```

Use the global form for plain HTML files opened directly from disk:

```html
<script src="./alphabet-index-scroll.global.js"></script>
<script>
  const { createAlphabetIndexScroll } = window.AlphabetIndexScroll;
</script>
```

For grouped lists, pass explicit sections:

```js
createAlphabetIndexScroll({
  scrollContainer,
  indexHost,
  sections: [
    { key: "A", label: "A", target: headingA },
    { key: "B", label: "B", target: headingB },
  ],
  includeMissing: true,
});
```

## API

`createAlphabetIndexScroll(options)` returns:

- `update()`: rebuilds the index after the list changes.
- `destroy()`: removes generated DOM.
- `scrollToKey(key)`: programmatically jumps to a section.
- `sections`: current resolved section list.

Important options:

- `scrollContainer`: required scrollable element.
- `indexHost`: positioned parent for the index. Defaults to the scroll
  container parent.
- `itemSelector`: selector used for automatic discovery.
- `sections`: explicit `{ key, label, target }` section list.
- `alphabet`: custom ordered key list.
- `includeMissing`: shows disabled letters for missing sections.
- `maxItems`: samples enabled sections when the index should be shorter than the
  full alphabet.
- `behavior`: scroll behavior, defaults to `smooth`.
- `offset`: pixels to offset from the top of the scroll container.
- `onSelect(section)`: callback after a jump.

The CSS uses custom properties so consuming screens can tune size and color
without changing the component:

```css
.my-scroll-frame {
  --ais-index-right: 6px;
  --ais-index-button-size: 15px;
  --ais-index-color: #c17615;
}
```
