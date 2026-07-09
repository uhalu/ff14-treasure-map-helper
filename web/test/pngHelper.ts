import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { GrayImage } from "../src/matcher/grayImage";

export function loadGrayImage(fixtureFile: string): GrayImage {
  const filePath = path.resolve(__dirname, "fixtures", fixtureFile);
  const buf = fs.readFileSync(filePath);
  const png = PNG.sync.read(buf);
  return GrayImage.fromImageData({ width: png.width, height: png.height, data: png.data });
}
