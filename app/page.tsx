'use client'

import { useEffect, useMemo, useState } from 'react'

type Player = 'black' | 'white'
type Piece = { player: Player; king: boolean }
type Pos = { r: number; c: number }
type BotLevel = 'normal' | 'expert'
type BotEngine = 'alpha-beta' | 'deep-q'

const BOARD = 8
const RELEASE_NOTE = 'fix: support Thai checkers rules'
const kingDirs = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

function initBoard() {
  const b: (Piece | null)[][] = Array.from({ length: BOARD }, () =>
    Array(BOARD).fill(null)
  )

  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < BOARD; c++) {
      if ((r + c) % 2 === 1) b[r][c] = { player: 'black', king: false }
    }
  }

  for (let r = 6; r < 8; r++) {
    for (let c = 0; c < BOARD; c++) {
      if ((r + c) % 2 === 1) b[r][c] = { player: 'white', king: false }
    }
  }

  return b
}

function clone(board: (Piece | null)[][]) {
  return board.map((row) => row.map((p) => (p ? { ...p } : null)))
}

const inb = (r: number, c: number) =>
  r >= 0 && r < BOARD && c >= 0 && c < BOARD

function manDirs(piece: Piece) {
  return piece.player === 'black'
    ? [
        [1, 1],
        [1, -1],
      ]
    : [
        [-1, 1],
        [-1, -1],
      ]
}

function jumpMoves(board: (Piece | null)[][], from: Pos): Pos[] {
  const piece = board[from.r][from.c]
  if (!piece) return []

  const out: Pos[] = []

  if (!piece.king) {
    for (const [dr, dc] of manDirs(piece)) {
      const mr = from.r + dr
      const mc = from.c + dc
      const tr = from.r + dr * 2
      const tc = from.c + dc * 2

      if (!inb(mr, mc) || !inb(tr, tc) || board[tr][tc]) continue

      const mid = board[mr][mc]
      if (mid && mid.player !== piece.player) out.push({ r: tr, c: tc })
    }

    return out
  }

  for (const [dr, dc] of kingDirs) {
    let r = from.r + dr
    let c = from.c + dc

    while (inb(r, c) && !board[r][c]) {
      r += dr
      c += dc
    }

    if (!inb(r, c)) continue

    const target = board[r][c]
    if (!target || target.player === piece.player) continue

    const landR = r + dr
    const landC = c + dc

    if (inb(landR, landC) && !board[landR][landC]) {
      out.push({ r: landR, c: landC })
    }
  }

  return out
}

function stepMoves(board: (Piece | null)[][], from: Pos): Pos[] {
  const piece = board[from.r][from.c]
  if (!piece) return []

  const out: Pos[] = []

  if (!piece.king) {
    for (const [dr, dc] of manDirs(piece)) {
      const nr = from.r + dr
      const nc = from.c + dc
      if (inb(nr, nc) && !board[nr][nc]) out.push({ r: nr, c: nc })
    }

    return out
  }

  for (const [dr, dc] of kingDirs) {
    let r = from.r + dr
    let c = from.c + dc

    while (inb(r, c) && !board[r][c]) {
      out.push({ r, c })
      r += dr
      c += dc
    }
  }

  return out
}

function allCaptureStarts(board: (Piece | null)[][], turn: Player): Pos[] {
  const starts: Pos[] = []

  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      const piece = board[r][c]
      if (
        piece &&
        piece.player === turn &&
        jumpMoves(board, { r, c }).length > 0
      ) {
        starts.push({ r, c })
      }
    }
  }

  return starts
}

function capturedBetween(
  board: (Piece | null)[][],
  from: Pos,
  to: Pos
): Pos | null {
  const dr = Math.sign(to.r - from.r)
  const dc = Math.sign(to.c - from.c)

  let r = from.r + dr
  let c = from.c + dc
  let found: Pos | null = null

  while (r !== to.r && c !== to.c) {
    if (board[r][c]) {
      if (found) return null
      found = { r, c }
    }

    r += dr
    c += dc
  }

  return found
}

function evaluate(board: (Piece | null)[][], root: Player) {
  let score = 0
  for (const p of board.flat()) {
    if (!p) continue
    const v = p.king ? 5 : 2
    score += p.player === root ? v : -v
  }
  return score
}

function buildTurns(board: (Piece | null)[][], turn: Player): (Piece | null)[][][] {
  const starts = allCaptureStarts(board, turn)

  const followJumps = (b: (Piece | null)[][], at: Pos): (Piece | null)[][][] => {
    const nextJumps = jumpMoves(b, at)
    if (nextJumps.length === 0) return [b]

    const out: (Piece | null)[][][] = []
    for (const t of nextJumps) {
      const nb = clone(b)
      const piece = nb[at.r][at.c]
      if (!piece) continue
      const captured = capturedBetween(nb, at, t)
      nb[at.r][at.c] = null
      nb[t.r][t.c] = piece
      if (captured) nb[captured.r][captured.c] = null

      if (
        !piece.king &&
        ((piece.player === 'black' && t.r === 7) ||
          (piece.player === 'white' && t.r === 0))
      ) {
        piece.king = true
        out.push(nb)
      } else {
        out.push(...followJumps(nb, t))
      }
    }

    return out
  }

  if (starts.length > 0) {
    return starts.flatMap((s) => followJumps(clone(board), s))
  }

  const out: (Piece | null)[][][] = []
  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      const piece = board[r][c]
      if (!piece || piece.player !== turn) continue
      for (const m of stepMoves(board, { r, c })) {
        const nb = clone(board)
        const moving = nb[r][c]
        if (!moving) continue
        nb[r][c] = null
        nb[m.r][m.c] = moving
        if (
          !moving.king &&
          ((moving.player === 'black' && m.r === 7) ||
            (moving.player === 'white' && m.r === 0))
        ) {
          moving.king = true
        }
        out.push(nb)
      }
    }
  }

  return out
}

