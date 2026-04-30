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
import { playableSquareNumber } from './analysis'

export type DeepSolveStatus = 'proven-win' | 'proven-loss' | 'advantage' | 'unknown' | 'timeout'

export type DeepSolveResult = {
  status: DeepSolveStatus
  bestLine: string
  score: number
  winChance: number
  depthReached: number
  nodes: number
  elapsedMs: number
  timedOut: boolean
}

type CandidateLine = {
  board: Board
  path: Pos[]
  captures: number
  capturedKings: number
  promotions: number
}

const WIN_SCORE = 10_000
const QUIESCENCE_DEPTH = 8
const DEFAULT_TIME_LIMIT_MS = 5_000

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

function orderScore(candidate: CandidateLine, root: Player, weights: Weights): number {
  return (
    candidate.captures * 120 +
    candidate.capturedKings * 260 +
    candidate.promotions * 90 +
    evaluateBoard(candidate.board, root, weights)
  )
}

function buildCandidateLines(board: Board, turn: Player, root: Player, weights: Weights): CandidateLine[] {
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
      const nextCaptures = captures + (moved.captured ? 1 : 0)
      const nextCapturedKings = capturedKings + (capturedPiece?.king ? 1 : 0)
      const nextPromotions = promotions + (moved.promoted ? 1 : 0)
      const nextPath = [...path, target]

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

  let candidates: CandidateLine[] = []
  if (starts.length > 0) {
    candidates = starts.flatMap((start) => followJumps(cloneBoard(board), start, [start], 0, 0, 0))
  } else {
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const piece = board[r][c]
        if (!piece || piece.player !== turn) continue
        const from = { r, c }
        for (const target of stepMoves(board, from)) {
          const moved = applyMove(board, from, target)
          candidates.push({
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

  return candidates.sort((a, b) => orderScore(b, root, weights) - orderScore(a, root, weights))
}

function terminalScore(board: Board, root: Player, depthLeft: number): number | null {
  const winner = winnerByPieces(board)
  if (winner === root) return WIN_SCORE + depthLeft
  if (winner && winner !== root) return -WIN_SCORE - depthLeft
  return null
}

function scoreToChance(score: number, depth: number): number {
  if (score >= 9_000) return 100
  if (score <= -9_000) return 0
  const confidence = Math.min(3.1, 1 + depth * 0.16)
  const scale = Math.max(2.4, 5.5 / confidence)
  const probability = 1 / (1 + Math.exp(-score / scale))
  return Math.max(1, Math.min(99, Math.round(probability * 100)))
}

function scoreToStatus(score: number, timedOut: boolean): DeepSolveStatus {
  if (timedOut) return 'timeout'
  if (score >= 9_000) return 'proven-win'
  if (score <= -9_000) return 'proven-loss'
  if (Math.abs(score) < 0.6) return 'unknown'
  return 'advantage'
}

export function deepSolvePosition(
  board: Board,
  player: Player,
  weights: Weights,
  maxDepth: number,
  timeLimitMs = DEFAULT_TIME_LIMIT_MS,
): DeepSolveResult {
  const startedAt = Date.now()
  const deadline = startedAt + Math.max(300, Math.min(60_000, Math.floor(timeLimitMs)))
  const depthLimit = Math.max(1, Math.min(24, Math.floor(maxDepth)))
  const table = new Map<string, number>()
  let nodes = 0
  let timedOut = false
  let bestScore = evaluateBoard(board, player, weights)
  let bestLine = ''
  let depthReached = 0

  const checkTime = () => {
    if (Date.now() > deadline) {
      timedOut = true
      return true
    }
    return false
  }

  const search = (
    b: Board,
    side: Player,
    depthLeft: number,
    qDepth: number,
    alpha: number,
    beta: number,
  ): number => {
    nodes += 1
    if ((nodes & 511) === 0 && checkTime()) return evaluateBoard(b, player, weights)

    const terminal = terminalScore(b, player, depthLeft + qDepth)
    if (terminal !== null) return terminal

    const key = boardKey(b, player, side, depthLeft, qDepth)
    const cached = table.get(key)
    if (cached !== undefined) return cached

    const moves = buildCandidateLines(b, side, player, weights)
    if (moves.length === 0) return side === player ? -WIN_SCORE - depthLeft : WIN_SCORE + depthLeft

    const hasCapture = moves.some((move) => move.captures > 0)
    if (depthLeft <= 0 && (!hasCapture || qDepth <= 0)) {
      const score = evaluateBoard(b, player, weights)
      table.set(key, score)
      return score
    }

    const nextSide = nextPlayer(side)
    const candidates = depthLeft <= 0 ? moves.filter((move) => move.captures > 0) : moves
    let result: number

    if (side === player) {
      let best = -Infinity
      for (let i = 0; i < candidates.length; i++) {
        const move = candidates[i]
        const reduce = depthLeft >= 4 && i >= 4 && move.captures === 0 ? 1 : 0
        const nextDepth = depthLeft > 0 ? Math.max(0, depthLeft - 1 - reduce) : 0
        const nextQDepth = depthLeft > 0 ? QUIESCENCE_DEPTH : qDepth - 1
        best = Math.max(best, search(move.board, nextSide, nextDepth, nextQDepth, alpha, beta))
        alpha = Math.max(alpha, best)
        if (beta <= alpha || timedOut) break
      }
      result = best
    } else {
      let best = Infinity
      for (let i = 0; i < candidates.length; i++) {
        const move = candidates[i]
        const reduce = depthLeft >= 4 && i >= 4 && move.captures === 0 ? 1 : 0
        const nextDepth = depthLeft > 0 ? Math.max(0, depthLeft - 1 - reduce) : 0
        const nextQDepth = depthLeft > 0 ? QUIESCENCE_DEPTH : qDepth - 1
        best = Math.min(best, search(move.board, nextSide, nextDepth, nextQDepth, alpha, beta))
        beta = Math.min(beta, best)
        if (beta <= alpha || timedOut) break
      }
      result = best
    }

    table.set(key, result)
    return result
  }

  for (let depth = 1; depth <= depthLimit; depth++) {
    if (checkTime()) break
    const rootMoves = buildCandidateLines(board, player, player, weights)
    if (rootMoves.length === 0) {
      bestScore = -WIN_SCORE
      bestLine = ''
      depthReached = depth
      break
    }

    let roundBest = -Infinity
    let roundLine = rootMoves[0].path
    for (const move of rootMoves) {
      const score = search(move.board, nextPlayer(player), depth - 1, QUIESCENCE_DEPTH, -Infinity, Infinity)
      if (score > roundBest) {
        roundBest = score
        roundLine = move.path
      }
      if (timedOut) break
    }

    if (!timedOut) {
      bestScore = roundBest
      bestLine = formatPath(roundLine)
      depthReached = depth
      if (bestScore >= 9_000 || bestScore <= -9_000) break
    }
  }

  const elapsedMs = Date.now() - startedAt
  return {
    status: scoreToStatus(bestScore, timedOut),
    bestLine,
    score: bestScore,
    winChance: scoreToChance(bestScore, Math.max(1, depthReached)),
    depthReached,
    nodes,
    elapsedMs,
    timedOut,
  }
}
