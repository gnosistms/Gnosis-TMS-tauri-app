// Split only the run that crosses the QR bank. Everything else, including
// styled text and link destinations, remains native Typst content.
#let wrappers = (link, emph, strong, underline)
#let plain(body) = {
  let f = body.func()
  if body.has("children") { body.children.map(plain).join("") }
  else if f == text { body.text }
  else if f == parbreak { "\u{2029}" }
  else if f == linebreak { "\n" }
  else if f == [ ].func() { " " }
  else if f in wrappers { plain(body.body) }
  else { "\u{fffc}" }
}

#let cut(body, pos) = {
  if pos == 0 { return ([], body) }
  if pos == plain(body).len() { return (body, []) }
  if body.has("children") {
    let offset = 0
    for (i, child) in body.children.enumerate() {
      let end = offset + plain(child).len()
      if pos <= end {
        let (a, b) = cut(child, pos - offset)
        return (body.children.slice(0, i).join([]) + a,
          b + body.children.slice(i + 1).join([]))
      }
      offset = end
    }
  }
  if body.func() == text {
    return (text(body.text.slice(0, pos)), text(body.text.slice(pos)))
  }
  let (a, b) = cut(body.body, pos)
  let wrap = if body.func() == link { link.with(body.dest) } else { body.func() }
  (wrap(a), wrap(b))
}

// Keep single returns, real paragraph boundaries and URL punctuation distinct.
// Ideographs and other scripts without spaces also have usable breakpoints.
#let opportunities = regex("[ \\t]+|[\\n\\x{2029}]|[-/]|[\\p{Han}\\p{Hiragana}\\p{Katakana}\\p{Hangul}\\p{Thai}\\p{Lao}\\p{Khmer}][\\p{M}]*[、。，．！？）」』】]*")

// Use a paragraph-owning block: inline style scopes alone cannot change
// the justification of a paragraph laid out by the surrounding grid cell.
#let reading-copy(body, width, direction, ragged) = block(width: width, above: 0pt, below: 0pt, {
  set text(dir: direction)
  set align(if direction == rtl { right } else { left })
  set par(justify: false, first-line-indent: 0pt) if ragged
  body
})

#let flow-around(prose, bank, occupied, width, direction, ragged) = {
  let narrow = width - occupied
  let bank-height = measure(bank, width: width).height
  let beside(body) = grid(columns: (narrow, occupied), align: (left + top, right + top),
    reading-copy(body, narrow, direction, ragged), bank)
  let line = measure([M]).height
  let step = measure([M\ M]).height - line
  let lines = calc.max(1, calc.ceil((bank-height + 0.5mm) / step))
  let target = line + (lines - 1) * step + 0.01pt
  if measure(reading-copy(prose, narrow, direction, ragged)).height <= target { return beside(prose) }

  let value = plain(prose)
  let choices = value.matches(opportunities).filter(m => m.start > 0 and m.end < value.len())
  if choices.len() == 0 { return beside(prose) }
  let boundary(m) = if m.text.trim() == "" { m.start } else { m.end }
  let lo = 0
  let hi = choices.len()
  while lo < hi {
    let mid = calc.floor((lo + hi) / 2)
    let prefix = cut(prose, boundary(choices.at(mid))).first()
    if measure(reading-copy(prefix, narrow, direction, ragged)).height <= target { lo = mid + 1 } else { hi = mid }
  }
  let at = choices.at(calc.max(0, lo - 1))
  let split = boundary(at)
  let prefix = cut(prose, split).first()
  let tail = cut(prose, at.end).last()
  let hard = at.text in ("\n", "\u{2029}")
  if not hard and not ragged and par.justify { prefix += linebreak(justify: true) }
  beside(prefix)
  v(par.leading, weak: true)
  reading-copy({
    if not ragged and at.text == "\u{2029}" {
      let indent = par.first-line-indent
      h(if type(indent) == dictionary { indent.amount } else { indent })
    }
    tail
  }, width, direction, ragged)
}
