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
type Row = { symbol: string; bkSymbol: string; source: Source; extFee: number; targetBkToExt: number; targetExtToBk: number; bkAsk: number; bkBid: number; extAskThb: number; extBidThb: number; bkToExtPct: number; extToBkPct: number; bestPct: number; bestDirection: string; verifiedBkToExt?: Verified; verifiedExtToBk?: Verified }
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
const TOP_MARKET_LIMIT = 500
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
function normalizedSource(value: unknown) { return String(value ?? '').trim().toLowerCase() }

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
    const source = normalizedSource(info?.source)
    if (source === 'broker') { brokerExcluded += 1; continue }
    if (!source) unknownExcluded += 1

    const last = firstNum(bk.last, bk.lastPrice, bk.last_price)
    const bkAsk = firstNum(bk.lowestAsk, bk.lowest_ask, bk.ask)
    const bkBid = firstNum(bk.highestBid, bk.highest_bid, bk.bid)
    const percentChange = firstFinite(bk.percentChange, bk.percent_change, bk.changePercent, bk.change_percent)
    const quoteVolume = firstNum(bk.quoteVolume, bk.quote_volume, bk.volumeQuote, bk.volume_quote)
    if (!last || !bkAsk || !bkBid || percentChange === null || !quoteVolume) continue

    rows.push({ symbol, bkSymbol, name: info?.name || symbol, marketSource: info?.source ?? 'unknown', last, bkAsk, bkBid, percentChange, quoteVolume, avg30dayVolume: null, median30dayVolume: null, mean30dayVolume: null, historyDays: 0 })
  }

  return { topGainers: [...rows].sort((a, b) => b.percentChange - a.percentChange).slice(0, TOP_MARKET_LIMIT), topVolumes: [...rows].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, TOP_MARKET_LIMIT), brokerExcluded, unknownExcluded }
}

