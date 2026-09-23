import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', timeout: 30000, use: { channel: 'msedge', headless: true }, outputDir: '../runtime/playwright-results' });
