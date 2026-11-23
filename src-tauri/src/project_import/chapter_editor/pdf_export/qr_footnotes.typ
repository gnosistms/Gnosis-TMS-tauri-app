#let module = 0.254mm
#let caption-size = 7.5pt
#let compact-caption(words, width) = {
  if measure(words).width <= width { return words }
  let prefix = ""
  for cluster in words.clusters() {
    if measure(prefix + cluster + "…").width > width { break }
    prefix += cluster
  }
  // Prefer a whole word for descriptive captions; URLs have no word spaces.
  if prefix.contains(" ") and not words.slice(prefix.len()).starts-with(" ") {
    prefix = prefix.split(" ").slice(0, -1).join(" ")
  }
  prefix.trim() + "…"
}

#let tile(ref, max-width, whole-link: false, at-text-indent: false) = {
  let modules = ref.modules
  let pitch = calc.min(module, max-width / (modules + 8))
  let border = 4 * pitch
  let width = modules * pitch
  let side = width + 2 * border
  let caption-width = calc.min(max-width, calc.max(side, 22mm))
  let alignment = if at-text-indent { left } else { center }
  let body = block(width: caption-width, breakable: false, above: 0pt, below: 0pt)[
    #set align(alignment)
    #set par(justify: false, first-line-indent: 0pt, leading: 2.5pt, spacing: 0pt)
    #set text(dir: ref.direction, size: caption-size, spacing: 100%, hyphenate: false)
    #grid(columns: (1fr,), row-gutter: 0.55mm, align: alignment + top,
      link(ref.url, box(inset: border, fill: white,
        image(bytes(ref.svg), format: "svg", width: width, alt: "QR code: " + ref.words))),
      block(width: 100%, link(ref.url,
        if whole-link { context compact-caption(ref.words, caption-width) }
        else { ref.words },
      )),
    )
  ]
  (width: caption-width, body: body)
}

#let column-gap = 1mm
#let row-gap = 1.8mm

#let take-row(tiles, limit) = {
  let cells = ()
  let used = 0pt
  for tile in tiles {
    let next = used + (if cells.len() > 0 { column-gap } else { 0pt }) + tile.width
    if cells.len() > 0 and next > limit { break }
    used = next
    cells.push(tile)
  }
  let body = grid(columns: cells.map(t => t.width), column-gutter: column-gap,
    align: center + top, ..cells.map(t => t.body))
  (count: cells.len(), width: used, body: body)
}

#let pack-rows(tiles, limit) = {
  let rows = ()
  let index = 0
  while index < tiles.len() {
    let row = take-row(tiles.slice(index), limit)
    rows.push(row)
    index += row.count
  }
  rows
}

#let wrap-note(prose, refs, width, whole-link, has-prose) = {
  if not has-prose {
    let tiles = refs.map(ref => tile(ref, width, whole-link: whole-link, at-text-indent: true))
    return grid(columns: (width,), align: left + top, row-gutter: row-gap,
      ..pack-rows(tiles, width).map(row => row.body))
  }
  let prose-gap = 2.5mm
  let limit = if refs.len() == 1 { width } else { width / 2 }
  let tiles = refs.map(ref => tile(ref, limit))
  let narrow-rows = pack-rows(tiles, limit)
  // Reserve the widest packed narrow row, so the prose uses any spare width.
  let reserved = calc.max(..narrow-rows.map(row => row.width))
  let prose-width = width - reserved - prose-gap
  let text-body = block(width: prose-width, above: 0pt, below: 0pt, prose)
  let text-height = measure(text-body, width: prose-width).height
  let narrow = ()
  let row-top = 0pt
  let index = 0
  for row in narrow-rows {
    if row-top >= text-height { break }
    narrow.push(row.body)
    row-top += measure(row.body, width: row.width).height + row-gap
    index += row.count
  }
  // Rows below the prose can use the whole measure, including for large codes.
  let wide-tiles = refs.slice(index).map(ref => tile(ref, width))
  let wide = pack-rows(wide-tiles, width).map(row => grid.cell(
    colspan: 2, align: right + top, row.body))
  let beside = if narrow.len() == 0 { () } else {
    (text-body, grid(columns: (reserved,), row-gutter: row-gap,
      align: right + top, ..narrow))
  }
  grid(columns: (1fr, reserved), column-gutter: prose-gap, row-gutter: row-gap,
    align: top, ..beside, ..wide,
  )
}

// Set physical column order independently of the language used for the prose.
#let gnosis-qr-note(prose, refs, whole-link, has-prose) = context {
  let direction = text.dir
  let refs = refs.map(ref => ref + (direction: direction))
  set text(dir: ltr)
  layout(size => wrap-note(text(dir: direction, prose), refs, size.width, whole-link, has-prose))
}