function calcVwap(levels: [unknown, unknown][], usdtThb: number, targetThb: number) {
  let need = targetThb
  let totalCoin = 0
  let totalThb = 0
  for (const [priceRaw, qtyRaw] of levels) {
    const priceUsd = n(priceRaw)
    const qty = n(qtyRaw)
    if (!priceUsd || !qty) continue
    const priceThb = priceUsd * usdtThb
    const levelThb = priceThb * qty
    const takeThb = Math.min(levelThb, need)
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
function thresholdFor(symbol: string, custom: Record<string, number>, side: 'bkToExt' | 'extToBk', fallback: number) { const specific = custom[clean(symbol)]; if (!specific) return fallback; return side === 'bkToExt' ? Math.min(specific, fallback) : Math.max(specific, fallback) }

async function extBook(symbol: string, source: Source, usdtThb: number, logs: string[]): Promise<ExtBook | null> {
  const s = clean(symbol)
  if (source === 'Binance') { const data = await j<{ askPrice?: string; bidPrice?: string }>(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${s}USDT`, 2500, logs); const ask = n(data?.askPrice), bid = n(data?.bidPrice); return ask && bid ? { ask: ask * usdtThb, bid: bid * usdtThb, source, fee: BINANCE_FEE } : null }
  if (source === 'MEXC') { const data = await j<{ askPrice?: string; bidPrice?: string }>(`https://api.mexc.com/api/v3/ticker/bookTicker?symbol=${s}USDT`, 2500, logs); const ask = n(data?.askPrice), bid = n(data?.bidPrice); return ask && bid ? { ask: ask * usdtThb, bid: bid * usdtThb, source, fee: MEXC_FEE } : null }
  if (source === 'Gate.io') { const data = await j<{ lowest_ask?: string; highest_bid?: string }>(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${s}_USDT`, 2500, logs); const row = Array.isArray(data) ? data[0] : data; const ask = n(row?.lowest_ask), bid = n(row?.highest_bid); return ask && bid ? { ask: ask * usdtThb, bid: bid * usdtThb, source, fee: GATE_FEE } : null }
  const data = await j<{ best_ask?: string; best_bid?: string }>(`https://api.exchange.coinbase.com/products/${coinbaseProductId(s)}/ticker`, 2500, logs); const ask = n(data?.best_ask), bid = n(data?.best_bid); return ask && bid ? { ask: ask * usdtThb, bid: bid * usdtThb, source, fee: COINBASE_FEE } : null
}

async function getUsdtThb(logs: string[]) {
  const direct = await j<{ result?: Record<string, { last?: unknown }> }>('https://api.bitkub.com/api/market/ticker?sym=THB_USDT', 2500, logs)
  const directLast = firstNum(direct?.result?.THB_USDT?.last)
  if (directLast) return directLast
  const fallback = await j<{ result?: Record<string, { last?: unknown }> }>('https://api.bitkub.com/api/market/ticker', 3000, logs)
  return firstNum(fallback?.result?.THB_USDT?.last) ?? 36
}

export async function GET(request: NextRequest) {
  const started = Date.now()
  const logs: string[] = []
  const minBkVol = clamp(request.nextUrl.searchParams.get('minBkVol'), DEFAULT_MIN_BK_VOL, 100, 1_000_000)
  const extVol = clamp(request.nextUrl.searchParams.get('extVol'), DEFAULT_EXT_VOL, 100, 1_000_000)
  const defaultGapBkToExt = clamp(request.nextUrl.searchParams.get('gapBkToExt'), DEFAULT_GAP_BK_TO_EXT, 0.1, 100)
  const defaultGapExtToBk = clamp(request.nextUrl.searchParams.get('gapExtToBk'), DEFAULT_GAP_EXT_TO_BK, 0.1, 100)
  const specialGaps = parseGaps(request.nextUrl.searchParams.get('specialGaps'), logs)
  const [ticker, symbols, usdtThb] = await Promise.all([j<{ result?: Record<string, Record<string, unknown>> }>('https://api.bitkub.com/api/market/ticker', 3000, logs), j<{ error?: number; result?: BitkubSymbolInfo[] }>('https://api.bitkub.com/api/market/symbols', 3000, logs), getUsdtThb(logs)])
  const symbolInfo = buildSymbolInfoMap(symbols)
  const topLists = buildTop24hLists(ticker?.result ?? {}, symbolInfo)
  const rows: Row[] = []
  if (!usdtThb) logs.push('USDT/THB fallback failed')

  const candidates = Object.entries(ticker?.result ?? {}).map(([market, bk]) => {
    const fromKey = market.startsWith('THB_') ? clean(market.split('_')[1]) : ''
    const rawSymbol = clean((bk as { symbol?: unknown }).symbol)
    const bkSymbol = fromKey || (rawSymbol ? clean(String(rawSymbol).split('_').pop()) : '')
    return { bk, bkSymbol, symbol: toStd(bkSymbol) }
  }).filter((item) => item.bkSymbol && item.symbol && !DO_NOT_CHECK.has(item.symbol))

  await mapLimit(candidates, 8, async ({ bk, bkSymbol, symbol }) => {
    const ask = firstNum((bk as Record<string, unknown>).lowestAsk, (bk as Record<string, unknown>).lowest_ask, (bk as Record<string, unknown>).ask)
    const bid = firstNum((bk as Record<string, unknown>).highestBid, (bk as Record<string, unknown>).highest_bid, (bk as Record<string, unknown>).bid)
    if (!ask || !bid || !usdtThb) return
    const sources: Source[] = FORCE_COINBASE_SYMBOLS.has(symbol) ? ['Coinbase'] : ['Binance', 'MEXC', 'Gate.io']
    const books = await Promise.all(sources.map((source) => extBook(symbol, source, usdtThb, logs)))
    for (const book of books) {
      if (!book) continue
      const bkBuy = ask * (1 + BITKUB_FEE), bkSell = bid * (1 - BITKUB_FEE), extBuy = book.ask * (1 + book.fee), extSell = book.bid * (1 - book.fee)
      const bkToExtPct = gap(extSell, bkBuy), extToBkPct = gap(bkSell, extBuy)
      const targetBkToExt = thresholdFor(symbol, specialGaps, 'bkToExt', defaultGapBkToExt), targetExtToBk = thresholdFor(symbol, specialGaps, 'extToBk', defaultGapExtToBk)
      if (bkToExtPct < targetBkToExt && extToBkPct < targetExtToBk) continue
      const row: Row = { symbol, bkSymbol, source: book.source, extFee: book.fee, targetBkToExt, targetExtToBk, bkAsk: ask, bkBid: bid, extAskThb: book.ask, extBidThb: book.bid, bkToExtPct, extToBkPct, bestPct: Math.max(bkToExtPct, extToBkPct), bestDirection: bkToExtPct >= extToBkPct ? 'bkToExt' : 'extToBk' }
      const [bkToExtBk, bkToExtExt, extToBkExt, extToBkBk] = await Promise.all([bkToExtPct >= targetBkToExt ? verifyBk(symbol, 'asks', minBkVol, logs) : Promise.resolve(null), bkToExtPct >= targetBkToExt ? sourceVwap(symbol, book.source, 'bids', usdtThb, extVol, logs) : Promise.resolve(null), extToBkPct >= targetExtToBk ? sourceVwap(symbol, book.source, 'asks', usdtThb, extVol, logs) : Promise.resolve(null), extToBkPct >= targetExtToBk ? verifyBk(symbol, 'bids', minBkVol, logs) : Promise.resolve(null)])
      if (bkToExtBk && bkToExtExt) row.verifiedBkToExt = { pct: gap(bkToExtExt.priceThb, bkToExtBk.price), buy: bkToExtBk.price, sell: bkToExtExt.priceThb, bitkubVolumeThb: bkToExtBk.volumeThb, externalVwapVolumeThb: bkToExtExt.volumeThb }
      if (extToBkExt && extToBkBk) row.verifiedExtToBk = { pct: gap(extToBkBk.price, extToBkExt.priceThb), buy: extToBkExt.priceThb, sell: extToBkBk.price, bitkubVolumeThb: extToBkBk.volumeThb, externalVwapVolumeThb: extToBkExt.volumeThb }
      rows.push(row)
    }
  })

  rows.sort((a, b) => Math.max(b.verifiedBkToExt?.pct ?? -999, b.verifiedExtToBk?.pct ?? -999, b.bestPct) - Math.max(a.verifiedBkToExt?.pct ?? -999, a.verifiedExtToBk?.pct ?? -999, a.bestPct))
  return NextResponse.json({ ok: logs.length < 80, ts: Date.now(), latencyMs: Date.now() - started, usdtThb, config: { minBitkubVolumeThb: minBkVol, externalVwapCheckThb: extVol, defaultGapBkToExt, defaultGapExtToBk }, rows, ...topLists, logs: logs.slice(0, 80) }, { headers: { 'Cache-Control': 'no-store' } })
}
