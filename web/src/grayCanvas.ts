import type { GrayImage } from "./matcher/grayImage";

/** グレースケール画像を Canvas に描画して返す（結果パネルのプレビュー表示用）。 */
export function grayToCanvas(gray: GrayImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = gray.width;
  canvas.height = gray.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(gray.width, gray.height);
  for (let i = 0; i < gray.pixels.length; i++) {
    const v = Math.round(gray.pixels[i]! * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
