import { describe, expect, it } from 'vitest';

describe('packages/pi-lsp/src/tools.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./tools.js')).resolves.toBeDefined();
	});
});
