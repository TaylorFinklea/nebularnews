<script>
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { resolveArticleImageUrl } from '$lib/article-image';
  import { apiFetch } from '$lib/client/api-fetch';
  import Card from '$lib/components/Card.svelte';
  import { showToast } from '$lib/client/toast';
  import ArticleDetailLead from '$lib/components/articles/ArticleDetailLead.svelte';
  import ArticleProse from '$lib/components/articles/ArticleProse.svelte';
  import ArticleQuickTake from '$lib/components/articles/ArticleQuickTake.svelte';
  import ArticleUtilities from '$lib/components/articles/ArticleUtilities.svelte';

  export let data;

  let threadId = null;
  let message = '';
  let chatLog = [];
  let sending = false;
  let rerunBusy = false;
  let readStateBusy = false;
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
  let articleImageUrl = '';
  let tagsSyncSignature = '';
  let suggestionsSyncSignature = '';

  const sanitizeBackHref = (value) => {
    if (!value || typeof value !== 'string') return '/articles';
    return value.startsWith('/articles') ? value : '/articles';
  };

  const decodeHtmlEntities = (value) =>
    value
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'");

  const htmlToMarkdownish = (html) => {
    if (!html) return '';
    return decodeHtmlEntities(
      String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n').replace(/<(h[1-6])[^>]*>/gi, '\n\n').replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '')
        .replace(/<\/(p|div|section|article|blockquote|ul|ol|pre|table|tr)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
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
    return normalized.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
      const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return null;
      if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
        const headingText = lines[0].replace(/^#{1,6}\s+/, '').trim();
        if (!headingText) return null;
        return { type: 'heading', text: headingText };
      }
      const bulletLines = lines.filter((line) => /^(?:[-*•]\s+|\d+[.)]\s+)/.test(line));
      if (bulletLines.length >= Math.max(2, Math.ceil(lines.length * 0.6))) {
        return { type: 'list', items: bulletLines.map((l) => l.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean) };
      }
      const paragraph = lines.join(' ');
      const chunks = splitLongParagraph(paragraph);
      if (chunks.length === 1) return { type: 'paragraph', text: chunks[0] };
      return { type: 'paragraph_group', paragraphs: chunks };
    }).filter(Boolean);
  };

  $: fullTextSource = (() => {
    const htmlFirst = htmlToMarkdownish(data.article?.content_html ?? '');
    if (htmlFirst && htmlFirst.length >= 80) return htmlFirst;
    return data.article?.content_text ?? '';
  })();

  $: backHref = sanitizeBackHref($page.url.searchParams.get('from'));
  $: articleImageUrl = resolveArticleImageUrl({
    id: data.article?.id ?? null,
    title: data.article?.title ?? null,
    source_name: data.preferredSource?.sourceName ?? null,
    image_url: data.article?.image_url ?? null,
    tags
  });
  $: articleBlocks = parseArticleBlocks(fullTextSource);
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

  const fromApi = (payload, key, fallback) => payload?.data?.[key] ?? payload?.[key] ?? fallback;

  const submitFeedback = async (ratingValue, commentValue) => {
    await apiFetch(`/api/articles/${data.article.id}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: ratingValue, comment: commentValue, feedId: data.preferredSource?.feedId ?? null })
    });
    await invalidateAll();
  };

  const setReaction = async (value) => {
    await apiFetch(`/api/articles/${data.article.id}/reaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, feedId: data.preferredSource?.feedId ?? null })
    });
    await invalidateAll();
  };

  const sendMessage = async () => {
    if (!data.chatReadiness?.canChat) { chatError = data.chatReadiness?.reasons?.[0] ?? 'Chat is not ready yet.'; return; }
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
        if (!threadRes.ok || !created?.id) { chatError = created?.error ?? 'Failed to start article chat'; return; }
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
      if (!res.ok) { chatError = response?.error ?? 'Chat request failed'; return; }
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

  const setReadState = async (isRead) => {
    readStateBusy = true;
    try {
      await apiFetch(`/api/articles/${data.article.id}/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isRead })
      });
    } finally {
      readStateBusy = false;
      await invalidateAll();
    }
  };

  const addTags = async () => {
    const names = tagInput.split(',').map((e) => e.trim()).filter(Boolean);
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
      if (!res.ok) { tagError = payload?.error?.message ?? payload?.error ?? 'Failed to add tags'; return; }
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
      if (!res.ok) { tagError = payload?.error?.message ?? payload?.error ?? 'Failed to remove tag'; return; }
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
    if (data.article && !data.article.is_read) {
      autoReadTimer = setTimeout(() => {
        if (!data.article?.is_read) void setReadState(true);
      }, AUTO_MARK_READ_DELAY_MS);
    }
    return () => { if (autoReadTimer) clearTimeout(autoReadTimer); };
  });
</script>

{#if !data.article}
  <p>Article not found.</p>
{:else}
  <ArticleDetailLead
    article={data.article}
    preferredSource={data.preferredSource}
    {backHref}
    {articleImageUrl}
    isRead={data.article.is_read}
    {readStateBusy}
    score={data.score}
    on:toggleRead={() => setReadState(!data.article.is_read)}
  />

  <div class="article-layout">
    <div class="content-col">
      <ArticleQuickTake
        summary={data.summary}
        keyPoints={data.keyPoints}
        {rerunBusy}
        on:rerun={(e) => rerunJobs(e.detail.types)}
      />

      <Card>
        <h2>Full text</h2>
        <ArticleProse blocks={articleBlocks} />
      </Card>
    </div>

    <div class="sidebar-col">
      <ArticleUtilities
        article={data.article}
        score={data.score}
        reaction={data.reaction}
        {tags}
        {tagSuggestions}
        availableTags={data.availableTags ?? []}
        sources={data.sources ?? []}
        chatReadiness={data.chatReadiness}
        {chatLog}
        bind:message
        {sending}
        {rerunBusy}
        {tagBusy}
        {tagError}
        bind:tagInput
        {chatError}
        on:react={(e) => setReaction(e.detail.value)}
        on:rerun={(e) => rerunJobs(e.detail.types)}
        on:addTags={addTags}
        on:removeTag={(e) => removeTag(e.detail.tagId)}
        on:acceptTagSuggestion={(e) => acceptTagSuggestion(e.detail.suggestion)}
        on:dismissTagSuggestion={(e) => dismissTagSuggestion(e.detail.suggestion)}
        on:submitFeedback={(e) => submitFeedback(e.detail.rating, e.detail.comment)}
        on:send={sendMessage}
      />
    </div>
  </div>
{/if}

<datalist id="article-tag-options">
  {#each data.availableTags ?? [] as tag}
    <option value={tag.name}></option>
  {/each}
</datalist>

<style>
  .article-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: var(--space-6);
    align-items: start;
  }

  .content-col, .sidebar-col {
    display: grid;
    gap: var(--space-5);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  @media (max-width: 900px) {
    .article-layout {
      grid-template-columns: 1fr;
    }

    .sidebar-col {
      order: -1;
    }
  }
</style>
