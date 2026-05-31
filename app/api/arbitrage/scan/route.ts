import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 10

type Side = 'asks' | 'bids'
type Source = 'Binance' | 'MEXC' | 'Gate.io' | 'Coinbase'
type MarketSource = 'exchange' | 'broker' | string
type ExtBook = { ask: number; bid: number; source: Source; fee: number }
type Verified = { pct: number; buy: number; sell: number; bitkubVolumeThb: number; externalVwapVolumeThb: number }
type Row = {
  symbol: string
  bkSymbol: string
  source: Source
  extFee: number
  targetBkToExt: number
  targetExtToBk: number
  bkAsk: number
  bkBid: number
  extAskThb: number
  extBidThb: number
  bkToExtPct: number
  extToBkPct: number
  bestPct: number
  bestDirection: string
  verifiedBkToExt?: Verified
  verifiedExtToBk?: Verified
}
type BitkubSymbolInfo = { base_asset?: string; name?: string; source?: MarketSource; symbol?: string }
type TopMarketRow = { symbol: string; bkSymbol: string; name: string; marketSource: MarketSource; last: number; bkAsk: number; bkBid: number; percentChange: number; quoteVolume: number; avg30dayVolume: number | null; median30dayVolume: number | null; mean30dayVolume: number | null; historyDays: number }

const BITKUB_FEE = 0.0025
const BINANCE_FEE = 0.001
const MEXC_FEE = 0
const GATE_FEE = 0.002
const COINBASE_FEE = 0.006
const DEFAULT_MIN_BK_VOL = 2000
const DEFAULT_EXT_VOL = 3000
const DEFAULT_GAP_BK_TO_EXT = 1.3
const DEFAULT_GAP_EXT_TO_BK = 1.5
const TOP_MARKET_LIMIT = 50
const DO_NOT_CHECK = new Set(['NEIRO', 'GT', 'ELIZAOS', 'CLEAR', 'OMNI'])
const FORCE_COINBASE_SYMBOLS = new Set(['IOTX', 'PERP', 'L3', 'ABT'])
const COINBASE_PRODUCT_IDS: Record<string, string> = { IOTX: 'IOTX-USD', PERP: 'PERP-USD', L3: 'L3-USD', ABT: 'ABT-USD' }
const SPECIAL_GAPS: Record<string, number> = {
  ZIL: 1.0, DOGE: 1.0, ETH: 1.0, ALPHA: 1.5, LUNC: 1.3, SQD: 2, MNT: 0.7, ZENT: 2.2,
  SNX: 2.0, AXS: 2.0, SPEC: 5.0, LYX: 3.0, ADA: 2.1, XMN: 3.3,
  MBX: 2.0, PYTH: 2.0, ORDER: 2.0, APT: 2.0, SIX: 15.0, PLN: 3.0, ABT: 2.0, L3: 2,
  TRAC: 3.0, UMA: 3.0, SUI: 2.0, ASP: 1.5, WOO: 2.0, HNT: 3.0, SAND: 2.0, CTXC: 20,
  BENQI: 2, XAUT: 1, PLUME: 1.5, RECALL: 1.3, HEMI: 2.3, EL: 5, PENGU: 0.8, BONK: 0.8,
  EDEN: 2, DMC: 3, FRAX: 2.3, BAL: 5, LA: 3, ZRC: 3, PERP: 2.13, IOTX: 3, PRCL: 3,
  RLUSD: 1.0, RDNT: 50, LM: 1.5,
}
const STD_TO_BK: Record<string, string> = { LUNC: 'LUNA', VELODROME: 'VELO', BENQI: 'QI', POWR: 'POW', ALTLAYER: 'ALT', S: 'FTM', PUFFER: 'PUFFR', FRAX: 'FXS', BEAMX: 'BEAM' }
const BK_TO_STD = Object.fromEntries(Object.entries(STD_TO_BK).map(([std, bk]) => [bk, std])) as Record<string, string>

