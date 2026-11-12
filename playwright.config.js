import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',workers:1,use:{baseURL:process.env.E2E_BASE_URL || 'http://127.0.0.1:8008',timezoneId:'America/Caracas',viewport:{width:1440,height:1000},screenshot:'only-on-failure'},reporter:'list'});
