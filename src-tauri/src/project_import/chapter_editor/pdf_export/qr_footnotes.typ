#import "qr-wrap.typ": flow-around, reading-copy

#let module = 25.4mm * 5 / 600
#let caption-size = 7.5pt
#let column-gap = 1.25mm
#let row-gap = 1mm
#let prose-gap = 2.5mm
#let max-group-height = 49mm

#let gnosis-qr-note(prose, refs, link-only: false, full-prose: none) = metadata((
  kind: "gnosis-qr", prose: prose, refs: refs, link-only: link-only, full-prose: full-prose,
))
#let cell-label(id) = label("gnosis-qr-entry-" + str(id))
#let id-of(note) = counter(footnote).at(note.location()).first()

#let reading(data, id, number, location, direction) = {
  let has-qr = data.func() == metadata and type(data.value) == dictionary and data.value.at("kind", default: none) == "gnosis-qr"
  let refs = if has-qr { data.value.refs } else { () }
  let refs = refs.enumerate().map(((i, ref)) => ref + (
    id: id, direction: direction,
    key: if refs.len() == 1 { number } else { number + numbering("a", i + 1) },
  ))
  let prose = if has-qr { data.value.prose } else { data }
  if refs.len() > 1 and prose.has("children") {
    prose = prose.children.map(it => {
      if it.func() == metadata and type(it.value) == dictionary and "qr-source" in it.value {
        let ref = refs.at(it.value.qr-source)
        text("\u{2060}") + super(link(ref.url, ref.key))
      } else { it }
    }).join([])
  }
  (id: id, number: number, location: location, refs: refs, prose: prose,
    full-prose: if has-qr { data.value.full-prose }, link-only: has-qr and data.value.link-only)
}

// The row ends at the last black module. The four-module quiet zone and
// half the caption's excess width can occupy the physical page margin.
// Preserve a full caption even when one word is wider than its column.
#let caption-text(words, face, direction) = {
  let style(s) = text(size: caption-size, dir: direction, spacing: 100%, hyphenate: false, s)
  let wrapped = words.split(" ").map(word => {
    if measure(style(word)).width <= face { return word }
    let pieces = ()
    let part = ""
    for cluster in word.clusters() {
      if part != "" and measure(style(part + cluster)).width > face {
        pieces.push(part)
        part = ""
      }
      part += cluster
    }
    (pieces + (part,)).join("\u{200b}")
  }).join(" ")
  style(wrapped)
}

#let tile(ref, limit, words) = {
  let pitch = calc.min(module, limit / (ref.modules + 8))
  let ink = ref.modules * pitch
  let quiet = 4 * pitch
  let side = ink + 2 * quiet
  let natural = measure(text(size: caption-size, spacing: 100%, words)).width
  let width = calc.max(side, calc.min(limit, 22mm, natural + .4pt))
  let caption = caption-text(words, width, ref.direction)
  let body = block(width: width, above: 0pt, below: 0pt, breakable: false)[
    #set align(center)
    #set par(first-line-indent: 0pt, justify: false, leading: 2.5pt, spacing: 0pt)
    #grid(columns: (width,), row-gutter: .35mm, align: center + top,
      link(ref.url, box(inset: quiet, fill: white,
        image(bytes(ref.svg), format: "svg", width: ink, alt: "QR: " + ref.words))),
      ..(if words == "" { () } else { (link(ref.url, caption),) }),
    )
  ]
  (body: body, width: width, hang: (width - ink) / 2, id: ref.id)
}

#let bank-for(tiles, limit, common) = {
  let rows = ()
  let cells = ()
  let used = 0pt
  let finish(cells, used) = {
    let width = used - cells.last().hang
    let body = block(width: width, above: 0pt, below: 0pt,
      align(left, grid(columns: cells.map(c => c.width), column-gutter: column-gap,
        align: left + top, ..cells.map(c => c.body))))
    (body: body, width: width, ids: cells.map(c => c.id))
  }
  for t in tiles {
    let next = used + (if cells.len() > 0 { column-gap } else { 0pt }) + t.width
    if cells.len() > 0 and next - t.hang > limit {
      rows.push(finish(cells, used))
      cells = ()
      used = 0pt
    }
    if cells.len() > 0 { used += column-gap }
    used += t.width
    cells.push(t)
  }
  rows.push(finish(cells, used))
  let width = calc.max(..rows.map(r => r.width))
  let heading = if common != none {
    let face = calc.max(width, calc.min(22mm, measure(text(size: caption-size, common.words)).width + .4pt))
    let caption = caption-text(common.words, face, common.direction)
    (block(width: width, above: 0pt, below: 0pt, align(center,
      block(width: face, above: 0pt, below: 0pt, align(center, caption)))),)
  } else { () }
  let body = {
    set par(first-line-indent: 0pt, justify: false)
    grid(columns: (width,), row-gutter: row-gap, align: right + top,
      ..heading, ..rows.map(r => r.body))
  }
  (width: width, body: body, rows: rows)
}

