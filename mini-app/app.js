// Базовая интеграция с Telegram Web App SDK.
// Если страница открыта не внутри Telegram (просто в браузере для превью),
// window.Telegram будет отсутствовать — код ниже это учитывает.

(function () {
  const tg = window.Telegram && window.Telegram.WebApp;

  if (tg) {
    document.body.classList.add('tg');
    tg.ready();
    tg.expand(); // раскрыть на всю высоту экрана

    // Развернуть на весь экран без верхней шапки Telegram (Bot API 8.0+).
    // На старых клиентах, где fullscreen недоступен, просто ничего не делает.
    if (tg.isVersionAtLeast && tg.isVersionAtLeast('8.0') && tg.requestFullscreen) {
      tg.requestFullscreen();
    }

    // В fullscreen-режиме Telegram больше не рисует свою шапку, поэтому
    // контент может залезать под системную чёлку/статус-бар телефона —
    // подставляем реальный safe-area отступ через CSS-переменную.
    const applySafeArea = () => {
      const top = (tg.safeAreaInset && tg.safeAreaInset.top || 0)
        + (tg.contentSafeAreaInset && tg.contentSafeAreaInset.top || 0);
      document.documentElement.style.setProperty('--tg-safe-area-top', top + 'px');
    };
    applySafeArea();
    tg.onEvent('safeAreaChanged', applySafeArea);
    tg.onEvent('contentSafeAreaChanged', applySafeArea);
    tg.onEvent('fullscreenChanged', applySafeArea);

    // Пример: подхватываем цвета темы пользователя (light/dark) из Telegram.
    // Пока не обязательно — экран и так на светлой теме, но пригодится позже.
    // const bg = tg.themeParams.bg_color;

    // Пример получения данных пользователя, который открыл бота:
    // const user = tg.initDataUnsafe?.user;
    // console.log('Открыл:', user?.first_name);
  } else {
    console.log('Предпросмотр вне Telegram: SDK не активен, это нормально.');
  }

  // Заглушки для нижней навигации — переключение вкладок здесь ещё не реализовано.
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Заглушка для кнопки "Записать глюкозу" — сюда позже подключим реальную логику/бэкенд.
  const cta = document.querySelector('.cta-button');
  if (cta) {
    cta.addEventListener('click', () => {
      if (tg && tg.showAlert) {
        tg.showAlert('The glucose entry form will go here (not implemented yet).');
      } else {
        alert('The glucose entry form will go here (not implemented yet).');
      }
    });
  }
})();
