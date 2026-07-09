import type { Rect } from "./objectFitCover";

/**
 * getUserMedia によるビューファインダのカメラストリーム管理と、
 * ガイド枠に対応する映像領域の canvas 切り出しを行う薄いラッパー。
 * ブラウザ API に依存するため単体テスト対象外（main.ts から利用）。
 */
export class Viewfinder {
  private stream: MediaStream | null = null;

  constructor(private readonly videoEl: HTMLVideoElement) {}

  get isActive(): boolean {
    return this.stream !== null;
  }

  /** 実映像解像度（未起動時は 0x0）。 */
  get videoSize(): { width: number; height: number } {
    return { width: this.videoEl.videoWidth, height: this.videoEl.videoHeight };
  }

  /**
   * 背面カメラを要求してビューファインダに接続する。
   * 非対応環境・権限拒否時は Error を投げる（呼び出し側でフォールバック表示する）。
   */
  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("このブラウザはカメラ (getUserMedia) に対応していません。");
    }
    // 解像度を明示要求する（既定では 640x480 になる端末が多く、ガイド枠切り出しが
    // ~310px まで落ちてゾーン名 OCR が不可能・細部照合も劣化する実測があった）。
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        // 4K を理想値で要求（非対応端末はブラウザが対応最大値に丸める）。
        // 引き構図でもゾーン名帯の文字に十分な画素数を確保するため。
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    });
    this.stream = stream;
    this.videoEl.srcObject = stream;
    await this.videoEl.play();
  }

  /** カメラストリームを停止し、トラックを解放する。 */
  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.videoEl.srcObject = null;
  }

  /** 省電力のため、確定表示中など照合が不要な間だけ映像デコードを止める。 */
  pause(): void {
    this.videoEl.pause();
  }

  /** pause() で止めた映像デコードを再開する。 */
  resume(): void {
    if (this.stream) {
      void this.videoEl.play();
    }
  }

  /**
   * ソース矩形 (video ピクセル座標) を canvas に描画し、ImageData として取り出す。
   * canvas のサイズは矩形サイズに合わせて変更される。
   */
  captureRegion(rect: Rect, canvas: HTMLCanvasElement): ImageData {
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas コンテキストを取得できませんでした。");
    }
    ctx.drawImage(
      this.videoEl,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );
    return ctx.getImageData(0, 0, rect.width, rect.height);
  }
}
