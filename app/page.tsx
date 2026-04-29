'use client'

import { useMemo, useState } from 'react'

type Player = 'black' | 'white'
type Piece = { player: Player; king: boolean }
type Pos = { r: number; c: number }

const BOARD = 8

function initBoard() {
  const b: (Piece | null)[][] = Array.from({ length: BOARD }, () =>
    Array(BOARD).fill(null)
  )

  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < BOARD; c++) {
      if ((r + c) % 2 === 1) {
        b[r][c] = { player: 'black', king: false }
      }
    }
  }

  for (let r = 6; r < 8; r++) {
    for (let c = 0; c < BOARD; c++) {
      if ((r + c) % 2 === 1) {
        b[r][c] = { player: 'white', king: false }
      }
    }
  }

  return b
}

function clone(board: (Piece | null)[][]) {
  return board.map((row) => row.map((p) => (p ? { ...p } : null)))
}

const inb = (r: number, c: number) =>
  r >= 0 && r < BOARD && c >= 0 && c < BOARD

function dirs(piece: Piece) {
  if (piece.king) {
    return [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]
  }

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

  for (const [dr, dc] of dirs(piece)) {
    const mr = from.r + dr
    const mc = from.c + dc
    const tr = from.r + dr * 2
    const tc = from.c + dc * 2

    if (!inb(mr, mc) || !inb(tr, tc) || board[tr][tc]) continue

    const mid = board[mr][mc]

    if (mid && mid.player !== piece.player) {
      out.push({ r: tr, c: tc })
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

export default function Home() {
  const [board, setBoard] = useState(initBoard)
  const [turn, setTurn] = useState<Player>('black')
  const [selected, setSelected] = useState<Pos | null>(null)
  const [forced, setForced] = useState<Pos | null>(null)
  const [msg, setMsg] = useState('ตาดำเริ่มก่อน')

  const captureStarts = useMemo(() => allCaptureStarts(board, turn), [
    board,
    turn,
  ])

  const legalMoves = (from: Pos): Pos[] => {
    const piece = board[from.r][from.c]

    if (!piece || piece.player !== turn) return []
    if (forced && (forced.r !== from.r || forced.c !== from.c)) return []

    const jumps = jumpMoves(board, from)

    if (captureStarts.length > 0) return jumps

    const steps: Pos[] = []

    for (const [dr, dc] of dirs(piece)) {
      const nr = from.r + dr
      const nc = from.c + dc

      if (inb(nr, nc) && !board[nr][nc]) {
        steps.push({ r: nr, c: nc })
      }
    }

    return steps
  }

  const tapCell = (r: number, c: number) => {
    const here = board[r][c]

    if (!selected) {
      if (!here || here.player !== turn) return
      if (forced && (forced.r !== r || forced.c !== c)) return
      if (captureStarts.length > 0 && jumpMoves(board, { r, c }).length === 0)
        return

      setSelected({ r, c })
      return
    }

    const target = legalMoves(selected).find((m) => m.r === r && m.c === c)

    if (!target) {
      if (here && here.player === turn) {
        setSelected({ r, c })
      }
      return
    }

    const next = clone(board)
    const piece = next[selected.r][selected.c]

    if (!piece) return

    const isJump = Math.abs(r - selected.r) === 2

    next[selected.r][selected.c] = null
    next[r][c] = piece

    if (isJump) {
      next[(r + selected.r) / 2][(c + selected.c) / 2] = null
    }

    if (
      !piece.king &&
      ((piece.player === 'black' && r === 7) ||
        (piece.player === 'white' && r === 0))
    ) {
      piece.king = true
    }

    if (isJump && jumpMoves(next, { r, c }).length > 0) {
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

  const reset = () => {
    setBoard(initBoard())
    setTurn('black')
    setSelected(null)
    setForced(null)
    setMsg('เริ่มใหม่: ตาดำก่อน')
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
          <h1 className="text-xl font-bold">หมากฮอสไทย (เล่นบนมือถือได้)</h1>
          <p>สถานะ: {msg}</p>
          <p>กติกาที่รองรับ: เดินทแยง, บังคับกิน, และต้องกินต่อเมื่อกินได้ต่อ</p>
          <p className="text-cyan-300">
            แนะนำ: หมุนจอแนวนอนเพื่อเห็นกระดานเต็มขึ้น
          </p>

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
            อ้างอิงกติกา PlayOK
          </a>
        </aside>
      </section>
    </main>
  )
}
