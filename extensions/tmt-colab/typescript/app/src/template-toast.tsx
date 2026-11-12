import { useEffect, useState } from 'react';
import './template-card.css';

/** A short confirmation at the bottom of the screen, read out once and gone after a few seconds. */
export function useToast(): [string | undefined, (message: string) => void] {
  const [message, setMessage] = useState<{ text: string; at: number }>();
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(undefined), 3200);
    return () => clearTimeout(timer);
  }, [message]);
  return [message?.text, (text) => setMessage({ text, at: Date.now() })];
}
export function Toast({ message }: { message: string | undefined }) {
  return (
    <div className="template-toast" role="status" aria-live="polite">
      {message && <span className="template-toast-message">{message}</span>}
    </div>
  );
}
