import type { Board, Player, Weights } from './types'
import { allCaptureStarts, nextPlayer, stepMoves } from './rules'

export const defaultWeights: Weights = {
  man: 2,
  king: 5,
  mobility: 0.15,
  captureBonus: 0.4,
  kingAdvance: 0.05,
}

export function evaluateBoard(board: Board, root: Player, weights: Weights): number {
  let score = 0
  let mobilityRoot = 0
  let mobilityEnemy = 0

  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const piece = board[r][c]
      if (!piece) continue
      const base = piece.king ? weights.king : weights.man
      const advance = piece.king ? 0 : (piece.player === 'black' ? r : (7 - r)) * weights.kingAdvance
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

  return score
}
