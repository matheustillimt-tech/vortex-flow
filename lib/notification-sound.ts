/**
 * Som agradável de notificação gerado via Web Audio API.
 * Duas notas curtas (C5 → E5) com envelope suave — sem precisar de arquivos.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  return audioCtx;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  durationSec: number,
  peakGain: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);

  // Envelope: ataque rápido, decay suave
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

/** Toca o "ding-dong" suave. Retorna true se conseguiu tocar. */
export function playNotificationSound(volume = 0.18): boolean {
  if (isMuted()) return false;
  const ctx = getCtx();
  if (!ctx) return false;
  // Em alguns browsers o ctx começa "suspended" até interação do usuário.
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  const now = ctx.currentTime;
  // C5 e E5 (523.25Hz, 659.25Hz) — terça maior, agradável e curta
  playTone(ctx, 523.25, now, 0.18, volume);
  playTone(ctx, 659.25, now + 0.12, 0.28, volume * 0.9);
  return true;
}

const STORAGE_KEY = "vortex-notif-muted";

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function setMuted(v: boolean) {
  if (typeof window === "undefined") return;
  if (v) localStorage.setItem(STORAGE_KEY, "1");
  else localStorage.removeItem(STORAGE_KEY);
}
