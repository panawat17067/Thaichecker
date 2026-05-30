'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Verified = { pct: number; buy: number; sell: number; bitkubVolumeThb: number; externalVwapVolumeThb: number }
type Row = { symbol: string; bkSymbol: string; source: string; targetBkToExt: number; targetExtToBk: number; bkAsk: number; bkBid: number; extAskThb: number; extBidThb: number; bkToExtPct: number; extToBkPct: number; bestPct: number; bestDirection: string; verifiedBkToExt?: Verified; verifiedExtToBk?: Verified }
type TopMarketRow = { symbol: string; bkSymbol: string; name: string; marketSource: string; last: number; bkAsk: number; bkBid: number; percentChange: number; quoteVolume: number; avg30dayVolume: number | null; median30dayVolume: number | null; mean30dayVolume: number | null; historyDays: number }
type ScanResponse = { ok: boolean; ts: number; latencyMs: number; usdtThb: number | null; config?: { minBitkubVolumeThb: number; externalVwapCheckThb: number; defaultGapBkToExt: number; defaultGapExtToBk: number }; rows: Row[]; topGainers?: TopMarketRow[]; topVolumes?: TopMarketRow[]; brokerExcluded24h?: number; logs: string[] }
type Preset = { minBkVol: number; extVol: number; gapBkToExt: number; gapExtToBk: number; refreshMs: number; onlyVerified: boolean }
type ViewMode = 'arbitrage' | 'gainers' | 'volumes'
type Avg30d = { symbol: string; avg30dayVolume: number; median30dayVolume: number; mean30dayVolume: number; historyDays: number; cachedAt: number }

