import { evaluateBoard } from './evaluate'
import {
  allCaptureStarts,
  applyMove,
  cloneBoard,
  jumpMoves,
  nextPlayer,
  stepMoves,
  winnerByPieces,
} from './rules'
import type { Board, Player, Pos, Weights } from './types'

export type AnalysisLine = {
  path: Pos[]
  pathLabel: string
  score: number
  winChance: number
  verdict: 'win' | 'loss' | 'draw' | 'advantage'
}

type CandidateLine = {
  board: Board
  path: Pos[]
}

export const MAX_ANALYSIS_DEPTH = 12

export function playableSquareNumber(pos: Pos): number | null {
  if ((pos.r + pos.c) % 2 !== 1) return null
  return pos.r * 4 + Math.floor(pos.c / 2) + 1
}

function samePos(a: Pos, b: Pos): boolean {
  return a.r === b.r && a.c === b.c
}

function formatSquare(pos: Pos): string {
  return String(playableSquareNumber(pos) ?? `${pos.r + 1}-${pos.c + 1}`)
}

function formatPath(path: Pos[]): string {
  return path.map(formatSquare).join(' → ')
}

function buildCandidateLines(board: Board, turn: Player, onlyFrom?: Pos | null): CandidateLine[] {
  const starts = allCaptureStarts(board, turn)

  const followJumps = (b: Board, at: Pos, path: Pos[]): CandidateLine[] => {
    const nextJumps = jumpMoves(b, at)
    if (nextJumps.length === 0) return [{ board: b, path }]

    const out: CandidateLine[] = []
    for (const target of nextJumps) {
      const { board: nextBoard, promoted } = applyMove(b, at, target)
      const nextPath = [...path, target]
      if (promoted) out.push({ board: nextBoard, path: nextPath })
      else out.push(...followJumps(nextBoard, target, nextPath))
    }
    return out
  }

  if (starts.length > 0) {
    const filteredStarts = onlyFrom ? starts.filter((start) => samePos(start, onlyFrom)) : starts
    return filteredStarts.flatMap((start) => followJumps(cloneBoard(board), start, [start]))
  }

  const out: CandidateLine[] = []
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const from = { r, c }
      const piece = board[r][c]
      if (!piece || piece.player !== turn) continue
      if (onlyFrom && !samePos(from, onlyFrom)) continue
      for (const target of stepMoves(board, from)) {
        out.push({ board: applyMove(board, from, target).board, path: [from, target] })
      }
    }
  }
  return out
}

function terminalScore(board: Board, root: Player, depthLeft: number): number | null {
  const winner = winnerByPieces(board)
  if (winner === root) return 10_000 + depthLeft
  if (winner && winner !== root) return -10_000 - depthLeft
  return null
}

function searchScore(
  board: Board,
  root: Player,
  side: Player,
  depthLeft: number,
  weights: Weights,
  alpha: number,
  beta: number,
): number {
  const terminal = terminalScore(board, root, depthLeft)
  if (terminal !== null) return terminal

  const moves = buildCandidateLines(board, side)
  if (depthLeft === 0 || moves.length === 0) {
    if (moves.length === 0) return side === root ? -10_000 - depthLeft : 10_000 + depthLeft
    return evaluateBoard(board, root, weights)
  }

  if (side === root) {
    let best = -Infinity
    for (const move of moves) {
      best = Math.max(best, searchScore(move.board, root, nextPlayer(side), depthLeft - 1, weights, alpha, beta))
      alpha = Math.max(alpha, best)
      if (beta <= alpha) break
    }
    return best
  }

  let best = Infinity
  for (const move of moves) {
    best = Math.min(best, searchScore(move.board, root, nextPlayer(side), depthLeft - 1, weights, alpha, beta))
    beta = Math.min(beta, best)
    if (beta <= alpha) break
  }
  return best
}

function scoreToWinChance(score: number): { winChance: number; verdict: AnalysisLine['verdict'] } {
  if (score >= 9_000) return { winChance: 100, verdict: 'win' }
  if (score <= -9_000) return { winChance: 0, verdict: 'loss' }

  const raw = 50 + (Math.atan(score / 8) / Math.PI) * 100
  const bounded = Math.max(1, Math.min(99, Math.round(raw)))
  const verdict = Math.abs(bounded - 50) <= 3 ? 'draw' : 'advantage'
  return { winChance: verdict === 'draw' ? 50 : bounded, verdict }
}

export function analyzeTopPlayerLines(
  board: Board,
  player: Player,
  weights: Weights,
  requestedDepth: number,
  limit = 5,
  onlyFrom?: Pos | null,
): AnalysisLine[] {
  const depth = Math.max(1, Math.min(MAX_ANALYSIS_DEPTH, Math.floor(requestedDepth)))
  const candidates = buildCandidateLines(board, player, onlyFrom)

  return candidates
    .map((candidate) => {
      const terminal = terminalScore(candidate.board, player, depth)
      const score = terminal ?? searchScore(candidate.board, player, nextPlayer(player), depth - 1, weights, -Infinity, Infinity)
      const { winChance, verdict } = scoreToWinChance(score)
      return {
        path: candidate.path,
        pathLabel: formatPath(candidate.path),
        score,
        winChance,
        verdict,
      }
    })
    .sort((a, b) => b.winChance - a.winChance || b.score - a.score)
    .slice(0, limit)
}
