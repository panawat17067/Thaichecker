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

type TurnOption = {
  board: Board
  captures: number
  capturedKings: number
  promotions: number
}

const WIN_SCORE = 10_000
const QUIESCENCE_DEPTH = 8

function boardKey(board: Board, side: Player, root: Player, depth: number, qDepth: number): string {
  const cells = board
    .flat()
    .map((piece) => {
      if (!piece) return '..'
      return `${piece.player[0]}${piece.king ? 'K' : 'M'}`
    })
    .join('')
  return `${root}|${side}|${depth}|${qDepth}|${cells}`
}

function orderScore(option: TurnOption, root: Player, weights: Weights): number {
  return (
    option.captures * 100 +
    option.capturedKings * 220 +
    option.promotions * 80 +
    evaluateBoard(option.board, root, weights)
  )
}

function buildTurnOptions(board: Board, turn: Player, root: Player, weights: Weights): TurnOption[] {
  const starts = allCaptureStarts(board, turn)

  const followJumps = (
    b: Board,
    at: Pos,
    captures: number,
    capturedKings: number,
    promotions: number,
  ): TurnOption[] => {
    const nextJumps = jumpMoves(b, at)
    if (nextJumps.length === 0) return [{ board: b, captures, capturedKings, promotions }]

    const out: TurnOption[] = []
    for (const target of nextJumps) {
      const moved = applyMove(b, at, target)
      const capturedPiece = moved.captured ? b[moved.captured.r]?.[moved.captured.c] : null
      const nextCaptures = captures + (moved.captured ? 1 : 0)
      const nextCapturedKings = capturedKings + (capturedPiece?.king ? 1 : 0)
      const nextPromotions = promotions + (moved.promoted ? 1 : 0)

      if (moved.promoted) {
        out.push({
          board: moved.board,
          captures: nextCaptures,
          capturedKings: nextCapturedKings,
          promotions: nextPromotions,
        })
      } else {
        out.push(...followJumps(moved.board, target, nextCaptures, nextCapturedKings, nextPromotions))
      }
    }
    return out
  }

  let options: TurnOption[] = []

  if (starts.length > 0) {
    options = starts.flatMap((start) => followJumps(cloneBoard(board), start, 0, 0, 0))
  } else {
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const piece = board[r][c]
        if (!piece || piece.player !== turn) continue
        for (const target of stepMoves(board, { r, c })) {
          const moved = applyMove(board, { r, c }, target)
          options.push({
            board: moved.board,
            captures: 0,
            capturedKings: 0,
            promotions: moved.promoted ? 1 : 0,
          })
        }
      }
    }
  }

  return options.sort((a, b) => orderScore(b, root, weights) - orderScore(a, root, weights))
}

export function buildTurns(board: Board, turn: Player): Board[] {
  return buildTurnOptions(board, turn, turn, {
    man: 2,
    king: 5,
    mobility: 0.15,
    captureBonus: 0.4,
    kingAdvance: 0.05,
  }).map((option) => option.board)
}

export function bestBoard(board: Board, turn: Player, depth: number, weights: Weights): Board | null {
  const table = new Map<string, number>()
  const searchDepth = Math.max(1, Math.floor(depth))

  const search = (b: Board, d: number, side: Player, alpha: number, beta: number, qDepth: number): number => {
    const winner = winnerByPieces(b)
    if (winner === turn) return WIN_SCORE + d + qDepth
    if (winner && winner !== turn) return -WIN_SCORE - d - qDepth

    const key = boardKey(b, side, turn, d, qDepth)
    const cached = table.get(key)
    if (cached !== undefined) return cached

    const options = buildTurnOptions(b, side, turn, weights)
    if (options.length === 0) {
      return side === turn ? -WIN_SCORE - d - qDepth : WIN_SCORE + d + qDepth
    }

    const hasCapture = options.some((option) => option.captures > 0)
    if (d === 0 && (!hasCapture || qDepth <= 0)) {
      const quietScore = evaluateBoard(b, turn, weights)
      table.set(key, quietScore)
      return quietScore
    }

    const nextSide = nextPlayer(side)
    const nextDepth = d > 0 ? d - 1 : 0
    const nextQDepth = d > 0 ? QUIESCENCE_DEPTH : qDepth - 1
    const candidates = d === 0 ? options.filter((option) => option.captures > 0) : options

    let result: number
    if (side === turn) {
      let best = -Infinity
      for (const option of candidates) {
        best = Math.max(best, search(option.board, nextDepth, nextSide, alpha, beta, nextQDepth))
        alpha = Math.max(alpha, best)
        if (beta <= alpha) break
      }
      result = best
    } else {
      let best = Infinity
      for (const option of candidates) {
        best = Math.min(best, search(option.board, nextDepth, nextSide, alpha, beta, nextQDepth))
        beta = Math.min(beta, best)
        if (beta <= alpha) break
      }
      result = best
    }

    table.set(key, result)
    return result
  }

  const options = buildTurnOptions(board, turn, turn, weights)
  if (options.length === 0) return null

  let bestScore = -Infinity
  let chosen = options[0].board
  for (const option of options) {
    const score = search(option.board, searchDepth - 1, nextPlayer(turn), -Infinity, Infinity, QUIESCENCE_DEPTH)
    if (score > bestScore) {
      bestScore = score
      chosen = option.board
    }
  }

  return chosen
}
