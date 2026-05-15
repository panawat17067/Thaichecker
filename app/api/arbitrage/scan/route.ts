import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 10

type Side = 'asks' | 'bids'
type Source = 'MEXC' | 'Gate.io' | 'Binance' | 'OKX' | 'Coinbase'
type ExtBook = { ask: number; bid: number; source: Source; fee: number }
type Verified = { pct: number; buy: number; sell: number; bitkubVolumeThb: number; externalVwapVolumeThb: number }
type Row = {
  symbol: string
  bkSymbol: string
  source: Source
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

const BITKUB_FEE = 0.0025
const GATE_FEE = 0.002
const BINANCE_FEE = 0.001
const OKX_FEE = 0.001
const COINBASE_FEE = 0.006
const DEFAULT_MIN_BK_VOL = 2000
const DEFAULT_EXT_VOL = 3000
const DEFAULT_GAP_BK_TO_EXT = 1.3
const DEFAULT_GAP_EXT_TO_BK = 1.5
const DO_NOT_CHECK = new Set(['NEIRO', 'GT', 'ELIZAOS', 'CLEAR'])
const BINANCE_SYMBOLS = new Set(['RLUSD'])
const GATE_SPECIAL = ['XAUT_USDT', 'ALPHA_USDT', 'LM_USDT']
const COINBASE_SYMBOLS = ['IOTX', 'PERP', 'ABT', 'L3']
const SPECIAL_GAPS: Record<string, number> = {
  ZIL: 1.0, DOGE: 1.0, ETH: 1.0, ALPHA: 1.5, LUNC: 1.3, SQD: 2, MNT: 0.7, ZENT: 2.2,
  SNX: 2.0, AXS: 2.0, OMNI: 3.0, SPEC: 5.0, LYX: 3.0, ADA: 2.1, XMN: 3.3,
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
function firstNum(...values: unknown[]) { for (const v of values) { const x = n(v); if (x) return x } return null }
function clamp(raw: string | null, fallback: number, min: number, max: number) { const x = Number(raw); return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback }
function gap(sell: number, buy: number) { return ((sell - buy) / buy) * 100 }

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

function calcVwap(levels: [unknown, unknown][], usdtThb: number, targetThb: number) {
  let need = targetThb
  let totalCoin = 0
  let totalThb = 0
  for (const [priceRaw, qtyRaw] of levels) {
    const priceUsdt = n(priceRaw)
    const qty = n(qtyRaw)
    if (!priceUsdt || !qty) continue
    const priceThb = priceUsdt * usdtThb
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

async function mexcVwap(symbol: string, side: Side, usdtThb: number, target: number, logs: string[]) {
  const data = await j<Record<Side, [unknown, unknown][]>>(`https://api.mexc.com/api/v3/depth?symbol=${clean(symbol)}USDT&limit=50`, 2500, logs)
  return calcVwap(data?.[side] ?? [], usdtThb, target)
}

async function gateVwap(symbol: string, side: Side, usdtThb: number, target: number, logs: string[]) {
  const data = await j<Record<Side, [unknown, unknown][]>>(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${clean(symbol)}_USDT&limit=50`, 2500, logs)
  return calcVwap(data?.[side] ?? [], usdtThb, target)
}

async function externalBooks(logs: string[]) {
  const out = new Map<string, ExtBook>()
  const [mexc, binance, gate, okx, coinbase] = await Promise.all([
    j<Array<{ symbol?: string; askPrice?: string; bidPrice?: string }>>('https://api.mexc.com/api/v3/ticker/bookTicker', 3500, logs),
    j<Array<{ symbol?: string; askPrice?: string; bidPrice?: string }>>('https://api.binance.com/api/v3/ticker/bookTicker', 3500, logs),
    Promise.all(GATE_SPECIAL.map(async pair => ({ pair, data: await j<Array<{ highest_bid?: string; lowest_ask?: string }>>(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`, 2500, logs) }))),
    j<{ data?: Array<{ askPx?: string; bidPx?: string }> }>('https://www.okx.com/api/v5/market/ticker?instId=ETH-USDT', 2500, logs),
    Promise.all(COINBASE_SYMBOLS.map(async symbol => ({ symbol, data: await j<{ ask?: string; bid?: string; price?: string }>(`https://api.exchange.coinbase.com/products/${symbol}-USD/ticker`, 2500, logs) }))),
  ])

  for (const row of mexc ?? []) {
    const raw = row.symbol ?? ''
    if (!raw.endsWith('USDT')) continue
    const symbol = clean(raw.slice(0, -4))
    const ask = n(row.askPrice), bid = n(row.bidPrice)
    if (symbol && ask && bid) out.set(symbol, { ask, bid, source: 'MEXC', fee: 0 })
  }
  for (const row of binance ?? []) {
    const raw = row.symbol ?? ''
    if (!raw.endsWith('USDT')) continue
    const symbol = clean(raw.slice(0, -4))
    if (!BINANCE_SYMBOLS.has(symbol)) continue
    const ask = n(row.askPrice), bid = n(row.bidPrice)
    if (symbol && ask && bid) out.set(symbol, { ask, bid, source: 'Binance', fee: BINANCE_FEE })
  }
  for (const row of gate) {
    const symbol = clean(row.pair.split('_')[0])
    const first = row.data?.[0]
    const ask = n(first?.lowest_ask), bid = n(first?.highest_bid)
    if (symbol && ask && bid) out.set(symbol, { ask, bid, source: 'Gate.io', fee: GATE_FEE })
  }
  const eth = okx?.data?.[0]
  const ethAsk = n(eth?.askPx), ethBid = n(eth?.bidPx)
  if (ethAsk && ethBid) out.set('ETH', { ask: ethAsk, bid: ethBid, source: 'OKX', fee: OKX_FEE })
  for (const row of coinbase) {
    const ask = firstNum(row.data?.ask, row.data?.price), bid = firstNum(row.data?.bid, row.data?.price)
    if (ask && bid) out.set(row.symbol, { ask, bid, source: 'Coinbase', fee: COINBASE_FEE })
  }
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

  const [bkTicker, extMap] = await Promise.all([
    j<Record<string, Record<string, unknown>>>('https://api.bitkub.com/api/market/ticker', 3500, logs),
    externalBooks(logs),
  ])
  const usdtThb = firstNum(bkTicker?.THB_USDT?.highestBid, bkTicker?.THB_USDT?.last)

  if (!bkTicker || !usdtThb) {
    return NextResponse.json({ ok: false, ts: Date.now(), latencyMs: Date.now() - started, usdtThb: usdtThb ?? null, rows: [], logs: ['Bitkub ticker or USDT price unavailable', ...logs] }, { headers: { 'Cache-Control': 'no-store' } })
  }

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
    rows.push({
      symbol, bkSymbol, source: ext.source, targetBkToExt, targetExtToBk, bkAsk, bkBid, extAskThb, extBidThb,
      bkToExtPct, extToBkPct, bestPct: Math.max(bkToExtPct, extToBkPct),
      bestDirection: bkToExtPct >= extToBkPct ? `Buy BK → Sell ${ext.source}` : `Buy ${ext.source} → Sell BK`,
    })
  }

  const likely = rows.filter(r => r.bkToExtPct >= r.targetBkToExt || r.extToBkPct >= r.targetExtToBk).sort((a, b) => b.bestPct - a.bestPct).slice(0, 50)
  await mapLimit(likely, 10, async row => {
    if (row.bkToExtPct >= row.targetBkToExt) {
      const bk = await verifyBk(row.symbol, 'asks', minBkVol, logs)
      if (bk) {
        const buy = bk.price * (1 + BITKUB_FEE)
        let sell = row.extBidThb
        let extVwap = 0
        if (row.source === 'MEXC') { const v = await mexcVwap(row.symbol, 'bids', usdtThb, extVol, logs); if (!v) return; sell = v.priceThb; extVwap = v.volumeThb }
        if (row.source === 'Gate.io') { const v = await gateVwap(row.symbol, 'bids', usdtThb, extVol, logs); if (!v) return; sell = v.priceThb; extVwap = v.volumeThb }
        const pct = gap(sell, buy)
        if (pct >= row.targetBkToExt) row.verifiedBkToExt = { pct, buy, sell, bitkubVolumeThb: bk.volumeThb, externalVwapVolumeThb: extVwap }
      }
    }
    if (row.extToBkPct >= row.targetExtToBk) {
      const bk = await verifyBk(row.symbol, 'bids', minBkVol, logs)
      if (bk) {
        const sell = bk.price * (1 - BITKUB_FEE)
        let buy = row.extAskThb
        let extVwap = 0
        if (row.source === 'MEXC') { const v = await mexcVwap(row.symbol, 'asks', usdtThb, extVol, logs); if (!v) return; buy = v.priceThb; extVwap = v.volumeThb }
        if (row.source === 'Gate.io') { const v = await gateVwap(row.symbol, 'asks', usdtThb, extVol, logs); if (!v) return; buy = v.priceThb; extVwap = v.volumeThb }
        const pct = gap(sell, buy)
        if (pct >= row.targetExtToBk) row.verifiedExtToBk = { pct, buy, sell, bitkubVolumeThb: bk.volumeThb, externalVwapVolumeThb: extVwap }
      }
    }
  })

  const sorted = rows.sort((a, b) => Math.max(b.verifiedBkToExt?.pct ?? b.bkToExtPct, b.verifiedExtToBk?.pct ?? b.extToBkPct) - Math.max(a.verifiedBkToExt?.pct ?? a.bkToExtPct, a.verifiedExtToBk?.pct ?? a.extToBkPct))
  return NextResponse.json({
    ok: true,
    ts: Date.now(),
    latencyMs: Date.now() - started,
    usdtThb,
    config: { minBitkubVolumeThb: minBkVol, externalVwapCheckThb: extVol, defaultGapBkToExt: gapBkToExt, defaultGapExtToBk: gapExtToBk },
    rows: sorted.slice(0, 160),
    logs: logs.slice(-80),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
