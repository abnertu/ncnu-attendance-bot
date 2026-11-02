import { syncSite } from './sync.js';
syncSite().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
