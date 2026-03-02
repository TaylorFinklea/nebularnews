import { json } from '@sveltejs/kit';
import { resetSignalWeights, resetAffinities } from '$lib/server/scoring/learning';
import { loadSignalWeights } from '$lib/server/scoring/engine';
import { recordAuditEvent } from '$lib/server/audit';

export const POST = async ({ platform, locals }) => {
  const db = platform.env.DB;

  await resetSignalWeights(db);
  await resetAffinities(db);

  await recordAuditEvent(db, {
    actor: 'admin',
    action: 'scoring.reset_weights',
    requestId: locals.requestId
  });

  const weights = await loadSignalWeights(db);
  return json({
    ok: true,
    signalWeights: weights.map((w) => ({
      name: w.signalName,
      weight: w.weight,
      sampleCount: w.sampleCount
    }))
  });
};
