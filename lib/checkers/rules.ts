import type { Board, Piece, Player, Pos } from './types'

const BOARD_SIZE = 8
const KING_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

export function initBoard(): Board {
  const board: Board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null))

  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { player: 'black', king: false }
    }
  }

  for (let r = 6; r < 8; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { player: 'white', king: false }
    }
  }

  return board
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((p) => (p ? { ...p } : null)))
}

export function nextPlayer(turn: Player): Player {
  return turn === 'black' ? 'white' : 'black'
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE
}

function manDirs(piece: Piece): number[][] {
  return piece.player === 'black' ? [[1, 1], [1, -1]] : [[-1, 1], [-1, -1]]
}

export function jumpMoves(board: Board, from: Pos): Pos[] {
  const piece = board[from.r][from.c]
  if (!piece) return []
  const out: Pos[] = []

  if (!piece.king) {
    for (const [dr, dc] of manDirs(piece)) {
      const mr = from.r + dr
      const mc = from.c + dc
      const tr = from.r + dr * 2
      const tc = from.c + dc * 2
      if (!inBounds(mr, mc) || !inBounds(tr, tc) || board[tr][tc]) continue
      const mid = board[mr][mc]
      if (mid && mid.player !== piece.player) out.push({ r: tr, c: tc })
    }
    return out
  }

  for (const [dr, dc] of KING_DIRS) {
    let r = from.r + dr
    let c = from.c + dc
    while (inBounds(r, c) && !board[r][c]) {
      r += dr
      c += dc
    }
    if (!inBounds(r, c)) continue
    const target = board[r][c]
    if (!target || target.player === piece.player) continue
    const landR = r + dr
    const landC = c + dc
    if (inBounds(landR, landC) && !board[landR][landC]) out.push({ r: landR, c: landC })
  }

  return out
}

export function stepMoves(board: Board, from: Pos): Pos[] {
  const piece = board[from.r][from.c]
  if (!piece) return []
  const out: Pos[] = []

  if (!piece.king) {
    for (const [dr, dc] of manDirs(piece)) {
      const nr = from.r + dr
      const nc = from.c + dc
      if (inBounds(nr, nc) && !board[nr][nc]) out.push({ r: nr, c: nc })
    }
    return out
  }

  for (const [dr, dc] of KING_DIRS) {
    let r = from.r + dr
    let c = from.c + dc
    while (inBounds(r, c) && !board[r][c]) {
      out.push({ r, c })
      r += dr
      c += dc
    }
  }

  return out
}

export function allCaptureStarts(board: Board, turn: Player): Pos[] {
  const starts: Pos[] = []
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = board[r][c]
      if (piece && piece.player === turn && jumpMoves(board, { r, c }).length > 0) starts.push({ r, c })
    }
  }
  return starts
}

export function capturedBetween(board: Board, from: Pos, to: Pos): Pos | null {
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

export function applyMove(board: Board, from: Pos, to: Pos): { board: Board; promoted: boolean; captured: Pos | null } {
  const next = cloneBoard(board)
  const piece = next[from.r][from.c]
  if (!piece) return { board: next, promoted: false, captured: null }

  const captured = capturedBetween(board, from, to)
  next[from.r][from.c] = null
  next[to.r][to.c] = piece
  if (captured) next[captured.r][captured.c] = null

  let promoted = false
  if (!piece.king && ((piece.player === 'black' && to.r === 7) || (piece.player === 'white' && to.r === 0))) {
    piece.king = true
    promoted = true
  }

  return { board: next, promoted, captured }
}

export function winnerByPieces(board: Board): Player | null {
  const blackLeft = board.flat().filter((p) => p?.player === 'black').length
  const whiteLeft = board.flat().filter((p) => p?.player === 'white').length
  if (blackLeft === 0) return 'white'
  if (whiteLeft === 0) return 'black'
  return null
}
