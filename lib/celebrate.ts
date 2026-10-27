"use client";

import confetti from "canvas-confetti";

/** Som "vitória" suave: acorde C-major (C5, E5, G5) curto e sequenciado. */
let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  return audioCtx;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  peak: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function playSuccessSound() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  // C5, E5, G5 — arpejo curto e doce
  playTone(ctx, 523.25, now, 0.18, 0.16);
  playTone(ctx, 659.25, now + 0.09, 0.22, 0.16);
  playTone(ctx, 783.99, now + 0.18, 0.32, 0.16);
}

/**
 * Dispara confetes a partir de um elemento (ex: o card da tarefa).
 * - Se `originOverride` é dado, usa essas coordenadas normalizadas (0..1).
 *   Útil quando o elemento será removido do DOM antes do confetti rodar.
 * - Senão tenta `getBoundingClientRect()` do elemento.
 * - Como fallback final, dispara do centro da tela.
 */
export function celebrate(
  element?: Element | null,
  originOverride?: { x: number; y: number } | null
) {
  let x = 0.5;
  let y = 0.5;
  if (originOverride) {
    x = originOverride.x;
    y = originOverride.y;
  } else {
    const rect = element?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      x = (rect.left + rect.width / 2) / window.innerWidth;
      y = (rect.top + rect.height / 2) / window.innerHeight;
    }
  }

  // 3 emissões curtas e suaves para um efeito agradável (não invasivo)
  void confetti({
    particleCount: 22,
    spread: 55,
    startVelocity: 28,
    gravity: 0.9,
    ticks: 80,
    scalar: 0.85,
    origin: { x, y },
    colors: ["#10b981", "#34d399", "#6ee7b7", "#fbbf24", "#a78bfa"]
  });
  setTimeout(
    () =>
      void confetti({
        particleCount: 14,
        spread: 70,
        startVelocity: 20,
        gravity: 0.8,
        ticks: 70,
        scalar: 0.75,
        origin: { x, y },
        colors: ["#10b981", "#fbbf24", "#a78bfa"]
      }),
    120
  );
  setTimeout(
    () =>
      void confetti({
        particleCount: 10,
        spread: 90,
        startVelocity: 14,
        gravity: 0.7,
        ticks: 60,
        scalar: 0.6,
        origin: { x, y },
        colors: ["#10b981", "#a78bfa"]
      }),
    260
  );

  playSuccessSound();
}
