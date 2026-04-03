import { createContext, useContext, useEffect, useReducer, useCallback } from 'react';

const PetContext = createContext(null);

const SHOP_ITEMS = [
  { id: 'hat', name: 'Hat', emoji: '🎩', cost: 20 },
  { id: 'sunglasses', name: 'Sunglasses', emoji: '😎', cost: 30 },
  { id: 'crown', name: 'Crown', emoji: '👑', cost: 50 },
  { id: 'bowtie', name: 'Bow Tie', emoji: '🎀', cost: 15 },
  { id: 'scarf', name: 'Scarf', emoji: '🧣', cost: 25 },
];

const INITIAL_STATE = {
  coins: 10,
  hunger: 80,
  happiness: 80,
  energy: 80,
  inventory: [],
  equipped: null,
  petCooldown: 0,
  sleepCooldown: 0,
  name: 'Buddy',
};

function petReducer(state, action) {
  switch (action.type) {
    case 'TICK': {
      return {
        ...state,
        hunger: Math.max(0, state.hunger - 2),
        happiness: Math.max(0, state.happiness - 1),
        energy: Math.max(0, state.energy - 1),
        petCooldown: Math.max(0, state.petCooldown - 1),
        sleepCooldown: Math.max(0, state.sleepCooldown - 1),
      };
    }
    case 'FEED': {
      if (state.coins < 5) return state;
      return {
        ...state,
        coins: state.coins - 5,
        hunger: Math.min(100, state.hunger + 30),
        happiness: Math.min(100, state.happiness + 5),
      };
    }
    case 'PET': {
      if (state.petCooldown > 0) return state;
      return {
        ...state,
        happiness: Math.min(100, state.happiness + 20),
        petCooldown: 10, // 10 ticks = ~5 min at 30s/tick
      };
    }
    case 'SLEEP': {
      if (state.sleepCooldown > 0) return state;
      return {
        ...state,
        energy: Math.min(100, state.energy + 30),
        sleepCooldown: 30, // 30 ticks = ~15 min
      };
    }
    case 'ADD_COINS': {
      return { ...state, coins: state.coins + action.amount };
    }
    case 'BUY_ITEM': {
      const item = SHOP_ITEMS.find((i) => i.id === action.itemId);
      if (!item || state.coins < item.cost) return state;
      if (state.inventory.includes(action.itemId)) return state;
      return {
        ...state,
        coins: state.coins - item.cost,
        inventory: [...state.inventory, action.itemId],
      };
    }
    case 'EQUIP': {
      return { ...state, equipped: action.itemId };
    }
    case 'SET_NAME': {
      return { ...state, name: action.name };
    }
    default:
      return state;
  }
}

export function PetProvider({ children }) {
  const [state, dispatch] = useReducer(petReducer, INITIAL_STATE);

  // Decay stats every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'TICK' }), 30000);
    return () => clearInterval(interval);
  }, []);

  const feed = useCallback(() => dispatch({ type: 'FEED' }), []);
  const pet = useCallback(() => dispatch({ type: 'PET' }), []);
  const sleep = useCallback(() => dispatch({ type: 'SLEEP' }), []);
  const addCoins = useCallback((amount) => dispatch({ type: 'ADD_COINS', amount }), []);
  const buyItem = useCallback((itemId) => dispatch({ type: 'BUY_ITEM', itemId }), []);
  const equip = useCallback((itemId) => dispatch({ type: 'EQUIP', itemId }), []);

  const mood = state.hunger > 60 && state.happiness > 60 && state.energy > 60
    ? 'happy'
    : (state.hunger < 30 || state.happiness < 30 || state.energy < 30 ? 'sad' : 'neutral');

  return (
    <PetContext.Provider value={{
      ...state, mood, feed, pet, sleep, addCoins, buyItem, equip,
      shopItems: SHOP_ITEMS,
    }}>
      {children}
    </PetContext.Provider>
  );
}

export function usePet() {
  const ctx = useContext(PetContext);
  if (!ctx) throw new Error('usePet must be inside PetProvider');
  return ctx;
}
