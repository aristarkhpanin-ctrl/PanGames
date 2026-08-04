import type { MesherIncoming, MesherResult } from './chunkMesher.worker';

/**
 * Пул воркеров мешинга. Два потока (§12 ТЗ): один не успевает за правкой мира,
 * а больше двух на интегрированной графике только мешают друг другу.
 */

const WORKER_COUNT = 2;

export interface MeshPayload {
  chunk: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export class MesherPool {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, (payload: MeshPayload) => void>();
  private nextTicket = 0;
  private nextWorker = 0;

  constructor(voxels: Uint8Array) {
    for (let i = 0; i < WORKER_COUNT; i += 1) {
      const worker = new Worker(new URL('./chunkMesher.worker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (event: MessageEvent<MesherResult>): void => {
        const { ticket, ...payload } = event.data;
        const resolve = this.pending.get(ticket);
        if (resolve === undefined) return;
        this.pending.delete(ticket);
        resolve(payload);
      };

      // Каждому воркеру своя копия мира: срез отдаётся без копирования на нашей стороне.
      const copy = voxels.slice();
      const init: MesherIncoming = { type: 'init', voxels: copy.buffer };
      worker.postMessage(init, [copy.buffer]);

      this.workers.push(worker);
    }
  }

  mesh(chunk: number): Promise<MeshPayload> {
    const ticket = this.nextTicket;
    this.nextTicket += 1;

    // Раздаём чанки по кругу: запросы идут пачками, и так они делятся поровну.
    const worker = this.workers[this.nextWorker % this.workers.length];
    this.nextWorker += 1;
    if (worker === undefined) return Promise.reject(new Error('Пул воркеров пуст'));

    return new Promise<MeshPayload>((resolve) => {
      this.pending.set(ticket, resolve);
      const request: MesherIncoming = { type: 'mesh', chunk, ticket };
      worker.postMessage(request);
    });
  }

  /** Держит копии мира в воркерах в согласии с главным потоком. Понадобится на M2. */
  applyEdits(indices: Uint32Array, materials: Uint8Array): void {
    for (const worker of this.workers) {
      const message: MesherIncoming = {
        type: 'edit',
        indices: indices.slice(),
        materials: materials.slice(),
      };
      worker.postMessage(message);
    }
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.pending.clear();
  }
}