const DEFAULTS: Preset = { minBkVol: 2000, extVol: 3000, gapBkToExt: 1.3, gapExtToBk: 1.5, refreshMs: 2500, onlyVerified: false }
const AVG30D_CACHE_KEY = 'arb-avg30d-cache-v1'
const AVG30D_TTL_MS = 30 * 24 * 60 * 60 * 1000
const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })
const pctFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const volFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function pctClass(value: number) { if (value >= 3) return 'text-emerald-300'; if (value >= 1.5) return 'text-lime-300'; if (value >= 0) return 'text-amber-200'; return 'text-slate-500' }
function bestVerifiedPct(row: Row) { return Math.max(row.verifiedBkToExt?.pct ?? -999, row.verifiedExtToBk?.pct ?? -999) }
function bestVisiblePct(row: Row) { return Math.max(bestVerifiedPct(row), row.bkToExtPct, row.extToBkPct) }
function directionLabel(row: Row, side: 'bkToExt' | 'extToBk') { return side === 'bkToExt' ? `BK → ${row.source}` : `${row.source} → BK` }
function volumeText(value: number | null | undefined) { return value ? volFmt.format(value) : '-' }
function isFreshAvg(row?: Avg30d) { return !!row && Date.now() - row.cachedAt < AVG30D_TTL_MS }
function numberInput(value: number, set: (value: number) => void, step = 100) { return <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400" type="number" value={value} step={step} onChange={(event) => set(Number(event.target.value))} /> }
function modeButton(active: boolean, label: string, onClick: () => void) { return <button onClick={onClick} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${active ? 'border-cyan-300 bg-cyan-400 text-slate-950' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-400'}`}>{label}</button> }

export default function ArbitragePage() {
  const [settings, setSettings] = useState<Preset>(DEFAULTS)
  const [data, setData] = useState<ScanResponse | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(true)
  const [showLogs, setShowLogs] = useState(false)
  const [query, setQuery] = useState('')
  const [lastError, setLastError] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('arbitrage')
  const [avg30d, setAvg30d] = useState<Record<string, Avg30d>>({})
  const inFlight = useRef<AbortController | null>(null)
  const avgLoadingRef = useRef(false)

  useEffect(() => {
    const saved = window.localStorage.getItem('arb-settings-v1')
    if (saved) { try { setSettings({ ...DEFAULTS, ...JSON.parse(saved) }) } catch {} }
    const savedAvg = window.localStorage.getItem(AVG30D_CACHE_KEY)
    if (savedAvg) {
      try {
        const parsed = JSON.parse(savedAvg) as Record<string, Avg30d>
        const fresh = Object.fromEntries(Object.entries(parsed).filter(([, row]) => isFreshAvg(row)))
        setAvg30d(fresh)
      } catch {}
    }
  }, [])

  useEffect(() => { window.localStorage.setItem('arb-settings-v1', JSON.stringify(settings)) }, [settings])
  useEffect(() => { window.localStorage.setItem(AVG30D_CACHE_KEY, JSON.stringify(avg30d)) }, [avg30d])

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    params.set('minBkVol', String(settings.minBkVol || DEFAULTS.minBkVol))
    params.set('extVol', String(settings.extVol || DEFAULTS.extVol))
    params.set('gapBkToExt', String(settings.gapBkToExt || DEFAULTS.gapBkToExt))
    params.set('gapExtToBk', String(settings.gapExtToBk || DEFAULTS.gapExtToBk))
    return `/api/arbitrage/scan?${params.toString()}`
  }, [settings.extVol, settings.gapBkToExt, settings.gapExtToBk, settings.minBkVol])

  const scan = async () => {
    if (inFlight.current) inFlight.current.abort()
    const controller = new AbortController(); inFlight.current = controller; setLoading(true); setLastError('')
    try {
      const res = await fetch(apiUrl, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ScanResponse
      setData(json); setLogs((items) => [...json.logs, ...items].slice(0, 120))
      if (!json.ok) setLastError(json.logs?.[0] ?? 'API returned not ok')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : String(err)
      setLastError(msg); setLogs((items) => [`${new Date().toLocaleTimeString()} UI fetch error: ${msg}`, ...items].slice(0, 120))
    } finally { if (inFlight.current === controller) inFlight.current = null; setLoading(false) }
  }

  useEffect(() => { scan(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [apiUrl])
  useEffect(() => { if (!auto) return; const timer = window.setInterval(scan, Math.max(1200, settings.refreshMs || DEFAULTS.refreshMs)); return () => window.clearInterval(timer); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [auto, apiUrl, settings.refreshMs])

  useEffect(() => {
    const q = query.trim().toUpperCase()
    const querySymbol = q.replace(/[^A-Z0-9]/g, '')
    const top10 = (data?.topGainers ?? []).slice(0, 10).map((row) => row.symbol)
    const marketPool = [...(data?.topGainers ?? []), ...(data?.topVolumes ?? [])]
    const searched = q
      ? marketPool
          .filter((row) => row.symbol.includes(q) || row.name.toUpperCase().includes(q))
          .map((row) => row.symbol)
      : []
    const targets = Array.from(new Set([...(querySymbol ? [querySymbol] : []), ...searched, ...top10]))
    const missing = targets.filter((symbol) => !isFreshAvg(avg30d[symbol]))
    if (missing.length === 0) return
    avgLoadingRef.current = true
    let cancelled = false
    ;(async () => {
      for (const symbol of missing) {
        if (cancelled) break
        try {
          const res = await fetch(`/api/arbitrage/avg30d?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
          if (res.ok) {
            const json = await res.json() as { ok: boolean } & Avg30d
            if (json.ok && !cancelled) setAvg30d((cache) => ({ ...cache, [symbol]: { symbol, avg30dayVolume: json.avg30dayVolume, median30dayVolume: json.median30dayVolume, mean30dayVolume: json.mean30dayVolume, historyDays: json.historyDays, cachedAt: json.cachedAt || Date.now() } }))
          } else if (res.status === 429) {
            setLogs((items) => [`${new Date().toLocaleTimeString()} avg30d 429: stop loading more today`, ...items].slice(0, 120))
            break
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setLogs((items) => [`${new Date().toLocaleTimeString()} avg30d ${symbol}: ${msg}`, ...items].slice(0, 120))
        }
        if (!q) await new Promise((resolve) => window.setTimeout(resolve, 3500))
      }
      avgLoadingRef.current = false
    })()
    return () => { cancelled = true; avgLoadingRef.current = false }
  }, [data?.topGainers, data?.topVolumes, avg30d, query])

  const topGainersWithAvg = useMemo(() => (data?.topGainers ?? []).map((row, index) => {
    const stat = index < 10 || query.trim() ? avg30d[row.symbol] : undefined
    return stat ? { ...row, avg30dayVolume: stat.avg30dayVolume, median30dayVolume: stat.median30dayVolume, mean30dayVolume: stat.mean30dayVolume, historyDays: stat.historyDays } : row
  }), [data?.topGainers, avg30d, query])

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase()
    return (data?.rows ?? []).filter((row) => !q || row.symbol.includes(q) || row.source.toUpperCase().includes(q)).filter((row) => !settings.onlyVerified || row.verifiedBkToExt || row.verifiedExtToBk).sort((a, b) => bestVisiblePct(b) - bestVisiblePct(a))
  }, [data?.rows, query, settings.onlyVerified])

  const marketRows = useMemo(() => {
    const q = query.trim().toUpperCase()
    const source = viewMode === 'gainers' ? topGainersWithAvg : data?.topVolumes
    return (source ?? []).filter((row) => !q || row.symbol.includes(q) || row.name.toUpperCase().includes(q)).slice(0, 80)
  }, [topGainersWithAvg, data?.topVolumes, query, viewMode])

  const updatedAt = data?.ts ? new Date(data.ts).toLocaleTimeString() : '-'
  const topGainer = topGainersWithAvg[0]
  const topVolume = data?.topVolumes?.[0]

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100"><div className="mx-auto max-w-7xl px-3 py-4 sm:px-5 lg:px-6">
      <header className="mb-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-2xl shadow-black/30"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs uppercase tracking-[0.25em] text-cyan-300">Vercel Arbitrage Monitor</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">Bitkub Gap Real-time</h1><p className="mt-1 text-sm text-slate-400">Top 24H ตัด broker coin ออก · Avg30D โหลด Top 10 Gainer และเหรียญที่ค้นหา · จำไว้ 30 วัน</p></div><div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5">USDT/THB: {data?.usdtThb ? fmt.format(data.usdtThb) : '-'}</span><span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5">Updated: {updatedAt}</span><span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5">Latency: {data?.latencyMs ?? '-'} ms</span><span className={`rounded-full border px-3 py-1.5 ${loading ? 'border-cyan-500 text-cyan-200' : 'border-slate-700 text-slate-300'}`}>{loading ? 'Scanning...' : auto ? 'Auto' : 'Manual'}</span></div></div></header>
      <section className="mb-4 flex flex-wrap gap-2 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">{modeButton(viewMode === 'arbitrage', 'Arbitrage', () => setViewMode('arbitrage'))}{modeButton(viewMode === 'gainers', 'Top 24H Gainer', () => setViewMode('gainers'))}{modeButton(viewMode === 'volumes', 'Top 24H Volume', () => setViewMode('volumes'))}<span className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">24H excludes broker: {data?.brokerExcluded24h ?? 0}</span><span className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">Avg30D cache: {Object.keys(avg30d).length}</span></section>
      <section className="mb-4 grid gap-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-4 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto]"><label className="space-y-1 text-xs text-slate-400">Bitkub Vol THB{numberInput(settings.minBkVol, (v) => setSettings((s) => ({ ...s, minBkVol: v })))}</label><label className="space-y-1 text-xs text-slate-400">External VWAP THB{numberInput(settings.extVol, (v) => setSettings((s) => ({ ...s, extVol: v })))}</label><label className="space-y-1 text-xs text-slate-400">Gap BK → EXT %{numberInput(settings.gapBkToExt, (v) => setSettings((s) => ({ ...s, gapBkToExt: v })), 0.1)}</label><label className="space-y-1 text-xs text-slate-400">Gap EXT → BK %{numberInput(settings.gapExtToBk, (v) => setSettings((s) => ({ ...s, gapExtToBk: v })), 0.1)}</label><label className="space-y-1 text-xs text-slate-400">Refresh ms{numberInput(settings.refreshMs, (v) => setSettings((s) => ({ ...s, refreshMs: v })), 500)}</label><label className="space-y-1 text-xs text-slate-400">Search<input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="BTC / Binance" /></label><div className="flex flex-wrap items-end gap-2"><button onClick={scan} className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950">Scan</button><button onClick={() => setAuto((v) => !v)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200">{auto ? 'Stop' : 'Auto'}</button><button onClick={() => setSettings((s) => ({ ...s, onlyVerified: !s.onlyVerified }))} className={`rounded-xl border px-4 py-2 text-sm ${settings.onlyVerified ? 'border-emerald-400 text-emerald-200' : 'border-slate-700 text-slate-300'}`}>Verified</button></div></section>
      {lastError && <div className="mb-4 rounded-2xl border border-red-900 bg-red-950/60 p-3 text-sm text-red-200">{lastError}</div>}
      <section className="grid gap-4 lg:grid-cols-3"><div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4"><p className="text-sm text-slate-400">Top Gainer</p><p className="mt-1 text-2xl font-bold text-emerald-300">{topGainer?.symbol ?? '-'}</p><p className="text-sm text-slate-300">{topGainer ? `${pctFmt.format(topGainer.percentChange)}% · Vol ${volumeText(topGainer.quoteVolume)}` : '-'}</p></div><div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4"><p className="text-sm text-slate-400">Top Volume</p><p className="mt-1 text-2xl font-bold text-cyan-300">{topVolume?.symbol ?? '-'}</p><p className="text-sm text-slate-300">{topVolume ? `Vol ${volumeText(topVolume.quoteVolume)}` : '-'}</p></div><div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4"><p className="text-sm text-slate-400">Arb Rows</p><p className="mt-1 text-2xl font-bold text-amber-200">{rows.length}</p><p className="text-sm text-slate-300">Raw {data?.rows?.length ?? 0}</p></div></section>
      {viewMode === 'arbitrage' ? <section className="mt-4 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-950 text-xs uppercase text-slate-400"><tr><th className="px-3 py-3">Symbol</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">BK → EXT</th><th className="px-3 py-3">EXT → BK</th><th className="px-3 py-3">Verified</th><th className="px-3 py-3">Bid/Ask</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.symbol}-${row.source}`} className="border-t border-slate-800"><td className="px-3 py-3 font-bold text-white">{row.symbol}</td><td className="px-3 py-3 text-slate-300">{row.source}</td><td className={`px-3 py-3 font-semibold ${pctClass(row.bkToExtPct)}`}>{pctFmt.format(row.bkToExtPct)}%</td><td className={`px-3 py-3 font-semibold ${pctClass(row.extToBkPct)}`}>{pctFmt.format(row.extToBkPct)}%</td><td className="px-3 py-3 text-xs text-slate-300">{row.verifiedBkToExt ? `${directionLabel(row, 'bkToExt')} ${pctFmt.format(row.verifiedBkToExt.pct)}%` : row.verifiedExtToBk ? `${directionLabel(row, 'extToBk')} ${pctFmt.format(row.verifiedExtToBk.pct)}%` : '-'}</td><td className="px-3 py-3 text-xs text-slate-400">BK {fmt.format(row.bkBid)}/{fmt.format(row.bkAsk)} · EXT {fmt.format(row.extBidThb)}/{fmt.format(row.extAskThb)}</td></tr>)}</tbody></table></div></section> : <section className="mt-4 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-950 text-xs uppercase text-slate-400"><tr><th className="px-3 py-3">Rank</th><th className="px-3 py-3">Symbol</th><th className="px-3 py-3">Name</th><th className="px-3 py-3">24H %</th><th className="px-3 py-3">24H Vol</th><th className="px-3 py-3">30D Median</th><th className="px-3 py-3">30D Avg</th><th className="px-3 py-3">Last/Bid/Ask</th></tr></thead><tbody>{marketRows.map((row, index) => <tr key={`${viewMode}-${row.symbol}`} className="border-t border-slate-800"><td className="px-3 py-3 text-slate-500">#{index + 1}</td><td className="px-3 py-3 font-bold text-white">{row.symbol}</td><td className="px-3 py-3 text-slate-300">{row.name}</td><td className={`px-3 py-3 font-semibold ${pctClass(row.percentChange)}`}>{pctFmt.format(row.percentChange)}%</td><td className="px-3 py-3 text-cyan-200">{volumeText(row.quoteVolume)}</td><td className="px-3 py-3 text-slate-300">{volumeText(row.median30dayVolume)}</td><td className="px-3 py-3 text-slate-300">{volumeText(row.avg30dayVolume ?? row.mean30dayVolume)}</td><td className="px-3 py-3 text-xs text-slate-400">{fmt.format(row.last)} · {fmt.format(row.bkBid)}/{fmt.format(row.bkAsk)}</td></tr>)}</tbody></table></div></section>}
      <section className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-4"><button onClick={() => setShowLogs((v) => !v)} className="text-sm font-semibold text-cyan-300">{showLogs ? 'Hide logs' : 'Show logs'}</button>{showLogs && <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-400">{logs.join('\n')}</pre>}</section>
    </div></main>
  )
}
