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

type GuardedMove = {
  from: number
  to: number
}

const WIN_SCORE = 10_000
const QUIESCENCE_DEPTH = 8
const WHITE_GUARDED_ANCHOR_SQUARES = new Set([28, 32])
const WHITE_BACKLINE_HOME_SQUARES = new Set([28, 29, 30, 31, 32])
const WHITE_GUARDED_QUIET_MOVES: GuardedMove[] = [
  { from: 32, to: 27 },
  { from: 31, to: 27 },
  { from: 29, to: 25 },
  { from: 26, to: 22 },
]
const WHITE_GUARDED_ORDER_PENALTY = 25_000
const WHITE_EARLY_31_TO_27_ORDER_PENALTY = 60_000
const WHITE_GUARDED_CLEAR_ADVANTAGE_MARGIN = 350
const WHITE_EARLY_31_TO_27_CLEAR_ADVANTAGE_MARGIN = 900
const WHITE_GUARDED_DRAW_FLOOR = -50
const WHITE_GUARDED_DRAW_MARGIN = 25

function playableSquareNumber(pos: Pos): number | null {
  if ((pos.r + pos.c) % 2 !== 1) return null
  return pos.r * 4 + Math.floor(pos.c / 2) + 1
}

function squareAt(board: Board, square: number): Pos {
  const index = square - 1
  const r = Math.floor(index / 4)
  const darkIndex = index % 4
  const c = r % 2 === 0 ? darkIndex * 2 + 1 : darkIndex * 2
  return { r, c }
}

function whiteBacklineHomeCount(board: Board): number {
  let count = 0
  for (const square of WHITE_BACKLINE_HOME_SQUARES) {
    const pos = squareAt(board, square)
    const piece = board[pos.r]?.[pos.c]
    if (piece?.player === 'white' && !piece.king) count += 1
  }
  return count
}

function startsFromGuardedAnchor(option: TurnOption): boolean {
  const [from] = option.path
  const square = from ? playableSquareNumber(from) : null
  return square !== null && WHITE_GUARDED_ANCHOR_SQUARES.has(square)
}

function matchesMove(option: TurnOption, fromSquare: number, toSquare: number): boolean {
  const [from, to] = option.path
  if (!from || !to) return false
  return playableSquareNumber(from) === fromSquare && playableSquareNumber(to) === toSquare
}

function matchesGuardedQuietMove(option: TurnOption): boolean {
  const [from, to] = option.path
  if (!from || !to) return false
  const fromSquare = playableSquareNumber(from)
  const toSquare = playableSquareNumber(to)
  return WHITE_GUARDED_QUIET_MOVES.some((move) => move.from === fromSquare && move.to === toSquare)
}

function isEarlyWhite31To27(option: TurnOption, board: Board, root: Player): boolean {
  return root === 'white' && option.captures === 0 && matchesMove(option, 31, 27) && whiteBacklineHomeCount(board) >= 4
}

function shouldGuardWhiteOpeningMove(option: TurnOption, root: Player): boolean {
  if (root !== 'white' || option.captures > 0) return false
  return startsFromGuardedAnchor(option) || matchesGuardedQuietMove(option)
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
  const guardedPenalty = shouldGuardWhiteOpeningMove(option, root) ? WHITE_GUARDED_ORDER_PENALTY : 0
  const early31Penalty = matchesMove(option, 31, 27) && root === 'white' ? WHITE_EARLY_31_TO_27_ORDER_PENALTY : 0

  return (
    option.captures * 100 +
    option.capturedKings * 220 +
    option.promotions * 80 +
    evaluateBoard(option.board, root, weights) -
    guardedPenalty -
    early31Penalty
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
  const bestUnguardedScore = scoredOptions
    .filter(({ option }) => !shouldGuardWhiteOpeningMove(option, turn))
    .reduce((best, item) => Math.max(best, item.score), -Infinity)

  let bestScore = -Infinity
  let chosen = scoredOptions[0].option.board

  for (const { option, score } of scoredOptions) {
    const early31To27 = isEarlyWhite31To27(option, board, turn)
    const guardedMove = shouldGuardWhiteOpeningMove(option, turn)
    const canReleaseEarly31To27 =
      !early31To27 ||
      scoredOptions.length === 1 ||
      bestUnguardedScore === -Infinity ||
      score >= bestUnguardedScore + WHITE_EARLY_31_TO_27_CLEAR_ADVANTAGE_MARGIN
    const canReleaseGuardedMove =
      !guardedMove ||
      scoredOptions.length === 1 ||
      bestUnguardedScore === -Infinity ||
      score >= bestUnguardedScore + WHITE_GUARDED_CLEAR_ADVANTAGE_MARGIN ||
      (!early31To27 && score >= WHITE_GUARDED_DRAW_FLOOR && score >= bestUnguardedScore - WHITE_GUARDED_DRAW_MARGIN)

    if (!canReleaseEarly31To27 || !canReleaseGuardedMove) continue

    if (score > bestScore) {
      bestScore = score
      chosen = option.board
    }
  }

  return chosen
}