function bestBoard(board: (Piece | null)[][], turn: Player, depth: number) {
  const enemy: Player = turn === 'black' ? 'white' : 'black'

  const search = (
    b: (Piece | null)[][],
    d: number,
    side: Player,
    alpha: number,
    beta: number
  ): number => {
    const moves = buildTurns(b, side)
    if (d === 0 || moves.length === 0) return evaluate(b, turn)

    if (side === turn) {
      let best = -Infinity
      for (const mv of moves) {
        best = Math.max(best, search(mv, d - 1, enemy, alpha, beta))
        alpha = Math.max(alpha, best)
        if (beta <= alpha) break
      }
      return best
    }

    let best = Infinity
    for (const mv of moves) {
      best = Math.min(best, search(mv, d - 1, turn, alpha, beta))
      beta = Math.min(beta, best)
      if (beta <= alpha) break
    }
    return best
  }

  const moves = buildTurns(board, turn)
  if (moves.length === 0) return null

  let bestScore = -Infinity
  let chosen = moves[0]
  for (const mv of moves) {
    const score = search(mv, depth - 1, enemy, -Infinity, Infinity)
    if (score > bestScore) {
      bestScore = score
      chosen = mv
    }
  }
  return chosen
}

export default function Home() {
  const [board, setBoard] = useState(initBoard)
  const [turn, setTurn] = useState<Player>('black')
  const [selected, setSelected] = useState<Pos | null>(null)
  const [forced, setForced] = useState<Pos | null>(null)
  const [msg, setMsg] = useState('ตาดำเริ่มก่อน (Default)')
  const [starter, setStarter] = useState<Player>('black')
  const [botEnabled, setBotEnabled] = useState(true)
  const [humanSide, setHumanSide] = useState<Player>('black')
  const [botLevel, setBotLevel] = useState<BotLevel>('expert')
  const [botEngine, setBotEngine] = useState<BotEngine>('alpha-beta')

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

    const next = clone(board)
    const piece = next[selected.r][selected.c]
    if (!piece) return

    const captured = capturedBetween(board, selected, { r, c })
    const isJump = Boolean(captured)

    next[selected.r][selected.c] = null
    next[r][c] = piece

    if (captured) {
      next[captured.r][captured.c] = null
    }

    let promoted = false

    if (
      !piece.king &&
      ((piece.player === 'black' && r === 7) ||
        (piece.player === 'white' && r === 0))
    ) {
      piece.king = true
      promoted = true
    }

    if (isJump && !promoted && jumpMoves(next, { r, c }).length > 0) {
      setBoard(next)
      setSelected({ r, c })
      setForced({ r, c })
      setMsg('กินต่อบังคับ')
      return
    }

    const nextTurn: Player = turn === 'black' ? 'white' : 'black'
    const blackLeft = next.flat().filter((p) => p?.player === 'black').length
    const whiteLeft = next.flat().filter((p) => p?.player === 'white').length

    setBoard(next)
    setSelected(null)
    setForced(null)
    setTurn(nextTurn)

    if (blackLeft === 0 || whiteLeft === 0) {
      setMsg(blackLeft === 0 ? 'ขาวชนะ' : 'ดำชนะ')
    } else {
      setMsg(nextTurn === 'black' ? 'ตาดำ' : 'ตาขาว')
    }
  }

  useEffect(() => {
    if (!botEnabled || turn === humanSide || forced) return

    if (botEngine === 'deep-q') return
    const timer = setTimeout(() => {
      const depth = botLevel === 'expert' ? 8 : 4
      const next = bestBoard(board, turn, depth)
      if (!next) {
        setMsg(turn === 'black' ? 'ขาวชนะ (ดำเดินไม่ได้)' : 'ดำชนะ (ขาวเดินไม่ได้)')
        return
      }
      const nextTurn: Player = turn === 'black' ? 'white' : 'black'
      const blackLeft = next.flat().filter((p) => p?.player === 'black').length
      const whiteLeft = next.flat().filter((p) => p?.player === 'white').length
      setBoard(next)
      setTurn(nextTurn)
      setSelected(null)
      setForced(null)
      if (blackLeft === 0 || whiteLeft === 0) {
        setMsg(blackLeft === 0 ? 'ขาวชนะ' : 'ดำชนะ')
      } else {
        setMsg(nextTurn === 'black' ? 'ตาดำ' : 'ตาขาว')
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [board, botEnabled, botEngine, botLevel, forced, humanSide, turn])

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
            หมายเหตุ: ตอนนี้มีเฉพาะ Alpha-Beta ที่พร้อมใช้ทันทีในเว็บนี้ ส่วน Deep Q-Learning ยังไม่พบโมเดลฝึกฟรีที่เชื่อถือได้สำหรับหมากฮอสไทย
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
                  <option value="deep-q">Deep Q-Learning (ยังไม่มีโมเดลฟรี)</option>
                </select>
              </label>

              <label className="block">
                ระดับ AI
                <select
                  className="mt-1 w-full rounded bg-slate-700 p-2"
                  value={botLevel}
                  onChange={(e) => setBotLevel(e.target.value as BotLevel)}
                >
                  <option value="expert">เก่งมาก (ค้นลึก)</option>
                  <option value="normal">ปกติ</option>
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
