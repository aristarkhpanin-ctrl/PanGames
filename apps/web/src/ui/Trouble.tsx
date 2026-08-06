import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Что видит игрок, когда сломались мы (§11 ТЗ).
 *
 * Ошибка в интерфейсе не должна оставлять человека перед пустым экраном и не должна
 * показывать ему стек. Она показывает одну спокойную строку и кнопку — и говорит главное:
 * остров цел. В «Гавани» ничего не теряется (устав, п. 2), и падение интерфейса не исключение:
 * мир живёт на сервере, а не в этой вкладке.
 *
 * В консоль при этом уходит всё как есть — разбираться-то надо по настоящему стеку.
 */
export class Trouble extends Component<{ children: ReactNode }, { broken: boolean }> {
  override state = { broken: false };

  static getDerivedStateFromError(): { broken: boolean } {
    return { broken: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Единственное место в клиенте, где допустим console.error: это и есть отчёт об ошибке.
    console.error('Гавань: сломался интерфейс', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.broken) return this.props.children;

    return (
      <div className="trouble" role="alert">
        <p className="trouble-line">Панели сломались, а остров цел. Обнови страницу</p>
        <button
          type="button"
          className="trouble-button"
          onClick={() => {
            window.location.reload();
          }}
        >
          обновить
        </button>
      </div>
    );
  }
}
