import { apiError, apiOk } from '$lib/server/api';
import { recordAuditEvent } from '$lib/server/audit';
import { clearAllDismissedTagSuggestions } from '$lib/server/tags';

export const POST = async (event) => {
  const { platform, locals } = event;
  try {
    await clearAllDismissedTagSuggestions(platform.env.DB);
    await recordAuditEvent(platform.env.DB, {
      actor: 'admin',
      action: 'settings.tag_suggestions.reset_dismissed',
      requestId: locals.requestId
    });
    return apiOk(event, { ok: true });
  } catch (error) {
    return apiError(
      event,
      500,
      'internal_error',
      error instanceof Error ? error.message : 'Failed to reset dismissed suggestions'
    );
  }
};
