'use client';

import { crewLineSchema, idSchema, trierarchReportDetailsSchema } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { z } from 'zod';

import { trierarchPluginVersionOf } from './version';

/**
 * The trierarch plugin as the console reads it, through the web app's server
 * (decision 0030): its connection (`/trierarch-plugin/connection`), and its
 * machines and Join a machine (`/api/trierarch-plugin/<procedure>`). Its
 * answers are outside data, so each is parsed here.
 */

/** The trierarch plugin's connection as the Settings page shows it: none when the console has no trierarch plugin. */
const settingsSchema = z.union([
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    connection: z.object({
      isEnabled: z.boolean(),
      state: z.enum(['not-connected', 'connected']),
      ship: z.object({ shipId: z.string(), name: z.string() }).nullable(),
      lastShipId: z.string().nullable(),
    }),
  }),
]);

export type TrierarchPluginSettings = z.infer<typeof settingsSchema>;

const CONNECTION_KEY = ['trierarch-plugin', 'connection'];
const CONNECTION_PATH = '/trierarch-plugin/connection';

async function answered(response: Response): Promise<TrierarchPluginSettings> {
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(z.object({ message: z.string() }).safeParse(body).data?.message ?? 'Try again in a moment');
  }
  return settingsSchema.parse(body);
}

/**
 * Whether this console has the trierarch plugin (AEOLUS_TRIERARCH_PLUGIN_URL
 * set), as the web app's server read it for this page: known before any
 * call, so a console without it never makes one.
 */
export const TrierarchPluginConfiguredContext = createContext(false);

/** Whether the trierarch plugin is set up for this console and connected. Without it it asks nothing: the answer is known. */
export function useTrierarchPluginSettings() {
  const isConfigured = useContext(TrierarchPluginConfiguredContext);
  return useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: async () => answered(await fetch(CONNECTION_PATH, { cache: 'no-store' })),
    enabled: isConfigured,
    initialData: isConfigured ? undefined : { configured: false },
  });
}

const VERSION_PATH = '/version';

/**
 * The trierarch plugin's version, from the console's own /version (#332, the
 * Trierarchs header); undefined while it loads, when the plugin does not
 * answer, and on a console without it, which asks nothing.
 */
export function useTrierarchPluginVersion(): string | undefined {
  const isConfigured = useContext(TrierarchPluginConfiguredContext);
  const query = useQuery({
    queryKey: ['console-version', 'trierarch-plugin'],
    queryFn: async () => trierarchPluginVersionOf(await (await fetch(VERSION_PATH, { cache: 'no-store' })).json()) ?? null,
    enabled: isConfigured,
  });
  return query.data ?? undefined;
}

/** Connect the trierarch plugin: the web app's server does the rest; the answer is the new connection. */
export function useConnectTrierarchPlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => answered(await fetch(CONNECTION_PATH, { method: 'POST' })),
    onSuccess: (settings) => {
      queryClient.setQueryData(CONNECTION_KEY, settings);
    },
  });
}

/**
 * Where the trierarch plugin stands for this console: none without
 * AEOLUS_TRIERARCH_PLUGIN_URL or while it is off for this fleet; unknown
 * until its connection is read; not connected; connected. A connection that
 * cannot be read counts as not connected.
 */
export type TrierarchPluginConnection = 'none' | 'unknown' | 'not-connected' | 'connected';

export function useTrierarchPluginConnection(): TrierarchPluginConnection {
  const settings = useTrierarchPluginSettings();
  if (settings.data === undefined) {
    return settings.isError ? 'not-connected' : 'unknown';
  }
  return settings.data.configured && settings.data.connection.isEnabled ? settings.data.connection.state : 'none';
}

/**
 * Whether this console shows the Trierarchs section: the trierarch plugin is
 * set up and on for this fleet. Until it answers, it shows nothing of it.
 */
export function useHasTrierarchPlugin(): boolean {
  const settings = useTrierarchPluginSettings();
  return settings.data?.configured === true && settings.data.connection.isEnabled;
}

