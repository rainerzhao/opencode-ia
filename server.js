const { startProduction } = require('./apps/server');

startProduction().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
