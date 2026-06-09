const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/**
 * UltimateTTTMatch — one 1v1 Ultimate Tic-Tac-Toe board (9 sub-boards). Plain
 * object; the PairingEngine owns ranking/byes/timers/leave. Server-authoritative:
 * applyMove validates turn, the forced-board rule, sub-board availability, and cell
 * emptiness, so a client can never play out of turn, outside the forced board, or
 * in a taken cell. Perfect-information game — getView returns the full board.
 */
export class UltimateTTTMatch {
  constructor(p1, p2) {
    this.p1 = p1;
    this.p2 = p2;
    this.marks = { [p1]: 'X', [p2]: 'O' };
    this.turn = p1;
    this.sub = Array.from({ length: 9 }, () => Array(9).fill(''));
    this.meta = Array(9).fill('');
    this.forcedBoard = null; // null = play any open board
    this.lastMove = null;
    this._status = 'playing';
    this._winner = null;
  }

  _lineWin(cells, mark) { return LINES.some((L) => L.every((i) => cells[i] === mark)); }

  applyMove(playerId, move) {
    if (playerId !== this.turn || this._status !== 'playing') return false;
    const board = move && Number(move.board);
    const cell = move && Number(move.cell);
    if (!Number.isInteger(board) || board < 0 || board > 8) return false;
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return false;
    if (this.forcedBoard !== null && board !== this.forcedBoard) return false;
    if (this.meta[board] !== '') return false; // sub-board already decided
    if (this.sub[board][cell] !== '') return false; // cell taken

    const mark = this.marks[playerId];
    this.sub[board][cell] = mark;
    this.lastMove = { board, cell, mark, playerId };

    if (this._lineWin(this.sub[board], mark)) this.meta[board] = mark;
    else if (this.sub[board].every((c) => c !== '')) this.meta[board] = 'D';

    if (this.meta[board] === mark && this._lineWin(this.meta, mark)) {
      this._status = 'won'; this._winner = playerId; this.forcedBoard = null; this.turn = null;
      return true;
    }
    if (this.meta.every((m) => m !== '')) {
      this._status = 'draw'; this._winner = null; this.forcedBoard = null; this.turn = null;
      return true;
    }
    this.forcedBoard = this.meta[cell] === '' ? cell : null;
    this.turn = playerId === this.p1 ? this.p2 : this.p1;
    return true;
  }

  legalMoves() {
    const out = [];
    const boards = this.forcedBoard !== null
      ? [this.forcedBoard]
      : this.meta.map((s, i) => (s === '' ? i : -1)).filter((i) => i >= 0);
    for (const b of boards) for (let c = 0; c < 9; c++) if (this.sub[b][c] === '') out.push({ board: b, cell: c });
    return out;
  }
  autoMove() {
    const moves = this.legalMoves();
    if (!moves.length) return null;
    return moves[Math.floor(Math.random() * moves.length)];
  }

  getView(playerId) {
    return {
      metaBoard: [...this.meta],
      subBoards: this.sub.map((b) => [...b]),
      forcedBoard: this.forcedBoard,
      yourMark: this.marks[playerId],
      turn: this.turn,
      isMyTurn: this.turn === playerId,
      lastMove: this.lastMove,
      status: this._status,
      winnerMark: this._winner ? this.marks[this._winner] : null,
    };
  }

  isOver() { return this._status !== 'playing'; }
  winner() { return this._winner; }
  isDraw() { return this._status === 'draw'; }
  scoreDiff(playerId) {
    const opp = playerId === this.p1 ? this.p2 : this.p1;
    const myMark = this.marks[playerId];
    const oppMark = this.marks[opp];
    const mine = this.meta.filter((m) => m === myMark).length;
    const theirs = this.meta.filter((m) => m === oppMark).length;
    let bonus = 0;
    if (this._winner === playerId) bonus = 1000;
    else if (this._winner && this._winner !== playerId) bonus = -1000;
    return (mine - theirs) + bonus;
  }
  destroy() {}
}
