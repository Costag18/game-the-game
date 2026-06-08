export class BaseGame {
  constructor(players, fsmConfig) {
    this.players = [...players];
    this.activePlayers = [...players];
    this.fsmConfig = fsmConfig;
    this.state = fsmConfig.initialState;
    this.currentTurnPlayer = null;
    this.turnIndex = 0;
  }

  transition(action) {
    const currentTransitions = this.fsmConfig.transitions[this.state];
    if (!currentTransitions || !currentTransitions[action]) {
      throw new Error(`Invalid transition: "${action}" from state "${this.state}"`);
    }
    const nextState = currentTransitions[action];
    this.state = nextState;
    const hookName = `onEnter${nextState.charAt(0).toUpperCase() + nextState.slice(1)}`;
    if (typeof this[hookName] === 'function') {
      this[hookName]();
    }
  }

  setTurnPlayer(playerId) {
    this.currentTurnPlayer = playerId;
    this.turnIndex = this.activePlayers.indexOf(playerId);
  }

  nextTurn() {
    this.turnIndex = (this.turnIndex + 1) % this.activePlayers.length;
    this.currentTurnPlayer = this.activePlayers[this.turnIndex];
    return this.currentTurnPlayer;
  }

  /**
   * Remove a player from the active-turn rotation ONLY (e.g. in-game
   * elimination). The player REMAINS in `this.players` so they still appear in
   * scoring/results. Safely reassigns the current turn if it was theirs.
   */
  _removeFromActive(playerId) {
    const wasCurrent = this.currentTurnPlayer === playerId;
    this.activePlayers = this.activePlayers.filter((p) => p !== playerId);
    if (this.activePlayers.length === 0) {
      this.currentTurnPlayer = null;
      this.turnIndex = 0;
      return;
    }
    if (wasCurrent) {
      this.turnIndex = this.turnIndex % this.activePlayers.length;
      this.currentTurnPlayer = this.activePlayers[this.turnIndex];
    } else {
      const idx = this.activePlayers.indexOf(this.currentTurnPlayer);
      this.turnIndex = idx >= 0 ? idx : 0;
    }
  }

  /**
   * A player has LEFT the game entirely (disconnect / leave lobby). Unlike
   * elimination, this prunes them from BOTH the turn rotation AND the master
   * roster (`this.players`) so that turn rotation, acknowledgement checks,
   * end-conditions and results no longer wait on or include a player who is
   * gone. Games override this to add game-specific nudges (advance the turn,
   * re-check round/ack completion, finish if <=1 remain) but MUST call
   * super.removePlayer(playerId) first.
   */
  removePlayer(playerId) {
    this.players = this.players.filter((p) => p !== playerId);
    this._removeFromActive(playerId);
  }

  /**
   * Optional teardown hook. Games that own timers (setTimeout / Timer) override
   * this to clear them. The orchestration calls it before discarding a game so
   * orphaned timers can't fire on a torn-down instance.
   */
  destroy() {}
}
