import { analyzeTopPlayerLines } from './analysis'
import { bestBoard } from './alphaBeta'
import { defaultWeights } from './evaluate'
import { allCaptureStarts, applyMove, stepMoves } from './rules'
import { defaultValueWeights, normalizeValueWeights } from './valueModel'
import type { Board, BotLevel, Pos, Player, Weights } from './types'

export const BOT_DEPTH_BY_LEVEL: Record<Exclude<BotLevel, 'custom'>, number> = {
  easy: 1,
  normal: 3,
  hard: 5,
}

type OpeningStep = {
  from: number
  to: number
}

const WHITE_FORCED_OPENING_STEPS: OpeningStep[] = [
  { from: 26, to: 22 },
  { from: 27, to: 23 },
  { from: 25, to: 21 },
]

export function clampBotDepth(depth: number): number {
  if (!Number.isFinite(depth)) return BOT_DEPTH_BY_LEVEL.hard
  return Math.max(1, Math.min(1000, Math.floor(depth)))
}

function squareToPos(square: number): Pos {
  const index = square - 1
  const r = Math.floor(index / 4)
  const darkIndex = index % 4
  const c = r % 2 === 0 ? darkIndex * 2 + 1 : darkIndex * 2
  return { r, c }
}

function samePos(a: Pos, b: Pos): boolean {
  return a.r === b.r && a.c === b.c
}

function chooseWhiteForcedOpeningMove(board: Board, turn: Player): Board | null {
  if (turn !== 'white') return null

  // ถ้ามีกินบังคับ ต้องเคารพกติกาก่อน opening book เสมอ
  if (allCaptureStarts(board, turn).length > 0) return null

  for (const step of WHITE_FORCED_OPENING_STEPS) {
    const from = squareToPos(step.from)
    const to = squareToPos(step.to)
    const fromPiece = board[from.r]?.[from.c]
    const toPiece = board[to.r]?.[to.c]

    // step นี้เดินไปแล้ว ให้ตรวจ step ถัดไป
    if (!fromPiece && toPiece?.player === 'white') continue

    // บังคับเดินตามลำดับเท่านั้น: 26-22, 27-23, 25-21
    if (fromPiece?.player === 'white' && !fromPiece.king && !toPiece) {
      const legal = stepMoves(board, from).some((target) => samePos(target, to))
      if (legal) return applyMove(board, from, to).board
    }

    // ถ้า step ปัจจุบันยังไม่สำเร็จและเดินไม่ได้ ห้ามข้ามไป step หลัง
    return null
  }

  return null
}

export async function loadAlphaBetaWeights(): Promise<Weights> {
  try {
    const [alphaRes, valueRes] = await Promise.all([
      fetch('/models/alpha-beta-trained.json', { cache: 'no-store' }),
      fetch('/models/value-trained.json', { cache: 'no-store' }),
    ])

    const alphaData = alphaRes.ok ? ((await alphaRes.json()) as Partial<Weights>) : defaultWeights
    const valueData = valueRes.ok ? await valueRes.json() : defaultValueWeights

    return {
      man: alphaData.man ?? defaultWeights.man,
      king: alphaData.king ?? defaultWeights.king,
      mobility: alphaData.mobility ?? defaultWeights.mobility,
      captureBonus: alphaData.captureBonus ?? defaultWeights.captureBonus,
      kingAdvance: alphaData.kingAdvance ?? defaultWeights.kingAdvance,
      valueBias: alphaData.valueBias ?? defaultWeights.valueBias,
      valueScale: alphaData.valueScale ?? defaultWeights.valueScale,
      valueWeights: normalizeValueWeights(valueData),
    }
  } catch {
    return defaultWeights
  }
}

export function chooseAlphaBetaMove(
  board: Board,
  turn: Player,
  level: BotLevel,
  weights: Weights,
  customDepth?: number,
): Board | null {
  const openingMove = chooseWhiteForcedOpeningMove(board, turn)
  if (openingMove) return openingMove

  const depth = level === 'custom' ? clampBotDepth(customDepth ?? BOT_DEPTH_BY_LEVEL.hard) : BOT_DEPTH_BY_LEVEL[level]
  return bestBoard(board, turn, depth, weights)
}

function applyPath(board: Board, path: Pos[]): Board | null {
  if (path.length < 2) return null

  let nextBoard = board
  for (let i = 0; i < path.length - 1; i++) {
    nextBoard = applyMove(nextBoard, path[i], path[i + 1]).board
  }
  return nextBoard
}

export function chooseThinkingWindowMove(
  board: Board,
  turn: Player,
  level: BotLevel,
  weights: Weights,
  customDepth?: number,
): Board | null {
  const openingMove = chooseWhiteForcedOpeningMove(board, turn)
  if (openingMove) return openingMove

  const depth = level === 'custom' ? clampBotDepth(customDepth ?? BOT_DEPTH_BY_LEVEL.hard) : BOT_DEPTH_BY_LEVEL[level]
  const [bestLine] = analyzeTopPlayerLines(board, turn, weights, depth, 1)
  return bestLine ? applyPath(board, bestLine.path) : null
}
