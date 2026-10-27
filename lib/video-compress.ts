/**
 * Compressão de vídeo no browser usando MediaRecorder + canvas.
 * - Sem dependências externas.
 * - Funciona em Chrome, Firefox e Safari 16+ (WebM ou MP4 conforme suporte).
 * - Roda em tempo real (a duração do vídeo + um pouco). Mostra progresso.
 * - Calcula bitrate para tentar caber em `targetBytes` com margem.
 * - Reduz resolução pra teto de 720p (long edge) por padrão.
 *
 * Cuidado: a faixa de áudio é capturada via captureStream() do <video>, o que
 * funciona em Chromium e Firefox. Safari pode acabar sem áudio em alguns
 * cenários — nesse caso ainda assim devolvemos o vídeo comprimido (mudo).
 */

export interface CompressOptions {
  /** Tamanho-alvo em bytes (default: 95 MB). */
  targetBytes?: number;
  /** Maior aresta da resolução em px (default: 720). */
  maxResolution?: number;
  /** Frames por segundo do output (default: 30). */
  fps?: number;
  /** Bitrate mínimo de vídeo em bps (default: 400_000). */
  minVideoBitrate?: number;
  /** Callback de progresso 0..1 chamado durante a compressão. */
  onProgress?: (p: number) => void;
}

export interface CompressResult {
  blob: Blob;
  /** Extensão sugerida pra nomear o arquivo (.webm ou .mp4). */
  ext: string;
  /** MIME do output. */
  mime: string;
  /** Resolução final (px). */
  width: number;
  height: number;
  /** Duração em segundos (≈ a original). */
  duration: number;
}

/** True se este browser tem o mínimo necessário pra rodar. */
export function canCompressVideo(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof MediaRecorder === "undefined") return false;
  // canvas.captureStream + HTMLVideoElement.captureStream
  const c = document.createElement("canvas") as HTMLCanvasElement & {
    captureStream?: () => unknown;
  };
  if (typeof c.captureStream !== "function") return false;
  return true;
}

function pickMime(): { mime: string; ext: string } | null {
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
    // Safari só suporta MP4 com MediaRecorder
    { mime: "video/mp4;codecs=h264,aac", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" }
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return null;
}

export async function compressVideoForUpload(
  file: File,
  opts: CompressOptions = {}
): Promise<CompressResult> {
  if (!canCompressVideo()) {
    throw new Error("Este navegador não suporta compressão de vídeo no browser.");
  }
  const mimePick = pickMime();
  if (!mimePick) {
    throw new Error("MediaRecorder não suporta nenhum formato compatível.");
  }

  const {
    targetBytes = 95 * 1024 * 1024,
    maxResolution = 720,
    fps = 30,
    minVideoBitrate = 400_000,
    onProgress
  } = opts;

  // 1) Carrega o vídeo source num <video> oculto
  const srcUrl = URL.createObjectURL(file);
  const srcVideo = document.createElement("video");
  srcVideo.src = srcUrl;
  srcVideo.crossOrigin = "anonymous";
  srcVideo.muted = false;
  srcVideo.playsInline = true;
  srcVideo.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      srcVideo.onloadedmetadata = () => resolve();
      srcVideo.onerror = () => reject(new Error("Não consegui ler o vídeo."));
    });
    // Em alguns browsers precisa esperar `canplay` pra dimensões serem sólidas
    if (!srcVideo.videoWidth || !srcVideo.videoHeight) {
      await new Promise<void>((resolve, reject) => {
        srcVideo.oncanplay = () => resolve();
        srcVideo.onerror = () => reject(new Error("Falha ao processar vídeo."));
      });
    }

    const duration = Math.max(srcVideo.duration || 0.1, 0.1);
    const srcW = srcVideo.videoWidth;
    const srcH = srcVideo.videoHeight;
    if (!srcW || !srcH) throw new Error("Resolução do vídeo desconhecida.");

    // 2) Decide resolução de saída (long edge ≤ maxResolution)
    const longer = Math.max(srcW, srcH);
    const scale = longer > maxResolution ? maxResolution / longer : 1;
    // Mantém múltiplos de 2 (alguns encoders exigem)
    const evenize = (n: number) => Math.max(2, Math.round(n) - (Math.round(n) % 2));
    const outW = evenize(srcW * scale);
    const outH = evenize(srcH * scale);

    // 3) Calcula bitrate alvo
    const audioBitrate = 96_000;
    const desiredTotalBps = (targetBytes * 8) / duration; // bps p/ caber
    const videoBitrate = Math.max(
      minVideoBitrate,
      Math.floor(desiredTotalBps - audioBitrate)
    );

    // 4) Monta canvas e stream
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas indisponível.");

    type CanvasWithCapture = HTMLCanvasElement & {
      captureStream: (frameRate?: number) => MediaStream;
    };
    const canvasStream = (canvas as CanvasWithCapture).captureStream(fps);

    // 5) Captura áudio do <video> source (quando suportado)
    type VideoWithCapture = HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    let audioTrack: MediaStreamTrack | undefined;
    try {
      const vAny = srcVideo as VideoWithCapture;
      const vStream =
        vAny.captureStream?.() ?? vAny.mozCaptureStream?.() ?? null;
      if (vStream) {
        audioTrack = vStream.getAudioTracks()[0];
      }
    } catch {
      /* sem áudio em browsers que não suportam captureStream em <video> */
    }

    const outStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...(audioTrack ? [audioTrack] : [])
    ]);

    // 6) Configura MediaRecorder
    const recorder = new MediaRecorder(outStream, {
      mimeType: mimePick.mime,
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: audioBitrate
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    // 7) Dispara a gravação + reprodução + render no canvas
    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimePick.mime });
        resolve(blob);
      };
      recorder.onerror = () => reject(new Error("Falha na gravação."));
    });

    recorder.start(500);
    srcVideo.currentTime = 0;
    try {
      await srcVideo.play();
    } catch (e) {
      // Autoplay restrito → falha
      throw new Error(
        "Não consegui reproduzir o vídeo para comprimir (autoplay bloqueado)."
      );
    }

    let stopped = false;
    function stopRecording() {
      if (stopped) return;
      stopped = true;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* ignore */
      }
    }

    function drawLoop() {
      if (stopped) return;
      ctx!.drawImage(srcVideo, 0, 0, outW, outH);
      if (onProgress) {
        onProgress(Math.min(1, srcVideo.currentTime / duration));
      }
      if (srcVideo.ended || srcVideo.paused) {
        // Garante que o último frame entrou
        setTimeout(stopRecording, 200);
        return;
      }
      requestAnimationFrame(drawLoop);
    }

    srcVideo.onended = () => {
      setTimeout(stopRecording, 200);
    };
    requestAnimationFrame(drawLoop);

    const blob = await done;
    return {
      blob,
      mime: mimePick.mime,
      ext: mimePick.ext,
      width: outW,
      height: outH,
      duration
    };
  } finally {
    URL.revokeObjectURL(srcUrl);
    try {
      srcVideo.pause();
    } catch {
      /* ignore */
    }
    srcVideo.removeAttribute("src");
    srcVideo.load();
  }
}
