import { create } from 'zustand';
import type {
  ChannelDefinition,
  SubscriptionEntry,
  PeerRoute,
} from '@openteams/template/types';

export interface EditorRoleConfig {
  name: string;
  displayName: string;
  description: string;
  extends?: string;
  capabilities: string[];
  promptContent?: string;
  additionalPrompts?: { name: string; content: string }[];
}

export interface EditorTeamConfig {
  name: string;
  description: string;
  version: 1;
  enforcement: 'strict' | 'permissive' | 'audit';
  extensions: Record<string, unknown>;
}

interface ConfigStore {
  team: EditorTeamConfig;
  roles: Map<string, EditorRoleConfig>;
  channels: Record<string, ChannelDefinition>;
  subscriptions: Record<string, SubscriptionEntry[]>;
  emissions: Record<string, string[]>;
  peerRoutes: PeerRoute[];
  spawnRules: Record<string, string[]>;
  roleModels: Record<string, string>;
  topologyRoot: string;
  topologyCompanions: string[];

  setTeam: (team: Partial<EditorTeamConfig>) => void;
  setRole: (name: string, role: EditorRoleConfig) => void;
  removeRole: (name: string) => void;
  renameRole: (oldName: string, newName: string) => void;
  setChannel: (name: string, channel: ChannelDefinition) => void;
  removeChannel: (name: string) => void;
  setSubscriptions: (role: string, subs: SubscriptionEntry[]) => void;
  setEmissions: (role: string, signals: string[]) => void;
  addPeerRoute: (route: PeerRoute) => void;
  removePeerRoute: (index: number) => void;
  setPeerRoutes: (routes: PeerRoute[]) => void;
  setSpawnRules: (role: string, canSpawn: string[]) => void;
  setRoleModel: (role: string, model: string | undefined) => void;
  setTopologyRoot: (role: string) => void;
  setTopologyCompanions: (roles: string[]) => void;
  clear: () => void;
  loadFromManifest: (
    team: EditorTeamConfig,
    roles: Map<string, EditorRoleConfig>,
    channels: Record<string, ChannelDefinition>,
    subscriptions: Record<string, SubscriptionEntry[]>,
    emissions: Record<string, string[]>,
    peerRoutes: PeerRoute[],
    spawnRules: Record<string, string[]>,
    roleModels: Record<string, string>,
    topologyRoot: string,
    topologyCompanions: string[],
  ) => void;
}

const defaultTeam: EditorTeamConfig = {
  name: 'new-team',
  description: '',
  version: 1,
  enforcement: 'permissive',
  extensions: {},
};

