import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BOARD_SIZE = 8
const MAX_PLIES = Number.parseInt(process.env.VALUE_MAX_PLIES ?? '140', 10)
const GAMES = Number.parseInt(process.env.VALUE_GAMES ?? '200', 10)
const DEPTH = Number.parseInt(process.env.VALUE_DEPTH ?? '2', 10)
const LEARNING_RATE = Number.parseFloat(process.env.VALUE_LR ?? '0.035')
const SAMPLE_EVERY = Number.parseInt(process.env.VALUE_SAMPLE_EVERY ?? '2', 10)
const MODEL_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'value-trained.json')
const ALPHA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'alpha-beta-trained.json')

const alphaWeights = readJson(ALPHA_PATH, { man: 2, king: 5, mobility: 0.15, captureBonus: 0.4, kingAdvance: 0.05 })
const defaultValueWeights = {
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
const FEATURE_NAMES = Object.keys(defaultValueWeights)
let seed = Number.parseInt(process.env.VALUE_SEED ?? '17067', 10)

function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function normalizeValueWeights(weights) {
  const out = { ...defaultValueWeights }
  for (const key of FEATURE_NAMES) {
    const value = weights?.[key]
    if (Number.isFinite(value)) out[key] = value
  }
  return out
}

function initBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null))
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) if ((r + c) % 2 === 1) board[r][c] = { player: 'black', king: false }
  }
  for (let r = 6; r < 8; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) if ((r + c) % 2 === 1) board[r][c] = { player: 'white', king: false }
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
      const mr = from.r + dr, mc = from.c + dc, tr = from.r + dr * 2, tc = from.c + dc * 2
      if (!inBounds(mr, mc) || !inBounds(tr, tc) || board[tr][tc]) continue
      const mid = board[mr][mc]
      if (mid && mid.player !== piece.player) out.push({ r: tr, c: tc })
    }
    return out
  }
  for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let r = from.r + dr, c = from.c + dc
    while (inBounds(r, c) && !board[r][c]) { r += dr; c += dc }
    if (!inBounds(r, c)) continue
    const target = board[r][c]
    if (!target || target.player === piece.player) continue
    const landR = r + dr, landC = c + dc
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
      const nr = from.r + dr, nc = from.c + dc
      if (inBounds(nr, nc) && !board[nr][nc]) out.push({ r: nr, c: nc })
    }
    return out
  }
  for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let r = from.r + dr, c = from.c + dc
    while (inBounds(r, c) && !board[r][c]) { out.push({ r, c }); r += dr; c += dc }
  }
  return out
}

function allCaptureStarts(board, turn) {
  const starts = []
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    const piece = board[r][c]
    if (piece && piece.player === turn && jumpMoves(board, { r, c }).length > 0) starts.push({ r, c })
  }
  return starts
}

function capturedBetween(board, from, to) {
  const dr = Math.sign(to.r - from.r), dc = Math.sign(to.c - from.c)
  let r = from.r + dr, c = from.c + dc, found = null
  while (r !== to.r && c !== to.c) {
    if (board[r][c]) {
      if (found) return null
      found = { r, c }
    }
    r += dr; c += dc
  }
  return found
}

function applyMove(board, from, to) {
  const next = cloneBoard(board)
  const piece = next[from.r][from.c]
  if (!piece) return { board: next, promoted: false, captured: null }
  const captured = capturedBetween(board, from, to)
  next[from.r][from.c] = null
  next[to.r][to.c] = piece
  if (captured) next[captured.r][captured.c] = null
  let promoted = false
  if (!piece.king && ((piece.player === 'black' && to.r === 7) || (piece.player === 'white' && to.r === 0))) {
    piece.king = true
    promoted = true
  }
  return { board: next, promoted, captured }
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
      const moved = applyMove(b, at, target)
      if (moved.promoted) out.push(moved.board)
      else out.push(...followJumps(moved.board, target))
    }
    return out
  }
  if (starts.length > 0) return starts.flatMap((start) => followJumps(cloneBoard(board), start))
  const out = []
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    const piece = board[r][c]
    if (!piece || piece.player !== turn) continue
    for (const target of stepMoves(board, { r, c })) out.push(applyMove(board, { r, c }, target).board)
  }
  return out
}

