import { useState } from 'react';

import { requestMagicLink } from '../net/api';
import { useGameStore } from '../state/store';

/**
 * Вход (M5.2). Паролей нет — только адрес почты и ссылка в письме (§1 ТЗ).
 *
 * Экран говорит, что произойдёт, а не требует данных: игра про спокойствие не начинается
 * с формы регистрации и обещаний прислать новости.
 */
export function SignIn(): React.JSX.Element | null {
  const session = useGameStore((state) => state.session);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // Пока неизвестно, вошёл ли кто-то, экран не показывается: мигать формой незачем.
  if (session !== null) return null;

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (email.trim() === '' || waiting) return;

    setWaiting(true);
    void requestMagicLink(email.trim()).then((ok) => {
      setWaiting(false);
      setSent(ok);
    });
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-title">Гавань</h1>

        {sent ? (
          <>
            <p className="gate-line">Письмо ушло на {email}.</p>
            <p className="gate-hint">
              Внутри ссылка — она работает один раз и в течение получаса. Можно закрыть эту вкладку,
              остров подождёт.
            </p>
          </>
        ) : (
          <>
            <p className="gate-line">
              Остров с четырьмя жителями ждёт. Оставь адрес почты — пришлём ссылку для входа.
            </p>
            <form className="gate-form" onSubmit={submit}>
              <input
                className="gate-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="почта"
                aria-label="Адрес почты"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
              <button className="gate-button" type="submit" disabled={waiting}>
                {waiting ? 'Отправляю' : 'Прислать ссылку'}
              </button>
            </form>
            <p className="gate-hint">Пароля нет и не будет. Писем — только эта ссылка.</p>
          </>
        )}
      </div>
    </div>
  );
}