export const useConfigStore = create<ConfigStore>((set, get) => ({
  team: { ...defaultTeam },
  roles: new Map(),
  channels: {},
  subscriptions: {},
  emissions: {},
  peerRoutes: [],
  spawnRules: {},
  roleModels: {},
  topologyRoot: '',
  topologyCompanions: [],

  setTeam: (updates) => {
    set({ team: { ...get().team, ...updates } });
  },

  setRole: (name, role) => {
    const roles = new Map(get().roles);
    roles.set(name, role);
    set({ roles });
  },

  removeRole: (name) => {
    const roles = new Map(get().roles);
    roles.delete(name);
    const { subscriptions, emissions, spawnRules, topologyRoot, topologyCompanions, peerRoutes } = get();
    const newSubs = { ...subscriptions };
    delete newSubs[name];
    const newEmissions = { ...emissions };
    delete newEmissions[name];
    const newSpawnRules = { ...spawnRules };
    delete newSpawnRules[name];
    // Remove from other spawn rules
    for (const key of Object.keys(newSpawnRules)) {
      newSpawnRules[key] = newSpawnRules[key].filter(r => r !== name);
    }
    const newModels = { ...get().roleModels };
    delete newModels[name];
    set({
      roles,
      subscriptions: newSubs,
      emissions: newEmissions,
      spawnRules: newSpawnRules,
      roleModels: newModels,
      peerRoutes: peerRoutes.filter(r => r.from !== name && r.to !== name),
      topologyRoot: topologyRoot === name ? '' : topologyRoot,
      topologyCompanions: topologyCompanions.filter(c => c !== name),
    });
  },

  renameRole: (oldName, newName) => {
    const { roles, subscriptions, emissions, spawnRules, topologyRoot, topologyCompanions, peerRoutes } = get();
    const newRoles = new Map<string, EditorRoleConfig>();
    for (const [key, val] of roles) {
      if (key === oldName) {
        newRoles.set(newName, { ...val, name: newName });
      } else {
        newRoles.set(key, val);
      }
    }

    const newSubs: Record<string, SubscriptionEntry[]> = {};
    for (const [key, val] of Object.entries(subscriptions)) {
      newSubs[key === oldName ? newName : key] = val;
    }

    const newEmissions: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(emissions)) {
      newEmissions[key === oldName ? newName : key] = val;
    }

    const newSpawnRules: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(spawnRules)) {
      const renamedKey = key === oldName ? newName : key;
      newSpawnRules[renamedKey] = val.map(r => (r === oldName ? newName : r));
    }

    const newModels: Record<string, string> = {};
    for (const [key, val] of Object.entries(get().roleModels)) {
      newModels[key === oldName ? newName : key] = val;
    }
    set({
      roles: newRoles,
      subscriptions: newSubs,
      emissions: newEmissions,
      spawnRules: newSpawnRules,
      roleModels: newModels,
      peerRoutes: peerRoutes.map(r => ({
        ...r,
        from: r.from === oldName ? newName : r.from,
        to: r.to === oldName ? newName : r.to,
      })),
      topologyRoot: topologyRoot === oldName ? newName : topologyRoot,
      topologyCompanions: topologyCompanions.map(c => (c === oldName ? newName : c)),
    });
  },

  setChannel: (name, channel) => {
    set({ channels: { ...get().channels, [name]: channel } });
  },

  removeChannel: (name) => {
    const channels = { ...get().channels };
    delete channels[name];
    // Remove subscriptions referencing this channel
    const subs = { ...get().subscriptions };
    for (const role of Object.keys(subs)) {
      subs[role] = subs[role].filter(s => s.channel !== name);
    }
    set({ channels, subscriptions: subs });
  },

  setSubscriptions: (role, subs) => {
    set({ subscriptions: { ...get().subscriptions, [role]: subs } });
  },

  setEmissions: (role, signals) => {
    set({ emissions: { ...get().emissions, [role]: signals } });
  },

  addPeerRoute: (route) => {
    set({ peerRoutes: [...get().peerRoutes, route] });
  },

  removePeerRoute: (index) => {
    set({ peerRoutes: get().peerRoutes.filter((_, i) => i !== index) });
  },

  setPeerRoutes: (routes) => {
    set({ peerRoutes: routes });
  },

  setSpawnRules: (role, canSpawn) => {
    set({ spawnRules: { ...get().spawnRules, [role]: canSpawn } });
  },

  setRoleModel: (role, model) => {
    const models = { ...get().roleModels };
    if (model) {
      models[role] = model;
    } else {
      delete models[role];
    }
    set({ roleModels: models });
  },

  setTopologyRoot: (role) => set({ topologyRoot: role }),
  setTopologyCompanions: (roles) => set({ topologyCompanions: roles }),

  clear: () => {
    set({
      team: { ...defaultTeam },
      roles: new Map(),
      channels: {},
      subscriptions: {},
      emissions: {},
      peerRoutes: [],
      spawnRules: {},
      roleModels: {},
      topologyRoot: '',
      topologyCompanions: [],
    });
  },

  loadFromManifest: (team, roles, channels, subscriptions, emissions, peerRoutes, spawnRules, roleModels, topologyRoot, topologyCompanions) => {
    set({ team, roles, channels, subscriptions, emissions, peerRoutes, spawnRules, roleModels, topologyRoot, topologyCompanions });
  },
}));
