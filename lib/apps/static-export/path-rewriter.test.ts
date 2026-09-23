import assert from 'node:assert/strict'
import test from 'node:test'

import { localizeKnownPageLinks, relativizePaths } from './path-rewriter'
import { buildOriginalAssetMap, rewriteToOriginalAssets } from './original-assets'

test('relativizePaths keeps an arbitrary background class matched after rewriting its asset URL', () => {
  const html = [
    '<style>',
    String.raw`.\[background\:url\(\/a\/4z4DOvTKukU5Y77Faqm8sh\/foto-01\.jpg\)_center\/cover\] {`,
    'background: url(/a/4z4DOvTKukU5Y77Faqm8sh/foto-01.jpg) center/cover;',
    '}',
    '</style>',
    '<div class="[background:url(/a/4z4DOvTKukU5Y77Faqm8sh/foto-01.jpg)_center/cover]"></div>',
  ].join('')

  const result = relativizePaths(html, 'index.html')

  assert.match(result, /class="\[background:url\(\.\/a\/4z4DOvTKukU5Y77Faqm8sh\/foto-01\.jpg\)_center\/cover\]"/)
  assert.ok(
    result.includes(
      String.raw`.\[background\:url\(\.\/a\/4z4DOvTKukU5Y77Faqm8sh\/foto-01\.jpg\)_center\/cover\]`,
    ),
  )
})

test('original asset and relative-path passes keep the full hero utility matched at root and nested routes', () => {
  const [asset] = [
    {
      id: '5f2c1a44-0000-4000-8000-000000000001',
      filename: 'foto-01.jpg',
      mime_type: 'image/jpeg',
      storage_path: 'website/foto-01.jpg',
      public_url: 'http://storage/website/foto-01.jpg',
    },
  ]
  const assets = buildOriginalAssetMap([asset])
  const [proxyPath] = [...assets.keys()]
  const escapedProxyPath = proxyPath.replaceAll('/', String.raw`\/`).replaceAll('.', String.raw`\.`)
  const suffix = String.raw`_center_30\%\/cover_no-repeat`
  const html = [
    `<style>.\\[background\\:url\\(${escapedProxyPath}\\)${suffix}\\] {`,
    `background: url(${proxyPath}) center 30%/cover no-repeat;`,
    '}</style>',
    `<div class="[background:url(${proxyPath})_center_30%/cover_no-repeat]"></div>`,
  ].join('')

  for (const outputKey of ['index.html', 'ca/coneix-la-nostra-hipica/index.html']) {
    const result = relativizePaths(rewriteToOriginalAssets(html, assets), outputKey)
    const prefix = outputKey === 'index.html' ? './' : '../../'
    const path = `${prefix}assets/foto-01.jpg`
    const escapedPath = path.replaceAll('/', String.raw`\/`).replaceAll('.', String.raw`\.`)

    assert.ok(result.includes(`class="[background:url(${path})_center_30%/cover_no-repeat]"`))
    assert.ok(result.includes(`.\\[background\\:url\\(${escapedPath}\\)${suffix}\\]`))
    assert.ok(result.includes(`background: url(${path}) center 30%/cover no-repeat`))
  }
})

test('localized export keeps imported URL links inside the active locale', () => {
  const routes = new Map([
    ['/', '/ca'],
    ['/tarifas', '/ca/tarifas'],
  ])
  const html = [
    '<a href="/tarifas?plan=basic#preus">Tarifes</a>',
    '<a href="/ca/tarifas">Ja localitzat</a>',
    '<a href="/desconeguda">Desconeguda</a>',
    '<a href="/assets/logo.svg">Logo</a>',
  ].join('')

  const localized = localizeKnownPageLinks(html, routes)

  assert.match(relativizePaths(localized, 'ca/index.html'), /href="\.\.\/ca\/tarifas\/index\.html\?plan=basic#preus"/)
  assert.match(relativizePaths(localized, 'ca/serveis/index.html'), /href="\.\.\/\.\.\/ca\/tarifas\/index\.html\?plan=basic#preus"/)
  assert.match(localized, /href="\/ca\/tarifas">Ja localitzat/)
  assert.match(localized, /href="\/desconeguda">Desconeguda/)
  assert.match(localized, /href="\/assets\/logo\.svg">Logo/)
})

test('the composed rewrites leave an unmapped proxy reference untouched', () => {
  const unmapped = '/a/AAAAAAAAAAAAAAAAAAAAAA/unmapped.jpg'
  const html = `<div class="[background:url(${unmapped})]"></div>`

  assert.equal(
    relativizePaths(rewriteToOriginalAssets(html, new Map()), 'ca/article/index.html'),
    `<div class="[background:url(../../${unmapped.slice(1)})]"></div>`,
  )
})