/** A machine as the trierarch plugin lists it: its trierarch's ship, its last report and the details it reported. */
export const machineSchema = z.object({
  shipId: idSchema('ship'),
  name: z.string(),
  status: z.enum(['awaitingCrew', 'crewed']),
  lastSeenAt: z.string().nullable(),
  /** Its trierarch has not been seen for longer than the plugin's threshold. */
  isSilent: z.boolean(),
  report: z.object({ state: z.string(), note: z.string().nullable(), reportedAt: z.string() }).nullable(),
  details: trierarchReportDetailsSchema.nullable(),
});

export type Machine = z.infer<typeof machineSchema>;

/** A joined machine: its trierarch's ship, its starting prompt and crew lines, and its setup line, each shown once. */
export const joinedMachineSchema = z.object({
  shipId: idSchema('ship'),
  name: z.string(),
  prompt: z.string(),
  crewLines: z.array(crewLineSchema),
  setupLine: z.string(),
});

export type JoinedMachine = z.infer<typeof joinedMachineSchema>;

const answerSchema = z.union([z.object({ result: z.object({ data: z.unknown() }) }), z.object({ error: z.object({ message: z.string() }) })]);

async function call<T>(procedure: string, request: { input?: unknown; isMutation?: boolean; answers: z.ZodType<T> }): Promise<T> {
  const path = `/api/trierarch-plugin/${procedure}`;
  const response = request.isMutation
    ? await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.input ?? {}) })
    : await fetch(request.input === undefined ? path : `${path}?input=${encodeURIComponent(JSON.stringify(request.input))}`, { cache: 'no-store' });
  const answer = answerSchema.safeParse(await response.json());
  if (!answer.success) {
    throw new Error('the trierarch plugin answered something the console does not understand');
  }
  if ('error' in answer.data) {
    throw new Error(answer.data.error.message);
  }
  return request.answers.parse(answer.data.result.data);
}

const MACHINES_KEY = ['trierarch-plugin', 'machines'];
/** How often the machines are read again: a trierarch reports on its own time. */
const MACHINES_REFRESH_MS = 10_000;

/** The fleet's machines, read again every few seconds; asked only while the trierarch plugin is connected. */
export function useMachines() {
  const isConnected = useTrierarchPluginConnection() === 'connected';
  return useQuery({
    queryKey: MACHINES_KEY,
    queryFn: () => call('machines.list', { answers: z.array(machineSchema) }),
    refetchInterval: MACHINES_REFRESH_MS,
    enabled: isConnected,
  });
}

/**
 * Join a machine: the trierarch plugin commissions its trierarch's ship. The
 * answer holds its starting prompt and setup line: shown once, kept only in
 * this browser's memory while the dialog is open.
 */
export function useJoinMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => call('machines.join', { input: { name }, isMutation: true, answers: joinedMachineSchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MACHINES_KEY });
    },
  });
}

/** What checking crew settings answers: a trierarch fits, none takes them (naming the settings field at fault), or none has room now. */
export const settingsCheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fits') }),
  z.object({ kind: z.literal('refused'), field: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('noRoom'), reason: z.string() }),
]);

export type SettingsCheck = z.infer<typeof settingsCheckSchema>;

const checkKey = (settings: unknown) => ['trierarch-plugin', 'check', JSON.stringify(settings)];

/**
 * Whether the trierarch plugin would place these settings now
 * (`requests.check`), asked again as the form changes; nothing is asked
 * until the form makes settings. `checkNow` asks afresh, for the moment of
 * requesting.
 */
export function useCrewSettingsCheck(settings: unknown) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: checkKey(settings),
    queryFn: () => call('requests.check', { input: { settings }, answers: settingsCheckSchema }),
    enabled: settings !== undefined,
  });
  const checkNow = (): Promise<SettingsCheck> =>
    queryClient.query({ queryKey: checkKey(settings), queryFn: () => call('requests.check', { input: { settings }, answers: settingsCheckSchema }), staleTime: 0 });
  return { ...query, checkNow };
}