function maxCaptureChain(board, from, limit = 8) {
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

function sideLongestCapture(board, side) {
  let longest = 0
  for (const start of allCaptureStarts(board, side)) longest = Math.max(longest, maxCaptureChain(board, start))
  return longest
}

function countKingLineControl(board, from) {
  const piece = board[from.r]?.[from.c]
  if (!piece?.king) return 0
  let control = 0
  for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let r = from.r + dr, c = from.c + dc
    while (inBounds(r, c) && !board[r][c]) { control += 1; r += dr; c += dc }
  }
  return control
}

function extractFeatures(board, root) {
  const enemy = nextPlayer(root)
  const f = Object.fromEntries(FEATURE_NAMES.map((name) => [name, 0]))
  f.bias = 1
  let rootMobility = 0, enemyMobility = 0, rootKingLine = 0, enemyKingLine = 0
  let rootCenter = 0, enemyCenter = 0, rootEdge = 0, enemyEdge = 0, rootAdvance = 0, enemyAdvance = 0
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    const piece = board[r][c]
    if (!piece) continue
    const sign = piece.player === root ? 1 : -1
    if (piece.king) f.kingDiff += sign
    else f.manDiff += sign
    const mobility = stepMoves(board, { r, c }).length
    const kingLine = countKingLineControl(board, { r, c })
    const center = r >= 2 && r <= 5 && c >= 2 && c <= 5 ? 1 : 0
    const edge = r === 0 || r === 7 || c === 0 || c === 7 ? 1 : 0
    const advance = piece.king ? 0 : piece.player === 'black' ? r : 7 - r
    if (piece.player === root) {
      rootMobility += mobility; rootKingLine += kingLine; rootCenter += center; rootEdge += edge; rootAdvance += advance
    } else {
      enemyMobility += mobility; enemyKingLine += kingLine; enemyCenter += center; enemyEdge += edge; enemyAdvance += advance
    }
  }
  const rootCaps = allCaptureStarts(board, root).length
  const enemyCaps = allCaptureStarts(board, enemy).length
  let risky = 0
  for (const start of allCaptureStarts(board, root)) for (const target of jumpMoves(board, start)) {
    if (allCaptureStarts(applyMove(board, start, target).board, enemy).length > 0) risky += 1
  }
  f.manDiff /= 8
  f.kingDiff /= 4
  f.mobilityDiff = (rootMobility - enemyMobility) / 16
  f.captureThreatDiff = (rootCaps - enemyCaps) / 4
  f.longestCaptureDiff = (sideLongestCapture(board, root) - sideLongestCapture(board, enemy)) / 4
  f.recaptureRisk = Math.min(4, risky) / 4
  f.kingLineControlDiff = (rootKingLine - enemyKingLine) / 24
  f.centerControlDiff = (rootCenter - enemyCenter) / 8
  f.edgePenaltyDiff = (rootEdge - enemyEdge) / 8
  f.advancementDiff = (rootAdvance - enemyAdvance) / 28
  f.opponentMobilityPressure = enemyMobility === 0 ? 1 : Math.max(0, 6 - enemyMobility) / 6
  return f
}

function valueEval(board, root, weights) {
  const features = extractFeatures(board, root)
  return FEATURE_NAMES.reduce((sum, key) => sum + features[key] * weights[key], 0)
}

