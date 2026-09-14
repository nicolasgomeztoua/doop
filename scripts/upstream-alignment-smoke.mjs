/* global document, window, PointerEvent, getComputedStyle, fetch */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'

const base = process.env.DOOP_TEST_BASE || 'http://localhost:4300'
const { DOOP_TEST_EMAIL: email, DOOP_TEST_PASSWORD: password } = process.env
assert.ok(email && password, 'Set DOOP_TEST_EMAIL and DOOP_TEST_PASSWORD.')
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const checks = []
const passed = (name) => {
  checks.push(name)
  console.log(`PASS ${name}`)
}
async function api(url, body, method = 'POST') {
  return page.evaluate(
    async ({ url, body, method }) => {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: res.status, data: await res.json() }
    },
    { url, body, method },
  )
}
async function type(selector, value) {
  await page.waitForSelector(selector)
  await page.click(selector, { clickCount: 3 })
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  if (value) await page.keyboard.type(value)
  else await page.keyboard.press('Backspace')
}
async function clickText(selector, text) {
  const nodes = await page.$$(selector)
  for (const node of nodes)
    if ((await node.evaluate((e) => e.textContent.trim())) === text) {
      await node.click()
      return
    }
  throw new Error(`No ${selector}: ${text}`)
}
async function select(name) {
  await type('[aria-label="Search layers and assets"]', name)
  const nodes = await page.$$('[role=treeitem]')
  let clicked = false
  for (const node of nodes)
    if ((await node.evaluate((e) => e.textContent)).includes(name)) {
      await node.click()
      clicked = true
      break
    }
  assert.ok(clicked, `layer ${name}`)
  await page.waitForSelector('[aria-label="Element properties"]')
  await clickText('[role=tab]', 'Design')
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Element properties"]')?.textContent.includes('Advanced design'),
  )
}
async function waitSaved() {
  await page.waitForFunction(
    () => ![...document.querySelectorAll('[role=status]')].some((e) => e.textContent.includes('Saving')),
  )
  const alert = await page.$('[role=alert]')
  assert.equal(alert ? await alert.evaluate((e) => e.textContent) : null, null)
}
async function designField(label, value) {
  await type(`[aria-label="${label}"]`, value)
  await page.keyboard.press('Enter')
  await waitSaved()
}
async function openAdvanced(section) {
  const summary = await page.$('[aria-label="Element properties"] details > summary')
  if (summary && !(await summary.evaluate((e) => e.parentElement.open))) await summary.click()
  if (section) {
    const toggle = await page.$(`button[aria-label="${section}"]`)
    if ((await toggle.evaluate((e) => e.getAttribute('aria-expanded'))) !== 'true') await toggle.click()
  }
}
let canvasId, frameId
async function stored() {
  return (await api(`/api/canvases/${canvasId}`, undefined, 'GET')).data.frames.find((f) => f.id === frameId).html
}
function artboard() {
  return page.frames().find((f) => f.url() === 'about:srcdoc')
}
async function rendered(selector, property, expected) {
  await artboard().waitForFunction(
    ({ selector, property, expected }) =>
      getComputedStyle(document.querySelector(selector)).getPropertyValue(property) === expected,
    {},
    { selector, property, expected },
  )
}
try {
  await page.goto(base, { waitUntil: 'networkidle0' })
  await type('input[type=email]', email)
  await type('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForFunction(() => !document.querySelector('input[type=password]'))
  passed('login through normal authentication')
  const fixture = await readFile(new URL('../tests/fixtures/design-editor.html', import.meta.url), 'utf8')
  canvasId = (await api('/api/canvases', { name: 'Upstream alignment · Regression' })).data.id
  frameId = (
    await api(`/api/canvases/${canvasId}/frames`, {
      name: 'Orbit · Landing page',
      html: fixture,
      width: 880,
      height: 740,
      x: 0,
      y: 0,
    })
  ).data.id
  await page.goto(`${base}/c/${canvasId}?frame=${frameId}`, { waitUntil: 'networkidle0' })
  await select('Headline')
  // Use upstream's everyday Text > Size control.
  const input = await page.evaluateHandle(() =>
    [...document.querySelectorAll('[aria-label="Element properties"] section')]
      .find((s) => s.querySelector('h3')?.textContent === 'Text')
      .querySelector('input'),
  )
  await input.asElement().click({ clickCount: 3 })
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  await page.keyboard.type('60')
  await page.keyboard.press('Enter')
  await rendered('#hero-title', 'font-size', '60px')
  await waitSaved()
  assert.match(await stored(), /font-size: 60px !important/)
  passed('upstream property control edits source and rendered typography')
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
  await rendered('#hero-title', 'font-size', '52px')
  await page.keyboard.down('Control')
  await page.keyboard.press('y')
  await page.keyboard.up('Control')
  await rendered('#hero-title', 'font-size', '60px')
  passed('undo and redo retain upstream element selection')
  await openAdvanced('Layer')
  await designField('Layer name', 'Headline renamed')
  await select('Headline renamed')
  passed('existing and edited layer names appear in upstream tree')
  await select('Orb · shadows')
  await openAdvanced('Effects')
  await designField('Shadow 1 blur', '36')
  await waitSaved()
  assert.match(await stored(), /36px/)
  passed('retained shadow controls persist through upstream panel')
  await select('Hero copy')
  const rows = await page.$$('[role=treeitem]')
  const rowText = await Promise.all(rows.map((row) => row.evaluate((e) => e.textContent)))
  const from = await rows[rowText.findIndex((text) => text.includes('Headline renamed'))].boundingBox()
  const to = await rows[rowText.findIndex((text) => text.includes('Description'))].boundingBox()
  await page.mouse.move(from.x + 100, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 100, to.y + to.height - 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForFunction(
    ({ canvasId, frameId }) =>
      fetch(`/api/canvases/${canvasId}`)
        .then((r) => r.json())
        .then((c) => {
          const html = c.frames.find((f) => f.id === frameId).html
          return html.indexOf('id="description"') < html.indexOf('id="hero-title"')
        }),
    {},
    { canvasId, frameId },
  )
  await waitSaved()
  passed('upstream drag-and-drop reorders persisted elements')
  // Export must inspect the current selected element, including changes just saved.
  await select('Headline renamed')
  await clickText('button', 'Export selected element…')
  await page.waitForSelector('[role=dialog]')
  assert.equal(await page.$eval('#export-scope', (e) => e.value), 'element')
  const exportRequests = []
  page.on('request', (req) => {
    if (req.url().includes(`/i/${frameId}.`)) exportRequests.push(req.url())
  })
  await clickText('button', 'Export PNG')
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  assert.ok(exportRequests.some((url) => new URL(url).searchParams.has('crop')))
  passed('selected element export uses measured crop')
  await page.click('[aria-label="Present selected frame"]')
  await page.waitForSelector('[aria-label="Presentation viewing controls"]')
  await clickText('button', 'Fit width')
  await clickText('button', '100%')
  await page.click('[aria-label="Presentation viewing controls"] [aria-label="Zoom in"]')
  await page.waitForFunction(() => document.querySelector('[aria-label="Zoom level"]')?.textContent === '125%')
  assert.equal(await page.$eval('[aria-label="Zoom level"]', (e) => e.textContent), '125%')
  await page.keyboard.press('Delete')
  assert.ok((await stored()).includes('Headline renamed'))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[aria-label="Presentation viewing controls"]'))
  passed('presentation retains zoom controls and blocks canvas shortcuts')
  const sourceTests = await page.evaluate(async () => {
    const { editDesign, parseDesign, sourceElement } = await import('/src/lib/designDocument.ts')
    const { buildLayerTree } = await import('/src/lib/layers.ts')
    const flattenLayers = (nodes) => nodes.flatMap((n) => [n, ...flattenLayers(n.children)])
    const original =
      '<!doctype html><html lang="en"><head><style>.card{color:var(--ink)}</style><script>window.boot=1</script></head><body><!--keep--><section id="container"><p id="title">Hello <b>world</b></p><img id="photo" src="a.png"><svg id="icon"><defs><linearGradient id="paint"><stop offset="0" /></linearGradient></defs><rect id="shape" fill="url(#paint)" /></svg></section></body></html>'
    const edited = editDesign(original, '#title', { type: 'style', values: { color: 'var(--ink, red)', width: '50%' } })
    const doc = parseDesign(edited.html)
    const tests = {
      sourcePreserved:
        doc.querySelector('script').textContent === 'window.boot=1' &&
        doc.querySelector('style').textContent === '.card{color:var(--ink)}' &&
        !!doc.querySelector('#title b') &&
        edited.html.includes('<!--keep-->'),
      valuesPreserved:
        doc.querySelector('#title').style.width === '50%' &&
        doc.querySelector('#title').style.color === 'var(--ink, red)',
      internalsExcluded: !flattenLayers(buildLayerTree(edited.html)).some((layer) =>
        ['style', 'script'].includes(layer.tag),
      ),
    }
    const rejects = (fn) => {
      try {
        fn()
        return false
      } catch {
        return true
      }
    }
    tests.badCssRejected = rejects(() =>
      editDesign(original, '#title', { type: 'style', values: { color: 'definitely-not-a-color' } }),
    )
    tests.missingRejected = rejects(() => editDesign(original, '#missing', { type: 'style', values: { color: 'red' } }))
    tests.nestedTextPreserved = rejects(() => editDesign(original, '#title', { type: 'text', text: 'erase children' }))
    tests.unsafeImageRejected = rejects(() =>
      editDesign(original, '#photo', { type: 'image', src: 'javascript:alert(1)' }),
    )
    const locked = editDesign(original, '#container', { type: 'lock' })
    tests.parentLockHonored = rejects(() =>
      editDesign(locked.html, '#title', { type: 'style', values: { color: 'red' } }),
    )
    const hidden = editDesign(original, '#container', { type: 'visibility' })
    const visible = editDesign(hidden.html, '#container', { type: 'visibility' })
    tests.hideRestoresCascade = !parseDesign(visible.html).querySelector('#container').style.display
    const show = (attributes) =>
      parseDesign(
        editDesign(`<div id="visible" ${attributes}>Text</div>`, '#visible', { type: 'visibility' }).html,
      ).querySelector('#visible')
    const hiddenFlex = show('hidden style="display:flex!important;visibility:visible!important;color:red"')
    tests.showPreservesAuthoredFlex =
      !hiddenFlex.hasAttribute('hidden') &&
      hiddenFlex.style.display === 'flex' &&
      hiddenFlex.style.getPropertyPriority('display') === 'important' &&
      hiddenFlex.style.visibility === 'visible' &&
      hiddenFlex.style.getPropertyPriority('visibility') === 'important' &&
      hiddenFlex.style.color === 'red'
    const hiddenGrid = show('style="visibility:hidden!important;display:grid!important"')
    tests.showPreservesAuthoredGrid =
      hiddenGrid.style.display === 'grid' &&
      hiddenGrid.style.getPropertyPriority('display') === 'important' &&
      !hiddenGrid.style.visibility
    const hiddenDisplay = show('style="display:none!important;visibility:visible!important"')
    tests.showPreservesAuthoredVisibility =
      !hiddenDisplay.style.display &&
      hiddenDisplay.style.visibility === 'visible' &&
      hiddenDisplay.style.getPropertyPriority('visibility') === 'important'
    const allHidden = show('hidden style="display:none!important;visibility:hidden!important;color:red"')
    tests.showRemovesOnlyHidingState =
      !allHidden.hasAttribute('hidden') &&
      !allHidden.style.display &&
      !allHidden.style.visibility &&
      allHidden.style.color === 'red'
    const authored = '<div id="visible" style="display:flex!important;visibility:visible!important">Text</div>'
    const hiddenAuthored = editDesign(authored, '#visible', { type: 'visibility' })
    const restored = parseDesign(
      editDesign(hiddenAuthored.html, '#visible', { type: 'visibility' }).html,
    ).querySelector('#visible')
    tests.editorHideShowPreservesPriority =
      restored.style.display === 'flex' &&
      restored.style.getPropertyPriority('display') === 'important' &&
      restored.style.visibility === 'visible' &&
      restored.style.getPropertyPriority('visibility') === 'important'
    const copy = editDesign(original, '#icon', { type: 'duplicate' })
    const copyDoc = parseDesign(copy.html)
    const copyEl = sourceElement(copyDoc, copy.selector)
    const ids = [...copyDoc.querySelectorAll('[id]')].map((node) => node.id)
    tests.copyIdsUnique =
      new Set(ids).size === ids.length &&
      copyEl.querySelector('rect').getAttribute('fill') === `url(#${copyEl.querySelector('linearGradient').id})`
    const styledCopy = editDesign(
      '<style>.shared, #button { color: red } .shared { color: blue } @media (min-width: 1px) { #button { padding: 12px } }</style><button id="button">Test</button>',
      '#button',
      { type: 'duplicate' },
    )
    const styleDoc = parseDesign(styledCopy.html)
    const copiedRules = styleDoc.querySelector('style[data-doop-copy-styles]').textContent
    tests.copyRetainsIdStyles =
      copiedRules.includes(styledCopy.selector) && copiedRules.includes('color: red') && copiedRules.includes('@media')
    tests.copyDoesNotRestyleOtherLayers = !copiedRules.includes('.shared')
    const moved = editDesign(original, '#title', { type: 'reorder', direction: 'down' })
    tests.reorderFollowsSelection =
      parseDesign(moved.html).querySelector('#container').children[1].id === 'title' && moved.selector === '#title'
    const removed = editDesign(original, '#title', { type: 'delete' })
    tests.deleteSelectsParent = removed.selector === '#container' && !parseDesign(removed.html).querySelector('#title')
    const inserted = editDesign(original, '#container', { type: 'insert', kind: 'text' })
    tests.insertSelectsNewLayer =
      sourceElement(parseDesign(inserted.html), inserted.selector).textContent === 'Your text'
    return tests
  })
  for (const [name, ok] of Object.entries(sourceTests)) assert.equal(ok, true, name)
  passed(`${Object.keys(sourceTests).length} browser source-integrity and structural-edit cases`)
  // An unsaved HTML edit must not overwrite a collaborator's newer source.
  await select('Headline renamed')
  await clickText('[role=tab]', 'HTML')
  await page.waitForSelector('[aria-label="Element HTML"]')
  const originalMarkup = await page.$eval('[aria-label="Element HTML"]', (e) => e.value)
  await type('[aria-label="Element HTML"]', originalMarkup.replace('possibility.', 'unsaved draft.'))
  const remoteHtml = (await stored()).replace('possibility.', 'collaborator text.')
  assert.equal((await api(`/api/frames/${frameId}`, { html: remoteHtml }, 'PATCH')).status, 200)
  await page.keyboard.press('Tab')
  await page.waitForSelector('[role=alert]')
  assert.match(await stored(), /collaborator text/)
  await page.click('summary')
  assert.match(await page.$eval('[aria-label="Unsaved HTML"]', (e) => e.value), /unsaved draft/)
  passed('HTML conflict preserves remote work and offers the unsaved draft')
  await select('Description')
  await clickText('[role=tab]', 'Design')
  // Multiple frames still export as ZIP or one canvas-positioned image.
  const secondId = (
    await api(`/api/canvases/${canvasId}/frames`, {
      name: 'Second',
      html: '<p>Second</p>',
      width: 200,
      height: 200,
      x: 950,
      y: 0,
    })
  ).data.id
  assert.ok(secondId)
  await page.waitForSelector('iframe[title="Second"]')
  for (const [name, shiftKey] of [
    ['Orbit · Landing page', false],
    ['Second', true],
  ]) {
    await page.evaluate(
      ({ name, shiftKey }) => {
        const frame = [...document.querySelectorAll('iframe')].find((el) => el.title === name).closest('.group')
        const title = frame.firstElementChild
        const box = title.getBoundingClientRect()
        const options = { bubbles: true, button: 0, pointerId: 1, clientX: box.x + 40, clientY: box.y + 8, shiftKey }
        title.dispatchEvent(new PointerEvent('pointerdown', options))
        window.dispatchEvent(new PointerEvent('pointerup', options))
      },
      { name, shiftKey },
    )
  }
  await clickText('button', 'Export')
  await page.waitForSelector('#export-mode')
  assert.equal(await page.$eval('#export-mode', (e) => e.value), 'separate')
  await clickText('button', 'Export 2 frames')
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  await clickText('button', 'Export')
  await page.select('#export-mode', 'combined')
  await clickText('button', 'Export PNG')
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  passed('multi-frame ZIP and combined image exports still work')
  await select('Description')
  await page.evaluate(() => {
    document.body.tabIndex = -1
    document.body.focus()
  })
  await page.keyboard.press('Delete')
  await page.waitForFunction(
    ({ canvasId, frameId }) =>
      fetch(`/api/canvases/${canvasId}`)
        .then((r) => r.json())
        .then((c) => {
          const f = c.frames.find((f) => f.id === frameId)
          return f && !f.html.includes('id="description"')
        }),
    {},
    { canvasId, frameId },
  )
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
  await page.waitForFunction(
    ({ canvasId, frameId }) =>
      fetch(`/api/canvases/${canvasId}`)
        .then((r) => r.json())
        .then((c) => c.frames.find((f) => f.id === frameId).html.includes('id="description"')),
    {},
    { canvasId, frameId },
  )
  passed('canvas Delete targets the selected element and undo restores it')
  await select('Description')
  // Mobile uses the same element panel inside a sheet.
  await page.setViewport({ width: 390, height: 844 })
  await page.waitForSelector('[aria-label="Element properties"]')
  assert.ok(await page.$('[aria-label="Element properties"] [role=tablist]'))
  await page.setViewport({ width: 1600, height: 1000 })
  passed('mobile element properties remain available')
  assert.deepEqual(errors, [])
  if (process.env.DOOP_TEST_SCREENSHOT) await page.screenshot({ path: process.env.DOOP_TEST_SCREENSHOT })
  console.log(JSON.stringify({ checks, canvasId, frameId }))
} catch (error) {
  if (process.env.DOOP_TEST_SCREENSHOT) await page.screenshot({ path: process.env.DOOP_TEST_SCREENSHOT })
  console.error('Browser errors:', errors)
  console.error((await page.$eval('body', (e) => e.innerText)).slice(-3000))
  throw error
} finally {
  await browser.close()
}
