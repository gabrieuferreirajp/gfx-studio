// Unidades disponíveis no CorelDRAW para Windows; valores internos continuam em pixels (96 por polegada).
export const unitDefinitions = {
  px: { label: 'Pixels', short: 'px', px: 1 },
  in: { label: 'Polegadas', short: 'pol', px: 96 },
  mm: { label: 'Milímetros', short: 'mm', px: 96 / 25.4 },
  cm: { label: 'Centímetros', short: 'cm', px: 96 / 2.54 },
  m: { label: 'Metros', short: 'm', px: 96 / 0.0254 },
  km: { label: 'Quilômetros', short: 'km', px: 96 / 0.0000254 },
  pt: { label: 'Pontos', short: 'pt', px: 96 / 72 },
  pc: { label: 'Paicas', short: 'pc', px: 16 },
  ft: { label: 'Pés', short: 'pés', px: 96 * 12 },
  yd: { label: 'Jardas', short: 'jd', px: 96 * 36 },
  mi: { label: 'Milhas', short: 'mi', px: 96 * 63360 },
  didot: { label: 'Didots', short: 'dd', px: 0.376065 * 96 / 25.4 },
  cicero: { label: 'Cíceros', short: 'cc', px: 12 * 0.376065 * 96 / 25.4 },
} as const;
export type DocumentUnit = keyof typeof unitDefinitions;
export const documentUnits = Object.keys(unitDefinitions) as DocumentUnit[];
export const isDocumentUnit = (value: unknown): value is DocumentUnit => typeof value === 'string' && Object.hasOwn(unitDefinitions, value);
export const MM_PER_PX = 25.4 / 96;
export const unitScale = (unit: DocumentUnit) => unitDefinitions[unit].px;
export const toUnit = (value: number, unit: DocumentUnit) => value / unitScale(unit);
export const fromUnit = (value: number, unit: DocumentUnit) => value * unitScale(unit);
export const unitStep = (unit: DocumentUnit) => unit === 'px' ? 1 : unitScale(unit) >= 96 * 12 ? 0.0001 : 0.01;
