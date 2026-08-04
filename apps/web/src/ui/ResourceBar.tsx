import { ALL_RESOURCES, type ResourceId } from '@gavan/shared';

import { useGameStore } from '../state/store';
import { KEY_RESOURCES, RESOURCE_LABEL } from './resourceText';

/**
 * Склад в углу экрана (§8 ТЗ): четыре ключевых числа всегда, остальное — по клику.
 *
 * Цифры табличные, поэтому счётчик не прыгает при каждом изменении и не тянет на себя взгляд.
 * Ни полосок, ни процентов заполнения: склад — это спокойная справка, а не датчик.
 */
export function ResourceBar(): React.JSX.Element {
  const resources = useGameStore((state) => state.resources);
  const cap = useGameStore((state) => state.storageCap);
  const open = useGameStore((state) => state.resourcesOpen);
  const toggle = useGameStore((state) => state.toggleResources);

  const shown: readonly ResourceId[] = open
    ? ALL_RESOURCES.filter((id) => resources[id] > 0 || KEY_RESOURCES.includes(id))
    : KEY_RESOURCES;

  return (
    <button type="button" className="resource-bar" onClick={toggle}>
      {shown.map((id) => (
        <span key={id} className="resource">
          <b className={resources[id] >= cap ? 'resource-value resource-full' : 'resource-value'}>
            {Math.floor(resources[id])}
          </b>
          <span className="resource-label">{RESOURCE_LABEL[id]}</span>
        </span>
      ))}
      <span className="resource-more">{open ? 'свернуть' : 'ещё'}</span>
    </button>
  );
}
