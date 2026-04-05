import { useEffect, useRef } from 'react';
import styles from './StockTicker.module.css';

export default function StockTicker() {
  const containerRef = useRef(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current || !containerRef.current) return;
    loadedRef.current = true;

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';
    script.async = true;
    script.type = 'text/javascript';
    script.textContent = JSON.stringify({
      symbols: [
        { proName: 'FOREXCOM:SPXUSD', title: 'S&P 500' },
        { proName: 'FOREXCOM:NSXUSD', title: 'US 100' },
        { proName: 'FX_IDC:EURUSD', title: 'EUR/USD' },
        { proName: 'BITSTAMP:BTCUSD', title: 'Bitcoin' },
        { proName: 'BITSTAMP:ETHUSD', title: 'Ethereum' },
        { proName: 'NASDAQ:AAPL', title: 'Apple' },
        { proName: 'NASDAQ:GOOGL', title: 'Google' },
        { proName: 'NASDAQ:MSFT', title: 'Microsoft' },
        { proName: 'NASDAQ:AMZN', title: 'Amazon' },
        { proName: 'NASDAQ:TSLA', title: 'Tesla' },
        { proName: 'NASDAQ:NVDA', title: 'NVIDIA' },
        { proName: 'NASDAQ:META', title: 'Meta' },
        { proName: 'TSX:SHOP', title: 'Shopify' },
        { proName: 'TSX:RY', title: 'Royal Bank' },
        { proName: 'TSX:TD', title: 'TD Bank' },
      ],
      showSymbolLogo: false,
      isTransparent: true,
      displayMode: 'compact',
      colorTheme: 'dark',
      locale: 'en',
    });
    containerRef.current.appendChild(script);
  }, []);

  return (
    <div className={styles.tickerWrap}>
      <div className="tradingview-widget-container" ref={containerRef}>
        <div className="tradingview-widget-container__widget" />
      </div>
    </div>
  );
}
