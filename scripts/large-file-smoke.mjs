/* global window, document, performance */
// Run with: node --import tsx scripts/large-file-smoke.mjs
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { FRAME_BOOTSTRAP } from '../src/lib/frameRuntime.ts'

const server = await createServer({ server: { port: 0, host: '127.0.0.1' } })
await server.listen()
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/design-editor.html`)
  const layers = await page.evaluate(async () => {
    const { parseDesign, readLayers, flattenLayers } = await import('/src/lib/designDocument.ts')
    const html = Array.from({ length: 12000 }, (_, i) => `<div data-doop-node="node-${i}">Layer ${i}</div>`).join('')
    const doc = parseDesign(html)
    let queries = 0
    const query = doc.querySelectorAll.bind(doc)
    doc.querySelectorAll = (...args) => {
      queries++
      return query(...args)
    }
    const started = performance.now()
    const tree = readLayers(doc)
    const duration = performance.now() - started
    return {
      durationMs: Math.round(duration),
      queries,
      count: flattenLayers(tree.layers).length,
      truncated: tree.truncated,
    }
  })
  console.log('Large layer tree:', layers)
  assert.equal(layers.count, 3000)
  assert.equal(layers.truncated, true)
  assert.ok(layers.queries <= 2, 'Layer discovery must not query the whole document for every layer')

  const selectors = await page.evaluate(async () => {
    const { parseDesign, readLayers, flattenLayers, designSelector } = await import('/src/lib/designDocument.ts')
    const results = []
    for (const doctype of ['', '<!doctype html>']) {
      const doc = parseDesign(`${doctype}<head><meta id="in-head"></head><body>
        <section data-doop-node="stable" data-doop-locked><p id="unique">Text</p><p>Sibling</p></section>
        <div id="duplicate" data-doop-node="repeated"></div><div id="duplicate" data-doop-node="repeated"></div>
        <div id="in-head"></div><div id="UPPER"></div><div id="upper"></div>
        <div id="escaped:1" data-doop-node="with space"></div>
        <svg><g><path id="path"/></g></svg><img src="image.svg"><script></script><div>Last</div>
      </body>`)
      for (const layer of flattenLayers(readLayers(doc).layers)) {
        const matches = doc.querySelectorAll(layer.selector)
        results.push({ matches: matches.length, selector: layer.selector, expected: designSelector(matches[0]) })
      }
    }
    // A duplicate outside the displayed tree must still disqualify an ID.
    const limited = parseDesign('<p id="beyond-limit"></p>' + '<div></div>'.repeat(3100) + '<p id="beyond-limit"></p>')
    const first = readLayers(limited).layers[0].children[0]
    results.push({
      matches: limited.querySelectorAll(first.selector).length,
      selector: first.selector,
      expected: designSelector(limited.querySelector('p')),
    })
    return results
  })
  for (const result of selectors) {
    assert.equal(result.matches, 1)
    assert.equal(result.selector, result.expected)
  }
  console.log('PASS: indexed selectors preserve unique IDs, duplicate fallbacks, positional paths, and truncation')

  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { LayersPanel } = await import('/src/components/LayersPanel.tsx')
    const { TooltipProvider } = await import('/src/components/ui/tooltip.tsx')
    const { useStore } = await import('/src/lib/store.ts')
    const frames = ['First', 'Second'].map((name) => ({
      id: name,
      canvasId: 'test',
      name,
      html: `<p id="${name}-text">${name} layer</p>`,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      createdAt: 1,
      updatedAt: 1,
      updatedBy: 'test',
    }))
    useStore.getState().setCanvas({ id: 'test', name: 'Test', frames, createdAt: 1, updatedAt: 1 })
    window.layerParses = 0
    const parse = window.DOMParser.prototype.parseFromString
    window.DOMParser.prototype.parseFromString = function (...args) {
      window.layerParses++
      return parse.apply(this, args)
    }
    const host = document.createElement('div')
    document.body.replaceChildren(host)
    window.testRoot = ReactDOM.createRoot(host)
    window.testRoot.render(
      React.createElement(TooltipProvider, null, React.createElement(LayersPanel, { onClose() {}, onAddFrame() {} })),
    )
  })
  await page.waitForSelector('[aria-label="Expand First"]')
  assert.equal(await page.evaluate(() => window.layerParses), 0, 'Collapsed layers must not parse any frame HTML')
  await page.click('[aria-label="Expand First"]')
  await page.waitForSelector('[role="treeitem"][aria-label="Frame contents"]')
  assert.equal(await page.evaluate(() => window.layerParses), 1, 'Expanding a frame reads only that frame')
  await page.type('[aria-label="Search layers and assets"]', 'Second layer')
  await page.waitForSelector('[role="treeitem"][aria-label="#Second-text"]')
  await page.click('[role="treeitem"][aria-label="#Second-text"]')
  await page.waitForFunction(
    () => document.querySelector('[aria-label="#Second-text"]').getAttribute('aria-selected') === 'true',
  )
  await page.click('[role="tab"]:last-child')
  await page.waitForSelector('[aria-label="New image URL"]')
  await page.evaluate(() => window.testRoot.unmount())
  console.log('PASS: collapsed frames defer parsing; expansion, canvas-wide search, selection, and Assets still work')

  // A separate document keeps the app's requests and styles out of the measurement.
  await page.goto('about:blank')
  const pending = []
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (request.url().startsWith('https://large-file.test/')) pending.push(request)
    else void request.continue()
  })
  await page.evaluate((bootstrap) => {
    window.reports = []
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'doop:frame-ready') window.frameReady = true
      if (event.data?.type === 'doop:assets-progress') window.reports.push(event.data)
    })
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.srcdoc = bootstrap.replace(
      '<script data-v-boot>',
      `<script data-v-boot>
      window.styleReads = 0;
      var originalComputedStyle = window.getComputedStyle;
      window.getComputedStyle = function () {
        window.styleReads++;
        return originalComputedStyle.apply(this, arguments);
      };
    `,
    )
    document.body.append(iframe)
  }, FRAME_BOOTSTRAP)
  await page.waitForFunction(() => window.frameReady)
  const before = await page.metrics()
  const started = performance.now()
  await page.evaluate(() => {
    const html =
      '<div>Layer</div>'.repeat(12000) +
      Array.from({ length: 30 }, (_, i) => `<img src="https://large-file.test/${i}">`).join('')
    document.querySelector('iframe').contentWindow.postMessage({ type: 'doop:html', html, preloadAssets: true }, '*')
  })
  await page.waitForFunction(() => window.reports.at(-1)?.pending === 30)
  for (let remaining = 30; remaining > 0; remaining--) {
    assert.ok(pending.length)
    await pending.shift().respond({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"/>',
    })
    await page.waitForFunction((remaining) => window.reports.at(-1)?.pending === remaining - 1, {}, remaining)
  }
  const after = await page.metrics()
  const styleReads = await page.frames()[1].evaluate(() => window.styleReads)
  console.log('Large frame assets:', {
    durationMs: Math.round(performance.now() - started),
    taskMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000),
    styleReads,
  })
  assert.ok(styleReads < 25000, 'Image completions must reuse background discovery instead of rescanning every element')
  assert.equal(await page.evaluate(() => window.reports.at(-1).pending), 0)
  assert.deepEqual(errors, [])
} catch (error) {
  console.error('Browser errors:', errors)
  throw error
} finally {
  await browser.close()
  await server.close()
}
