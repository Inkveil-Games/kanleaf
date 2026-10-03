import ELK from 'elkjs/lib/elk-api.js';
import LayoutWorker from 'elkjs/lib/elk-worker.min.js?worker';

export function createGraphLayoutEngine() {
  return new ELK({ workerFactory: () => new LayoutWorker() });
}
