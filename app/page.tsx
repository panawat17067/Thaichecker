'use client'

import { useEffect, useMemo, useState } from 'react'
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

const RELEASE_NOTE = 'fix: support Thai checkers rules'

const PUBLIC_AI_SOURCES = [
  {
    name: 'CU_Makhos (PyTorch, AlphaGo-style + minimax)',
    model: 'train_iter_268.pth.tar',
    url: 'https://github.com/51616/CU_Makhos',
  },
  {
    name: 'witchu/alphazero (Keras, AlphaZero-style)',
    model: 'model-45k.h5',
    url: 'https://github.com/witchu/alphazero',
  },
]

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
  const [botEngine, setBotEngine] = useState<BotEngine>('alpha-beta')
  const [weights, setWeights] = useState<Weights>(defaultWeights)

  useEffect(() => {
    loadAlphaBetaWeights().then(setWeights)
  }, [])

  const captureStarts = useMemo(() => allCaptureStarts(board, turn), [board, turn])

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
      const next = chooseAlphaBetaMove(board, turn, botLevel, weights)
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
  }, [board, botEnabled, botEngine, botLevel, forced, humanSide, turn, weights])

  const reset = () => {
    setBoard(initBoard())
    setTurn(starter)
    setSelected(null)
    setForced(null)
    setMsg(starter === 'black' ? 'เริ่มใหม่: ตาดำก่อน (Default)' : 'เริ่มใหม่: ตาขาวก่อน')
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-3 sm:p-4">
      <section className="mx-auto w-full max-w-[1200px] aspect-auto md:aspect-video bg-slate-900 rounded-2xl p-3 sm:p-4 md:p-6 shadow-2xl grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 md:gap-6">
        <div className="flex items-center justify-center">
          <div className="grid grid-cols-8 grid-rows-8 w-full max-w-[92vw] sm:max-w-[78vh] aspect-square border-4 border-amber-700 rounded-xl overflow-hidden touch-manipulation select-none">
            {board.map((row, r) =>
              row.map((cell, c) => {
                const dark = (r + c) % 2 === 1
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
                    aria-label={`ช่อง ${r + 1}-${c + 1}`}
                  >
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
          <h1 className="text-xl font-bold">หมากฮอสไทย</h1>
          <p>สถานะ: {msg}</p>
          <p>กติกา: เบี้ยเดินหน้า, บังคับกิน, กินต่อบังคับ, ฮอสเดินยาวและกินยาวตามแนวทแยง</p>
          <p className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-emerald-200">
            อัปเดตล่าสุด: <span className="font-semibold">{RELEASE_NOTE}</span>
          </p>
          <p className="text-xs text-amber-200">
            หมายเหตุ: ในเว็บนี้ใช้งานได้ทันทีเฉพาะ Alpha-Beta. จากการสำรวจยังไม่พบโมเดล Deep Q-Learning สาธารณะที่พร้อมใช้ตรงกับหมากฮอสไทย
          </p>
          <div className="rounded-md border border-slate-600 p-3 text-xs space-y-2">
            <p className="font-semibold text-slate-200">แหล่งโมเดลสาธารณะที่แนะนำ</p>
            {PUBLIC_AI_SOURCES.map((src) => (
              <a
                key={src.url}
                href={src.url}
                target="_blank"
                rel="noreferrer"
                className="block underline text-cyan-300"
              >
                {src.name} — {src.model}
              </a>
            ))}
          </div>

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
            โหมดเกม
            <select
              className="mt-1 w-full rounded bg-slate-700 p-2"
              value={botEnabled ? 'bot' : 'human'}
              onChange={(e) => setBotEnabled(e.target.value === 'bot')}
            >
              <option value="bot">เล่นกับบอท AI</option>
              <option value="human">คน vs คน</option>
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
                เอนจินบอท
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
                ระดับ AI
                <select
                  className="mt-1 w-full rounded bg-slate-700 p-2"
                  value={botLevel}
                  onChange={(e) => setBotLevel(e.target.value as BotLevel)}
                >
                  <option value="easy">ง่าย</option>
                  <option value="normal">ปกติ</option>
                  <option value="hard">ยาก</option>
                </select>
              </label>
            </>
          )}

          <p className="text-cyan-300">แนะนำ: หมุนจอแนวนอนเพื่อเห็นกระดานเต็มขึ้น</p>

          <button
            onClick={reset}
            className="w-full py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-semibold"
          >
            เริ่มเกมใหม่
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
