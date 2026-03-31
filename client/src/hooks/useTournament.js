import { useEffect, useState, useCallback } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';

export function useTournament() {
  const { socket } = useSocketContext();
  const [tournamentState, setTournamentState] = useState(null);
  const [eligibleGames, setEligibleGames] = useState([]);
  const [voteResult, setVoteResult] = useState(null);
  const [roundResults, setRoundResults] = useState(null);
  const [tournamentEnd, setTournamentEnd] = useState(null);
  const [gameState, setGameState] = useState(null);

  useEffect(() => {
    if (!socket) return;
    socket.on(EVENTS.TOURNAMENT_STATE, setTournamentState);
    socket.on(EVENTS.ROUND_START, (data) => setEligibleGames(data.eligibleGames));
    socket.on(EVENTS.VOTE_RESULT, setVoteResult);
    socket.on(EVENTS.ROUND_RESULTS, setRoundResults);
    socket.on(EVENTS.TOURNAMENT_END, setTournamentEnd);
    socket.on(EVENTS.GAME_STATE, setGameState);
    return () => {
      socket.off(EVENTS.TOURNAMENT_STATE, setTournamentState);
      socket.off(EVENTS.ROUND_START);
      socket.off(EVENTS.VOTE_RESULT, setVoteResult);
      socket.off(EVENTS.ROUND_RESULTS, setRoundResults);
      socket.off(EVENTS.TOURNAMENT_END, setTournamentEnd);
      socket.off(EVENTS.GAME_STATE, setGameState);
    };
  }, [socket]);

  const vote = useCallback((gameId) => { socket?.emit(EVENTS.VOTE_GAME, gameId); }, [socket]);
  const submitWager = useCallback((amount) => { socket?.emit(EVENTS.WAGER_SUBMIT, amount); }, [socket]);
  const sendAction = useCallback((action) => { socket?.emit(EVENTS.GAME_ACTION, action); }, [socket]);
  const clearRoundResults = useCallback(() => setRoundResults(null), []);

  return { tournamentState, eligibleGames, voteResult, roundResults, tournamentEnd, gameState, vote, submitWager, sendAction, clearRoundResults };
}
