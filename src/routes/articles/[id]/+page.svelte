<script>
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import ArticleDetailLead from '$lib/components/articles/ArticleDetailLead.svelte';
  import ArticleQuickTake from '$lib/components/articles/ArticleQuickTake.svelte';
  import ArticleProse from '$lib/components/articles/ArticleProse.svelte';
  import ArticleUtilities from '$lib/components/articles/ArticleUtilities.svelte';
  import ArticleUtilitySheet from '$lib/components/articles/ArticleUtilitySheet.svelte';
  import { showToast } from '$lib/client/toast';

  export let data;

  let rating = 3;
  let comment = '';
  let threadId = null;
  let message = '';
  let chatLog = [];
  let sending = false;
  let rerunBusy = false;
  let readStateBusy = false;
  let reactionBusy = false;
  let tagBusy = false;
  let tagError = '';
  let tagInput = '';
  let tags = Array.isArray(data.tags) ? data.tags : [];
  let tagSuggestions = Array.isArray(data.tagSuggestions) ? data.tagSuggestions : [];
  let chatError = '';
  const AUTO_MARK_READ_DELAY_MS = Number(data.autoReadDelayMs ?? 4000);
  let autoReadTimer = null;
  let fullTextSource = '';
  let articleBlocks = [];
  let backHref = '/articles';
  let articleImageUrl = null;
  let tagsSyncSignature = '';
  let suggestionsSyncSignature = '';
  let readSyncSignature = '';
  let reactionSyncSignature = '';
  let isRead = false;
  let reactionValue = null;
  let utilitiesOpen = false;
  let publishedLabel = '';
  let leadTags = [];
  let extraLeadTagCount = 0;

  const sanitizeBackHref = (value) => {
    if (!value || typeof value !== 'string') return '/articles';
    return value.startsWith('/articles') ? value : '/articles';
  };

  const normalizeReadValue = (value) => (Number(value) === 1 ? 1 : 0);
  const normalizeReactionValue = (value) => {
    const n = Number(value);
    if (n === 1) return 1;
    if (n === -1) return -1;
    return null;
  };

  const decodeHtmlEntities = (value) =>
    value
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'");

  const htmlToMarkdownish = (html) => {
    if (!html) return '';
    return decodeHtmlEntities(
      String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<(h[1-6])[^>]*>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<\/li>/gi, '')
        .replace(/<\/(p|div|section|article|blockquote|ul|ol|pre|table|tr)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  };

  const splitLongParagraph = (text) => {
    const compact = text.trim();
    if (compact.length < 520) return [compact];
    const sentences = compact.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean);
    if (!sentences || sentences.length < 4) return [compact];
    const groups = [];
    for (let i = 0; i < sentences.length; i += 3) groups.push(sentences.slice(i, i + 3).join(' '));
    return groups;
  };

  const parseArticleBlocks = (text) => {
    if (!text) return [];
    const normalized = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
    if (!normalized) return [];
    return normalized
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length === 0) return null;
        if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
          const headingText = lines[0].replace(/^#{1,6}\s+/, '').trim();
          if (!headingText) return null;
          return { type: 'heading', text: headingText };
        }
        const bulletLines = lines.filter((line) => /^(?:[-*•]\s+|\d+[.)]\s+)/.test(line));
        if (bulletLines.length >= Math.max(2, Math.ceil(lines.length * 0.6))) {
          return {
            type: 'list',
            items: bulletLines.map((line) => line.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean)
          };
        }
        const paragraph = lines.join(' ');
        const chunks = splitLongParagraph(paragraph);
        if (chunks.length === 1) return { type: 'paragraph', text: chunks[0] };
        return { type: 'paragraph_group', paragraphs: chunks };
      })
      .filter(Boolean);
  };

  const formatPublishedLabel = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  };

  const clearAutoReadTimer = () => {
    if (autoReadTimer) clearTimeout(autoReadTimer);
    autoReadTimer = null;
  };

  $: fullTextSource = (() => {
    const htmlFirst = htmlToMarkdownish(data.article?.content_html ?? '');
    if (htmlFirst && htmlFirst.length >= 80) return htmlFirst;
    return data.article?.content_text ?? '';
  })();

  $: backHref = sanitizeBackHref($page.url.searchParams.get('from'));
  $: articleImageUrl =
    typeof data.article?.image_url === 'string' && data.article.image_url.trim().length > 0
      ? data.article.image_url
      : null;
  $: articleBlocks = parseArticleBlocks(fullTextSource);
  $: publishedLabel = formatPublishedLabel(data.article?.published_at);
  $: leadTags = tags.slice(0, 3).map((tag) => ({ id: String(tag?.id ?? ''), name: String(tag?.name ?? 'Untitled') }));
  $: extraLeadTagCount = Math.max(0, tags.length - leadTags.length);
  $: {
    const signature = JSON.stringify(data.tags ?? []);
    if (signature !== tagsSyncSignature) {
      tagsSyncSignature = signature;
      tags = Array.isArray(data.tags) ? [...data.tags] : [];
    }
  }
  $: {
    const signature = JSON.stringify(data.tagSuggestions ?? []);
    if (signature !== suggestionsSyncSignature) {
      suggestionsSyncSignature = signature;
      tagSuggestions = Array.isArray(data.tagSuggestions) ? [...data.tagSuggestions] : [];
    }
  }
  $: {
    const nextRead = normalizeReadValue(data.article?.is_read);
    const signature = `${data.article?.id ?? 'article'}:${nextRead}`;
    if (signature !== readSyncSignature) {
      readSyncSignature = signature;
      isRead = nextRead === 1;
    }
  }
  $: {
    const nextReaction = normalizeReactionValue(data.reaction?.value);
    const signature = `${data.article?.id ?? 'article'}:${nextReaction ?? 'none'}`;
    if (signature !== reactionSyncSignature) {
      reactionSyncSignature = signature;
      reactionValue = nextReaction;
    }
  }
  $: if (isRead) clearAutoReadTimer();

  const fromApi = (payload, key, fallback) => payload?.data?.[key] ?? payload?.[key] ?? fallback;
  const openUtilities = () => {
    utilitiesOpen = true;
  };
  const closeUtilities = () => {
    utilitiesOpen = false;
  };

  const submitFeedback = async () => {
    await apiFetch(`/api/articles/${data.article.id}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating, comment, feedId: data.preferredSource?.feedId ?? null })
    });
    comment = '';
    await invalidateAll();
  };

  const setReaction = async (value) => {
    if (reactionBusy) return;
    const previous = reactionValue;
    reactionValue = value;
    reactionBusy = true;
    try {
      const res = await apiFetch(`/api/articles/${data.article.id}/reaction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, feedId: data.preferredSource?.feedId ?? null })
      });
      if (!res.ok) throw new Error('reaction_failed');
    } catch {
      reactionValue = previous;
      showToast('Unable to save feed reaction. Reverted.', 'error');
    } finally {
      reactionBusy = false;
      await invalidateAll();
    }
  };

  const sendMessage = async () => {
    if (!data.chatReadiness?.canChat) {
      chatError = data.chatReadiness?.reasons?.[0] ?? 'Chat is not ready yet.';
      return;
    }
    if (!message) return;
    sending = true;
    chatError = '';
    try {
      if (!threadId) {
        const threadRes = await apiFetch('/api/chat/threads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'article', articleId: data.article.id, title: data.article.title })
        });
        const created = await threadRes.json().catch(() => ({}));
        if (!threadRes.ok || !created?.id) {
          chatError = created?.error ?? 'Failed to start article chat';
          return;
        }
        threadId = created.id;
      }
      const userText = message;
      chatLog = [...chatLog, { role: 'user', content: userText }];
      message = '';
      const res = await apiFetch(`/api/chat/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: userText })
      });
      const response = await res.json().catch(() => ({}));
      if (!res.ok) {
        chatError = response?.error ?? 'Chat request failed';
        return;
      }
      chatLog = [...chatLog, { role: 'assistant', content: response.response }];
    } catch {
      chatError = 'Chat request failed';
    } finally {
      sending = false;
    }
  };

  const rerunJobs = async (types) => {
    rerunBusy = true;
    await apiFetch(`/api/articles/${data.article.id}/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ types })
    });
    rerunBusy = false;
    await invalidateAll();
  };

  const setReadState = async (nextIsRead) => {
    if (readStateBusy) return;
    const previous = isRead;
    isRead = nextIsRead;
    readStateBusy = true;
    clearAutoReadTimer();
    try {
      const res = await apiFetch(`/api/articles/${data.article.id}/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isRead: nextIsRead })
      });
      if (!res.ok) throw new Error('read_state_failed');
    } catch {
      isRead = previous;
      showToast('Unable to save read state. Reverted.', 'error');
    } finally {
      readStateBusy = false;
      await invalidateAll();
    }
  };

  const addTags = async () => {
    const names = tagInput
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    tagBusy = true;
    tagError = '';
    try {
      const res = await apiFetch(`/api/articles/${data.article.id}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addTagNames: names, source: 'manual' })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        tagError = payload?.error?.message ?? payload?.error ?? 'Failed to add tags';
        return;
      }
      tags = fromApi(payload, 'tags', tags);
      tagInput = '';
    } finally {
      tagBusy = false;
      await invalidateAll();
    }
  };

  const removeTag = async (tagId) => {
    tagBusy = true;
    tagError = '';
    try {
      const res = await apiFetch(`/api/articles/${data.article.id}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ removeTagIds: [tagId] })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        tagError = payload?.error?.message ?? payload?.error ?? 'Failed to remove tag';
        return;
      }
      tags = fromApi(payload, 'tags', tags);
    } finally {
      tagBusy = false;
      await invalidateAll();
    }
  };

  const acceptTagSuggestion = async (suggestion) => {
    if (tagBusy) return;
    const previousSuggestions = [...tagSuggestions];
    const previousTags = [...tags];
    tagBusy = true;
    tagError = '';
    tagSuggestions = tagSuggestions.filter((entry) => entry.id !== suggestion.id);
    tags = [...tags, { id: `pending-${suggestion.name_normalized}`, name: suggestion.name, source: 'manual' }];
    try {
      const res = await apiFetch(`/api/articles/${data.article.id}/tag-suggestions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'accept', suggestionId: suggestion.id })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        tagError = payload?.error?.message ?? payload?.error ?? 'Failed to accept suggestion';
        tagSuggestions = previousSuggestions;
        tags = previousTags;
        return;
      }
      tags = fromApi(payload, 'tags', tags);
      tagSuggestions = fromApi(payload, 'suggestions', tagSuggestions);
      void invalidateAll();
    } finally {
      tagBusy = false;
    }
  };

  const undoDismissTagSuggestion = async (suggestion) => {
    if (tagBusy) return;
    tagBusy = true;
    tagError = '';
    try {
      const res = await apiFetch(`/api/articles/${data.article.id}/tag-suggestions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'undo_dismiss',
          name: suggestion.name,
          confidence: suggestion.confidence ?? null,
          sourceProvider: suggestion.source_provider ?? null,
          sourceModel: suggestion.source_model ?? null
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        tagError = payload?.error?.message ?? payload?.error ?? 'Failed to undo dismiss';
        return;
      }
      tagSuggestions = fromApi(payload, 'suggestions', tagSuggestions);
      tags = fromApi(payload, 'tags', tags);
      void invalidateAll();
    } finally {
      tagBusy = false;
    }
  };

  const dismissTagSuggestion = async (suggestion) => {
    if (tagBusy) return;
    const previousSuggestions = [...tagSuggestions];
    tagBusy = true;
    tagError = '';
    tagSuggestions = tagSuggestions.filter((entry) => entry.id !== suggestion.id);
    try {
      const res = await apiFetch(`/api/articles/${data.article.id}/tag-suggestions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', suggestionId: suggestion.id })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        tagError = payload?.error?.message ?? payload?.error ?? 'Failed to dismiss suggestion';
        tagSuggestions = previousSuggestions;
        return;
      }
      tagSuggestions = fromApi(payload, 'suggestions', tagSuggestions);
      tags = fromApi(payload, 'tags', tags);
      void invalidateAll();
      showToast('Suggestion dismissed.', 'info', {
        durationMs: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            void undoDismissTagSuggestion(suggestion);
          }
        }
      });
    } finally {
      tagBusy = false;
    }
  };

  onMount(() => {
    if (data.article && !isRead) {
      autoReadTimer = setTimeout(() => {
        if (!isRead) void setReadState(true);
      }, AUTO_MARK_READ_DELAY_MS);
    }
    return () => {
      clearAutoReadTimer();
    };
  });

  onDestroy(() => {
    clearAutoReadTimer();
  });
