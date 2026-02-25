import { useConfigStore } from '../stores/config-store';

/**
 * Collect all known signal names from channels and emissions.
 * Used for autocomplete in signal pickers.
 */
export function getSignalCatalog(): string[] {
  const config = useConfigStore.getState();
  const signals = new Set<string>();

  // From channel definitions
  for (const channel of Object.values(config.channels)) {
    for (const sig of channel.signals) {
      signals.add(sig);
    }
  }

  // From emissions (may include signals not yet in a channel)
  for (const roleSignals of Object.values(config.emissions)) {
    for (const sig of roleSignals) {
      signals.add(sig);
    }
  }

  // From peer route signal filters
  for (const route of config.peerRoutes) {
    if (route.signals) {
      for (const sig of route.signals) {
        signals.add(sig);
      }
    }
  }

  return Array.from(signals).sort();
}

/**
 * Get signals defined in a specific channel.
 */
export function getChannelSignals(channelName: string): string[] {
  const config = useConfigStore.getState();
  return config.channels[channelName]?.signals || [];
}

/**
 * Get all channel names.
 */
export function getChannelNames(): string[] {
  return Object.keys(useConfigStore.getState().channels);
}
