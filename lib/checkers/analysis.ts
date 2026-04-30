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
  captures: number
  capturedKings: number
  promotions: number
}

export const MAX_ANALYSIS_DEPTH = 12
const WIN_SCORE = 10_000
const QUIESCENCE_DEPTH = 8

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

function boardKey(board: Board, root: Player, side: Player, depth: number, qDepth: number): string {
  const cells = board
    .flat()
    .map((piece) => {
      if (!piece) return '..'
      return `${piece.player[0]}${piece.king ? 'K' : 'M'}`
    })
    .join('')
  return `${root}|${side}|${depth}|${qDepth}|${cells}`
}

function orderScore(line: CandidateLine, root: Player, weights: Weights): number {
  return (
    line.captures * 100 +
    line.capturedKings * 220 +
    line.promotions * 80 +
    evaluateBoard(line.board, root, weights)
  )
}

function buildCandidateLines(board: Board, turn: Player, weights: Weights, root: Player, onlyFrom?: Pos | null): CandidateLine[] {
  const starts = allCaptureStarts(board, turn)

  const followJumps = (
    b: Board,
    at: Pos,
    path: Pos[],
    captures: number,
    capturedKings: number,
    promotions: number,
  ): CandidateLine[] => {
    const nextJumps = jumpMoves(b, at)
    if (nextJumps.length === 0) return [{ board: b, path, captures, capturedKings, promotions }]

    const out: CandidateLine[] = []
    for (const target of nextJumps) {
      const moved = applyMove(b, at, target)
      const capturedPiece = moved.captured ? b[moved.captured.r]?.[moved.captured.c] : null
      const nextPath = [...path, target]
      const nextCaptures = captures + (moved.captured ? 1 : 0)
      const nextCapturedKings = capturedKings + (capturedPiece?.king ? 1 : 0)
      const nextPromotions = promotions + (moved.promoted ? 1 : 0)

      if (moved.promoted) {
        out.push({
          board: moved.board,
          path: nextPath,
          captures: nextCaptures,
          capturedKings: nextCapturedKings,
          promotions: nextPromotions,
        })
      } else {
        out.push(...followJumps(moved.board, target, nextPath, nextCaptures, nextCapturedKings, nextPromotions))
      }
    }
    return out
  }

  let out: CandidateLine[] = []

  if (starts.length > 0) {
    const filteredStarts = onlyFrom ? starts.filter((start) => samePos(start, onlyFrom)) : starts
    out = filteredStarts.flatMap((start) => followJumps(cloneBoard(board), start, [start], 0, 0, 0))
  } else {
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const from = { r, c }
        const piece = board[r][c]
        if (!piece || piece.player !== turn) continue
        if (onlyFrom && !samePos(from, onlyFrom)) continue
        for (const target of stepMoves(board, from)) {
          const moved = applyMove(board, from, target)
          out.push({
            board: moved.board,
            path: [from, target],
            captures: 0,
            capturedKings: 0,
            promotions: moved.promoted ? 1 : 0,
          })
        }
      }
    }
  }

  return out.sort((a, b) => orderScore(b, root, weights) - orderScore(a, root, weights))
}

function terminalScore(board: Board, root: Player, depthLeft: number): number | null {
  const winner = winnerByPieces(board)
  if (winner === root) return WIN_SCORE + depthLeft
  if (winner && winner !== root) return -WIN_SCORE - depthLeft
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
  qDepth: number,
  table: Map<string, number>,
): number {
  const terminal = terminalScore(board, root, depthLeft + qDepth)
  if (terminal !== null) return terminal

  const key = boardKey(board, root, side, depthLeft, qDepth)
  const cached = table.get(key)
  if (cached !== undefined) return cached

  const moves = buildCandidateLines(board, side, weights, root)
  if (moves.length === 0) return side === root ? -WIN_SCORE - depthLeft : WIN_SCORE + depthLeft

  const hasCapture = moves.some((move) => move.captures > 0)
  if (depthLeft === 0 && (!hasCapture || qDepth <= 0)) {
    const score = evaluateBoard(board, root, weights)
    table.set(key, score)
    return score
  }

  const nextSide = nextPlayer(side)
  const nextDepth = depthLeft > 0 ? depthLeft - 1 : 0
  const nextQDepth = depthLeft > 0 ? QUIESCENCE_DEPTH : qDepth - 1
  const candidates = depthLeft === 0 ? moves.filter((move) => move.captures > 0) : moves

  let result: number
  if (side === root) {
    let best = -Infinity
    for (const move of candidates) {
      best = Math.max(best, searchScore(move.board, root, nextSide, nextDepth, weights, alpha, beta, nextQDepth, table))
      alpha = Math.max(alpha, best)
      if (beta <= alpha) break
    }
    result = best
  } else {
    let best = Infinity
    for (const move of candidates) {
      best = Math.min(best, searchScore(move.board, root, nextSide, nextDepth, weights, alpha, beta, nextQDepth, table))
      beta = Math.min(beta, best)
      if (beta <= alpha) break
    }
    result = best
  }

  table.set(key, result)
  return result
}

function scoreToWinChance(score: number, depth: number): { winChance: number; verdict: AnalysisLine['verdict'] } {
  if (score >= 9_000) return { winChance: 100, verdict: 'win' }
  if (score <= -9_000) return { winChance: 0, verdict: 'loss' }

  const confidence = Math.min(2.4, 0.75 + depth * 0.18)
  const scale = Math.max(3, 8 / confidence)
  const probability = 1 / (1 + Math.exp(-score / scale))
  const bounded = Math.max(1, Math.min(99, Math.round(probability * 100)))
  const verdict = Math.abs(bounded - 50) <= 2 ? 'draw' : 'advantage'
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
  const table = new Map<string, number>()
  const candidates = buildCandidateLines(board, player, weights, player, onlyFrom)

  return candidates
    .map((candidate) => {
      const terminal = terminalScore(candidate.board, player, depth)
      const score = terminal ?? searchScore(candidate.board, player, nextPlayer(player), depth - 1, weights, -Infinity, Infinity, QUIESCENCE_DEPTH, table)
      const { winChance, verdict } = scoreToWinChance(score, depth)
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
