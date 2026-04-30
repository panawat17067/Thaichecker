import {
  allCaptureStarts,
  applyMove,
  jumpMoves,
  nextPlayer,
  stepMoves,
} from './rules'
import type { Board, Player, Pos } from './types'

export type ValueWeights = {
  bias: number
  manDiff: number
  kingDiff: number
  mobilityDiff: number
  captureThreatDiff: number
  longestCaptureDiff: number
  recaptureRisk: number
  kingLineControlDiff: number
  centerControlDiff: number
  edgePenaltyDiff: number
  advancementDiff: number
  opponentMobilityPressure: number
}

export const defaultValueWeights: ValueWeights = {
  bias: 0,
  manDiff: 1.1,
  kingDiff: 2.6,
  mobilityDiff: 0.18,
  captureThreatDiff: 0.95,
  longestCaptureDiff: 1.25,
  recaptureRisk: -1.1,
  kingLineControlDiff: 0.28,
  centerControlDiff: 0.22,
  edgePenaltyDiff: -0.18,
  advancementDiff: 0.16,
  opponentMobilityPressure: 0.35,
}

type FeatureName = keyof ValueWeights

export type ValueFeatures = Record<FeatureName, number>

const FEATURE_NAMES: FeatureName[] = [
  'bias',
  'manDiff',
  'kingDiff',
  'mobilityDiff',
  'captureThreatDiff',
  'longestCaptureDiff',
  'recaptureRisk',
  'kingLineControlDiff',
  'centerControlDiff',
  'edgePenaltyDiff',
  'advancementDiff',
  'opponentMobilityPressure',
]

const EMPTY_FEATURES: ValueFeatures = {
  bias: 1,
  manDiff: 0,
  kingDiff: 0,
  mobilityDiff: 0,
  captureThreatDiff: 0,
  longestCaptureDiff: 0,
  recaptureRisk: 0,
  kingLineControlDiff: 0,
  centerControlDiff: 0,
  edgePenaltyDiff: 0,
  advancementDiff: 0,
  opponentMobilityPressure: 0,
}

function emptyFeatures(): ValueFeatures {
  return { ...EMPTY_FEATURES }
}

function ownerSign(player: Player, root: Player): number {
  return player === root ? 1 : -1
}

function isCenter(pos: Pos): boolean {
  return pos.r >= 2 && pos.r <= 5 && pos.c >= 2 && pos.c <= 5
}

function isEdge(pos: Pos): boolean {
  return pos.r === 0 || pos.r === 7 || pos.c === 0 || pos.c === 7
}

function countKingLineControl(board: Board, from: Pos): number {
  const piece = board[from.r]?.[from.c]
  if (!piece?.king) return 0
  let control = 0
  for (const [dr, dc] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    let r = from.r + dr
    let c = from.c + dc
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && !board[r][c]) {
      control += 1
      r += dr
      c += dc
    }
  }
  return control
}

function maxCaptureChain(board: Board, from: Pos, limit = 8): number {
  if (limit <= 0) return 0
  const jumps = jumpMoves(board, from)
  if (jumps.length === 0) return 0

  let best = 0
  for (const target of jumps) {
    const moved = applyMove(board, from, target)
    const continuation = moved.promoted ? 0 : maxCaptureChain(moved.board, target, limit - 1)
    best = Math.max(best, 1 + continuation)
  }
  return best
}

function sideMobility(board: Board, side: Player): number {
  let total = 0
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const piece = board[r][c]
      if (!piece || piece.player !== side) continue
      total += stepMoves(board, { r, c }).length
    }
  }
  return total
}

function sideLongestCapture(board: Board, side: Player): number {
  let longest = 0
  for (const start of allCaptureStarts(board, side)) {
    longest = Math.max(longest, maxCaptureChain(board, start))
  }
  return longest
}

