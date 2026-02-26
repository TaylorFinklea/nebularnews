import { describe, expect, it } from 'vitest';
import { inspectFileContent } from '../../../scripts/check-ssr-render-inner.mjs';

describe('ssr render-inner guard', () => {
  it('passes when $$render_inner call has a function definition', () => {
    const content = [
      'function $$render_inner($$payload) { return $$payload; }',
      'let $$inner_payload;',
      '$$render_inner($$inner_payload);'
    ].join('\n');

    const findings = inspectFileContent(content);
    expect(findings).toEqual([]);
  });

  it('fails when $$render_inner is called without a definition', () => {
    const content = [
      'let $$inner_payload;',
      '$$render_inner($$inner_payload);'
    ].join('\n');

    const findings = inspectFileContent(content);
    expect(findings.some((finding) => finding.code === 'render-inner-missing-def')).toBe(true);
  });

  it('fails when suspicious IIFE pattern is present', () => {
    const content = [
      '(function $$render_inner($$payload) { return $$payload; });',
      '$$render_inner({});'
    ].join('\n');

    const findings = inspectFileContent(content);
    expect(findings.some((finding) => finding.code === 'render-inner-iife')).toBe(true);
  });
});
