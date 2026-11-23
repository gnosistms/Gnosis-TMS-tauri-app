#let module = 0.254mm
#let caption-size = 7.5pt
#let horizontal-spacing = 0.55
// Scale the space outside the square, which already includes its quiet zone.
#let caption-column(side, limit) = side + horizontal-spacing * calc.max(0pt, limit - side)

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

#let tile(ref, max-width, whole-link: false, at-text-indent: false, caption-width: auto) = {
  let modules = ref.modules
  let pitch = calc.min(module, max-width / (modules + 8))
  let border = 4 * pitch
  let width = modules * pitch
  let side = width + 2 * border
  let caption-width = if caption-width == auto {
    caption-column(side, calc.min(max-width, 22mm))
  } else { caption-width }
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

#let column-gap = horizontal-spacing * 1mm
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
  let prose-gap = horizontal-spacing * 2.5mm
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

// Single-link notes retain their normal body for standalone rows. The entry
// rule can also read their original content before it is laid out in a cell.
#let packable-note(prose, refs, whole-link, has-prose) = {
  if refs.len() == 1 {
    metadata((kind: "qr-note", prose: prose, ref: refs.first(), whole: whole-link, has-prose: has-prose))
  }
  gnosis-qr-note(prose, refs, whole-link, has-prose)
}
#let note-data(note) = {
  let first = note.body.fields().at("children", default: ()).at(0, default: none)
  if first != none and first.func() == metadata and type(first.value) == dictionary and first.value.at("kind", default: none) == "qr-note" {
    first.value
  }
}

// The nominal grid determines how many notes fit on a paper size. Actual
// positions use each note's rendered width and the reduced gutter.
#let nominal-gap = 3mm
#let note-gap = horizontal-spacing * nominal-gap
#let cell-label(id) = label("gnosis-qr-entry-" + str(id))
#let slot-width(pitch, span, gap) = span * pitch - gap
#let note-number(note) = numbering(note.numbering, ..counter(footnote).at(note.location()))

#let compact-cell(note, data, width, direction, checking: false) = {
  let marker = link(note.location(), note-number(note) + [.])
  let gutter = calc.max(12pt, measure(marker).width)
  let available = width - gutter - 3pt
  let side = (data.ref.modules + 8) * module
  if checking and available < side { return none }
  let ref = data.ref + (direction: direction)
  let words-width = measure(text(size: caption-size, dir: direction, spacing: 100%, ref.words)).width
  let caption = if data.has-prose {
    calc.max(side, calc.min(words-width, caption-column(side, 22mm)))
  } else { caption-column(side, available) }
  let body-width = if data.has-prose { available } else { caption }
  let code = tile(ref, available, caption-width: caption, whole-link: data.whole, at-text-indent: not data.has-prose).body
  let body = if data.has-prose {
    let prose-gap = horizontal-spacing * 1.5mm
    let prose-width = available - caption - prose-gap
    if checking and prose-width < 12mm { return none }
    let prose = block(width: prose-width, above: 0pt, below: 0pt)[
      #set text(dir: direction)
      #set align(start)
      #set par(first-line-indent: 0pt, justify: false)
      #data.prose
    ]
    if checking and measure(prose, width: prose-width).height > measure(code, width: caption).height { return none }
    grid(columns: (prose-width, caption), column-gutter: prose-gap, align: top, prose, code)
  } else { code }
  let cell = grid(columns: (gutter, body-width), column-gutter: 3pt, align: (right + top, left + top), marker, body)
  (body: cell, width: gutter + 3pt + body-width)
}

#let entry-rule(entry, rows, entry-gap) = context {
  if rows == (:) { return entry }
  let note = entry.note
  let data = note-data(note)
  if data == none { return entry }
  let id = counter(footnote).at(note.location()).first()
  let cell = if rows != none { rows.at(str(id), default: none) }
  if cell == none and rows != none { return entry }
  let direction = text.dir
  // Each marker owns its native footnote content, including when its cell
  // shares an earlier entry's row. Only the leader reserves the row height.
  if cell != none and cell.row != id { v(-entry-gap) }
  layout(size => {
    let count = calc.max(1, calc.floor((size.width + nominal-gap) / (23mm + nominal-gap)))
    // Prose can use the freed gutter space. For a code-only note, compact-cell
    // scales the unused part of its original slot by the same factor as the gap.
    let gap = if data.has-prose { note-gap } else { nominal-gap }
    let pitch = (size.width + gap) / count
    if cell == none {
      let span = if data.has-prose { calc.min(2, count) } else {
        let gutter = calc.max(12pt, measure(note-number(note) + [.]).width) + 3pt
        calc.max(1, calc.ceil((gutter + (data.ref.modules + 8) * module + gap) / pitch))
      }
      if span < count {
        let w = slot-width(pitch, span, gap)
        let preview = compact-cell(note, data, w, direction, checking: true)
        if preview != none {
          let height = measure(text(dir: ltr, preview.body), width: preview.width).height / 1pt
          let advance = (preview.width + note-gap) / 1pt
          [#metadata((id: id, span: span, capacity: count, height: height, advance: advance))<gnosis-qr-measure>]
        }
      }
      entry
    } else {
      set text(dir: ltr)
      let height = cell.height * 1pt
      let leader = cell.row == id
      let width = slot-width(pitch, cell.span, gap)
      let content = compact-cell(note, data, width, direction)
      // A follower has no flow height. Give its placed content the full row
      // height so its QR image has the same drawing region as the leader.
      block(width: size.width, height: if leader { height } else { 0pt },
        breakable: false, above: 0pt, below: 0pt,
        place(top + left,
          dx: cell.x * 1pt,
          dy: if leader { 0pt } else { -height },
          block(width: content.width, height: height, above: 0pt, below: 0pt)[
            #metadata(id)<gnosis-qr-cell>
            #metadata(id)#cell-label(id)
            #content.body
          ],
        ),
      )
    }
  })
}

#let callout-rule(note, rows) = context {
  if rows == none or rows == (:) { return note }
  let id = counter(footnote).at(note.location()).first()
  if str(id) in rows {
    let target = query(cell-label(id)).at(0, default: none)
    if target != none { return super(link(target.location(), text(fill: text.fill, note-number(note)))) }
  }
  note
}
