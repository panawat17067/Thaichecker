'use client'

import { useEffect, useMemo, useState } from 'react'
import { analyzeTopPlayerLines, MAX_ANALYSIS_DEPTH, playableSquareNumber } from '@/lib/checkers/analysis'
import { chooseAlphaBetaMove, loadAlphaBetaWeights } from '@/lib/checkers/bot'
import { defaultWeights } from '@/lib/checkers/evaluate'
import {
  allCaptureStarts,
  applyMove,
  initBoard,
  jumpMoves,
  nextPlayer,
  stepMoves,
  winnerByPieces,
} from '@/lib/checkers/rules'
import type { BotEngine, BotLevel, Player, Pos, Weights } from '@/lib/checkers/types'

const RELEASE_NOTE = 'analysis: Thai 1-32 board notation'
type AnalysisMode = 'top5' | 'selected'

export default function Home() {
  const [board, setBoard] = useState(initBoard)
  const [turn, setTurn] = useState<Player>('black')
  const [selected, setSelected] = useState<Pos | null>(null)
  const [forced, setForced] = useState<Pos | null>(null)
  const [msg, setMsg] = useState('ตาดำเริ่มก่อน (Default)')
  const [starter, setStarter] = useState<Player>('black')
  const [botEnabled, setBotEnabled] = useState(true)
  const [humanSide, setHumanSide] = useState<Player>('black')
  const [botLevel, setBotLevel] = useState<BotLevel>('hard')
  const [customBotDepth, setCustomBotDepth] = useState(5)
  const [botEngine, setBotEngine] = useState<BotEngine>('alpha-beta')
  const [weights, setWeights] = useState<Weights>(defaultWeights)
  const [analysisEnabled, setAnalysisEnabled] = useState(true)
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('top5')
  const [analysisRequestedDepth, setAnalysisRequestedDepth] = useState(6)
  const [analysisRuntimeDepth, setAnalysisRuntimeDepth] = useState(1)
  const [analysisElapsedMs, setAnalysisElapsedMs] = useState(0)

  useEffect(() => {
    loadAlphaBetaWeights().then(setWeights)
  }, [])

  const captureStarts = useMemo(() => allCaptureStarts(board, turn), [board, turn])

  const analysisDepthLimit = Math.min(MAX_ANALYSIS_DEPTH, Math.max(1, Math.floor(analysisRequestedDepth)))
  const analysisPlayer = botEnabled ? humanSide : turn
  const analysisFrom = analysisMode === 'selected' ? selected : null
  const selectedPiece = selected ? board[selected.r]?.[selected.c] : null
  const canAnalyzeSelected = Boolean(selected && selectedPiece && selectedPiece.player === analysisPlayer)

  useEffect(() => {
    setAnalysisRuntimeDepth(1)
    setAnalysisElapsedMs(0)
  }, [board, selected, analysisMode, analysisRequestedDepth, analysisPlayer])

  useEffect(() => {
    if (!analysisEnabled) return
    const startedAt = Date.now() - analysisElapsedMs
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      setAnalysisElapsedMs(elapsed)
      setAnalysisRuntimeDepth((depth) => Math.min(analysisDepthLimit, depth + 1))
    }, 900)

    return () => window.clearInterval(timer)
  }, [analysisDepthLimit, analysisElapsedMs, analysisEnabled])

  const analysisLines = useMemo(() => {
    if (!analysisEnabled) return []
    if (analysisMode === 'selected' && !canAnalyzeSelected) return []
    return analyzeTopPlayerLines(board, analysisPlayer, weights, analysisRuntimeDepth, analysisMode === 'selected' ? 1 : 5, analysisFrom)
  }, [analysisEnabled, analysisFrom, analysisMode, analysisPlayer, analysisRuntimeDepth, board, canAnalyzeSelected, weights])

  const legalMoves = (from: Pos): Pos[] => {
    const piece = board[from.r][from.c]

    if (!piece || piece.player !== turn) return []
    if (forced && (forced.r !== from.r || forced.c !== from.c)) return []

    const jumps = jumpMoves(board, from)
    if (captureStarts.length > 0) return jumps

    return stepMoves(board, from)
  }

  const canSelect = (r: number, c: number) => {
    const piece = board[r][c]
    if (!piece || piece.player !== turn) return false
    if (forced && (forced.r !== r || forced.c !== c)) return false
    if (captureStarts.length > 0 && jumpMoves(board, { r, c }).length === 0) {
      return false
    }
    return true
  }

  const tapCell = (r: number, c: number) => {
    if (botEnabled && turn !== humanSide) return
    if (!selected) {
      if (canSelect(r, c)) setSelected({ r, c })
      return
    }

    const target = legalMoves(selected).find((m) => m.r === r && m.c === c)

    if (!target) {
      if (canSelect(r, c)) setSelected({ r, c })
      return
    }

    const { board: next, captured, promoted } = applyMove(board, selected, { r, c })
    const isJump = Boolean(captured)

    if (isJump && !promoted && jumpMoves(next, { r, c }).length > 0) {
      setBoard(next)
      setSelected({ r, c })
      setForced({ r, c })
      setMsg('กินต่อบังคับ')
      return
    }

    const nextTurn = nextPlayer(turn)
    const winner = winnerByPieces(next)

    setBoard(next)
    setSelected(null)
    setForced(null)
    setTurn(nextTurn)

    if (winner) {
      setMsg(winner === 'black' ? 'ดำชนะ' : 'ขาวชนะ')
    } else {
      setMsg(nextTurn === 'black' ? 'ตาดำ' : 'ตาขาว')
    }
  }

  useEffect(() => {
    if (!botEnabled || turn === humanSide || forced) return

    if (botEngine === 'deep-q') return
    const timer = setTimeout(() => {
      const next = chooseAlphaBetaMove(board, turn, botLevel, weights, customBotDepth)
      if (!next) {
        setMsg(turn === 'black' ? 'ขาวชนะ (ดำเดินไม่ได้)' : 'ดำชนะ (ขาวเดินไม่ได้)')
        return
      }
      const nextTurn = nextPlayer(turn)
      const winner = winnerByPieces(next)
      setBoard(next)
      setTurn(nextTurn)
      setSelected(null)
      setForced(null)
      if (winner) {
        setMsg(winner === 'black' ? 'ดำชนะ' : 'ขาวชนะ')
      } else {
        setMsg(nextTurn === 'black' ? 'ตาดำ' : 'ตาขาว')
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [board, botEnabled, botEngine, botLevel, customBotDepth, forced, humanSide, turn, weights])

  const reset = () => {
    setBoard(initBoard())
    setTurn(starter)
    setSelected(null)
    setForced(null)
    setAnalysisRuntimeDepth(1)
    setAnalysisElapsedMs(0)
    setMsg(starter === 'black' ? 'เริ่มใหม่: ตาดำก่อน (Default)' : 'เริ่มใหม่: ตาขาวก่อน')
  }

  const restartAnalysis = () => {
    setAnalysisRuntimeDepth(1)
    setAnalysisElapsedMs(0)
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-3 sm:p-4">
      <section className="mx-auto w-full max-w-[1200px] aspect-auto md:aspect-video bg-slate-900 rounded-2xl p-3 sm:p-4 md:p-6 shadow-2xl grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 md:gap-6">
        <div className="flex items-center justify-center">
          <div className="grid grid-cols-8 grid-rows-8 w-full max-w-[92vw] sm:max-w-[78vh] aspect-square border-4 border-amber-700 rounded-xl overflow-hidden touch-manipulation select-none">
            {board.map((row, r) =>
              row.map((cell, c) => {
                const dark = (r + c) % 2 === 1
                const squareNo = dark ? playableSquareNumber({ r, c }) : null
                const isSel = selected?.r === r && selected?.c === c
                const canMove = selected
                  ? legalMoves(selected).some((m) => m.r === r && m.c === c)
                  : false

                return (
                  <button
                    key={`${r}-${c}`}
                    onClick={() => tapCell(r, c)}
                    className={`relative min-h-[36px] ${
                      dark ? 'bg-amber-800' : 'bg-amber-100'
                    } ${
                      isSel
                        ? 'outline outline-4 outline-cyan-300 outline-offset-[-2px]'
                        : ''
                    }`}
                    aria-label={squareNo ? `ช่องเดิน ${squareNo}` : `ช่องว่าง ${r + 1}-${c + 1}`}
                  >
                    {squareNo && (
                      <span className="absolute right-1 top-1 z-20 rounded bg-black/30 px-1 text-[10px] font-bold leading-none text-amber-100 sm:text-xs">
                        {squareNo}
                      </span>
                    )}

                    {canMove && (
                      <span className="absolute inset-0 m-auto h-3.5 w-3.5 rounded-full bg-cyan-300/90" />
                    )}

                    {cell && (
                      <span
                        className={`absolute inset-[3px] sm:inset-1 rounded-full border-2 sm:border-4 ${
                          cell.player === 'black'
                            ? 'bg-neutral-900 border-neutral-700 text-yellow-300'
                            : 'bg-gray-100 border-gray-300 text-red-600'
                        } flex items-center justify-center font-bold text-base sm:text-xl`}
                      >
                        {cell.king ? '♛' : ''}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <aside className="bg-slate-800 rounded-xl p-4 space-y-3 text-sm">
          <h1 className="text-xl font-bold">โปรแกรมถอดหมากฮอสไทย</h1>
          <p>สถานะ: {msg}</p>
          <p>โฟกัสหลัก: ถอดหมาก วิเคราะห์ทางเดิน และทดลองเล่นกับบอท Alpha-Beta</p>
          <p>กติกา: เบี้ยเดินหน้า, บังคับกิน, กินต่อบังคับ, ฮอสเดินยาวและกินยาวตามแนวทแยง</p>
          <p className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            เลขบนกระดานแสดงเฉพาะช่องเดินจริง 1-32 ตามกระดานหมากฮอสไทย และตรงกับเส้นทางใน Thinking window เช่น 9 → 14
          </p>

          <div className="rounded-xl border border-cyan-400/50 bg-slate-950/60 p-3 shadow-lg shadow-cyan-950/40">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-cyan-200">Thinking window</p>
                <p className="text-xs text-slate-300">
                  {analysisMode === 'selected' ? 'ถอดเฉพาะหมากที่เลือก' : 'วิเคราะห์ 5 ทางเดินที่ดีที่สุด'} · depth {analysisRuntimeDepth}/{analysisDepthLimit} · {(analysisElapsedMs / 1000).toFixed(1)}s
                </p>
              </div>
              <button
                onClick={() => setAnalysisEnabled((value) => !value)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${analysisEnabled ? 'bg-cyan-500 text-black' : 'bg-slate-700 text-slate-200'}`}
              >
                {analysisEnabled ? 'ปิด' : 'เปิด'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="block">
                โหมดถอดหมาก
                <select
                  className="mt-1 w-full rounded bg-slate-700 p-2"
                  value={analysisMode}
                  onChange={(e) => setAnalysisMode(e.target.value as AnalysisMode)}
                >
                  <option value="top5">5 ทางเดินที่ดีที่สุด</option>
                  <option value="selected">เฉพาะตาที่เลือก</option>
                </select>
              </label>
              <label className="block">
                ความลึกวิเคราะห์
                <input
                  className="mt-1 w-full rounded bg-slate-700 p-2"
                  type="number"
                  min={1}
                  max={1000}
                  value={analysisRequestedDepth}
                  onChange={(e) => {
                    const nextDepth = Number(e.target.value)
                    if (!Number.isFinite(nextDepth)) return
                    setAnalysisRequestedDepth(Math.max(1, Math.min(1000, Math.floor(nextDepth))))
                  }}
                />
              </label>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span className="rounded-full bg-cyan-500/20 px-2 py-1 text-cyan-100">
                {analysisEnabled ? (analysisRuntimeDepth >= analysisDepthLimit ? 'คิดครบความลึก' : 'กำลังถอดหมาก') : 'ปิดการวิเคราะห์'}
              </span>
              <button onClick={restartAnalysis} className="rounded bg-slate-700 px-2 py-1 text-slate-100">
                คิดใหม่
              </button>
            </div>

            {analysisMode === 'selected' && !canAnalyzeSelected && analysisEnabled ? (
              <p className="mt-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-amber-200">
                แตะเลือกหมากของ{analysisPlayer === 'black' ? 'ดำ' : 'ขาว'}ก่อน เพื่อถอดเฉพาะตาเดินนั้น
              </p>
            ) : null}

            {!analysisEnabled ? (
              <p className="mt-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-slate-300">
                ปิด Thinking window แล้ว เปิดเมื่ออยากถอดหมากเท่านั้น
              </p>
            ) : analysisLines.length === 0 ? (
              <p className="mt-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-amber-200">
                ไม่มีทางเดินที่วิเคราะห์ได้ในตำแหน่งนี้
              </p>
            ) : (
              <ol className="mt-2 space-y-2">
                {analysisLines.map((line, index) => (
                  <li key={`${line.pathLabel}-${index}-${analysisRuntimeDepth}`} className="rounded-lg bg-slate-900 p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-100">#{index + 1} {line.pathLabel}</span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-bold ${
                          line.winChance >= 70
                            ? 'bg-emerald-500/20 text-emerald-200'
                            : line.winChance <= 30
                              ? 'bg-red-500/20 text-red-200'
                              : 'bg-amber-500/20 text-amber-200'
                        }`}
                      >
                        {line.winChance}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                      <div className="h-full rounded-full bg-cyan-300 transition-all duration-300" style={{ width: `${line.winChance}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      ตัวเลขเปลี่ยนตามเวลาที่คิดลึกขึ้น · 100% แสดงเฉพาะเมื่อเจอเส้นชนะชัดเจน
                    </p>
                  </li>
                ))}
              </ol>
            )}

            {analysisRequestedDepth > MAX_ANALYSIS_DEPTH ? (
              <p className="mt-2 text-xs text-amber-200">
                ตั้งไว้ {analysisRequestedDepth} แต่ Thinking window จำกัดการแสดงสดที่ depth {MAX_ANALYSIS_DEPTH} เพื่อกันเครื่องค้าง
              </p>
            ) : null}
          </div>

          <p className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-emerald-200">
            อัปเดตล่าสุด: <span className="font-semibold">{RELEASE_NOTE}</span>
          </p>

          <label className="block">
            เริ่มก่อน
            <select
              className="mt-1 w-full rounded bg-slate-700 p-2"
              value={starter}
              onChange={(e) => setStarter(e.target.value as Player)}
            >
              <option value="black">ดำเดินก่อน (Default)</option>
              <option value="white">ขาวเดินก่อน</option>
            </select>
          </label>

          <label className="block">
            โหมด
            <select
              className="mt-1 w-full rounded bg-slate-700 p-2"
              value={botEnabled ? 'bot' : 'human'}
              onChange={(e) => setBotEnabled(e.target.value === 'bot')}
            >
              <option value="bot">ถอดหมาก + ทดลองกับบอท</option>
              <option value="human">ถอดหมาก / คน vs คน</option>
            </select>
          </label>

          {botEnabled && (
            <>
              <label className="block">
                ฝั่งผู้เล่น
                <select
                  className="mt-1 w-full rounded bg-slate-700 p-2"
                  value={humanSide}
                  onChange={(e) => setHumanSide(e.target.value as Player)}
                >
                  <option value="black">เดินก่อน (ดำ)</option>
                  <option value="white">เดินหลัง (ขาว)</option>
                </select>
              </label>

              <label className="block">
                เอนจินวิเคราะห์/บอท
                <select
                  className="mt-1 w-full rounded bg-slate-700 p-2"
                  value={botEngine}
                  onChange={(e) => setBotEngine(e.target.value as BotEngine)}
                >
                  <option value="alpha-beta">Alpha-Beta Pruning (พร้อมใช้)</option>
                  <option value="deep-q">Deep Q-Learning (ยังไม่พบแหล่งพร้อมใช้)</option>
                </select>
              </label>

              <label className="block">
                ระดับบอททดลองเล่น
                <select
                  className="mt-1 w-full rounded bg-slate-700 p-2"
                  value={botLevel}
                  onChange={(e) => setBotLevel(e.target.value as BotLevel)}
                >
                  <option value="easy">ง่าย (depth 1)</option>
                  <option value="normal">ปกติ (depth 3)</option>
                  <option value="hard">ยาก (depth 5)</option>
                  <option value="custom">ปรับเอง</option>
                </select>
              </label>

              {botLevel === 'custom' && (
                <label className="block">
                  Depth บอททดลองเล่น (1-1000)
                  <input
                    className="mt-1 w-full rounded bg-slate-700 p-2"
                    type="number"
                    min={1}
                    max={1000}
                    value={customBotDepth}
                    onChange={(e) => {
                      const nextDepth = Number(e.target.value)
                      if (!Number.isFinite(nextDepth)) return
                      setCustomBotDepth(Math.max(1, Math.min(1000, Math.floor(nextDepth))))
                    }}
                  />
                  <p className="mt-1 text-xs text-amber-200">
                    ค่า depth สูงมากอาจทำให้เครื่องช้า/ค้าง โดยเฉพาะบนมือถือ แนะนำ 6-8 ก่อน
                  </p>
                </label>
              )}
            </>
          )}

          <p className="text-cyan-300">แนะนำ: หมุนจอแนวนอนเพื่อเห็นกระดานเต็มขึ้น</p>

          <button
            onClick={reset}
            className="w-full py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-semibold"
          >
            ตั้งกระดานใหม่
          </button>

          <a
            className="underline text-cyan-300"
            href="https://www.playok.com/th/makhos/"
            target="_blank"
            rel="noreferrer"
          >
            เล่น/เทียบกติกากับ PlayOK
          </a>
        </aside>
      </section>
    </main>
  )
}