#let marker(n, marked) = {
  if marked {
    [#metadata(n.id)<gnosis-qr-cell>#metadata(n.id)#cell-label(n.id)]
  }
  let number = n.number + [.]
  if n.location == none { number } else { link(n.location, number) }
}
#let gutter(n) = calc.max(12pt, measure(n.number + [.]).width)
#let note-line(n, width, body) = grid(columns: (gutter(n), width - gutter(n) - 3pt), column-gutter: 3pt,
  align: (right + top, left + top), marker(n, true), body)

#let common-caption(refs) = if refs.len() > 1 and refs.all(r => r.detached and r.words == refs.first().words) {
  refs.first()
}

#let group-layout(notes, width, direction, spacing) = {
  let refs = notes.map(n => n.refs).flatten()
  let common = common-caption(refs)
  if refs.len() > 1 and common == none {
    notes = notes.map(n => if n.full-prose == none { n } else { n + (prose: n.full-prose) })
  }
  // The key belongs to the code's source, including a lone code beside two notes.
  let tiles = refs.map(r => tile(r, width,
    if refs.len() == 1 and r.detached { r.key + " · " + r.words } else { r.key }))
  let narrow = bank-for(tiles, width * .42, common)
  let wide = if narrow.rows.len() > 1 { bank-for(tiles, width, common) } else { narrow }
  let normal(n, width, ragged) = note-line(n, width,
    reading-copy(n.prose, width - gutter(n) - 3pt, direction, ragged or n.link-only))
  let natural = grid(columns: (width,), row-gutter: spacing, align: left + top,
    ..notes.map(n => normal(n, width, false)))
  let below = grid(columns: (width,), align: right + top, row-gutter: row-gap, natural, wide.body)
  let below-height = measure(below, width: width).height
  let below-layout() = (body: below, height: below-height, excess: below-height - measure(natural, width: width).height)
  let occupied = narrow.width + prose-gap
  if width - occupied < 18mm { return below-layout() }
  let single = notes.filter(n => n.refs.len() == 1).map(n => n.id)
  let ragged = narrow.rows.map(r => r.ids.filter(id => id in single)).filter(ids => ids.len() > 1).flatten()
  let bank-height = measure(narrow.body).height
  let y = 0pt
  let lines = ()
  for n in notes {
    let remaining = bank-height - y
    let left-aligned = n.id in ragged or n.link-only
    let line = if remaining <= 0pt { normal(n, width, left-aligned) } else {
      let short = normal(n, width - occupied, left-aligned)
      if measure(short).height <= remaining { short } else {
        // The bank can end halfway through the last note beside it.
        let prose-width = width - gutter(n) - 3pt
        note-line(n, width, flow-around(n.prose, block(height: remaining), occupied, prose-width, direction, left-aligned))
      }
    }
    lines.push(line)
    y += measure(line).height + spacing
  }
  let stack = grid(columns: (width,), row-gutter: spacing, align: left + top, ..lines)
  let height = calc.max(y - spacing, bank-height)
  if height > below-height { return below-layout() }
  (body: block(width: width, height: height, above: 0pt, below: 0pt)[
    #place(top + right, narrow.body)
    #stack
  ], height: height, excess: height - (y - spacing))
}

