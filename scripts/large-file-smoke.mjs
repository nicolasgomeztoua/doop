/* global window, performance */
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
try {
  const page = await browser.newPage()
  await page.goto(process.env.DOOP_TEST_BASE || 'http://localhost:4300', { waitUntil: 'networkidle0' })
  const result = await page.evaluate(async () => {
    const { buildLayerTree } = await import('/src/lib/layers.ts')
    const { parseDesign, designSelector } = await import('/src/lib/designDocument.ts')
    const flatten = (nodes) => nodes.flatMap((n) => [n, ...flatten(n.children)])
    const html =
      '<!doctype html><body>' +
      Array.from({ length: 10000 }, (_, i) => `<div id="item-${i}" data-doop-node="node-${i}">Item</div>`).join('')
    let queries = 0
    const original = window.Document.prototype.querySelectorAll
    window.Document.prototype.querySelectorAll = function (...args) {
      queries++
      return original.apply(this, args)
    }
    const start = performance.now()
    const tree = buildLayerTree(html)
    const ms = performance.now() - start
    window.Document.prototype.querySelectorAll = original
    const selectors = []
    for (const doctype of ['', '<!doctype html>']) {
      const source = `${doctype}<head><meta id="in-head"></head><body>
        <section data-doop-node="stable" data-doop-locked><p id="unique">Text</p><p>Sibling</p></section>
        <div id="duplicate" data-doop-node="repeated"></div><div id="duplicate" data-doop-node="repeated"></div>
        <div id="in-head"></div><div id="UPPER"></div><div id="upper"></div>
        <div id="escaped:1" data-doop-node="with space"></div><svg><path/></svg><script></script></body>`
      const doc = parseDesign(source)
      for (const layer of flatten(buildLayerTree(source))) {
        const matches = doc.querySelectorAll(layer.selector)
        selectors.push(matches.length === 1 && layer.selector === designSelector(matches[0]))
      }
    }
    const truncated = '<p id="beyond-limit"></p>' + '<div></div>'.repeat(3100) + '<p id="beyond-limit"></p>'
    const first = buildLayerTree(truncated)[0]
    selectors.push(parseDesign(truncated).querySelectorAll(first.selector).length === 1)
    const deep = '<div>'.repeat(200) + 'Text' + '</div>'.repeat(200)
    return { count: flatten(tree).length, queries, ms, selectors, depthCount: flatten(buildLayerTree(deep)).length }
  })
  assert.equal(result.count, 3000)
  assert.ok(result.queries <= 2, 'Index source identities once per tree')
  assert.ok(result.selectors.every(Boolean), 'Tree and runtime source selectors must identify one element')
  assert.ok(result.depthCount <= 81, 'Deep imports cannot overflow the layer traversal')
  console.log('PASS large imported documents retain bounded trees and matching unique selectors', result)
} finally {
  await browser.close()
}
