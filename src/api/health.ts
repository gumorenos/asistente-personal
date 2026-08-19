import { createServer, type Server } from 'node:http';
import type { AssistantStatus } from '../core/types.ts';

export interface HealthDependencies {
  isDatabaseReady(): boolean;
  getAssistantStatus(): AssistantStatus;
}

export function createHealthServer(
  host: string,
  port: number,
  deps: HealthDependencies,
): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }

    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.url === '/readyz') {
      const dbReady = deps.isDatabaseReady();
      const assistant = deps.getAssistantStatus();
      const ready = dbReady && assistant.state !== 'starting';
      response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: ready, database: dbReady, assistant }));
      return;
    }

    response.writeHead(404).end();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
