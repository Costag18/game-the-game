import { createContext, useContext, useEffect, useReducer, useCallback } from 'react';

const PetContext = createContext(null);

const SHOP_ITEMS = [
  { id: 'bowtie', name: 'Bow Tie', emoji: '🎀', cost: 10, slot: 'neck' },
  { id: 'hat', name: 'Hat', emoji: '🎩', cost: 20, slot: 'head' },
  { id: 'sunglasses', name: 'Shades', emoji: '🕶️', cost: 35, slot: 'eyes' },
  { id: 'crown', name: 'Crown', emoji: '👑', cost: 50, slot: 'head' },
  { id: 'diamond', name: 'Diamond', emoji: '💎', cost: 75, slot: 'side' },
  { id: 'trophy', name: 'Trophy', emoji: '🏆', cost: 100, slot: 'side' },
  { id: 'rocket', name: 'Rocket', emoji: '🚀', cost: 150, slot: 'side' },
  { id: 'rainbow', name: 'Rainbow', emoji: '🌈', cost: 200, slot: 'head' },
];

const INITIAL_STATE = {
  coins: 10,
  hunger: 80,
  happiness: 80,
  energy: 80,
  inventory: [],
  equipped: {}, // { head: 'crown', neck: 'bowtie', eyes: null, side: null }
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
        petCooldown: 3, // 3 ticks = 30s at 10s/tick
      };
    }
    case 'SLEEP': {
      if (state.sleepCooldown > 0) return state;
      return {
        ...state,
        energy: Math.min(100, state.energy + 30),
        sleepCooldown: 6, // 6 ticks = 60s
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
      const item = SHOP_ITEMS.find((i) => i.id === action.itemId);
      if (!item) return state;
      const newEquipped = { ...state.equipped };
      // Toggle: if already equipped in that slot, unequip
      if (newEquipped[item.slot] === action.itemId) {
        newEquipped[item.slot] = null;
      } else {
        newEquipped[item.slot] = action.itemId;
      }
      return { ...state, equipped: newEquipped };
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

  // Decay stats every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'TICK' }), 10000);
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
