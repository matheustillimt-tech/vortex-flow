/**
 * Som de mensagem de chat, estilo WhatsApp.
 * Dois "pops" curtos e brilhantes, claramente distintos do som de notificação
 * geral (que é mais grave e suave). Gerado via Web Audio API.
 */

import { isMuted } from "@/lib/notification-sound";

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

function pop(
  ctx: AudioContext,
  startAt: number,
  freq: number,
  durationSec: number,
  peakGain: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  // Onda triangular: timbre mais "pop" / "bolha", aproximando o feel do WhatsApp
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, startAt);
  // Pequeno gliss descendente em cada nota: dá aquela sensação de "bolha"
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(freq * 0.78, 200),
    startAt + durationSec
  );

  // Envelope: ataque imediato, decay rápido — "tek tek"
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

/**
 * Toca o som de nova mensagem ("pop-pop" duplo).
 * Retorna true se conseguiu disparar.
 */
export function playMessageSound(volume = 0.22): boolean {
  if (isMuted()) return false;
  const ctx = getCtx();
  if (!ctx) return false;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  const now = ctx.currentTime;
  // Dois pops próximos: primeiro mais agudo, segundo um pouco mais grave —
  // padrão característico do WhatsApp ("ti-tum").
  pop(ctx, now, 1200, 0.09, volume);
  pop(ctx, now + 0.08, 900, 0.12, volume * 0.85);
  return true;
}
