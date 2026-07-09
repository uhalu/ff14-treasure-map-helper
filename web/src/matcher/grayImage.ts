import { roundHalfEven } from "./mathUtil";

/** Canvas ImageData 互換 / PNG デコード結果互換の RGBA ピクセルソース。 */
export interface RgbaSource {
  width: number;
  height: number;
  /** 行優先の RGBA バイト列（stride なし、width*height*4 バイト）。 */
  data: Uint8Array | Uint8ClampedArray;
}

/**
 * グレースケール画像（輝度 0..1、行優先）。
 * 画像デコードには依存しない。呼び出し側がデコード済みピクセルを渡す。
 */
export class GrayImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Float32Array;

  constructor(width: number, height: number, pixels: Float32Array) {
    if (width <= 0 || height <= 0) {
      throw new RangeError("画像サイズは正の値が必要です。");
    }
    if (pixels.length !== width * height) {
      throw new Error(`ピクセル数が不正です: ${pixels.length} != ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.pixels = pixels;
  }

  /** RGBA（Canvas ImageData 相当）から BT.601 輝度でグレースケール化する。 */
  static fromImageData(source: RgbaSource): GrayImage {
    const { width, height, data } = source;
    const px = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      const r = data[o] ?? 0;
      const g = data[o + 1] ?? 0;
      const b = data[o + 2] ?? 0;
      px[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    return new GrayImage(width, height, px);
  }

  /** 四辺を insetRatio (0..0.4) ぶん切り落とした中央部分を返す。0 なら自身を返す。 */
  cropCenter(insetRatio: number): GrayImage {
    if (insetRatio <= 0) return this;
    if (insetRatio >= 0.4) {
      throw new RangeError("insetRatio は 0..0.4 の範囲で指定してください。");
    }
    return this.cropRelative(insetRatio, insetRatio, 1 - insetRatio * 2, 1 - insetRatio * 2);
  }

  /** 相対座標 (0..1) で矩形を切り出す。範囲は画像内に収まっている必要がある。 */
  cropRelative(x0: number, y0: number, width: number, height: number): GrayImage {
    const ix = roundHalfEven(this.width * x0);
    const iy = roundHalfEven(this.height * y0);
    const w = roundHalfEven(this.width * width);
    const h = roundHalfEven(this.height * height);
    if (ix < 0 || iy < 0 || w <= 0 || h <= 0 || ix + w > this.width || iy + h > this.height) {
      throw new RangeError(`切り出し範囲が画像外です: (${x0},${y0},${width},${height})`);
    }
    const px = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const srcOffset = (y + iy) * this.width + ix;
      px.set(this.pixels.subarray(srcOffset, srcOffset + w), y * w);
    }
    return new GrayImage(w, h, px);
  }

  /**
   * 面積平均（ボックスフィルタ）で縮小リサイズする。
   * 窓境界は DB 生成側と同じく `tx * Width / targetWidth` の整数除算で求めるため、
   * Math.floor による切り捨てで同じ結果を再現する（丸めではなく切り捨て）。
   */
  resizeArea(targetWidth: number, targetHeight: number): GrayImage {
    if (targetWidth <= 0 || targetHeight <= 0) {
      throw new RangeError("targetWidth/targetHeight は正の値が必要です。");
    }
    const px = new Float32Array(targetWidth * targetHeight);
    for (let ty = 0; ty < targetHeight; ty++) {
      const y0 = Math.floor((ty * this.height) / targetHeight);
      const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * this.height) / targetHeight));
      for (let tx = 0; tx < targetWidth; tx++) {
        const x0 = Math.floor((tx * this.width) / targetWidth);
        const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * this.width) / targetWidth));
        let sum = 0;
        for (let y = y0; y < y1; y++) {
          const row = y * this.width;
          for (let x = x0; x < x1; x++) {
            sum += this.pixels[row + x] ?? 0;
          }
        }
        px[ty * targetWidth + tx] = sum / ((y1 - y0) * (x1 - x0));
      }
    }
    return new GrayImage(targetWidth, targetHeight, px);
  }
}
