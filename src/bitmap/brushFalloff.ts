/**
 * Queda de opacidade da ponta redonda do pincel (como no Photoshop): opaco até a dureza, depois cai em curva suave
 * (smoothstep) até a borda. `t` é a distância ao centro (0–1), `hardness` vai de 0 a 1.
 */
export function brushFalloff(t: number, hardness: number) {
  if (t <= hardness) return 1;
  if (t >= 1) return 0;
  const u = (t - hardness) / (1 - hardness);
  return 1 - u * u * (3 - 2 * u);
}
