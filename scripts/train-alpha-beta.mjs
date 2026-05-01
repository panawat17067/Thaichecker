import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BOARD_SIZE = 8
const MAX_PLIES = Number.parseInt(process.env.TRAIN_MAX_PLIES ?? '120', 10)
const SEARCH_DEPTH = Number.parseInt(process.env.TRAIN_DEPTH ?? '2', 10)
const ROUNDS = Number.parseInt(process.env.TRAIN_ROUNDS ?? '3', 10)
const CANDIDATES_PER_ROUND = Number.parseInt(process.env.TRAIN_CANDIDATES ?? '8', 10)
const MODEL_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'alpha-beta-trained.json')

const defaultWeights = { man: 2, king: 5, mobility: 0.15, captureBonus: 0.4, kingAdvance: 0.05 }

const WHITE_OPENING_TARGET_SQUARES = new Set([21, 22, 23, 28, 29, 30, 31, 32])
const WHITE_OPENING_FRONT_SQUARES = new Set([21, 22, 23])
const WHITE_OPENING_BACKLINE_SQUARES = new Set([29, 30, 31, 32])
const WHITE_OPENING_ANCHOR_SQUARE = 28

function playableSquareNumberOfCell(r, c) {
  if ((r + c) % 2 !== 1) return null
  return r * 4 + Math.floor(c / 2) + 1
}

function whiteOpeningFormationScore(board) {
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

const KING_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
let seed = 17067

function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

function normalizeWeights(weights) {
  return {
    man: Number.isFinite(weights.man) ? weights.man : defaultWeights.man,
    king: Number.isFinite(weights.king) ? weights.king : defaultWeights.king,
    mobility: Number.isFinite(weights.mobility) ? weights.mobility : defaultWeights.mobility,
    captureBonus: Number.isFinite(weights.captureBonus) ? weights.captureBonus : defaultWeights.captureBonus,
    kingAdvance: Number.isFinite(weights.kingAdvance) ? weights.kingAdvance : defaultWeights.kingAdvance,
  }
}

function readWeights() {
  try {
    return normalizeWeights(JSON.parse(readFileSync(MODEL_PATH, 'utf8')))
  } catch {
    return { ...defaultWeights }
  }
}

function mutate(weights, scale) {
  const jitter = (value, pct, min, max) => {
    const factor = 1 + (random() * 2 - 1) * pct * scale
    return Math.max(min, Math.min(max, Number((value * factor).toFixed(4))))
  }

  return {
    man: jitter(weights.man, 0.3, 0.5, 8),
    king: jitter(weights.king, 0.35, 1, 14),
    mobility: jitter(weights.mobility, 0.7, 0.01, 2),
    captureBonus: jitter(weights.captureBonus, 0.8, 0.02, 4),
    kingAdvance: jitter(weights.kingAdvance, 0.9, 0.001, 1),
  }
}

function initBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null))
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { player: 'black', king: false }
    }
  }
  for (let r = 6; r < 8; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { player: 'white', king: false }
    }
  }
  return board
}

function cloneBoard(board) {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)))
}

function nextPlayer(turn) {
  return turn === 'black' ? 'white' : 'black'
}

function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE
}

function manDirs(piece) {
  return piece.player === 'black' ? [[1, 1], [1, -1]] : [[-1, 1], [-1, -1]]
}

function jumpMoves(board, from) {
  const piece = board[from.r][from.c]
  if (!piece) return []
  const out = []

  if (!piece.king) {
    for (const [dr, dc] of manDirs(piece)) {
      const mr = from.r + dr
      const mc = from.c + dc
      const tr = from.r + dr * 2
      const tc = from.c + dc * 2
      if (!inBounds(mr, mc) || !inBounds(tr, tc) || board[tr][tc]) continue
      const mid = board[mr][mc]
      if (mid && mid.player !== piece.player) out.push({ r: tr, c: tc })
    }
    return out
  }

  for (const [dr, dc] of KING_DIRS) {
    let r = from.r + dr
    let c = from.c + dc
    while (inBounds(r, c) && !board[r][c]) {
      r += dr
      c += dc
    }
    if (!inBounds(r, c)) continue
    const target = board[r][c]
    if (!target || target.player === piece.player) continue
    const landR = r + dr
    const landC = c + dc
    if (inBounds(landR, landC) && !board[landR][landC]) out.push({ r: landR, c: landC })
  }
  return out
}

function stepMoves(board, from) {
  const piece = board[from.r][from.c]
  if (!piece) return []
  const out = []

  if (!piece.king) {
    for (const [dr, dc] of manDirs(piece)) {
      const nr = from.r + dr
      const nc = from.c + dc
      if (inBounds(nr, nc) && !board[nr][nc]) out.push({ r: nr, c: nc })
    }
    return out
  }

  for (const [dr, dc] of KING_DIRS) {
    let r = from.r + dr
    let c = from.c + dc
    while (inBounds(r, c) && !board[r][c]) {
      out.push({ r, c })
      r += dr
      c += dc
    }
  }
  return out
}

function allCaptureStarts(board, turn) {
  const starts = []
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = board[r][c]
      if (piece && piece.player === turn && jumpMoves(board, { r, c }).length > 0) starts.push({ r, c })
    }
  }
  return starts
}

function capturedBetween(board, from, to) {
  const dr = Math.sign(to.r - from.r)
  const dc = Math.sign(to.c - from.c)
  let r = from.r + dr
  let c = from.c + dc
  let found = null

  while (r !== to.r && c !== to.c) {
    if (board[r][c]) {
      if (found) return null
      found = { r, c }
    }
    r += dr
    c += dc
  }
  return found
}

