# Account for scrolling controls above the virtual subtitle list

1. Reproduce the blank viewport band while scrolling long SRT files in Standard
   and Group fragments views, including when the pause controls wrap onto a line.
2. Measure the list origin within the scroll container and supply it as Virtual
   Core's scroll margin. Convert virtual item coordinates back to list-local
   coordinates for spacer heights, and keep row reveal bounds in scroll-content
   coordinates. Preserve the existing scroll-anchor owner and resize arbitration.
3. Add regression coverage for nonzero list offsets and browser viewport coverage
   during scrolling, resizing, and view changes. Run focused scroll/virtualization
   tests, the subtitle browser suite, and a production build.

Status: complete.

- The new browser regression reproduced a 106 px blank band at scrollTop 600
  before the fix. It passes afterward in both views at 1280 px and 1100 px
  window widths, with forward/backward scrolling and wrapped pause controls.
- Virtual Core now receives the measured list origin as scrollMargin; spacer
  heights subtract that origin and row reveal bounds use the resulting
  scroll-content coordinates directly. No second scroll-compensation mechanism
  was introduced, and controls continue scrolling with the document.
- All 38 focused virtualization/scroll unit tests and all 48 selected browser
  cases pass (25 subtitle grouping cases plus 23 affected editor regressions).
  Scoped ESLint, whitespace checks, and the production build pass. The build
  retains its existing chunk-size warning.
- Native macOS and Windows scrolling checks were not performed; the browser
  regression coverage does not substitute for native platform verification.
