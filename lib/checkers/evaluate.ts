import type { Board, Player, Weights } from './types'
import { allCaptureStarts, nextPlayer, stepMoves } from './rules'
import { defaultValueWeights, evaluateValueBoard, normalizeValueWeights } from './valueModel'

export const defaultWeights: Weights = {
  man: 2,
  king: 5,
  mobility: 0.15,
  captureBonus: 0.4,
  kingAdvance: 0.05,
  valueBias: 0,
  valueScale: 1,
  valueWeights: defaultValueWeights,
}

const WHITE_OPENING_TARGET_SQUARES = new Set([21, 22, 23, 28, 29, 30, 31, 32])
const WHITE_OPENING_FRONT_SQUARES = new Set([21, 22, 23])
const WHITE_OPENING_BACKLINE_SQUARES = new Set([29, 30, 31, 32])
const WHITE_OPENING_ANCHOR_SQUARE = 28

function playableSquareNumberOfCell(r: number, c: number): number | null {
  if ((r + c) % 2 !== 1) return null
  return r * 4 + Math.floor(c / 2) + 1
}

function whiteOpeningFormationScore(board: Board): number {
  let score = 0
  let whitePieces = 0
  let whiteKings = 0
  let anchorOccupied = false

  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const piece = board[r][c]
      if (!piece || piece.player !== 'white') continue

      whitePieces += 1
      if (piece.king) whiteKings += 1

      const square = playableSquareNumberOfCell(r, c)
      if (square === null) continue

      if (square === WHITE_OPENING_ANCHOR_SQUARE) {
        anchorOccupied = true
        score += 7
      }

      if (WHITE_OPENING_TARGET_SQUARES.has(square)) score += 1.2
      else if (!piece.king) score -= 0.9

      if (WHITE_OPENING_FRONT_SQUARES.has(square)) score += 1.0
      if (WHITE_OPENING_BACKLINE_SQUARES.has(square)) score += 0.5
    }
  }

  if (whitePieces >= 7 && whiteKings === 0 && anchorOccupied === false) {
    score -= 10
  }

  return whiteKings > 0 || whitePieces < 6 ? score * 0.25 : score
}

function evaluateClassicBoard(board: Board, root: Player, weights: Weights): number {
  let score = 0
  let mobilityRoot = 0
  let mobilityEnemy = 0

  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const piece = board[r][c]
      if (!piece) continue
      const base = piece.king ? weights.king : weights.man
      const advance = piece.king ? 0 : (piece.player === 'black' ? r : 7 - r) * weights.kingAdvance
      score += piece.player === root ? base + advance : -(base + advance)

      const m = stepMoves(board, { r, c }).length
      if (piece.player === root) mobilityRoot += m
      else mobilityEnemy += m
    }
  }

  const rootCaps = allCaptureStarts(board, root).length
  const enemyCaps = allCaptureStarts(board, nextPlayer(root)).length

  score += (mobilityRoot - mobilityEnemy) * weights.mobility
  score += (rootCaps - enemyCaps) * weights.captureBonus

  const formationScore = whiteOpeningFormationScore(board)
  score += root === 'white' ? formationScore : -formationScore

  return score
}

export function evaluateBoard(board: Board, root: Player, weights: Weights): number {
  const classicScore = evaluateClassicBoard(board, root, weights)
  const trainedValueWeights = normalizeValueWeights(weights.valueWeights ?? defaultValueWeights)
  const valueScore = evaluateValueBoard(board, root, trainedValueWeights)
  return classicScore + (weights.valueBias ?? 0) + valueScore * (weights.valueScale ?? 1)
}
