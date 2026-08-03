import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Hud } from './Hud';

export function mountHud(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <Hud />
    </StrictMode>,
  );
}
