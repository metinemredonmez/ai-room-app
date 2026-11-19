import { describe, expect, it } from 'vitest';
import { FeedbackSchema } from './designs/designs.service.js';

// Result feedback (palemi): the owner's thumbs on a finished design; the admin red rate reads these.

describe('design feedback input', () => {
  it('accepts liked/disliked with an optional short reason', () => {
    expect(FeedbackSchema.parse({ rating: 'liked' }).rating).toBe('liked');
    expect(FeedbackSchema.parse({ rating: 'disliked', reason: 'Renkler koyu çıktı' }).reason).toBe('Renkler koyu çıktı');
  });

  it('rejects an unknown rating, extra fields and a long reason', () => {
    expect(() => FeedbackSchema.parse({ rating: 'ok' })).toThrow();
    expect(() => FeedbackSchema.parse({ rating: 'liked', extra: 1 })).toThrow();
    expect(() => FeedbackSchema.parse({ rating: 'disliked', reason: 'x'.repeat(301) })).toThrow();
  });
});
