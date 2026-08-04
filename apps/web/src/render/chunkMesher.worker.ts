import { meshChunk } from '@gavan/shared';

/**
 * Воркер мешинга чанков. Главный поток не блокируется никогда (§2.4, §12 ТЗ):
 * на полном острове мешинг занимает около 190 мс, и в кадре этому места нет.
 *
 * Сам алгоритм живёт в @gavan/shared и ничего не знает про воркеры — здесь только обвязка.
 */

export interface MesherInit {
  type: 'init';
  /** Копия мира. У каждого воркера своя: SharedArrayBuffer потребовал бы изоляции источника. */
  voxels: ArrayBuffer;
}

export interface MesherRequest {
  type: 'mesh';
  chunk: number;
  /** Номер запроса: ответы приходят вперемешку, и клиент сопоставляет их по нему. */
  ticket: number;
}

/** Точечные правки мира — чтобы копия в воркере не расходилась с главным потоком (M2). */
export interface MesherEdit {
  type: 'edit';
  indices: Uint32Array;
  materials: Uint8Array;
}

export type MesherIncoming = MesherInit | MesherRequest | MesherEdit;

export interface MesherResult {
  type: 'mesh';
  chunk: number;
  ticket: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

let voxels: Uint8Array | null = null;

self.onmessage = (event: MessageEvent<MesherIncoming>): void => {
  const message = event.data;

  if (message.type === 'init') {
    voxels = new Uint8Array(message.voxels);
    return;
  }

  if (message.type === 'edit') {
    if (voxels === null) return;
    for (let i = 0; i < message.indices.length; i += 1) {
      voxels[message.indices[i] ?? 0] = message.materials[i] ?? 0;
    }
    return;
  }

  if (voxels === null) {
    throw new Error('Воркеру мешинга не передали мир — сначала нужен init');
  }

  const mesh = meshChunk(voxels, message.chunk);
  const result: MesherResult = {
    type: 'mesh',
    chunk: message.chunk,
    ticket: message.ticket,
    positions: mesh.positions,
    normals: mesh.normals,
    colors: mesh.colors,
    indices: mesh.indices,
  };

  // Буферы уезжают без копирования: геометрия острова весит около трёх мегабайт.
  self.postMessage(result, [
    mesh.positions.buffer,
    mesh.normals.buffer,
    mesh.colors.buffer,
    mesh.indices.buffer,
  ]);
};
