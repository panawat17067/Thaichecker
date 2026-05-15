'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Verified = {
  pct: number
  buy: number
  sell: number
  bitkubVolumeThb: number
  externalVwapVolumeThb: number
}

type Row = {
  symbol: string
  bkSymbol: string
  source: string
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

type ScanResponse = {
  ok: boolean
  ts: number
  latencyMs: number
  usdtThb: number | null
  config?: {
    minBitkubVolumeThb: number
    externalVwapCheckThb: number
    defaultGapBkToExt: number
    defaultGapExtToBk: number
  }
  rows: Row[]
  logs: string[]
}

type Preset = {
  minBkVol: number
  extVol: number
  gapBkToExt: number
  gapExtToBk: number
  refreshMs: number
  onlyVerified: boolean
}

const DEFAULTS: Preset = {
  minBkVol: 2000,
  extVol: 3000,
  gapBkToExt: 1.3,
  gapExtToBk: 1.5,
  refreshMs: 2500,
  onlyVerified: false,
}

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })
const pctFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const volFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function pctClass(value: number) {
  if (value >= 3) return 'text-emerald-300'
  if (value >= 1.5) return 'text-lime-300'
  if (value >= 0) return 'text-amber-200'
  return 'text-slate-500'
}

function bestVerifiedPct(row: Row) {
  return Math.max(row.verifiedBkToExt?.pct ?? -999, row.verifiedExtToBk?.pct ?? -999)
}

function bestVisiblePct(row: Row) {
  return Math.max(bestVerifiedPct(row), row.bkToExtPct, row.extToBkPct)
}

function directionLabel(row: Row, side: 'bkToExt' | 'extToBk') {
  return side === 'bkToExt' ? `BK → ${row.source}` : `${row.source} → BK`
}

function numberInput(value: number, set: (value: number) => void, step = 100) {
  return (
    <input
      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
      type="number"
      value={value}
      step={step}
      onChange={(event) => set(Number(event.target.value))}
    />
  )
}

