import { bestBoard } from './alphaBeta'
import { defaultWeights } from './evaluate'
import type { Board, BotLevel, Player, Weights } from './types'

export const BOT_DEPTH_BY_LEVEL: Record<BotLevel, number> = {
  easy: 1,
  normal: 3,
  hard: 5,
}

export async function loadAlphaBetaWeights(): Promise<Weights> {
  try {
    const res = await fetch('/models/alpha-beta-trained.json', { cache: 'no-store' })
    if (!res.ok) return defaultWeights
    const data = (await res.json()) as Partial<Weights>
    return {
      man: data.man ?? defaultWeights.man,
      king: data.king ?? defaultWeights.king,
      mobility: data.mobility ?? defaultWeights.mobility,
      captureBonus: data.captureBonus ?? defaultWeights.captureBonus,
      kingAdvance: data.kingAdvance ?? defaultWeights.kingAdvance,
    }
  } catch {
    return defaultWeights
  }
}

export function chooseAlphaBetaMove(board: Board, turn: Player, level: BotLevel, weights: Weights): Board | null {
  return bestBoard(board, turn, BOT_DEPTH_BY_LEVEL[level], weights)
}
