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
  path: Pos[]
  captures: number
  capturedKings: number
  promotions: number
}

const WIN_SCORE = 10_000
const QUIESCENCE_DEPTH = 8
const WHITE_OPENING_ANCHOR_SQUARE = 28
const WHITE_ANCHOR_ORDER_PENALTY = 25_000
const WHITE_ANCHOR_CLEAR_ADVANTAGE_MARGIN = 350

function playableSquareNumber(pos: Pos): number | null {
  if ((pos.r + pos.c) % 2 !== 1) return null
  return pos.r * 4 + Math.floor(pos.c / 2) + 1
}

function startsFromSquare(option: TurnOption, square: number): boolean {
  const [from] = option.path
  return Boolean(from && playableSquareNumber(from) === square)
}

function shouldProtectWhiteAnchor(option: TurnOption, root: Player): boolean {
  return root === 'white' && startsFromSquare(option, WHITE_OPENING_ANCHOR_SQUARE) && option.captures === 0
}

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
  const anchorPenalty = shouldProtectWhiteAnchor(option, root) ? WHITE_ANCHOR_ORDER_PENALTY : 0

  return (
    option.captures * 100 +
    option.capturedKings * 220 +
    option.promotions * 80 +
    evaluateBoard(option.board, root, weights) -
    anchorPenalty
  )
}

function buildTurnOptions(board: Board, turn: Player, root: Player, weights: Weights): TurnOption[] {
  const starts = allCaptureStarts(board, turn)

  const followJumps = (
    b: Board,
    at: Pos,
    path: Pos[],
    captures: number,
    capturedKings: number,
    promotions: number,
  ): TurnOption[] => {
    const nextJumps = jumpMoves(b, at)
    if (nextJumps.length === 0) return [{ board: b, path, captures, capturedKings, promotions }]

    const out: TurnOption[] = []
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

  let options: TurnOption[] = []

  if (starts.length > 0) {
    options = starts.flatMap((start) => followJumps(cloneBoard(board), start, [start], 0, 0, 0))
  } else {
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const from = { r, c }
        const piece = board[r][c]
        if (!piece || piece.player !== turn) continue
        for (const target of stepMoves(board, from)) {
          const moved = applyMove(board, from, target)
          options.push({
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

  const scoredOptions = options.map((option) => ({
    option,
    score: search(option.board, searchDepth - 1, nextPlayer(turn), -Infinity, Infinity, QUIESCENCE_DEPTH),
  }))
  const bestNonAnchorScore = scoredOptions
    .filter(({ option }) => !shouldProtectWhiteAnchor(option, turn))
    .reduce((best, item) => Math.max(best, item.score), -Infinity)

  let bestScore = -Infinity
  let chosen = scoredOptions[0].option.board

  for (const { option, score } of scoredOptions) {
    const protectedAnchor = shouldProtectWhiteAnchor(option, turn)
    const canReleaseAnchor =
      !protectedAnchor ||
      scoredOptions.length === 1 ||
      bestNonAnchorScore === -Infinity ||
      score >= bestNonAnchorScore + WHITE_ANCHOR_CLEAR_ADVANTAGE_MARGIN

    if (!canReleaseAnchor) continue

    if (score > bestScore) {
      bestScore = score
      chosen = option.board
    }
  }

  return chosen
}
