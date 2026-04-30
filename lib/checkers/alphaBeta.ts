import { evaluateBoard } from './evaluate'
import {
  allCaptureStarts,
  applyMove,
  cloneBoard,
  jumpMoves,
  nextPlayer,
  stepMoves,
} from './rules'
import type { Board, Player, Pos, Weights } from './types'

export function buildTurns(board: Board, turn: Player): Board[] {
  const starts = allCaptureStarts(board, turn)

  const followJumps = (b: Board, at: Pos): Board[] => {
    const nextJumps = jumpMoves(b, at)
    if (nextJumps.length === 0) return [b]

    const out: Board[] = []
    for (const t of nextJumps) {
      const { board: nb, promoted } = applyMove(b, at, t)
      if (promoted) out.push(nb)
      else out.push(...followJumps(nb, t))
    }
    return out
  }

  if (starts.length > 0) {
    return starts.flatMap((s) => followJumps(cloneBoard(board), s))
  }

  const out: Board[] = []
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const piece = board[r][c]
      if (!piece || piece.player !== turn) continue
      for (const m of stepMoves(board, { r, c })) {
        out.push(applyMove(board, { r, c }, m).board)
      }
    }
  }
  return out
}

export function bestBoard(board: Board, turn: Player, depth: number, weights: Weights): Board | null {
  const enemy = nextPlayer(turn)

  const search = (b: Board, d: number, side: Player, alpha: number, beta: number): number => {
    const moves = buildTurns(b, side)
    if (d === 0 || moves.length === 0) return evaluateBoard(b, turn, weights)

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