export default function ArbitragePage() {
  const [settings, setSettings] = useState<Preset>(DEFAULTS)
  const [data, setData] = useState<ScanResponse | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(true)
  const [showLogs, setShowLogs] = useState(false)
  const [query, setQuery] = useState('')
  const [lastError, setLastError] = useState('')
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    const saved = window.localStorage.getItem('arb-settings-v1')
    if (!saved) return
    try {
      setSettings({ ...DEFAULTS, ...JSON.parse(saved) })
    } catch {
      // ignore bad local storage
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('arb-settings-v1', JSON.stringify(settings))
  }, [settings])

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
    const controller = new AbortController()
    inFlight.current = controller
    setLoading(true)
    setLastError('')

    try {
      const res = await fetch(apiUrl, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ScanResponse
      setData(json)
      setLogs((items) => [...json.logs, ...items].slice(0, 120))
      if (!json.ok) setLastError(json.logs?.[0] ?? 'API returned not ok')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : String(err)
      setLastError(msg)
      setLogs((items) => [`${new Date().toLocaleTimeString()} UI fetch error: ${msg}`, ...items].slice(0, 120))
    } finally {
      if (inFlight.current === controller) inFlight.current = null
      setLoading(false)
    }
  }

  useEffect(() => {
    scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl])

  useEffect(() => {
    if (!auto) return
    const timer = window.setInterval(scan, Math.max(1200, settings.refreshMs || DEFAULTS.refreshMs))
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, apiUrl, settings.refreshMs])

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase()
    return (data?.rows ?? [])
      .filter((row) => !q || row.symbol.includes(q) || row.source.toUpperCase().includes(q))
      .filter((row) => !settings.onlyVerified || row.verifiedBkToExt || row.verifiedExtToBk)
      .sort((a, b) => bestVisiblePct(b) - bestVisiblePct(a))
  }, [data?.rows, query, settings.onlyVerified])

  const verifiedCount = rows.filter((row) => row.verifiedBkToExt || row.verifiedExtToBk).length
  const updatedAt = data?.ts ? new Date(data.ts).toLocaleTimeString() : '-'

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-5 lg:px-6">
        <header className="mb-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-300">Vercel Arbitrage Monitor</p>
              <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Bitkub Gap Real-time</h1>
              <p className="mt-1 text-sm text-slate-400">เปิดหน้าเว็บเมื่อไหร่ค่อยสแกน ไม่กินทรัพยากรเครื่องคุณ ไม่มี Telegram notify</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5">USDT/THB: {data?.usdtThb ? fmt.format(data.usdtThb) : '-'}</span>
              <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5">Updated: {updatedAt}</span>
              <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5">Latency: {data?.latencyMs ?? '-'} ms</span>
              <span className={`rounded-full border px-3 py-1.5 ${loading ? 'border-cyan-500 text-cyan-200' : 'border-slate-700 text-slate-300'}`}>{loading ? 'Scanning...' : auto ? 'Auto' : 'Manual'}</span>
            </div>
          </div>
        </header>

        <section className="mb-4 grid gap-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-4 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
          <label className="space-y-1 text-xs text-slate-400">Bitkub Vol THB{numberInput(settings.minBkVol, (v) => setSettings((s) => ({ ...s, minBkVol: v })))}</label>
          <label className="space-y-1 text-xs text-slate-400">External VWAP THB{numberInput(settings.extVol, (v) => setSettings((s) => ({ ...s, extVol: v })))}</label>
          <label className="space-y-1 text-xs text-slate-400">Gap BK → EXT %{numberInput(settings.gapBkToExt, (v) => setSettings((s) => ({ ...s, gapBkToExt: v })), 0.1)}</label>
          <label className="space-y-1 text-xs text-slate-400">Gap EXT → BK %{numberInput(settings.gapExtToBk, (v) => setSettings((s) => ({ ...s, gapExtToBk: v })), 0.1)}</label>
          <label className="space-y-1 text-xs text-slate-400">Refresh ms{numberInput(settings.refreshMs, (v) => setSettings((s) => ({ ...s, refreshMs: v })), 100)}</label>
          <label className="space-y-1 text-xs text-slate-400">
            Search
            <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="LM, ETH, MEXC" />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <button onClick={scan} className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-300">Scan</button>
            <button onClick={() => setAuto((v) => !v)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm hover:border-cyan-400">{auto ? 'Pause' : 'Auto'}</button>
            <button onClick={() => setSettings((s) => ({ ...s, onlyVerified: !s.onlyVerified }))} className={`rounded-xl border px-4 py-2 text-sm ${settings.onlyVerified ? 'border-emerald-400 text-emerald-200' : 'border-slate-700'}`}>Verified</button>
          </div>
        </section>

        <section className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-400">Pairs</p><p className="text-2xl font-bold">{rows.length}</p></div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-400">Verified</p><p className="text-2xl font-bold text-emerald-300">{verifiedCount}</p></div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-400">Top Gap</p><p className="text-2xl font-bold">{rows[0] ? `${pctFmt.format(bestVisiblePct(rows[0]))}%` : '-'}</p></div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-400">Status</p><p className={`text-lg font-bold ${lastError ? 'text-amber-300' : 'text-cyan-200'}`}>{lastError || 'OK'}</p></div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80 shadow-2xl shadow-black/30">
          <div className="overflow-x-auto">
            <table className="min-w-[1120px] w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Coin</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">BK → EXT</th>
                  <th className="px-4 py-3">EXT → BK</th>
                  <th className="px-4 py-3">Verified</th>
                  <th className="px-4 py-3">Buy</th>
                  <th className="px-4 py-3">Sell</th>
                  <th className="px-4 py-3">BK Vol</th>
                  <th className="px-4 py-3">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row) => {
                  const bestSide: 'bkToExt' | 'extToBk' = (row.verifiedBkToExt?.pct ?? row.bkToExtPct) >= (row.verifiedExtToBk?.pct ?? row.extToBkPct) ? 'bkToExt' : 'extToBk'
                  const verified = bestSide === 'bkToExt' ? row.verifiedBkToExt : row.verifiedExtToBk
                  const buy = verified?.buy ?? (bestSide === 'bkToExt' ? row.bkAsk * 1.0025 : row.extAskThb)
                  const sell = verified?.sell ?? (bestSide === 'bkToExt' ? row.extBidThb : row.bkBid * 0.9975)
                  const bkVol = verified?.bitkubVolumeThb
                  return (
                    <tr key={`${row.symbol}-${row.source}`} className="hover:bg-slate-800/60">
                      <td className="px-4 py-3"><div className="font-bold text-white">{row.symbol}</div><div className="text-xs text-slate-500">BK: {row.bkSymbol}</div></td>
                      <td className="px-4 py-3"><span className="rounded-full border border-slate-700 px-2 py-1 text-xs">{row.source}</span></td>
                      <td className={`px-4 py-3 font-bold ${pctClass(row.verifiedBkToExt?.pct ?? row.bkToExtPct)}`}>{pctFmt.format(row.verifiedBkToExt?.pct ?? row.bkToExtPct)}%</td>
                      <td className={`px-4 py-3 font-bold ${pctClass(row.verifiedExtToBk?.pct ?? row.extToBkPct)}`}>{pctFmt.format(row.verifiedExtToBk?.pct ?? row.extToBkPct)}%</td>
                      <td className="px-4 py-3">
                        {verified ? <div><div className="font-semibold text-emerald-300">{directionLabel(row, bestSide)}</div><div className="text-xs text-slate-400">VWAP {verified.externalVwapVolumeThb ? volFmt.format(verified.externalVwapVolumeThb) : '-'} THB</div></div> : <span className="text-slate-500">mock only</span>}
                      </td>
                      <td className="px-4 py-3">{fmt.format(buy)}</td>
                      <td className="px-4 py-3">{fmt.format(sell)}</td>
                      <td className="px-4 py-3">{bkVol ? `${volFmt.format(bkVol)} THB` : '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{row.targetBkToExt}% / {row.targetExtToBk}%</td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">ยังไม่มีข้อมูล หรือ exchange ปลายทางตอบช้า ลองกด Scan อีกครั้ง</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70">
          <button onClick={() => setShowLogs((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-300">
            <span>Background logs / errors</span>
            <span>{showLogs ? 'Hide' : 'Show'} ({logs.length})</span>
          </button>
          {showLogs && (
            <pre className="max-h-80 overflow-auto border-t border-slate-800 p-4 text-xs text-slate-400">{logs.length ? logs.join('\n') : 'No logs'}</pre>
          )}
        </section>
      </div>
    </main>
  )
}
