// Minimal grid-layout engine: collision detection + vertical compaction + collision-aware moves.
// Operates on plain arrays of items `{ i, x, y, w, h }` measured in grid units (columns/rows).
// Adapted from the well-known react-grid-layout compaction algorithm (MIT). Self-contained — the
// component owns the layout array and drives gestures; this module just answers "where does
// everything land?". Vertical compaction only (items always float upward), matching the previous
// `vertical-compact` behavior.

function cloneItem(it) {
  return { i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, moved: false }
}

export function cloneLayout(layout) {
  return layout.map(cloneItem)
}

// Do two items overlap? Items never collide with themselves (matched by id).
export function collides(a, b) {
  if (a.i === b.i) return false
  if (a.x + a.w <= b.x) return false
  if (a.x >= b.x + b.w) return false
  if (a.y + a.h <= b.y) return false
  if (a.y >= b.y + b.h) return false
  return true
}

function getFirstCollision(layout, item) {
  for (const l of layout) if (collides(l, item)) return l
  return null
}

function getAllCollisions(layout, item) {
  return layout.filter((l) => collides(l, item))
}

// Lowest occupied row (used to size the grid host).
export function bottom(layout) {
  let max = 0
  for (const l of layout) {
    const b = l.y + l.h
    if (b > max) max = b
  }
  return max
}

// Reading order: top-to-bottom, then left-to-right.
function sortByRowCol(layout) {
  return layout.slice().sort((a, b) => {
    if (a.y > b.y || (a.y === b.y && a.x > b.x)) return 1
    if (a.y === b.y && a.x === b.x) return 0
    return -1
  })
}

function clampX(l, cols) {
  if (l.x + l.w > cols) l.x = Math.max(0, cols - l.w)
  if (l.x < 0) l.x = 0
  return l
}

function compactItem(placed, l, cols) {
  // Float up as far as it can go without hitting an already-placed item...
  while (l.y > 0 && !getFirstCollision(placed, l)) l.y--
  // ...then drop back down past anything it now overlaps.
  let collision
  while ((collision = getFirstCollision(placed, l))) l.y = collision.y + collision.h
  // Keep it inside the columns.
  return clampX(l, cols)
}

// Compact the whole layout upward, resolving overlaps deterministically. When `pinnedId` is given,
// that item is placed first and never floated — every other item compacts around it. This keeps a
// just-resized subplot exactly where the user pulled its edges while neighbours reflow.
export function compact(layout, cols, pinnedId = null) {
  const placed = []
  const out = []
  if (pinnedId != null) {
    const found = layout.find((l) => l.i === pinnedId)
    if (found) {
      const pinned = clampX(cloneItem(found), cols)
      pinned.moved = false
      placed.push(pinned)
      out.push(pinned)
    }
  }
  for (const item of sortByRowCol(layout)) {
    if (item.i === pinnedId) continue
    const l = compactItem(placed, cloneItem(item), cols)
    l.moved = false
    placed.push(l)
    out.push(l)
  }
  return out
}

function moveAwayFromCollision(layout, collidesWith, toMove, isUserAction, cols) {
  // First try lifting the bumped item *above* the mover — gives natural swaps when there's room.
  if (isUserAction) {
    const fake = {
      i: '__fake__',
      x: toMove.x,
      y: Math.max(collidesWith.y - toMove.h, 0),
      w: toMove.w,
      h: toMove.h,
    }
    if (!getFirstCollision(layout, fake)) {
      return moveElement(layout, toMove, undefined, fake.y, false, cols)
    }
  }
  // Otherwise nudge it straight down.
  return moveElement(layout, toMove, undefined, toMove.y + 1, false, cols)
}

// Move item `l` to (x,y) authoritatively, pushing colliding items out of the way. Mutates and
// returns `layout`. `isUserAction` enables the lift-to-swap heuristic on the first bump only.
export function moveElement(layout, l, x, y, isUserAction, cols) {
  const movingUp = typeof y === 'number' && l.y > y
  if (typeof x === 'number') l.x = x
  if (typeof y === 'number') l.y = y
  l.moved = true

  // Resolve nearest collisions first; reversed when moving up so we don't thrash.
  let sorted = sortByRowCol(layout)
  if (movingUp) sorted = sorted.reverse()
  const collisions = getAllCollisions(sorted, l).filter((c) => c.i !== l.i)

  for (const collision of collisions) {
    if (collision.moved) continue
    layout = moveAwayFromCollision(layout, l, collision, isUserAction, cols)
  }
  return layout
}