function evaluateBoard(board, root, valueWeights) {
  let score = valueEval(board, root, valueWeights)
  let classic = 0
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    const piece = board[r][c]
    if (!piece) continue
    const base = piece.king ? alphaWeights.king : alphaWeights.man
    const advance = piece.king ? 0 : (piece.player === 'black' ? r : 7 - r) * alphaWeights.kingAdvance
    classic += piece.player === root ? base + advance : -(base + advance)
  }
  classic += (allCaptureStarts(board, root).length - allCaptureStarts(board, nextPlayer(root)).length) * alphaWeights.captureBonus
  return classic + score
}

function bestBoard(board, turn, depth, valueWeights) {
  const search = (b, d, side, alpha, beta) => {
    const winner = winnerByPieces(b)
    if (winner === turn) return 10_000 + d
    if (winner && winner !== turn) return -10_000 - d
    const moves = buildTurns(b, side)
    if (moves.length === 0) return side === turn ? -10_000 - d : 10_000 + d
    if (d === 0) return evaluateBoard(b, turn, valueWeights)
    const next = nextPlayer(side)
    if (side === turn) {
      let best = -Infinity
      for (const move of moves) { best = Math.max(best, search(move, d - 1, next, alpha, beta)); alpha = Math.max(alpha, best); if (beta <= alpha) break }
      return best
    }
    let best = Infinity
    for (const move of moves) { best = Math.min(best, search(move, d - 1, next, alpha, beta)); beta = Math.min(beta, best); if (beta <= alpha) break }
    return best
  }
  const moves = buildTurns(board, turn)
  if (moves.length === 0) return null
  let chosen = moves[Math.floor(random() * moves.length)]
  let bestScore = -Infinity
  for (const move of moves) {
    const score = search(move, depth - 1, nextPlayer(turn), -Infinity, Infinity)
    if (score > bestScore || (score === bestScore && random() < 0.2)) { bestScore = score; chosen = move }
  }
  return chosen
}

function playGame(valueWeights) {
  let board = initBoard()
  let turn = 'black'
  const samples = []
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const winner = winnerByPieces(board)
    if (winner) return { winner, samples }
    if (ply % SAMPLE_EVERY === 0) samples.push({ board: cloneBoard(board), turn })
    const next = bestBoard(board, turn, DEPTH, valueWeights)
    if (!next) return { winner: nextPlayer(turn), samples }
    board = next
    turn = nextPlayer(turn)
  }
  const blackScore = evaluateBoard(board, 'black', valueWeights)
  const whiteScore = evaluateBoard(board, 'white', valueWeights)
  return { winner: blackScore > whiteScore ? 'black' : whiteScore > blackScore ? 'white' : 'draw', samples }
}

function targetFor(winner, root) {
  if (winner === 'draw') return 0
  return winner === root ? 1 : -1
}

function train() {
  const weights = normalizeValueWeights(readJson(MODEL_PATH, defaultValueWeights))
  let samplesSeen = 0
  let errorSum = 0
  console.log('Starting value weights:', weights)
  for (let game = 1; game <= GAMES; game++) {
    const { winner, samples } = playGame(weights)
    for (const sample of samples) {
      const target = targetFor(winner, sample.turn)
      const features = extractFeatures(sample.board, sample.turn)
      const prediction = Math.tanh(FEATURE_NAMES.reduce((sum, key) => sum + features[key] * weights[key], 0) / 3)
      const error = target - prediction
      errorSum += Math.abs(error)
      samplesSeen += 1
      for (const key of FEATURE_NAMES) {
        weights[key] += LEARNING_RATE * error * features[key]
        weights[key] = Math.max(-8, Math.min(8, Number(weights[key].toFixed(5))))
      }
    }
    if (game % Math.max(1, Math.floor(GAMES / 10)) === 0) {
      console.log(`Game ${game}/${GAMES}: winner=${winner}, samples=${samplesSeen}, meanAbsError=${(errorSum / samplesSeen).toFixed(4)}`)
    }
  }
  writeFileSync(MODEL_PATH, `${JSON.stringify(weights, null, 2)}\n`)
  console.log(`Wrote trained value model to ${MODEL_PATH}`)
  console.log(weights)
}

train()
