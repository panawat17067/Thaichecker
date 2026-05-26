import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 10

type History = { s?: string; c?: unknown[]; v?: unknown[] }
type Avg30d = {
  symbol: string
  avg30dayVolume: number
  median30dayVolume: number
  mean30dayVolume: number
  historyDays: number
  cachedAt: number
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const cache = new Map<string, Avg30d>()
const STD_TO_BK: Record<string, string> = { LUNC: 'LUNA', VELODROME: 'VELO', BENQI: 'QI', POWR: 'POW', ALTLAYER: 'ALT', S: 'FTM', PUFFER: 'PUFFR', FRAX: 'FXS', BEAMX: 'BEAM' }

function clean(v: unknown) { return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') }
function toBk(s: string) { return STD_TO_BK[s] ?? s }
function n(v: unknown) { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null }
function median(values: number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function fetchHistory(symbol: string) {
  const nowSec = Math.floor(Date.now() / 1000)
  const fromSec = nowSec - 35 * 24 * 60 * 60
  const pair = `${toBk(symbol)}_THB`
  const url = `https://api.bitkub.com/tradingview/history?symbol=${encodeURIComponent(pair)}&resolution=1D&from=${fromSec}&to=${nowSec}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3500)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'force-cache', headers: { accept: 'application/json' } })
    if (!res.ok) return { ok: false as const, status: res.status, data: null as History | null }
    return { ok: true as const, status: res.status, data: await res.json() as History }
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(request: NextRequest) {
  const symbol = clean(request.nextUrl.searchParams.get('symbol'))
  if (!symbol) return NextResponse.json({ ok: false, error: 'missing symbol' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })

  const cached = cache.get(symbol)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, ...cached }, { headers: { 'Cache-Control': 'private, max-age=2592000' } })
  }

  const history = await fetchHistory(symbol)
  if (!history.ok || history.data?.s !== 'ok') {
    return NextResponse.json({ ok: false, symbol, status: history.status, error: `history unavailable ${history.status}` }, { status: history.status === 429 ? 429 : 502, headers: { 'Cache-Control': 'no-store' } })
  }

  const closes = history.data.c ?? []
  const volumes = history.data.v ?? []
  const dailyThbVolumes: number[] = []
  for (let i = Math.max(0, volumes.length - 30); i < volumes.length; i += 1) {
    const close = n(closes[i])
    const volume = n(volumes[i])
    if (close && volume) dailyThbVolumes.push(close * volume)
  }

  const median30dayVolume = median(dailyThbVolumes)
  if (!median30dayVolume || dailyThbVolumes.length === 0) {
    return NextResponse.json({ ok: false, symbol, error: 'not enough history' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }

  const mean30dayVolume = dailyThbVolumes.reduce((sum, value) => sum + value, 0) / dailyThbVolumes.length
  const avg30dayVolume = median30dayVolume * 0.7 + mean30dayVolume * 0.3
  const result: Avg30d = { symbol, avg30dayVolume, median30dayVolume, mean30dayVolume, historyDays: dailyThbVolumes.length, cachedAt: Date.now() }
  cache.set(symbol, result)
  return NextResponse.json({ ok: true, cached: false, ...result }, { headers: { 'Cache-Control': 'private, max-age=2592000' } })
}
