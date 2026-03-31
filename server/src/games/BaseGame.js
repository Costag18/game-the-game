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

  removePlayer(playerId) {
    this.activePlayers = this.activePlayers.filter((p) => p !== playerId);
    if (this.currentTurnPlayer === playerId) {
      this.turnIndex = this.turnIndex % this.activePlayers.length;
      this.currentTurnPlayer = this.activePlayers[this.turnIndex] || null;
    }
  }
}
