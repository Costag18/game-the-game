import { useState, useEffect, useRef } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './Chat.module.css';

export default function Chat() {
  const { socket } = useSocketContext();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    function onMessage(msg) {
      setMessages((prev) => [...prev, msg]);
    }

    socket.on(EVENTS.CHAT_MESSAGE, onMessage);
    return () => socket.off(EVENTS.CHAT_MESSAGE, onMessage);
  }, [socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || !socket) return;
    socket.emit(EVENTS.CHAT_SEND, { message: text });
    setInput('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className={styles.chat}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Chat</span>
      </div>

      <div className={styles.messageList}>
        {messages.length === 0 && (
          <p className={styles.empty}>No messages yet…</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={styles.message}>
            <span className={styles.nick}>{msg.nickname}:</span>
            <span className={styles.text}> {msg.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="text"
          placeholder="Type a message…"
          value={input}
          maxLength={200}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className={styles.btnSend}
          onClick={handleSend}
          disabled={!input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
