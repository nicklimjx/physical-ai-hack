import type { RiskReport, WorldDefinition } from '@ember/contracts';

export type ViewMode = 'natural' | 'thermal' | 'jev';
export type MapPriorBand = 'low' | 'moderate' | 'high' | 'nonburnable';
export interface RegionMapPrior {
  regionId: string;
  band: MapPriorBand;
  score: number;
  fuelCells: number;
  forestCells: number;
  grassCells: number;
  woodBuildings: number;
  waterCells: number;
  roadCells: number;
  source: 'MAP PRIOR · RULES · KNOWN MAP / WEATHER';
}
export interface MapPriorWeather { windMps: { x: number; y: number }; humidity: number; temperatureC: number }

export const landclassColors = {
  water: '#397dbb', forest: '#52764b', grass: '#c2a875', road: '#888c90', wood_building: '#c89347',
} as const;
export const landclassRgb = {
  water: [57, 125, 187], forest: [82, 118, 75], grass: [194, 168, 117], road: [136, 140, 144], wood_building: [200, 147, 71],
} as const;
export const landclassNames = {
  water: 'Water', forest: 'Forest', grass: 'Grass / open', road: 'Road', wood_building: 'Wooden buildings',
} as const;

export function quantizePriorWeather(weather: MapPriorWeather): MapPriorWeather {
  const bucket = (value: number, step: number) => Math.round(value / step) * step;
  return {
    windMps: { x: bucket(weather.windMps.x, .5), y: bucket(weather.windMps.y, .5) },
    humidity: Math.max(0, Math.min(1, bucket(weather.humidity, .05))),
    temperatureC: bucket(weather.temperatureC, 2),
  };
}
export function staticMapKey(definition: WorldDefinition): string {
  let hash = 2166136261;
  const add = (value: string) => { for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); };
  for (const region of definition.regions) add(`${region.id}:${region.kind};`);
  for (const cell of definition.staticCells) add(`${cell.fuelClass}:${cell.regionId}:${cell.initialFuel};`);
  return `${definition.mapId}:${definition.width}x${definition.height}:${hash >>> 0}`;
}
export function mapPriorKey(definition: WorldDefinition, weather: MapPriorWeather): string {
  const rounded = quantizePriorWeather(weather);
  return `${definition.runId}:${staticMapKey(definition)}:${rounded.windMps.x},${rounded.windMps.y}:${rounded.humidity}:${rounded.temperatureC}`;
}
export function deriveMapPrior(definition: WorldDefinition, weather: MapPriorWeather): Map<string, RegionMapPrior> {
  const rounded = quantizePriorWeather(weather);
  const counts = new Map<string, Omit<RegionMapPrior, 'band' | 'score' | 'source'>>();
  for (const region of definition.regions) counts.set(region.id, { regionId: region.id, fuelCells: 0, forestCells: 0, grassCells: 0, woodBuildings: 0, waterCells: 0, roadCells: 0 });
  for (const cell of definition.staticCells) {
    const item = counts.get(cell.regionId);
    if (!item) continue;
    if (cell.fuelClass === 'water') item.waterCells++;
    else if (cell.fuelClass === 'road') item.roadCells++;
    else {
      item.fuelCells++;
      if (cell.fuelClass === 'forest') item.forestCells++;
      else if (cell.fuelClass === 'grass') item.grassCells++;
      else item.woodBuildings++;
    }
  }
  const wind = Math.hypot(rounded.windMps.x, rounded.windMps.y);
  const dryness = 1 - rounded.humidity;
  const warmth = Math.max(0, rounded.temperatureC - 20);
  const result = new Map<string, RegionMapPrior>();
  for (const [regionId, item] of counts) {
    const weightedFuel = item.forestCells + item.grassCells * .45 + item.woodBuildings * 1.2;
    const score = item.fuelCells === 0 ? 0 : weightedFuel / item.fuelCells + (item.woodBuildings / item.fuelCells) * .7 + dryness * .25 + wind / 10 * .4 + warmth / 30 * .3;
    const band: MapPriorBand = item.fuelCells === 0 ? 'nonburnable' : score >= 1.65 ? 'high' : score >= 1.05 ? 'moderate' : 'low';
    result.set(regionId, { ...item, score, band, source: 'MAP PRIOR · RULES · KNOWN MAP / WEATHER' });
  }
  return result;
}
export function latestReportsByRegion(reports: readonly RiskReport[], runId: string) {
  const latest = new Map<string, RiskReport>();
  for (const report of reports) {
    if (report.runId !== runId) continue;
    const current = latest.get(report.regionId);
    if (!current || report.sampledAtSimSeconds > current.sampledAtSimSeconds) latest.set(report.regionId, report);
  }
  return latest;
}