function applyMove(board, from, to) {
  const next = cloneBoard(board)
  const piece = next[from.r][from.c]
  if (!piece) return { board: next, promoted: false }

  const captured = capturedBetween(board, from, to)
  next[from.r][from.c] = null
  next[to.r][to.c] = piece
  if (captured) next[captured.r][captured.c] = null

  let promoted = false
  if (!piece.king && ((piece.player === 'black' && to.r === 7) || (piece.player === 'white' && to.r === 0))) {
    piece.king = true
    promoted = true
  }
  return { board: next, promoted }
}

function winnerByPieces(board) {
  const pieces = board.flat()
  const blackLeft = pieces.filter((piece) => piece?.player === 'black').length
  const whiteLeft = pieces.filter((piece) => piece?.player === 'white').length
  if (blackLeft === 0) return 'white'
  if (whiteLeft === 0) return 'black'
  return null
}

function buildTurns(board, turn) {
  const starts = allCaptureStarts(board, turn)
  const followJumps = (b, at) => {
    const nextJumps = jumpMoves(b, at)
    if (nextJumps.length === 0) return [b]
    const out = []
    for (const target of nextJumps) {
      const { board: nextBoard, promoted } = applyMove(b, at, target)
      if (promoted) out.push(nextBoard)
      else out.push(...followJumps(nextBoard, target))
    }
    return out
  }

  if (starts.length > 0) return starts.flatMap((start) => followJumps(cloneBoard(board), start))

  const out = []
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const piece = board[r][c]
      if (!piece || piece.player !== turn) continue
      for (const target of stepMoves(board, { r, c })) out.push(applyMove(board, { r, c }, target).board)
    }
  }
  return out
}

function evaluateBoard(board, root, weights) {
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
      const mobility = stepMoves(board, { r, c }).length
      if (piece.player === root) mobilityRoot += mobility
      else mobilityEnemy += mobility
    }
  }

  score += (mobilityRoot - mobilityEnemy) * weights.mobility
  score += (allCaptureStarts(board, root).length - allCaptureStarts(board, nextPlayer(root)).length) * weights.captureBonus

  const formationScore = whiteOpeningFormationScore(board)
  score += root === 'white' ? formationScore : -formationScore

  return score
}

function bestBoard(board, turn, depth, weights) {
  const search = (b, d, side, alpha, beta) => {
    const winner = winnerByPieces(b)
    if (winner === turn) return 10_000 + d
    if (winner && winner !== turn) return -10_000 - d
    const moves = buildTurns(b, side)
    if (d === 0 || moves.length === 0) return evaluateBoard(b, turn, weights)
    const next = nextPlayer(side)

    if (side === turn) {
      let best = -Infinity
      for (const move of moves) {
        best = Math.max(best, search(move, d - 1, next, alpha, beta))
        alpha = Math.max(alpha, best)
        if (beta <= alpha) break
      }
      return best
    }

    let best = Infinity
    for (const move of moves) {
      best = Math.min(best, search(move, d - 1, next, alpha, beta))
      beta = Math.min(beta, best)
      if (beta <= alpha) break
    }
    return best
  }

  const moves = buildTurns(board, turn)
  if (moves.length === 0) return null
  let bestScore = -Infinity
  let chosen = moves[0]
  for (const move of moves) {
    const score = search(move, depth - 1, nextPlayer(turn), -Infinity, Infinity)
    if (score > bestScore || (score === bestScore && random() < 0.2)) {
      bestScore = score
      chosen = move
    }
  }
  return chosen
}

function playGame(blackWeights, whiteWeights) {
  let board = initBoard()
  let turn = 'black'
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const winner = winnerByPieces(board)
    if (winner) return winner
    const weights = turn === 'black' ? blackWeights : whiteWeights
    const next = bestBoard(board, turn, SEARCH_DEPTH, weights)
    if (!next) return nextPlayer(turn)
    board = next
    turn = nextPlayer(turn)
  }
  const blackScore = evaluateBoard(board, 'black', blackWeights)
  const whiteScore = evaluateBoard(board, 'white', whiteWeights)
  if (blackScore > whiteScore) return 'black'
  if (whiteScore > blackScore) return 'white'
  return 'draw'
}

function matchScore(candidate, champion) {
  const first = playGame(candidate, champion)
  const second = playGame(champion, candidate)
  let score = 0
  if (first === 'black') score += 1
  else if (first === 'draw') score += 0.5
  if (second === 'white') score += 1
  else if (second === 'draw') score += 0.5
  return score
}

function train() {
  let best = readWeights()
  let bestScore = 0
  console.log('Starting weights:', best)

  for (let round = 1; round <= ROUNDS; round++) {
    const scale = Math.max(0.25, 1 - (round - 1) / ROUNDS)
    const candidates = [best, ...Array.from({ length: CANDIDATES_PER_ROUND }, () => mutate(best, scale))]
    let roundBest = best
    let roundBestScore = -Infinity

    for (const candidate of candidates) {
      const score = matchScore(candidate, best)
      if (score > roundBestScore) {
        roundBestScore = score
        roundBest = candidate
      }
    }

    best = roundBest
    bestScore = roundBestScore
    console.log(`Round ${round}/${ROUNDS}: score=${roundBestScore.toFixed(2)}`, best)
  }

  const output = `${JSON.stringify(normalizeWeights(best), null, 2)}\n`
  writeFileSync(MODEL_PATH, output)
  console.log(`Wrote trained weights to ${MODEL_PATH} with final score ${bestScore.toFixed(2)}`)
}

train()
