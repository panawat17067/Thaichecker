import { bestBoard } from './alphaBeta'
import { defaultWeights } from './evaluate'
import { defaultValueWeights, normalizeValueWeights } from './valueModel'
import type { Board, BotLevel, Player, Weights } from './types'

export const BOT_DEPTH_BY_LEVEL: Record<Exclude<BotLevel, 'custom'>, number> = {
  easy: 1,
  normal: 3,
  hard: 5,
}

export function clampBotDepth(depth: number): number {
  if (!Number.isFinite(depth)) return BOT_DEPTH_BY_LEVEL.hard
  return Math.max(1, Math.min(1000, Math.floor(depth)))
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
  const depth = level === 'custom' ? clampBotDepth(customDepth ?? BOT_DEPTH_BY_LEVEL.hard) : BOT_DEPTH_BY_LEVEL[level]
  return bestBoard(board, turn, depth, weights)
}