</script>

{#if !data.article}
  <p>Article not found.</p>
{:else}
  <div class="article-detail-page">
    <ArticleDetailLead
      backHref={backHref}
      title={data.article.title ?? 'Untitled article'}
      sourceName={data.preferredSource?.sourceName ?? 'Unknown source'}
      author={data.article.author ?? null}
      publishedLabel={publishedLabel}
      {isRead}
      readBusy={readStateBusy}
      {reactionValue}
      reactionBusy={reactionBusy}
      canonicalUrl={data.article.canonical_url ?? null}
      fitScore={data.score?.score ?? null}
      fitLabel={data.score?.label ?? null}
      {leadTags}
      {extraLeadTagCount}
      imageUrl={articleImageUrl || null}
      onToggleRead={() => setReadState(!isRead)}
      onReactUp={() => setReaction(1)}
      onReactDown={() => setReaction(-1)}
      onOpenUtilities={openUtilities}
    />

    <div class="article-detail-layout">
      <div class="article-main">
        <ArticleQuickTake
          summaryText={data.summary?.summary_text ?? null}
          keyPoints={data.keyPoints?.points ?? []}
          score={data.score?.score ?? null}
          scoreLabel={data.score?.label ?? null}
          scoreReason={data.score?.reason_text ?? null}
          scoreEvidence={data.score?.evidence ?? []}
        />

        <ArticleProse blocks={articleBlocks} />
      </div>

      <aside class="article-inspector" aria-label="Article utilities">
        <ArticleUtilities
          layout="inspector"
          {tags}
          {tagSuggestions}
          {tagBusy}
          {tagError}
          bind:tagInput
          availableTags={data.availableTags ?? []}
          {rerunBusy}
          summary={data.summary}
          keyPoints={data.keyPoints}
          score={data.score}
          chatReadiness={data.chatReadiness}
          {chatLog}
          bind:message
          {sending}
          {chatError}
          bind:rating
          bind:comment
          feedbackCount={data.feedback?.length ?? 0}
          sources={data.sources ?? []}
          onAddTags={addTags}
          onRemoveTag={removeTag}
          onAcceptTagSuggestion={acceptTagSuggestion}
          onDismissTagSuggestion={dismissTagSuggestion}
          onRerunJobs={rerunJobs}
          onSendMessage={sendMessage}
          onSubmitFeedback={submitFeedback}
        />
      </aside>
    </div>

    <ArticleUtilitySheet open={utilitiesOpen} onClose={closeUtilities}>
      <ArticleUtilities
        layout="sheet"
        {tags}
        {tagSuggestions}
        {tagBusy}
        {tagError}
        bind:tagInput
        availableTags={data.availableTags ?? []}
        {rerunBusy}
        summary={data.summary}
        keyPoints={data.keyPoints}
        score={data.score}
        chatReadiness={data.chatReadiness}
        {chatLog}
        bind:message
        {sending}
        {chatError}
        bind:rating
        bind:comment
        feedbackCount={data.feedback?.length ?? 0}
        sources={data.sources ?? []}
        onAddTags={addTags}
        onRemoveTag={removeTag}
        onAcceptTagSuggestion={acceptTagSuggestion}
        onDismissTagSuggestion={dismissTagSuggestion}
        onRerunJobs={rerunJobs}
        onSendMessage={sendMessage}
        onSubmitFeedback={submitFeedback}
      />
    </ArticleUtilitySheet>
  </div>
{/if}

<style>
  .article-detail-page {
    min-width: 0;
    display: grid;
    gap: clamp(1.25rem, 2vw, 2rem);
    overflow-x: clip;
    width: 100%;
    max-width: min(100%, 86rem);
    margin-inline: auto;
  }

  .article-detail-layout {
    min-width: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: clamp(1.25rem, 2vw, 2rem);
    align-items: start;
  }

  .article-main,
  .article-inspector {
    min-width: 0;
  }

  .article-main {
    display: grid;
    gap: clamp(1.6rem, 2vw, 2.2rem);
  }

  @media (min-width: 960px) {
    .article-detail-layout {
      grid-template-columns: minmax(0, 1fr) minmax(320px, 352px);
      gap: clamp(1.5rem, 2vw, 2.5rem);
    }
  }
</style>
