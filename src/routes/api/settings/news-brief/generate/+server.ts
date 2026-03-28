import { json } from '@sveltejs/kit';
import { recordAuditEvent } from '$lib/server/audit';
import {
  createManualNewsBriefEdition,
  processNewsBriefEditionById,
  resolveNewsBriefGenerationContext
} from '$lib/server/news-brief';

export const POST = async ({ platform, locals }) => {
  const db = locals.db;
  const userId = locals.user?.id ?? 'admin';
  const generationContext = await resolveNewsBriefGenerationContext(db, platform.env, userId);

  if (!generationContext.apiKey) {
    return json(
      { error: { message: 'News Brief requires a configured provider key for the current global chat lane.' } },
      { status: 400 }
    );
  }

  const editionId = await createManualNewsBriefEdition(db, generationContext.config, undefined, userId);
  if (!editionId) {
    return json({ error: { message: 'Unable to queue News Brief generation.' } }, { status: 500 });
  }

  try {
    const edition = await processNewsBriefEditionById(db, platform.env, editionId, { skipClaim: true });

    await recordAuditEvent(db, {
      actor: userId,
      action: 'news_brief.generate_manual',
      requestId: locals.requestId,
      metadata: {
        edition_id: edition?.id ?? editionId,
        status: edition?.status ?? 'unknown'
      }
    });

    return json({
      ok: true,
      edition: {
        id: edition?.id ?? editionId,
        status: edition?.status ?? 'failed',
        generatedAt: edition?.generated_at ?? null,
        candidateCount: edition?.candidate_count ?? 0
      }
    });
  } catch (error) {
    await recordAuditEvent(db, {
      actor: userId,
      action: 'news_brief.generate_manual_failed',
      requestId: locals.requestId,
      metadata: {
        edition_id: editionId,
        error: error instanceof Error ? error.message : String(error)
      }
    });

    return json(
      { error: { message: error instanceof Error ? error.message : 'Failed to generate News Brief.' } },
      { status: 500 }
    );
  }
};
