import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/app.vitest.js', 'tests/financial-engine.test.js', 'tests/trading-engine.test.js', 'tests/chart-data-service.test.js', 'tests/state-recovery.test.js']
  }
});
