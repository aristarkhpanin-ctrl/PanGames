import { describe, expect, it } from 'vitest';

import { WORLD_FORMAT_VERSION } from './index';

describe('@gavan/shared', () => {
  it('загружается и отдаёт версию формата мира', () => {
    expect(WORLD_FORMAT_VERSION).toBe(1);
  });
});
