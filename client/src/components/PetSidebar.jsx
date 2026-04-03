import { useState } from 'react';
import { usePet } from '../context/PetContext.jsx';
import CoinCatchGame from './CoinCatchGame.jsx';
import styles from './PetSidebar.module.css';

const PET_FACES = {
  happy: '😊',
  neutral: '😐',
  sad: '😢',
};

function StatBar({ label, value, color }) {
  return (
    <div className={styles.statBar}>
      <span className={styles.statLabel}>{label}</span>
      <div className={styles.statTrack}>
        <div className={styles.statFill} style={{ width: `${value}%`, background: color }} />
      </div>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

export default function PetSidebar() {
  const {
    coins, hunger, happiness, energy, mood, name,
    inventory, equipped, shopItems,
    feed, pet, sleep, buyItem, equip,
    petCooldown, sleepCooldown,
  } = usePet();

  const [shopOpen, setShopOpen] = useState(false);

  const equippedItem = shopItems.find((i) => i.id === equipped);

  return (
    <div className={styles.petSidebar}>
      {/* Pet Display */}
      <div className={styles.petDisplay}>
        <div className={styles.petAvatar}>
          <span className={styles.petFace}>{PET_FACES[mood]}</span>
          {equippedItem && (
            <span className={styles.petAccessory}>{equippedItem.emoji}</span>
          )}
        </div>
        <span className={styles.petName}>{name}</span>
        <span className={styles.coinCount}>🪙 {coins}</span>
      </div>

      {/* Stats */}
      <div className={styles.stats}>
        <StatBar label="🍖" value={hunger} color="#4caf50" />
        <StatBar label="💖" value={happiness} color="#e91e63" />
        <StatBar label="⚡" value={energy} color="#ff9800" />
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={feed} disabled={coins < 5}>
          Feed (5🪙)
        </button>
        <button className={styles.actionBtn} onClick={pet} disabled={petCooldown > 0}>
          {petCooldown > 0 ? `Pet (${petCooldown})` : 'Pet 🤗'}
        </button>
        <button className={styles.actionBtn} onClick={sleep} disabled={sleepCooldown > 0}>
          {sleepCooldown > 0 ? `Sleep (${sleepCooldown})` : 'Sleep 💤'}
        </button>
      </div>

      {/* Inventory */}
      {inventory.length > 0 && (
        <div className={styles.inventory}>
          <span className={styles.sectionLabel}>Items</span>
          <div className={styles.itemRow}>
            {inventory.map((itemId) => {
              const item = shopItems.find((i) => i.id === itemId);
              if (!item) return null;
              return (
                <button
                  key={itemId}
                  className={`${styles.itemBtn} ${equipped === itemId ? styles.itemEquipped : ''}`}
                  onClick={() => equip(equipped === itemId ? null : itemId)}
                  title={item.name}
                >
                  {item.emoji}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Shop */}
      <div className={styles.shop}>
        <button className={styles.shopToggle} onClick={() => setShopOpen(!shopOpen)}>
          Shop {shopOpen ? '▲' : '▼'}
        </button>
        {shopOpen && (
          <div className={styles.shopList}>
            {shopItems.map((item) => {
              const owned = inventory.includes(item.id);
              return (
                <div key={item.id} className={styles.shopItem}>
                  <span className={styles.shopEmoji}>{item.emoji}</span>
                  <span className={styles.shopName}>{item.name}</span>
                  {owned ? (
                    <span className={styles.shopOwned}>Owned</span>
                  ) : (
                    <button
                      className={styles.shopBuyBtn}
                      onClick={() => buyItem(item.id)}
                      disabled={coins < item.cost}
                    >
                      {item.cost}🪙
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Coin catch game */}
      <CoinCatchGame />
    </div>
  );
}
