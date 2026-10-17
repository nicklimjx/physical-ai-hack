import { createRuntime } from './runtime/index.js';
import { createComposition } from './composition.js';
import { createRoutes } from './routes.js';

const composition = createComposition(createRuntime());
const { server, clients } = createRoutes(composition.runtime, composition.services);
const port = Number(process.env.PORT ?? 4317);
server.listen(port, '127.0.0.1', () => {
  composition.start();
  console.log(`Ember Command simulation API at http://127.0.0.1:${port}`);
});

const shutdown = () => {
  composition.stop();
  for (const client of clients) client.end();
  server.close();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
