/* global window, document */
// Run with: node --import tsx scripts/frame-assets-smoke.mjs
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { FRAME_BOOTSTRAP } from '../src/lib/frameRuntime.ts'

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
const errors = []
const requests = new Map()
page.on('pageerror', (error) => errors.push(error.message))
await page.setRequestInterception(true)
page.on('request', (request) => {
  if (request.url().startsWith('https://assets.test/')) requests.set(request.url(), request)
  else void request.continue()
})

async function render(html, preloadAssets = false) {
  await page.evaluate(
    ({ html, preloadAssets }) => {
      document.querySelector('iframe').contentWindow.postMessage({ type: 'doop:html', html, preloadAssets }, '*')
    },
    { html, preloadAssets },
  )
}
async function loading(value) {
  await page.waitForFunction((value) => window.assetLoading === value, { timeout: 5000 }, value)
}
async function settle(
  name,
  failure = false,
  contentType = 'image/svg+xml',
  body = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"/>',
) {
  const url = `https://assets.test/${name}`
  assert.ok(requests.has(url), `Expected a request for ${name}`)
  await requests
    .get(url)
    .respond({ status: failure ? 404 : 200, contentType, body, headers: { 'Access-Control-Allow-Origin': '*' } })
  requests.delete(url)
}

try {
  await page.evaluate((bootstrap) => {
    window.assetLoading = false
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'doop:frame-ready') window.frameReady = true
      if (event.data?.type === 'doop:assets-progress') {
        window.assetLoading = event.data.pending > 0
        window.assetProgress = event.data
      }
    })
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.srcdoc = bootstrap
    document.body.append(iframe)
  }, FRAME_BOOTSTRAP)
  await page.waitForFunction(() => window.frameReady)

  await render('<img src="https://assets.test/one"><img src="https://assets.test/two">')
  await loading(true)
  await settle('one')
  await loading(true)
  await settle('two', true)
  await loading(false)
  console.log('PASS: slow images stay pending until both success and failure settle')

  await render('<img src="https://assets.test/old">')
  await loading(true)
  await render('<img src="https://assets.test/new">')
  await settle('old')
  await loading(true)
  await settle('new')
  await loading(false)
  console.log('PASS: replacing an image ignores stale completion')

  await render('<img src="https://assets.test/removed">')
  await loading(true)
  await render('<p>No assets left</p>')
  await loading(false)
  console.log('PASS: removing an unfinished asset clears loading')

  await render('<div style="width:80px;height:80px;background-image:url(https://assets.test/background)"></div>')
  await loading(true)
  await settle('background')
  await loading(false)
  console.log('PASS: CSS background images are tracked')

  await render('<link rel="stylesheet" href="https://assets.test/style"><p>Styled text</p>')
  await loading(true)
  await settle('style', true, 'text/css', '')
  await loading(false)
  await render('<link rel="stylesheet" href="https://assets.test/replaced-style"><p>Styled text</p>')
  await loading(true)
  await settle('replaced-style', false, 'text/css', 'body{color:red}')
  await loading(false)
  console.log('PASS: failed and replaced stylesheets settle')

  await render(
    '<style>@font-face{font-family:Test;src:url(https://assets.test/font)}p{font-family:Test}</style><p>Font loading</p>',
  )
  await loading(true)
  await settle('font', true, 'font/woff2', '')
  await loading(false)
  console.log('PASS: pending fonts and font failures are tracked')

  await render('<img loading="lazy" style="margin-top:10000px" src="https://assets.test/lazy">')
  // Let the morph and its scheduled scan finish before checking the quiet state.
  await page.evaluate(
    () => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))),
  )
  await loading(false)
  console.log('PASS: offscreen lazy images are deferred outside the startup preload')

  await render('<img loading="lazy" style="margin-top:10000px" src="https://assets.test/preload-lazy">', true)
  await loading(true)
  await settle('preload-lazy')
  await loading(false)
  assert.equal(await page.frames()[1].evaluate(() => document.querySelector('img').getAttribute('loading')), 'lazy')
  console.log('PASS: startup preloads offscreen lazy assets without changing the design')

  await render('<script src="https://assets.test/script"></script>', true)
  await loading(true)
  await settle(
    'script',
    false,
    'text/javascript',
    'document.body.innerHTML += \'<img src="https://assets.test/script-image">\'',
  )
  // The script discovers another asset; its completion must not end loading.
  await page.waitForFunction(() => window.assetProgress.total === 2)
  await loading(true)
  await settle('script-image')
  await loading(false)
  assert.deepEqual(
    await page.evaluate(() => ({ total: window.assetProgress.total, pending: window.assetProgress.pending })),
    { total: 2, pending: 0 },
  )
  assert.deepEqual(errors, [])
  console.log('PASS: external scripts and the assets they add contribute to real progress; no runtime errors')
} catch (error) {
  console.error('Pending requests:', [...requests.keys()])
  throw error
} finally {
  await browser.close()
}
