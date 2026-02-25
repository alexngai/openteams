import { useEffect, useRef } from 'react';
import { useConfigStore } from '../stores/config-store';
import { useValidationStore } from '../stores/validation-store';
import { useCanvasStore } from '../stores/canvas-store';
import { validate } from '../lib/validator';

export function useValidation() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const team = useConfigStore(s => s.team);
  const roles = useConfigStore(s => s.roles);
  const channels = useConfigStore(s => s.channels);
  const subscriptions = useConfigStore(s => s.subscriptions);
  const emissions = useConfigStore(s => s.emissions);
  const peerRoutes = useConfigStore(s => s.peerRoutes);
  const spawnRules = useConfigStore(s => s.spawnRules);
  const topologyRoot = useConfigStore(s => s.topologyRoot);
  const topologyCompanions = useConfigStore(s => s.topologyCompanions);

  useEffect(() => {
    useValidationStore.getState().setValidating(true);

    if (timerRef.current !== null) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const { errors, warnings } = validate({
        team, roles, channels, subscriptions, emissions, peerRoutes, spawnRules, topologyRoot, topologyCompanions,
      });

      useValidationStore.getState().setResults(errors, warnings);

      // Update node data with validation results
      const canvas = useCanvasStore.getState();
      for (const node of canvas.nodes) {
        const nodeErrors = errors.filter(e => e.nodeId === node.id).map(e => e.message);
        const nodeWarnings = warnings.filter(w => w.nodeId === node.id).map(w => w.message);
        canvas.updateNodeData(node.id, { errors: nodeErrors, warnings: nodeWarnings });
      }
    }, 300);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [team, roles, channels, subscriptions, emissions, peerRoutes, spawnRules, topologyRoot, topologyCompanions]);
}