function recaptureRisk(board: Board, root: Player): number {
  let risky = 0
  const rootCaptures = allCaptureStarts(board, root)
  for (const start of rootCaptures) {
    for (const target of jumpMoves(board, start)) {
      const moved = applyMove(board, start, target)
      if (allCaptureStarts(moved.board, nextPlayer(root)).length > 0) risky += 1
    }
  }
  return Math.min(4, risky) / 4
}

export function extractValueFeatures(board: Board, root: Player): ValueFeatures {
  const features = emptyFeatures()
  const enemy = nextPlayer(root)
  let rootMobility = 0
  let enemyMobility = 0
  let rootKingLine = 0
  let enemyKingLine = 0
  let rootCenter = 0
  let enemyCenter = 0
  let rootEdge = 0
  let enemyEdge = 0
  let rootAdvance = 0
  let enemyAdvance = 0

  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const piece = board[r][c]
      if (!piece) continue
      const pos = { r, c }
      const sign = ownerSign(piece.player, root)

      if (piece.king) features.kingDiff += sign
      else features.manDiff += sign

      if (piece.player === root) {
        rootMobility += stepMoves(board, pos).length
        rootKingLine += countKingLineControl(board, pos)
        if (isCenter(pos)) rootCenter += 1
        if (isEdge(pos)) rootEdge += 1
        rootAdvance += piece.king ? 0 : piece.player === 'black' ? r : 7 - r
      } else {
        enemyMobility += stepMoves(board, pos).length
        enemyKingLine += countKingLineControl(board, pos)
        if (isCenter(pos)) enemyCenter += 1
        if (isEdge(pos)) enemyEdge += 1
        enemyAdvance += piece.king ? 0 : piece.player === 'black' ? r : 7 - r
      }
    }
  }

  const rootCaps = allCaptureStarts(board, root).length
  const enemyCaps = allCaptureStarts(board, enemy).length

  features.manDiff /= 8
  features.kingDiff /= 4
  features.mobilityDiff = (rootMobility - enemyMobility) / 16
  features.captureThreatDiff = (rootCaps - enemyCaps) / 4
  features.longestCaptureDiff = (sideLongestCapture(board, root) - sideLongestCapture(board, enemy)) / 4
  features.recaptureRisk = recaptureRisk(board, root)
  features.kingLineControlDiff = (rootKingLine - enemyKingLine) / 24
  features.centerControlDiff = (rootCenter - enemyCenter) / 8
  features.edgePenaltyDiff = (rootEdge - enemyEdge) / 8
  features.advancementDiff = (rootAdvance - enemyAdvance) / 28
  features.opponentMobilityPressure = enemyMobility === 0 ? 1 : Math.max(0, 6 - enemyMobility) / 6

  return features
}

export function normalizeValueWeights(weights: Partial<ValueWeights> | null | undefined): ValueWeights {
  const normalized = { ...defaultValueWeights }
  for (const key of FEATURE_NAMES) {
    const value = weights?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) normalized[key] = value
  }
  return normalized
}

export function evaluateValueBoard(board: Board, root: Player, weights: ValueWeights = defaultValueWeights): number {
  const features = extractValueFeatures(board, root)
  return FEATURE_NAMES.reduce((score, key) => score + features[key] * weights[key], 0)
}

export function valueScoreToWinChance(score: number, depth: number): number {
  const confidence = Math.min(2.8, 0.9 + depth * 0.2)
  const scale = Math.max(2.6, 4.8 / confidence)
  const probability = 1 / (1 + Math.exp(-score / scale))
  return Math.max(1, Math.min(99, Math.round(probability * 100)))
}

export async function loadValueWeights(): Promise<ValueWeights> {
  try {
    const res = await fetch('/models/value-trained.json', { cache: 'no-store' })
    if (!res.ok) return defaultValueWeights
    const data = (await res.json()) as Partial<ValueWeights>
    return normalizeValueWeights(data)
  } catch {
    return defaultValueWeights
  }
}
