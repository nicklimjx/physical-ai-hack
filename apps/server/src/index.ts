import { createPreviewWorld } from '@ember/contracts/fixtures';
import { createPreviewRuntime } from './runtime/index.js';
import { createRoutes } from './routes.js';
const runtime=createPreviewRuntime(createPreviewWorld());
const {server}=createRoutes(runtime);
const port=Number(process.env.PORT??4317);
server.listen(port,'127.0.0.1',()=>console.log(`Ember Command preview API at http://127.0.0.1:${port}`));
