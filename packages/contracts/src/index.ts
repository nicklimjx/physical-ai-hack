import { z } from 'zod';

const id = z.string().min(1).max(100);
const name = z.string().min(1);
const finite = z.number();
const point = z.strictObject({ x: finite, y: finite });

export const RiskClassSchema = z.enum(['no_issue', 'watch', 'high_risk', 'active_fire']);
export const MissionTypeSchema = z.enum(['suppress', 'protect_monitor', 'monitor', 'recall', 'hold']);
export const MissionStatusSchema = z.enum(['idle', 'travelling', 'working', 'monitoring', 'returning', 'refilling']);

export const WorldDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: id, mapId: id, seed: z.number().int(),
  width: z.number().int().positive(), height: z.number().int().positive(), cellSizeM: finite.positive(),
  staticCells: z.array(z.strictObject({ elevationM: finite, fuelClass: z.enum(['water', 'road', 'grass', 'forest', 'wood_building']), initialFuel: finite.min(0).max(1), regionId: id })),
  regions: z.array(z.strictObject({ id, name, kind: z.enum(['forest', 'neighborhood', 'base', 'water']) })),
  base: point,
}).refine((world) => world.staticCells.length === world.width * world.height, 'Static cell count must equal width × height');

export const WeatherSchema = z.strictObject({ windMps: point, temperatureC: finite, humidity: finite.min(0).max(1) });
export const SettingsSchema = z.strictObject({ paused: z.boolean(), speed: finite.min(0.1).max(10), spreadMultiplier: finite.min(0).max(5) });
export const MissionSchema = z.strictObject({ id, squadId: id, type: MissionTypeSchema, status: MissionStatusSchema, target: point, source: z.enum(['auto', 'human']), pinned: z.boolean(), progress: finite.min(0).max(1), version: z.number().int().nonnegative() });
export const DroneSchema = z.strictObject({ id, squadId: id, position: point, battery: finite.min(0).max(1), payload: finite.min(0).max(1), status: z.enum(['ready', 'travelling', 'working', 'returning']) });
export const SquadSchema = z.strictObject({ id, name, droneIds: z.array(id), missionId: id.nullable(), version: z.number().int().nonnegative(), payload: finite.min(0).max(1) });
export const EventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('observation'), id, atSimSeconds: finite, summary: name }),
  z.strictObject({ type: z.literal('assessment'), id, atSimSeconds: finite, summary: name }),
  z.strictObject({ type: z.literal('mission'), id, atSimSeconds: finite, summary: name }),
  z.strictObject({ type: z.literal('system'), id, atSimSeconds: finite, summary: name }),
]);
export const WorldSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: id, revision: z.number().int().nonnegative(), simSeconds: finite,
  weather: WeatherSchema, settings: SettingsSchema,
  dynamicCells: z.array(z.strictObject({ heat: finite.min(0).max(1), fuel: finite.min(0).max(1), burnState: z.enum(['unburned', 'burning', 'burned']), protection: finite.min(0).max(1) })),
  drones: z.array(DroneSchema), squads: z.array(SquadSchema), missions: z.array(MissionSchema),
  metrics: z.strictObject({ burningCells: z.number().int().nonnegative(), protectedCells: z.number().int().nonnegative(), threatenedStructures: z.number().int().nonnegative() }),
  events: z.array(EventSchema).max(100),
});
export const ObservationSchema = z.strictObject({ schemaVersion: z.literal(1), runId: id, id, sourceDroneId: id, position: point, sampledAtSimSeconds: finite, observed: z.strictObject({ heat: finite.min(0).max(1), burning: z.boolean(), nearbyStructures: z.number().int().nonnegative(), windMps: point }), footprintRadiusM: finite.nonnegative() });
export const RiskReportSchema = z.strictObject({ schemaVersion: z.literal(1), runId: id, id, observationIds: z.array(id), sourceDroneIds: z.array(id), regionId: id, classification: RiskClassSchema, summary: name, provider: z.enum(['jev', 'rules', 'preview']), confidence: finite.min(0).max(1).nullable(), sampledAtSimSeconds: finite, validUntilSimSeconds: finite, evidence: z.array(name) });
export const IncidentSummarySchema = z.strictObject({ schemaVersion: z.literal(1), runId: id, id, regionId: id, reportIds: z.array(id), sourceDroneIds: z.array(id), classification: RiskClassSchema, summary: name, stale: z.boolean(), uncertainty: name });
export const AssignmentSchema = z.strictObject({ squadId: id, type: MissionTypeSchema, target: point, reportIds: z.array(id) });
export const MissionProposalSchema = z.strictObject({ schemaVersion: z.literal(1), runId: id, decisionEpoch: z.number().int().nonnegative(), missionVersions: z.record(id, z.number().int().nonnegative()), assignments: z.array(AssignmentSchema), source: z.enum(['auto', 'human']), summary: name });