#let solo-layout(n, width, direction) = {
  // Plain entries use the native 12 pt marker column when printed individually.
  let gutter = if n.refs.len() == 0 { 12pt } else { gutter(n) }
  let measure-width = width - gutter - 3pt
  let line(body) = grid(columns: (gutter, measure-width), column-gutter: 3pt,
    align: (right + top, left + top), marker(n, false), body)
  let full-copy = reading-copy(n.prose, measure-width, direction, n.link-only)
  if n.refs.len() == 0 { return (body: line(full-copy), excess: 0pt) }
  let tiles = n.refs.map(r => tile(r, measure-width,
    if n.refs.len() > 1 { r.key } else if r.detached { r.words } else { "" }))
  let bank = bank-for(tiles, measure-width * .46, none)
  let used = bank.width + prose-gap
  let narrow = measure-width - used
  let bank-height = measure(bank.body).height
  let copy-height = if narrow >= 12mm { measure(reading-copy(n.prose, narrow, direction, n.link-only)).height } else { 0pt }
  if narrow < 12mm or (bank.rows.len() > 1 and bank-height > copy-height) {
    let wide = bank-for(tiles, measure-width, none)
    let body = line(grid(columns: (measure-width,), row-gutter: row-gap, align: right + top, full-copy, wide.body))
    return (body: body, excess: measure(body).height - measure(line(full-copy)).height)
  }
  (body: line(flow-around(n.prose, bank.body, used, measure-width, direction, n.link-only)),
    excess: calc.max(0pt, bank-height - calc.max(copy-height, measure(marker(n, false)).height)))
}

// If this code reaches the next note's normal starting position, try sharing
// the row. The following note can have room for its own code. Price the full
// layouts, including their captions, wrapping, and the same inter-note gap.
#let fit-options(n, own, width, direction, gap, read) = {
  if own.excess <= gap { return none }
  let capacity = calc.max(2, calc.floor(width / 13mm))
  let all-notes = query(footnote)
  let page = n.location.page()
  let notes = (n,)
  let codes = n.refs.len()
  let separate = measure(own.body, width: width).height
  let excess = own.excess
  let options = ()
  for i in range(n.id, calc.min(n.id - 1 + capacity, all-notes.len())) {
    let next = read(all-notes.at(i), i + 1)
    // Notes on different pages have no inter-note space to recover.
    if next.location.page() != page { break }
    codes += next.refs.len()
    if codes > capacity { break }
    let individual = solo-layout(next, width, direction)
    separate += gap + measure(individual.body, width: width).height
    excess += individual.excess
    notes.push(next)
    let group = group-layout(notes, width, direction, gap)
    if group.height > max-group-height { break }
    let saved = int(calc.round(calc.min(separate - group.height, excess) / 1pt * 100))
    if saved > 0 {
      options.push((first: n.id, count: notes.len(), saved: saved))
    }
    // End the row as soon as its bank clears the next note's normal start.
    if group.excess <= gap { break }
  }
  if options.len() > 0 { [#metadata(options)<gnosis-qr-measure>] }
}

// Font review excerpts have an original number but no body callout.
#let qr-excerpt(number, data) = context {
  let direction = text.dir
  let n = reading(data, number, str(number), none, direction)
  set text(dir: ltr)
  set par(first-line-indent: (amount: 1.5em, all: false), spacing: par.leading)
  layout(size => solo-layout(n, size.width, direction).body)
}

#let entry-rule(entry, rows, entry-gap) = context {
  let note = entry.note
  let id = id-of(note)
  let direction = text.dir
  let read(note, id) = reading(note.body, id, numbering(note.numbering, id), note.location(), direction)
  let n = read(note, id)
  let cell = if rows != none { rows.at(str(id), default: none) }
  if cell != none and cell.row != id { return v(-entry-gap) }
  let members = ()
  if cell != none {
    let all-notes = query(footnote)
    if id - 1 + cell.count <= all-notes.len() {
      members = all-notes.slice(id - 1, id - 1 + cell.count).enumerate().map(((i, note)) => read(note, id + i))
    }
  }
  // During repagination an intermediate query can still have missing
  // callouts. Render individually until the planned row has a QR to draw.
  let grouped = members.any(member => member.refs.len() > 0)
  if not grouped and n.refs.len() == 0 { return entry }
  set text(dir: ltr, costs: (widow: 0%))
  set par(first-line-indent: (amount: 1.5em, all: false), spacing: par.leading)
  layout(size => if not grouped {
    let own = solo-layout(n, size.width, direction)
    if rows == none { fit-options(n, own, size.width, direction, entry-gap, read) }
    own.body
  } else {
    let group = group-layout(members, size.width, direction, entry-gap)
    if group.height > max-group-height { [#metadata(id)<gnosis-qr-tall>] }
    block(width: size.width, breakable: false, above: 0pt, below: 0pt, group.body)
  })
}

#let callout-rule(note, rows) = context {
  if rows == none or rows == (:) { return note }
  let id = id-of(note)
  if str(id) in rows {
    let target = query(cell-label(id)).at(0, default: none)
    if target != none { return super(link(target.location(), text(fill: text.fill, numbering(note.numbering, id)))) }
  }
  note
}
