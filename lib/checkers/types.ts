export type Player = 'black' | 'white'
export type Piece = { player: Player; king: boolean }
export type Pos = { r: number; c: number }
export type Board = (Piece | null)[][]

export type BotLevel = 'easy' | 'normal' | 'hard' | 'custom'
export type BotEngine = 'alpha-beta' | 'deep-q'

export type Weights = {
  man: number
  king: number
  mobility: number
  captureBonus: number
  kingAdvance: number
}