export const OperatorCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('assign'), squadId: id, missionType: MissionTypeSchema, target: point }),
  z.strictObject({ type: z.literal('set_priority'), regionId: id, priority: z.number().int().min(0).max(3) }),
  z.strictObject({ type: z.literal('pause'), paused: z.boolean() }),
  z.strictObject({ type: z.literal('set_speed'), speed: finite.min(0.1).max(10) }),
  z.strictObject({ type: z.literal('set_spread'), multiplier: finite.min(0).max(5) }),
  z.strictObject({ type: z.literal('set_weather'), weather: WeatherSchema }),
  z.strictObject({ type: z.literal('ignite'), position: point }),
  z.strictObject({ type: z.literal('recall'), squadId: id }),
  z.strictObject({ type: z.literal('resume_auto'), squadId: id }),
  z.strictObject({ type: z.literal('reset') }),
]);
export const CommandEnvelopeSchema = z.strictObject({ schemaVersion: z.literal(1), runId: id, commandId: id, source: z.enum(['human', 'auto']), payload: OperatorCommandSchema });
export const CommandResultSchema = z.strictObject({ schemaVersion: z.literal(1), runId: id, commandId: id, status: z.enum(['accepted', 'rejected', 'unavailable']), reason: name, appliedRevision: z.number().int().nonnegative().nullable(), missionIds: z.array(id), message: name });
export const OperatorInputSchema = z.strictObject({ schemaVersion: z.literal(1), runId: id, requestId: id, text: z.string().min(1).max(2000), committed: z.literal(true) });
export const AnnouncementSchema = z.strictObject({ schemaVersion: z.literal(1), runId: id, id, priority: z.enum(['routine', 'important', 'critical']), text: name, createdAt: finite, expiresAt: finite, missionIds: z.array(id), reportIds: z.array(id) });
export const OperatorResponseSchema = z.strictObject({ schemaVersion: z.literal(1), runId: id, requestId: id, status: z.enum(['answered', 'unavailable']), text: name, commandResult: CommandResultSchema.nullable(), announcements: z.array(AnnouncementSchema) });
export const ProviderStateSchema = z.strictObject({ provider: z.enum(['jev', 'gpt', 'voice']), status: z.enum(['preview', 'ready', 'unavailable', 'error']), label: name });
export const WorldResponseSchema = z.strictObject({ definition: WorldDefinitionSchema, snapshot: WorldSnapshotSchema, risks: z.array(RiskReportSchema), announcements: z.array(AnnouncementSchema), providers: z.array(ProviderStateSchema), preview: z.boolean() }).refine((world) => world.definition.runId === world.snapshot.runId && world.risks.every((risk) => risk.runId === world.snapshot.runId) && world.announcements.every((announcement) => announcement.runId === world.snapshot.runId), 'World envelope run IDs must match').refine((world) => world.snapshot.dynamicCells.length === world.definition.width * world.definition.height, 'Dynamic cell count must equal width × height');
export const WorldStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('world'), schemaVersion: z.literal(1), runId: id, world: WorldResponseSchema }),
  z.strictObject({ type: z.literal('risk'), schemaVersion: z.literal(1), runId: id, report: RiskReportSchema }),
  z.strictObject({ type: z.literal('mission'), schemaVersion: z.literal(1), runId: id, mission: MissionSchema }),
  z.strictObject({ type: z.literal('announcement'), schemaVersion: z.literal(1), runId: id, announcement: AnnouncementSchema }),
]);

export const PlanningContextSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: id, decisionEpoch: z.number().int().nonnegative(),
  definition: WorldDefinitionSchema, weather: WeatherSchema, observations: z.array(ObservationSchema),
  incidents: z.array(IncidentSummarySchema), reports: z.array(RiskReportSchema),
  squads: z.array(SquadSchema), drones: z.array(DroneSchema), missions: z.array(MissionSchema),
  feasibleCandidates: z.array(AssignmentSchema), missionVersions: z.record(id, z.number().int().nonnegative()),
  humanConstraints: z.array(z.strictObject({ squadId: id, kind: z.enum(['pinned', 'released']), missionId: id.nullable(), summary: name })),
}).refine((context) => context.runId === context.definition.runId && context.observations.every((item) => item.runId === context.runId) && context.incidents.every((item) => item.runId === context.runId) && context.reports.every((item) => item.runId === context.runId), 'Planning context run IDs must match');

export type WorldDefinition = z.infer<typeof WorldDefinitionSchema>;
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type RiskReport = z.infer<typeof RiskReportSchema>;
export type IncidentSummary = z.infer<typeof IncidentSummarySchema>;
export type MissionProposal = z.infer<typeof MissionProposalSchema>;
export type PlanningContext = z.infer<typeof PlanningContextSchema>;
export type OperatorCommand = z.infer<typeof OperatorCommandSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type OperatorInput = z.infer<typeof OperatorInputSchema>;
export type OperatorResponse = z.infer<typeof OperatorResponseSchema>;
export type Announcement = z.infer<typeof AnnouncementSchema>;
export type ProviderState = z.infer<typeof ProviderStateSchema>;
export type WorldResponse = z.infer<typeof WorldResponseSchema>;
export type WorldStreamEvent = z.infer<typeof WorldStreamEventSchema>;
