/** Status tones shared by the Cimiento feedback components (docs/design-system/components). */
export const TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
export type Tone = (typeof TONES)[number];

/** Tones with a message role (Alert and Toast have no `neutral`). */
export type MessageTone = Exclude<Tone, 'neutral'>;

/** Glyphs available to the feedback components (see Glyph.svelte). */
export type GlyphName =
	'info' | 'success' | 'alert' | 'error' | 'x' | 'chevron-down' | 'inbox' | 'search';
