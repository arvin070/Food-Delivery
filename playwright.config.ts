import { defineConfig } from '@playwright/test';
process.env.LOG_LEVEL ??= 'silent';
export default defineConfig({
 testDir:'./tests/browser',workers:1,fullyParallel:false,timeout:30000,
 use:{baseURL:'http://127.0.0.1:3107',browserName:'chromium',headless:true,trace:'off',actionTimeout:15000},
 webServer:[
  {command:'npm run start -w @lunch/api',url:'http://127.0.0.1:4107/api/v1/health/ready',env:{NODE_ENV:'development',API_PORT:'4107',LOG_LEVEL:'silent',CORS_ORIGINS:'http://127.0.0.1:3107,http://localhost:3000'},reuseExistingServer:false,timeout:60000},
  {command:'npm exec -w @lunch/web -- next start --port 3107',url:'http://127.0.0.1:3107/login',env:{NODE_ENV:'production',API_INTERNAL_URL:'http://127.0.0.1:4107'},reuseExistingServer:false,timeout:60000},
 ],
});