function clean(v: unknown) { return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') }
function toBk(s: string) { return STD_TO_BK[s] ?? s }
function toStd(s: string) { return BK_TO_STD[s] ?? s }
function n(v: unknown) { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null }
function num(v: unknown) { const x = Number(v); return Number.isFinite(x) ? x : null }
function firstNum(...values: unknown[]) { for (const v of values) { const x = n(v); if (x) return x } return null }
function firstFinite(...values: unknown[]) { for (const v of values) { const x = num(v); if (x !== null) return x } return null }
function clamp(raw: string | null, fallback: number, min: number, max: number) { const x = Number(raw); return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback }
function gap(sell: number, buy: number) { return ((sell - buy) / buy) * 100 }
function coinbaseProductId(symbol: string) { const s = clean(symbol); return COINBASE_PRODUCT_IDS[s] ?? `${s}-USD` }

async function j<T>(url: string, timeoutMs: number, logs: string[]): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: { accept: 'application/json' } })
    if (!res.ok) { logs.push(`${url} HTTP ${res.status}`); return null }
    return await res.json() as T
  } catch (err) {
    logs.push(`${url} ${err instanceof Error ? err.message : String(err)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0
  async function runner() {
    for (;;) {
      const i = index++
      if (i >= items.length) return
      await worker(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
}

function parseGaps(raw: string | null, logs: string[]) {
  if (!raw) return SPECIAL_GAPS
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const out = { ...SPECIAL_GAPS }
    for (const [k, v] of Object.entries(obj)) {
      const symbol = clean(k)
      const value = n(v)
      if (symbol && value) out[symbol] = value
    }
    return out
  } catch (err) {
    logs.push(`specialGaps parse failed: ${err instanceof Error ? err.message : String(err)}`)
    return SPECIAL_GAPS
  }
}

function buildSymbolInfoMap(data: { error?: number; result?: BitkubSymbolInfo[] } | null) {
  const map = new Map<string, { name: string; source: MarketSource }>()
  for (const item of data?.result ?? []) {
    const source = item.source ?? 'unknown'
    const name = String(item.name ?? '')
    const keys = new Set<string>()
    const base = clean(item.base_asset)
    if (base) keys.add(toStd(base))
    const symbol = String(item.symbol ?? '').toUpperCase()
    for (const part of symbol.split('_')) {
      const key = toStd(clean(part))
      if (key && key !== 'THB') keys.add(key)
    }
    for (const key of keys) map.set(key, { name, source })
  }
  return map
}

function buildTop24hLists(bkTicker: Record<string, Record<string, unknown>>, symbolInfo: Map<string, { name: string; source: MarketSource }>) {
  const rows: TopMarketRow[] = []
  let brokerExcluded = 0
  let unknownExcluded = 0
  for (const [market, bk] of Object.entries(bkTicker)) {
    if (!market.startsWith('THB_') || market === 'THB_USDT') continue
    const bkSymbol = clean(market.split('_')[1])
    const symbol = toStd(bkSymbol)
    if (!symbol || DO_NOT_CHECK.has(symbol)) continue
    const info = symbolInfo.get(symbol)
    if (info?.source === 'broker') { brokerExcluded += 1; continue }
    if (info?.source !== 'exchange') { unknownExcluded += 1; continue }
    const last = firstNum(bk.last, bk.lastPrice, bk.last_price)
    const bkAsk = firstNum(bk.lowestAsk, bk.lowest_ask, bk.ask)
    const bkBid = firstNum(bk.highestBid, bk.highest_bid, bk.bid)
    const percentChange = firstFinite(bk.percentChange, bk.percent_change, bk.changePercent, bk.change_percent)
    const quoteVolume = firstNum(bk.quoteVolume, bk.quote_volume, bk.volumeQuote, bk.volume_quote)
    if (!last || !bkAsk || !bkBid || percentChange === null || !quoteVolume) continue
    rows.push({ symbol, bkSymbol, name: info.name || symbol, marketSource: info.source, last, bkAsk, bkBid, percentChange, quoteVolume, avg30dayVolume: null, median30dayVolume: null, mean30dayVolume: null, historyDays: 0 })
  }
  return { topGainers: [...rows].sort((a, b) => b.percentChange - a.percentChange).slice(0, TOP_MARKET_LIMIT), topVolumes: [...rows].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, TOP_MARKET_LIMIT), brokerExcluded, unknownExcluded }
}

function calcVwap(levels: [unknown, unknown][], usdtThb: number, targetThb: number) {
  let need = targetThb, totalCoin = 0, totalThb = 0
  for (const [priceRaw, qtyRaw] of levels) {
    const priceUsd = n(priceRaw), qty = n(qtyRaw)
    if (!priceUsd || !qty) continue
    const priceThb = priceUsd * usdtThb, levelThb = priceThb * qty, takeThb = Math.min(levelThb, need)
    totalCoin += takeThb / priceThb
    totalThb += takeThb
    need -= takeThb
    if (need <= 0) break
  }
  if (totalThb < targetThb || totalCoin <= 0) return null
  return { priceThb: totalThb / totalCoin, volumeThb: totalThb }
}

async function verifyBk(symbol: string, side: Side, minVol: number, logs: string[]) {
  const bk = toBk(clean(symbol))
  const data = await j<{ error?: number; result?: Record<Side, [unknown, unknown][]> }>(`https://api.bitkub.com/api/v3/market/depth?sym=${bk}_THB&lmt=10`, 2500, logs)
  if (!data || data.error !== 0) return null
  for (const [pRaw, aRaw] of data.result?.[side] ?? []) {
    const price = n(pRaw), amount = n(aRaw)
    if (!price || !amount) continue
    const volumeThb = price * amount
    if (volumeThb >= minVol) return { price, volumeThb }
  }
  return null
}

async function binanceVwap(symbol: string, side: Side, usdtThb: number, target: number, logs: string[]) { const data = await j<Record<Side, [unknown, unknown][]>>(`https://api.binance.com/api/v3/depth?symbol=${clean(symbol)}USDT&limit=50`, 2500, logs); return calcVwap(data?.[side] ?? [], usdtThb, target) }
async function mexcVwap(symbol: string, side: Side, usdtThb: number, target: number, logs: string[]) { const data = await j<Record<Side, [unknown, unknown][]>>(`https://api.mexc.com/api/v3/depth?symbol=${clean(symbol)}USDT&limit=50`, 2500, logs); return calcVwap(data?.[side] ?? [], usdtThb, target) }
async function gateVwap(symbol: string, side: Side, usdtThb: number, target: number, logs: string[]) { const data = await j<Record<Side, [unknown, unknown][]>>(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${clean(symbol)}_USDT&limit=50`, 2500, logs); return calcVwap(data?.[side] ?? [], usdtThb, target) }
async function coinbaseVwap(symbol: string, side: Side, usdtThb: number, target: number, logs: string[]) { const data = await j<Record<Side, [unknown, unknown][]>>(`https://api.exchange.coinbase.com/products/${coinbaseProductId(symbol)}/book?level=2`, 2500, logs); return calcVwap(data?.[side] ?? [], usdtThb, target) }
async function sourceVwap(symbol: string, source: Source, side: Side, usdtThb: number, target: number, logs: string[]) { if (source === 'Binance') return binanceVwap(symbol, side, usdtThb, target, logs); if (source === 'MEXC') return mexcVwap(symbol, side, usdtThb, target, logs); if (source === 'Gate.io') return gateVwap(symbol, side, usdtThb, target, logs); return coinbaseVwap(symbol, side, usdtThb, target, logs) }
function setByPriority(out: Map<string, ExtBook>, wanted: Set<string>, symbol: string, ask: unknown, bid: unknown, source: Source, fee: number) { const cleanSymbol = clean(symbol); if (!wanted.has(cleanSymbol) || out.has(cleanSymbol) || FORCE_COINBASE_SYMBOLS.has(cleanSymbol)) return; const askNum = n(ask), bidNum = n(bid); if (askNum && bidNum) out.set(cleanSymbol, { ask: askNum, bid: bidNum, source, fee }) }
function setCoinbaseForced(out: Map<string, ExtBook>, wanted: Set<string>, symbol: string, ask: unknown, bid: unknown) { const cleanSymbol = clean(symbol); if (!wanted.has(cleanSymbol) || !FORCE_COINBASE_SYMBOLS.has(cleanSymbol)) return; const askNum = n(ask), bidNum = n(bid); if (askNum && bidNum) out.set(cleanSymbol, { ask: askNum, bid: bidNum, source: 'Coinbase', fee: COINBASE_FEE }) }

async function externalBooks(bitkubSymbols: string[], logs: string[]) {
  const wanted = new Set(bitkubSymbols.map(clean).filter(Boolean))
  const out = new Map<string, ExtBook>()
  const forcedCoinbase = [...wanted].filter(symbol => FORCE_COINBASE_SYMBOLS.has(symbol))
  const [binance, mexc, gate, coinbaseTickers] = await Promise.all([
    j<Array<{ symbol?: string; askPrice?: string; bidPrice?: string }>>('https://api.binance.com/api/v3/ticker/bookTicker', 3500, logs),
    j<Array<{ symbol?: string; askPrice?: string; bidPrice?: string }>>('https://api.mexc.com/api/v3/ticker/bookTicker', 3500, logs),
    j<Array<{ currency_pair?: string; highest_bid?: string; lowest_ask?: string }>>('https://api.gateio.ws/api/v4/spot/tickers', 3500, logs),
    Promise.all(forcedCoinbase.map(async symbol => ({ symbol, data: await j<{ ask?: string; bid?: string; price?: string }>(`https://api.exchange.coinbase.com/products/${coinbaseProductId(symbol)}/ticker`, 2500, logs) }))),
  ])
  for (const row of binance ?? []) { const raw = row.symbol ?? ''; if (raw.endsWith('USDT')) setByPriority(out, wanted, raw.slice(0, -4), row.askPrice, row.bidPrice, 'Binance', BINANCE_FEE) }
  for (const row of mexc ?? []) { const raw = row.symbol ?? ''; if (raw.endsWith('USDT')) setByPriority(out, wanted, raw.slice(0, -4), row.askPrice, row.bidPrice, 'MEXC', MEXC_FEE) }
  for (const row of gate ?? []) { const pair = row.currency_pair ?? ''; if (pair.endsWith('_USDT')) setByPriority(out, wanted, pair.split('_')[0], row.lowest_ask, row.highest_bid, 'Gate.io', GATE_FEE) }
  for (const row of coinbaseTickers) { const ask = firstNum(row.data?.ask, row.data?.price); const bid = firstNum(row.data?.bid, row.data?.price); setCoinbaseForced(out, wanted, row.symbol, ask, bid) }
  logs.push(`Bitkub symbols checked: ${wanted.size}, external matched: ${out.size}, forced Coinbase: ${forcedCoinbase.join(',') || '-'}`)
  return out
}

export async function GET(request: NextRequest) {
  const started = Date.now()
  const logs: string[] = []
  const q = request.nextUrl.searchParams
  const minBkVol = clamp(q.get('minBkVol'), DEFAULT_MIN_BK_VOL, 100, 1_000_000)
  const extVol = clamp(q.get('extVol'), DEFAULT_EXT_VOL, 100, 1_000_000)
  const gapBkToExt = clamp(q.get('gapBkToExt'), DEFAULT_GAP_BK_TO_EXT, 0, 100)
  const gapExtToBk = clamp(q.get('gapExtToBk'), DEFAULT_GAP_EXT_TO_BK, 0, 100)
  const specialGaps = parseGaps(q.get('specialGaps'), logs)
  const [bkTicker, bkSymbolData] = await Promise.all([j<Record<string, Record<string, unknown>>>('https://api.bitkub.com/api/market/ticker', 3500, logs), j<{ error?: number; result?: BitkubSymbolInfo[] }>('https://api.bitkub.com/api/v3/market/symbols', 3500, logs)])
  const usdtThb = firstNum(bkTicker?.THB_USDT?.highestBid, bkTicker?.THB_USDT?.last)
  if (!bkTicker || !usdtThb) return NextResponse.json({ ok: false, ts: Date.now(), latencyMs: Date.now() - started, usdtThb: usdtThb ?? null, rows: [], topGainers: [], topVolumes: [], logs: ['Bitkub ticker or USDT price unavailable', ...logs] }, { headers: { 'Cache-Control': 'no-store' } })
  const symbolInfo = buildSymbolInfoMap(bkSymbolData)
  const { topGainers, topVolumes, brokerExcluded, unknownExcluded } = buildTop24hLists(bkTicker, symbolInfo)
  if (!bkSymbolData || bkSymbolData.error !== 0) logs.push('Bitkub symbols unavailable: 24H modes require source=exchange and may be empty')
  logs.push(`24H exchange-only lists: gainers=${topGainers.length}, volumes=${topVolumes.length}, broker excluded=${brokerExcluded}, unknown excluded=${unknownExcluded}`)
  logs.push('Avg30D is loaded separately and cached; scan does not call tradingview/history')
  const bitkubSymbols = Object.keys(bkTicker).filter(market => market.startsWith('THB_') && market !== 'THB_USDT').map(market => toStd(clean(market.split('_')[1]))).filter(symbol => symbol && !DO_NOT_CHECK.has(symbol))
  const extMap = await externalBooks(bitkubSymbols, logs)
  const rows: Row[] = []
  for (const [market, bk] of Object.entries(bkTicker)) {
    if (!market.startsWith('THB_') || market === 'THB_USDT') continue
    const bkSymbol = clean(market.split('_')[1])
    const symbol = toStd(bkSymbol)
    if (DO_NOT_CHECK.has(symbol)) continue
    const ext = extMap.get(symbol)
    if (!ext) continue
    const bkAsk = firstNum(bk.lowestAsk, bk.lowest_ask, bk.ask)
    const bkBid = firstNum(bk.highestBid, bk.highest_bid, bk.bid)
    if (!bkAsk || !bkBid) continue
    const extAskThb = ext.ask * usdtThb * (1 + ext.fee)
    const extBidThb = ext.bid * usdtThb * (1 - ext.fee)
    const bkBuy = bkAsk * (1 + BITKUB_FEE)
    const bkSell = bkBid * (1 - BITKUB_FEE)
    const bkToExtPct = gap(extBidThb, bkBuy)
    const extToBkPct = gap(bkSell, extAskThb)
    const targetBkToExt = specialGaps[symbol] ?? gapBkToExt
    const targetExtToBk = specialGaps[symbol] ?? gapExtToBk
    rows.push({ symbol, bkSymbol, source: ext.source, extFee: ext.fee, targetBkToExt, targetExtToBk, bkAsk, bkBid, extAskThb, extBidThb, bkToExtPct, extToBkPct, bestPct: Math.max(bkToExtPct, extToBkPct), bestDirection: bkToExtPct >= extToBkPct ? `Buy BK → Sell ${ext.source}` : `Buy ${ext.source} → Sell BK` })
  }
  const likely = rows.filter(r => r.bkToExtPct >= r.targetBkToExt || r.extToBkPct >= r.targetExtToBk).sort((a, b) => b.bestPct - a.bestPct).slice(0, 50)
  await mapLimit(likely, 10, async row => {
    if (row.bkToExtPct >= row.targetBkToExt) { const bk = await verifyBk(row.symbol, 'asks', minBkVol, logs); if (bk) { const buy = bk.price * (1 + BITKUB_FEE); const v = await sourceVwap(row.symbol, row.source, 'bids', usdtThb, extVol, logs); if (v) { const sell = v.priceThb * (1 - row.extFee); const pct = gap(sell, buy); if (pct >= row.targetBkToExt) row.verifiedBkToExt = { pct, buy, sell, bitkubVolumeThb: bk.volumeThb, externalVwapVolumeThb: v.volumeThb } } } }
    if (row.extToBkPct >= row.targetExtToBk) { const bk = await verifyBk(row.symbol, 'bids', minBkVol, logs); if (bk) { const sell = bk.price * (1 - BITKUB_FEE); const v = await sourceVwap(row.symbol, row.source, 'asks', usdtThb, extVol, logs); if (v) { const buy = v.priceThb * (1 + row.extFee); const pct = gap(sell, buy); if (pct >= row.targetExtToBk) row.verifiedExtToBk = { pct, buy, sell, bitkubVolumeThb: bk.volumeThb, externalVwapVolumeThb: v.volumeThb } } } }
  })
  const sorted = rows.sort((a, b) => Math.max(b.verifiedBkToExt?.pct ?? b.bkToExtPct, b.verifiedExtToBk?.pct ?? b.extToBkPct) - Math.max(a.verifiedBkToExt?.pct ?? a.bkToExtPct, a.verifiedExtToBk?.pct ?? a.extToBkPct))
  return NextResponse.json({ ok: true, ts: Date.now(), latencyMs: Date.now() - started, usdtThb, config: { minBitkubVolumeThb: minBkVol, externalVwapCheckThb: extVol, defaultGapBkToExt: gapBkToExt, defaultGapExtToBk: gapExtToBk }, rows: sorted, topGainers, topVolumes, brokerExcluded24h: brokerExcluded, logs: logs.slice(-80) }, { headers: { 'Cache-Control': 'no-store' } })
}
