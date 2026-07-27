/**
 * Everything tier 2 runs inside the page, as one script with several modes.
 *
 * It is a string rather than a module because `agent-browser eval` ships source
 * over stdin; keeping it in one place means one round trip per mode instead of
 * one per assertion, which is most of why tier 2 is cheap.
 *
 * The scene is reached through `_roots`, the map React Three Fiber keeps of
 * canvas to store. That hands us the same camera, raycaster and interaction
 * list the event system itself uses, so a hit test here is the hit test the
 * player gets -- including the instance bounding sphere that once made every
 * corner of the board dead.
 */

export type PageMode = 'boot' | 'targets' | 'environment' | 'stage' | 'confirm' | 'layout' | 'placement' | 'trade' | 'closeDialog'

export type PageConfig = {
  mode: PageMode
  /** `stage`: which board affordance to click. */
  kind?: 'vertex' | 'edge' | 'city'
  /** `placement`: the HUD placement-mode button to press first. */
  button?: string
  /** `layout`: minimum interactive target edge, in CSS pixels. */
  minTarget?: number
}

const SOURCE = String.raw`
const cfg = __QA_CONFIG__

const round = (value, places = 1) => Math.round(value * 10 ** places) / 10 ** places
const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const settle = async (ms = 90) => { await frame(); await new Promise((resolve) => setTimeout(resolve, ms)) }

/** The live scene, through the map fiber keeps of canvas to store. */
const scene = async () => {
  const names = performance.getEntriesByType('resource').map((entry) => entry.name)
  const threeUrl = names.find((name) => /\/deps\/three\.js/.test(name))
  const fiberUrl = names.find((name) => /@react-three_fiber\.js/.test(name))
  if (!threeUrl || !fiberUrl) throw new Error('three or fiber never loaded')
  const three = await import(threeUrl)
  const fiber = await import(fiberUrl)
  // The fiber root map is the one access that also carries internal.interaction,
  // which is the exact list the event system raycasts against. __katanScene is
  // the app's own dev hook and is used when the map is not reachable.
  const root = fiber._roots && [...fiber._roots.values()][0]
  if (root) return { three, state: root.store.getState() }
  const exposed = globalThis.__katanScene
  if (!exposed) throw new Error('no fiber root and no __katanScene; the canvas never mounted')
  const interaction = []
  exposed.scene.traverse((object) => { if (object.__r3f && object.__r3f.eventCount) interaction.push(object) })
  return { three, state: { ...exposed, internal: { interaction } } }
}

const descends = (node, ancestor) => {
  for (let current = node; current; current = current.parent) if (current === ancestor) return true
  return false
}

/**
 * Every target the event system would consider, flattened to one entry per
 * clickable thing: one per instance for an InstancedMesh, one per object
 * otherwise.
 */
const candidates = (three, state) => {
  const matrix = new three.Matrix4()
  const list = []
  for (const object of state.internal.interaction) {
    if (object.isInstancedMesh) {
      const radius = object.geometry.boundingSphere ? object.geometry.boundingSphere.radius : 0.2
      for (let index = 0; index < object.count; index += 1) {
        object.getMatrixAt(index, matrix)
        const scale = new three.Vector3().setFromMatrixScale(matrix)
        list.push({
          object,
          instanceId: index,
          point: new three.Vector3().setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld),
          radius: radius * Math.max(scale.x, scale.y, scale.z),
          shape: 'instance',
        })
      }
      continue
    }
    const box = new three.Box3().setFromObject(object)
    if (box.isEmpty()) continue
    list.push({
      object,
      instanceId: null,
      point: object.getWorldPosition(new three.Vector3()),
      radius: box.getSize(new three.Vector3()).length() / 4,
      shape: object.type,
    })
  }
  return list
}

const project = (three, state, point) => {
  const ndc = point.clone().project(state.camera)
  const rect = state.gl.domElement.getBoundingClientRect()
  return { ndc, x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width, y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height }
}

/** Pixel diameter of a target's hit volume, measured across the camera's right axis. */
const pixelSize = (three, state, candidate) => {
  const right = new three.Vector3().setFromMatrixColumn(state.camera.matrixWorld, 0).multiplyScalar(candidate.radius)
  const a = project(three, state, candidate.point.clone().sub(right))
  const b = project(three, state, candidate.point.clone().add(right))
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Does a ray through this target's centre actually reach it? */
const hits = (three, state, candidate, screen) => {
  state.raycaster.setFromCamera(new three.Vector2(screen.ndc.x, screen.ndc.y), state.camera)
  const found = state.raycaster.intersectObjects(state.internal.interaction, true)
  const top = found[0]
  if (!top) return false
  if (!descends(top.object, candidate.object)) return false
  return candidate.instanceId === null || top.instanceId === candidate.instanceId
}

const pointer = (canvas, type, x, y, extra) => canvas.dispatchEvent(new PointerEvent(type, {
  clientX: x, clientY: y, bubbles: true, cancelable: true,
  pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, ...extra,
}))

/** A real click, in the order a mouse produces one. */
const clickAt = async (canvas, x, y) => {
  pointer(canvas, 'pointermove', x, y)
  await frame()
  pointer(canvas, 'pointerdown', x, y, { buttons: 1 })
  pointer(canvas, 'pointerup', x, y)
  canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }))
  await settle()
}

const previewTitle = () => {
  const node = document.querySelector('.action-preview strong')
  return node ? node.textContent.trim() : ''
}

const PREVIEW = { vertex: /settlement\?/i, edge: /road\?/i, city: /city\?/i, robber: /robber/i }

const cancelPreview = async () => {
  const cancel = document.querySelector('.action-preview button:not(.confirm)')
  if (cancel) { cancel.click(); await settle(60) }
}

const legalTargets = () => [...document.querySelectorAll('.board-targets button')].map((node) => node.textContent)

/* ------------------------------------------------------------------ modes */

const boot = async () => {
  const canvas = document.querySelector('canvas')
  const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'))
  const load = globalThis.__katanLoad
  const resources = performance.getEntriesByType('resource')
  const inWindow = load ? resources.filter((entry) => entry.startTime >= load.startedAt - 50 && entry.startTime <= load.finishedAt) : []
  const lateHeavy = load
    ? resources.filter((entry) => entry.startTime > load.finishedAt && entry.transferSize > 50_000 && !/\/api\//.test(entry.name))
    : []
  const failed = resources.filter((entry) => entry.responseStatus && entry.responseStatus >= 400)
  return {
    canvasWidth: canvas ? canvas.width : 0,
    webgl: gl ? (gl instanceof WebGL2RenderingContext ? 2 : 1) : 0,
    loadingVisible: Boolean(document.querySelector('[aria-busy="true"]')),
    preload: load || null,
    preloadFetched: inWindow.length,
    lateHeavy: lateHeavy.map((entry) => entry.name.replace(location.origin, '')).slice(0, 4),
    lateHeavyCount: lateHeavy.length,
    failedResources: failed.map((entry) => entry.responseStatus + ' ' + entry.name.replace(location.origin, '')).slice(0, 4),
    failedCount: failed.length,
    domTargets: legalTargets().length,
  }
}

const onScreenAt = (screen, margin = 0) =>
  screen.ndc.z <= 1 && screen.x >= margin && screen.y >= margin && screen.x <= innerWidth - margin && screen.y <= innerHeight - margin

/**
 * How wide the target actually is to a ray, in screen pixels, found by walking
 * outwards from its centre until the ray stops reaching it. This is the number
 * that has to agree with what the marker draws: a ring that is painted 60
 * pixels across and answers to 12 is a quieter version of the dead click.
 */
const hitExtent = (three, state, candidate, screen, limit) => {
  const rect = state.gl.domElement.getBoundingClientRect()
  const ndcAt = (x, y) => new three.Vector3(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1), 0)
  const reach = (dx) => {
    let distance = 0
    for (let offset = 2; offset <= limit; offset += 2) {
      const x = screen.x + dx * offset
      if (!hits(three, state, candidate, { ndc: ndcAt(x, screen.y), x, y: screen.y })) break
      distance = offset
    }
    return distance
  }
  return reach(1) + reach(-1)
}

/** The widest thing drawn for this instance, across every mesh in its group. */
const drawnRadius = (three, state, candidate) => {
  const group = candidate.object.parent
  if (!group) return candidate.radius
  const matrix = new three.Matrix4()
  let widest = 0
  for (const sibling of group.children) {
    if (!sibling.isInstancedMesh || sibling.count <= candidate.instanceId) continue
    if (!sibling.geometry.boundingBox) sibling.geometry.computeBoundingBox()
    sibling.getMatrixAt(candidate.instanceId, matrix)
    const scale = new three.Vector3().setFromMatrixScale(matrix)
    const box = sibling.geometry.boundingBox
    // Horizontal half-extent only. A mast is tall and thin; its bounding sphere
    // would claim a width it does not draw.
    widest = Math.max(widest, Math.max((box.max.x - box.min.x) * scale.x, (box.max.z - box.min.z) * scale.z) / 2)
  }
  return widest || candidate.radius
}

const targets = async () => {
  const { three, state } = await scene()
  const all = candidates(three, state)
  const instanced = all.filter((candidate) => candidate.shape === 'instance')
  const pool = instanced.length ? instanced : all
  let reachable = 0
  let smallest = Infinity
  let onScreen = 0
  let worstRatio = Infinity
  let worstDrawn = 0
  let worstHit = 0
  for (const candidate of pool) {
    const screen = project(three, state, candidate.point)
    if (!onScreenAt(screen)) continue
    onScreen += 1
    const reached = hits(three, state, candidate, screen)
    if (reached) reachable += 1
    const drawnPx = pixelSize(three, state, { ...candidate, radius: drawnRadius(three, state, candidate) })
    smallest = Math.min(smallest, drawnPx)
    if (!reached) { worstRatio = 0; worstDrawn = round(drawnPx); worstHit = 0; continue }
    const measured = hitExtent(three, state, candidate, screen, Math.ceil(drawnPx))
    const ratio = drawnPx > 0 ? measured / drawnPx : 1
    if (ratio < worstRatio) { worstRatio = ratio; worstDrawn = round(drawnPx); worstHit = round(measured) }
  }
  return {
    total: pool.length,
    onScreen,
    reachable,
    smallestPx: round(smallest === Infinity ? 0 : smallest),
    extentRatio: round(worstRatio === Infinity ? 1 : worstRatio, 2),
    worstDrawnPx: worstDrawn,
    worstHitPx: worstHit,
    instanced: instanced.length,
  }
}

/**
 * What the page believes about its own input. A phone-width window that still
 * reports a fine pointer and hover is a desktop pretending, and every mobile
 * assertion built on it is fiction.
 */
const environment = async () => ({
  width: innerWidth,
  height: innerHeight,
  dpr: devicePixelRatio,
  maxTouchPoints: navigator.maxTouchPoints,
  touchEvents: 'ontouchstart' in window,
  coarse: matchMedia('(pointer: coarse)').matches,
  hover: matchMedia('(hover: hover)').matches,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
})

/** Click a legal board affordance of the requested kind with a real pointer. */
const stage = async () => {
  const { three, state } = await scene()
  const canvas = state.gl.domElement
  const all = candidates(three, state)
  // Instanced targets are the settlement beacons; roads and city-ready
  // buildings are plain groups. Try the likely shape first, then the rest,
  // and let the confirm bar say what was actually staged.
  const preferInstanced = cfg.kind === 'vertex'
  const ordered = [...all].sort((a, b) => Number((b.shape === 'instance') === preferInstanced) - Number((a.shape === 'instance') === preferInstanced))
  const want = PREVIEW[cfg.kind]
  let tried = 0
  for (const candidate of ordered) {
    const screen = project(three, state, candidate.point)
    if (screen.ndc.z > 1 || screen.x < 4 || screen.y < 4 || screen.x > innerWidth - 4 || screen.y > innerHeight - 4) continue
    if (!hits(three, state, candidate, screen)) continue
    tried += 1
    await clickAt(canvas, screen.x, screen.y)
    const title = previewTitle()
    if (title && want.test(title)) return { staged: true, tried, title, x: round(screen.x), y: round(screen.y), shape: candidate.shape }
    if (title) await cancelPreview()
    if (tried > 40) break
  }
  return { staged: false, tried, title: previewTitle(), targets: legalTargets().length }
}

/** Press the HUD button that puts the board into a placement mode. */
const placement = async () => {
  const wanted = cfg.button.toLowerCase()
  const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim().toLowerCase().startsWith(wanted))
  if (!button) return { pressed: false, reason: 'no button named ' + cfg.button }
  if (button.disabled) return { pressed: false, reason: cfg.button + ' is disabled' }
  button.click()
  await settle(140)
  return { pressed: true, targets: legalTargets().length }
}

/**
 * What the trade table says about itself.
 *
 * The data-state attribute is the whole answer to the client's report that it
 * glitches out after one trade: a table reopened after a completed deal has to
 * come back composing, not stuck on the last result.
 */
const trade = async () => {
  const table = document.querySelector('.trade-table')
  const send = document.querySelector('.table-send')
  const note = document.querySelector('.harbor-note')
  const respond = document.querySelector('.table-respond, .trade-table [data-state="responding"]')
  return {
    open: Boolean(table),
    state: table ? table.dataset.state : '',
    sendPresent: Boolean(send),
    sendDisabled: send ? send.disabled : true,
    harborNote: note ? note.textContent.trim() : '',
    responding: Boolean(respond) || (table ? table.dataset.state === 'responding' : false),
    title: table ? (table.getAttribute('aria-label') || '') : '',
  }
}

const closeDialog = async () => {
  const close = document.querySelector('.table-header button, .trade-table button[aria-label*="lose"]')
  if (close) close.click()
  else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle(160)
  return { closed: !document.querySelector('.trade-table') }
}

const confirm = async () => {
  const button = document.querySelector('.action-preview button.confirm')
  if (!button) return { confirmed: false }
  button.click()
  await settle(240)
  return { confirmed: true, previewGone: !document.querySelector('.action-preview') }
}

/* ------------------------------------------------------------------ layout */

const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])'

const visible = (node) => {
  const rect = node.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false
  const style = getComputedStyle(node)
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false
  // Screen-reader-only nodes are deliberately one pixel and are not a tap target.
  return !(rect.width <= 2 && rect.height <= 2) && style.clip !== 'rect(0px, 0px, 0px, 0px)' && !node.closest('.sr-only')
}

const accessibleName = (node) => {
  const label = node.getAttribute('aria-label')
  if (label && label.trim()) return label.trim()
  const labelledBy = node.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
    if (text) return text
  }
  const text = (node.innerText || node.textContent || '').trim()
  if (text) return text
  const title = node.getAttribute('title')
  if (title && title.trim()) return title.trim()
  const image = node.querySelector('img[alt], svg title')
  if (image) return (image.getAttribute('alt') || image.textContent || '').trim()
  const value = node.getAttribute('value') || node.getAttribute('placeholder')
  return value ? value.trim() : ''
}

const parseColor = (value) => {
  const match = /rgba?\(([^)]+)\)/.exec(value || '')
  if (!match) return null
  const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number)
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
}

const luminance = ({ r, g, b }) => {
  const channel = (value) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
})

/**
 * The effective background behind a run of text, by walking up until something
 * opaque is found. Anything painted with an image or gradient on the way is
 * unmeasurable from here and is skipped rather than guessed at.
 */
const backdrop = (node) => {
  let stack = null
  for (let current = node; current && current !== document.documentElement; current = current.parentElement) {
    const style = getComputedStyle(current)
    if (style.backgroundImage && style.backgroundImage !== 'none') return null
    const color = parseColor(style.backgroundColor)
    if (!color || color.a === 0) continue
    stack = stack ? over(stack, color) : color
    if (stack.a >= 0.999) return stack
  }
  return null
}

const contrast = (foreground, background) => {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const layout = async () => {
  const min = cfg.minTarget || 44
  let cls = 0
  await new Promise((resolve) => {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) cls += entry.value
      })
      observer.observe({ type: 'layout-shift', buffered: true })
      setTimeout(() => { observer.disconnect(); resolve() }, 120)
    } catch { resolve() }
  })

  const overflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const controls = [...document.querySelectorAll(CONTROLS)].filter(visible)
  const small = []
  const unlabelled = []
  for (const node of controls) {
    const rect = node.getBoundingClientRect()
    if (Math.min(rect.width, rect.height) < min) small.push(node.tagName.toLowerCase() + '.' + (node.className || '').toString().split(' ')[0] + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height))
    if (!accessibleName(node)) unlabelled.push(node.tagName.toLowerCase() + '.' + (node.className || '').toString().split(' ')[0])
  }

  const failures = []
  let worst = 21
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.nodeValue.trim()) continue
    const element = text.parentElement
    if (!element || seen.has(element) || !visible(element)) continue
    seen.add(element)
    const style = getComputedStyle(element)
    const foreground = parseColor(style.color)
    const background = backdrop(element)
    if (!foreground || !background || foreground.a < 0.999) continue
    const size = parseFloat(style.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
    const ratio = contrast(foreground, background)
    if (ratio < worst) worst = ratio
    if (ratio < (large ? 3 : 4.5)) failures.push(element.tagName.toLowerCase() + '.' + (element.className || '').toString().split(' ')[0] + ' ' + round(ratio, 2) + ':1')
  }

  return {
    width: innerWidth,
    height: innerHeight,
    cls: round(cls, 4),
    overflow,
    controls: controls.length,
    smallCount: small.length,
    small: small.slice(0, 4),
    unlabelledCount: unlabelled.length,
    unlabelled: [...new Set(unlabelled)].slice(0, 4),
    contrastFailures: failures.length,
    contrastWorst: round(worst, 2),
    contrastSample: [...new Set(failures)].slice(0, 4),
  }
}

const modes = { boot, targets, environment, stage, placement, confirm, layout, trade, closeDialog }
return modes[cfg.mode]()
`

export const pageScript = (config: PageConfig) =>
  `(async () => {\n${SOURCE.replace('__QA_CONFIG__', JSON.stringify(config))}\n})()`
