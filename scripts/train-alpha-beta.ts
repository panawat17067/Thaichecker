import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Player = 'black' | 'white'
type Piece = { player: Player; king: boolean }
type Board = (Piece | null)[][]
type Weights = { man: number; king: number; mobility: number; captureBonus: number; kingAdvance: number }

const SIZE = 8
const KING_DIRS = [[1,1],[1,-1],[-1,1],[-1,-1]]
const defaultWeights: Weights = { man: 2, king: 5, mobility: 0.15, captureBonus: 0.4, kingAdvance: 0.05 }
const OUTPUT = resolve(process.cwd(), 'public/models/alpha-beta-trained.json')
const GAMES = Number(process.env.GAMES ?? 16)
const MAX_PLIES = Number(process.env.MAX_PLIES ?? 120)

const nextPlayer = (p: Player): Player => (p === 'black' ? 'white' : 'black')
const inBounds = (r: number,c:number) => r>=0&&r<SIZE&&c>=0&&c<SIZE
const clone = (b: Board): Board => b.map((row)=>row.map((p)=>p?{...p}:null))

function initBoard(): Board { const b: Board = Array.from({length:SIZE},()=>Array(SIZE).fill(null));
for(let r=0;r<2;r++)for(let c=0;c<SIZE;c++)if((r+c)%2===1)b[r][c]={player:'black',king:false}
for(let r=6;r<8;r++)for(let c=0;c<SIZE;c++)if((r+c)%2===1)b[r][c]={player:'white',king:false}
return b }

function dirs(piece: Piece){ return piece.king ? KING_DIRS : (piece.player==='black'?[[1,1],[1,-1]]:[[-1,1],[-1,-1]]) }
function steps(board:Board,r:number,c:number){const p=board[r][c];if(!p)return[] as [number,number][];const out:[number,number][]=[];for(const [dr,dc] of dirs(p)){let nr=r+dr,nc=c+dc;if(!p.king){if(inBounds(nr,nc)&&!board[nr][nc])out.push([nr,nc]);}else{while(inBounds(nr,nc)&&!board[nr][nc]){out.push([nr,nc]);nr+=dr;nc+=dc}}}return out}
function jumps(board:Board,r:number,c:number){const p=board[r][c];if(!p)return[] as [number,number][];const out:[number,number][]=[];if(!p.king){for(const [dr,dc] of dirs(p)){const mr=r+dr,mc=c+dc,tr=r+2*dr,tc=c+2*dc;if(inBounds(tr,tc)&&board[mr]?.[mc]&&board[mr][mc]!.player!==p.player&&!board[tr][tc])out.push([tr,tc])}return out}
for(const [dr,dc] of KING_DIRS){let nr=r+dr,nc=c+dc;while(inBounds(nr,nc)&&!board[nr][nc]){nr+=dr;nc+=dc}if(!inBounds(nr,nc))continue;const t=board[nr][nc];if(!t||t.player===p.player)continue;const lr=nr+dr,lc=nc+dc;if(inBounds(lr,lc)&&!board[lr][lc])out.push([lr,lc])}return out}

function apply(board:Board,fr:number,fc:number,tr:number,tc:number):Board{const b=clone(board);const p=b[fr][fc];if(!p)return b;b[fr][fc]=null;b[tr][tc]=p;const dr=Math.sign(tr-fr),dc=Math.sign(tc-fc);let r=fr+dr,c=fc+dc;while(r!==tr&&c!==tc){if(b[r][c]){b[r][c]=null;break}r+=dr;c+=dc}if(!p.king&&((p.player==='black'&&tr===7)||(p.player==='white'&&tr===0)))p.king=true;return b}
function captures(board:Board,turn:Player){const s:[number,number][]=[];for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++)if(board[r][c]?.player===turn&&jumps(board,r,c).length)s.push([r,c]);return s}
function moves(board:Board,turn:Player):Board[]{const caps=captures(board,turn);const out:Board[]=[];for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){if(board[r][c]?.player!==turn)continue;const list=caps.length?jumps(board,r,c):steps(board,r,c);for(const [nr,nc] of list)out.push(apply(board,r,c,nr,nc))}return out}
function evaluate(board:Board,root:Player,w:Weights){let s=0;for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){const p=board[r][c];if(!p)continue;const v=(p.king?w.king:w.man)+(!p.king?(p.player==='black'?r:7-r)*w.kingAdvance:0);s+=p.player===root?v:-v}return s}
function bestBoard(board:Board,turn:Player,depth:number,w:Weights):Board|null{const enemy=nextPlayer(turn);const search=(b:Board,d:number,side:Player,a:number,beta:number):number=>{const ms=moves(b,side);if(d===0||ms.length===0)return evaluate(b,turn,w);if(side===turn){let best=-Infinity;for(const m of ms){best=Math.max(best,search(m,d-1,enemy,a,beta));a=Math.max(a,best);if(beta<=a)break}return best}else{let best=Infinity;for(const m of ms){best=Math.min(best,search(m,d-1,turn,a,beta));beta=Math.min(beta,best);if(beta<=a)break}return best}};const ms=moves(board,turn);if(!ms.length)return null;let best=ms[0],score=-Infinity;for(const m of ms){const sc=search(m,depth-1,enemy,-Infinity,Infinity);if(sc>score){score=sc;best=m}}return best}

const jitter=(v:number,s:number)=>Math.max(0.001,v*(1+(Math.random()*2-1)*s))
const mutate=(base:Weights):Weights=>({man:jitter(base.man,.35),king:jitter(base.king,.3),mobility:jitter(base.mobility,.6),captureBonus:jitter(base.captureBonus,.6),kingAdvance:jitter(base.kingAdvance,.7)})

function duel(candidate: Weights, baseline: Weights){let score=0;for(let g=0;g<GAMES;g++){let b=initBoard();let t:Player='black';const side:Player=g%2===0?'black':'white';for(let p=0;p<MAX_PLIES;p++){const w=t===side?candidate:baseline;const d=t===side?3:2;const n=bestBoard(b,t,d,w);if(!n){score+=t===side?-1:1;break}b=n;t=nextPlayer(t)}}return score}

let best={...defaultWeights};let bestScore=duel(best,defaultWeights)
for(let i=0;i<30;i++){const c=mutate(best);const s=duel(c,best);if(s>=bestScore){best=c;bestScore=s}}
writeFileSync(OUTPUT,JSON.stringify(best,null,2)+'\n','utf8')
console.log('saved',OUTPUT,best)
