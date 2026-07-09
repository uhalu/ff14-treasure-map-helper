/**
 * 半整数を偶数側に丸める銀行丸め（round half to even）。DB 生成側の丸め規則に合わせる。
 * JS の Math.round は「0.5 は常に +∞ 方向」に丸めるため、ちょうど半整数になる
 * 入力（クロップ座標の計算など）で DB 側と結果がずれ得る。ここで丸めを揃える。
 */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // ちょうど 0.5: 偶数側に丸める
  return floor % 2 === 0 ? floor : floor + 1;
}
