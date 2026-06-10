import { createContext, useContext, useState, useEffect } from 'react';

const KEY = 'northstar_timer_started_at';
const TimerContext = createContext(null);

function pad(n) { return String(n).padStart(2, '0'); }

export function formatTimer(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function TimerProvider({ children }) {
  const [startedAt, setStartedAt] = useState(() => {
    const v = localStorage.getItem(KEY);
    return v ? Number(v) : null;
  });
  const [now, setNow] = useState(() => Date.now());

  // Elapsed time is derived from the persisted start timestamp, not from
  // counting ticks — so a throttled background tab or locked phone never
  // loses time. The interval only refreshes the display.
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Pick up a timer started or stopped in another tab.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === KEY) setStartedAt(e.newValue ? Number(e.newValue) : null);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function start() {
    const t = Date.now();
    localStorage.setItem(KEY, String(t));
    setStartedAt(t);
  }

  // Returns total elapsed seconds and clears the timer.
  function stop() {
    const secs = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
    localStorage.removeItem(KEY);
    setStartedAt(null);
    return secs;
  }

  const running = startedAt != null;
  const seconds = running ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  return (
    <TimerContext.Provider value={{ running, seconds, start, stop }}>
      {children}
    </TimerContext.Provider>
  );
}

export function useTimer() {
  return useContext(TimerContext);
}
