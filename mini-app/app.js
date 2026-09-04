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
      // safeAreaInset приходит от Telegram асинхронно, ПОСЛЕ первой отрисовки
      // (в момент запуска tg.expand()/requestFullscreen() оно ещё 0). Наша
      // сжимающаяся шапка (см. ниже) один раз измеряет вёрстку при загрузке —
      // без этого события её измерения так и остаются рассчитаны под нулевой
      // safe-area, и когда Telegram чуть позже подставляет настоящий отступ
      // (сдвигая .frame через padding-top), верстка "разъезжается": score
      // рисуется поверх строки с датой вместо того, чтобы идти под ней.
      // Сигналим об этом через синтетический resize — на него уже подписан
      // пересчёт (window.addEventListener('resize', measure) ниже по файлу).
      window.dispatchEvent(new Event('resize'));
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

  // Сжатие шапки со score в фиксированную плашку при скролле — в стиле
  // collapsing header из iOS. Маскот, фон-градиент и блок score НЕ подменяются
  // отдельными "компактными" копиями — их top/размер/font-size непрерывно
  // интерполируются между развёрнутым и свёрнутым состоянием прямо от
  // scrollTop, без CSS transition, поэтому трансформация идёт 1:1 с пальцем.
  //
  // .hero-full получает через measure() ригидную высоту и sticky top,
  // выставленные ОДИН РАЗ (не на каждый кадр скролла) — поэтому браузер сам
  // отвечает за нативный, плавный скролл/прилипание, без гонки со
  // scroll-anchoring. На каждый кадр скролла меняются только position:absolute
  // потомки (маскот/фон/score), что не влияет на высоту документа.
  const scroller = document.getElementById('app');
  const heroFull = document.getElementById('heroFull');
  const bgGradient = heroFull && heroFull.querySelector('.bg-gradient');
  const calendarRow = heroFull && heroFull.querySelector('.calendar-row');
  const mascot = heroFull && heroFull.querySelector('.mascot');
  const healthScore = heroFull && heroFull.querySelector('.health-score');
  const scoreNum = healthScore && healthScore.querySelector('.score-num');
  const scorePercent = healthScore && healthScore.querySelector('.score-percent');
  const scoreTitle = healthScore && healthScore.querySelector('.score-title');
  const scoreSub = healthScore && healthScore.querySelector('.score-sub');
  const summary = heroFull && heroFull.querySelector('.summary');
  const metricCards = summary ? Array.from(summary.querySelectorAll('.metric-card')) : [];
  const advice = summary && summary.querySelector('.advice');
  const ctaButton = document.querySelector('.cta-button');
  const ctaSpacer = document.getElementById('ctaSpacer');

  if (scroller && heroFull && bgGradient && calendarRow && mascot && healthScore
      && scoreNum && scorePercent && scoreTitle && scoreSub && summary
      && metricCards.length && advice && ctaButton && ctaSpacer) {
    const COMPACT_HEIGHT = 114; // высота свёрнутой зелёной плашки
    const FULL_BG_HEIGHT = 350; // высота полотна градиента в развёрнутом виде
    // Оценка высоты компактного блока score (число+% и заголовок) при
    // compact-размерах шрифта — нужна только чтобы центрировать его по
    // вертикали в плашке; см. вычисление compact.scoreTop ниже.
    const COMPACT_SCORE_CONTENT_HEIGHT = 72; // 48 (число) + 8 (margin) + 16 (заголовок)

    // Свёрнутые значения. Раньше scoreTop/mascotTop брались из макета
    // Good-short в Figma (78/84px), но тот макет сверху резервирует место под
    // мокап системного статус-бара (~62px), которого в реальном приложении
    // нет — вместо него используется настоящий safe-area-inset устройства.
    // Поэтому вместо жёстких чисел центрируем маскота и блок score по
    // вертикали в доступном пространстве плашки (COMPACT_HEIGHT за вычетом
    // safe-area) — см. вычисление в measure() ниже.
    const compact = {
      mascotLeft: 0, mascotWidth: 115, mascotHeight: 84,
      scoreNumSize: 48, scorePercentSize: 32, scoreTitleSize: 16,
    };
    const getSafeAreaTop = () => parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--tg-safe-area-top')
    ) || 0;

    let full = null;
    let collapseDistance = 1;
    let framePaddingTop = 0;
    let ticking = false;

    const lerp = (a, b, t) => a + (b - a) * t;

    // Сбрасываем ВСЕ инлайновые правки, наведённые update(), перед измерением —
    // иначе при повторном measure() (например, по resize) во время скролла
    // мы измерим уже анимированные (уменьшенные) значения вместо настоящих
    // "развёрнутых", и с каждым таким пересчётом шапка будет схлопываться
    // сильнее, чем нужно.
    const metricCardChildren = metricCards.map((card) => Array.from(card.children));
    const adviceChildren = Array.from(advice.children);

    const measure = () => {
      healthScore.style.position = healthScore.style.top = healthScore.style.left = healthScore.style.right = '';
      healthScore.style.paddingTop = '';
      summary.style.position = summary.style.top = summary.style.left = summary.style.right = '';
      summary.style.pointerEvents = '';
      ctaButton.style.position = ctaButton.style.top = ctaButton.style.left = ctaButton.style.right = '';
      ctaButton.style.margin = '';
      ctaSpacer.style.height = '';
      mascot.style.top = mascot.style.left = mascot.style.width = mascot.style.height = '';
      bgGradient.style.top = bgGradient.style.height = '';
      heroFull.style.height = heroFull.style.top = '';
      scoreNum.style.fontSize = scorePercent.style.fontSize = scoreTitle.style.fontSize = '';
      scoreSub.style.opacity = '';
      calendarRow.style.opacity = calendarRow.style.pointerEvents = '';
      metricCards.forEach((card) => { card.style.opacity = card.style.pointerEvents = ''; });
      metricCardChildren.forEach((children) => children.forEach((el) => { el.style.opacity = ''; }));
      advice.style.opacity = advice.style.pointerEvents = '';
      adviceChildren.forEach((el) => { el.style.opacity = ''; });

      const heroRectTop = heroFull.getBoundingClientRect().top;
      const fullHeight = heroFull.offsetHeight;

      full = {
        mascotTop: mascot.getBoundingClientRect().top - heroRectTop,
        mascotLeft: mascot.offsetLeft,
        mascotWidth: mascot.offsetWidth,
        mascotHeight: mascot.offsetHeight,
        scoreTop: healthScore.getBoundingClientRect().top - heroRectTop,
        scorePaddingTop: parseFloat(getComputedStyle(healthScore).paddingTop),
        scoreNumSize: parseFloat(getComputedStyle(scoreNum).fontSize),
        scorePercentSize: parseFloat(getComputedStyle(scorePercent).fontSize),
        scoreTitleSize: parseFloat(getComputedStyle(scoreTitle).fontSize),
        // Документная (не завязанная на текущий scrollTop) позиция кнопки —
        // чтобы кнопка не заезжала на ещё не полностью погасшие совет/карточки,
        // её движение при скролле искусственно "придерживается" (см. ctaEase
        // в update()) и доезжает до места в самом конце, а не сразу 1:1.
        ctaDocTop: ctaButton.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop,
      };

      // Кнопка становится position:absolute и перестаёт резервировать место в
      // потоке — без спейсера с её прежним "футпринтом" (margin-top + высота)
      // .pinned немедленно съезжал бы вверх, на место кнопки.
      ctaSpacer.style.height = (ctaButton.offsetHeight + parseFloat(getComputedStyle(ctaButton).marginTop)) + 'px';

      // Центрируем маскота и блок score по вертикали в пространстве плашки,
      // которое реально остаётся под safe-area (чёлкой/статус-баром).
      const safeAreaTop = getSafeAreaTop();
      const availableHeight = COMPACT_HEIGHT - safeAreaTop;
      compact.mascotTop = safeAreaTop + (availableHeight - compact.mascotHeight) / 2;
      compact.scoreTop = safeAreaTop + (availableHeight - COMPACT_SCORE_CONTENT_HEIGHT) / 2;

      collapseDistance = Math.max(fullHeight - COMPACT_HEIGHT, 1);
      heroFull.style.height = fullHeight + 'px';
      heroFull.style.top = -collapseDistance + 'px';

      // В Telegram (body.tg) у .frame есть padding-top под safe-area (чёлку) —
      // sticky-офсет hero-full отсчитывается от ВНУТРЕННЕГО (padding) края
      // контейнера, поэтому первые framePaddingTop px скролла уходят на то,
      // чтобы проскроллить этот padding, и только потом hero-full реально
      // начинает двигаться. Без поправки на это наши progress/scrollAmt
      // "убегают" вперёд настоящего сжатия — из-за чего CTA-кнопка наезжала
      // на score (кнопка, в отличие от score/mascot, позиционируется самим
      // браузером, а не нашей формулой, и знает о padding сама).
      framePaddingTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;

      // .health-score и .summary переводим в position:absolute — им нужно
      // самим управлять своей позицией (score едет к компактной точке, а
      // summary должен всегда идти сразу под текущим низом score, даже когда
      // тот меняет свою естественную высоту из-за уменьшения шрифтов).
      healthScore.style.position = 'absolute';
      healthScore.style.left = healthScore.style.right = '0';
      summary.style.position = 'absolute';
      summary.style.left = summary.style.right = '0';

      // Кнопку тоже переводим в position:absolute (относительно #app, а не
      // .hero-full — .frame и так position:relative), чтобы придержать её
      // движение и не дать ей наехать на ещё не погасший совет/карточки
      // (см. ctaEase в update()). left/right вместо изначальных margin —
      // иначе margin-top сложился бы с нашим top ещё раз.
      ctaButton.style.position = 'absolute';
      ctaButton.style.left = ctaButton.style.right = '16px';
      ctaButton.style.margin = '0';

      update();
    };

    const update = () => {
      ticking = false;
      if (!full) return;

      const scrollTop = scroller.scrollTop;
      // Порог, при котором .hero-full "прилипает", — ровно collapseDistance
      // (framePaddingTop на него не влияет: sticky начинает двигаться сразу
      // с scrollTop=0, а не после проскроливания padding).
      const progress = Math.min(Math.max(scrollTop / collapseDistance, 0), 1);

      // Реальная viewport-позиция верхнего края .hero-full. До прилипания она
      // равна (framePaddingTop - scrollTop); "пол", на который она садится —
      // это top-значение самого .hero-full (-collapseDistance), СДВИНУТОЕ на
      // framePaddingTop (см. комментарий в measure(): sticky-офсет отсчитан от
      // padding-края контейнера, а не от border-края/viewport). heroTop здесь
      // ВСЕГДА точно совпадает с тем, что реально рисует браузер, поэтому
      // дальнейшие top-координаты (которые мы считаем как "локальные" +
      // heroTop) не могут разъехаться с CTA-кнопкой и остальным контентом,
      // который просто идёт в потоке за .hero-full — именно такой рассинхрон
      // и вызывал наезд кнопки на score.
      const heroTop = Math.min(
        Math.max(framePaddingTop - scrollTop, framePaddingTop - collapseDistance),
        framePaddingTop
      );

      // Стаггер: возвращает 0..1 внутри своего [start; end] окна общего
      // progress — так дата/совет/карточки пропадают не одновременно, а по
      // очереди: сначала дата, потом совет, затем Stress/Energy. Окна НЕ
      // пересекаются — иначе следующий блок начинал гаснуть раньше, чем
      // предыдущий успевал уйти (совет заметно таял почти сразу же).
      const stagger = (start, end) => Math.min(Math.max((progress - start) / (end - start), 0), 1);
      const calendarProgress = stagger(0, 0.3);
      const adviceProgress = stagger(0.3, 0.65);
      const cardsProgress = stagger(0.65, 1);

      // full.mascotTop/scoreTop измерены как ЛОКАЛЬНЫЕ координаты (относительно
      // .hero-full), а compact.mascotTop/scoreTop — это уже VIEWPORT-цели
      // (16/22px от реального safe-area). Чтобы честно лерпить одно к
      // другому, сначала переводим "развёрнутые" координаты в те же
      // viewport-термины: в естественном (нескролленном) состоянии верх
      // .hero-full стоит ровно на framePaddingTop, значит viewport = то же
      // самое + локальный отступ. Без этого пересчёта, как только
      // framePaddingTop переставал быть нулём (safe-area в реальном
      // Telegram), score рисовался поверх строки с датой.
      const fullMascotViewport = framePaddingTop + full.mascotTop;
      const fullScoreViewport = framePaddingTop + full.scoreTop;

      // Маскот: летит из развёрнутой позиции в свёрнутую.
      mascot.style.top = (lerp(fullMascotViewport, compact.mascotTop, progress) - heroTop) + 'px';
      mascot.style.left = lerp(full.mascotLeft, compact.mascotLeft, progress) + 'px';
      mascot.style.width = lerp(full.mascotWidth, compact.mascotWidth, progress) + 'px';
      mascot.style.height = lerp(full.mascotHeight, compact.mascotHeight, progress) + 'px';

      // Фон: та же логика, только левый край и цель по top совпадают (0),
      // поэтому top = -heroTop, а высота "полотна" сжимается до 168px.
      bgGradient.style.top = (-heroTop) + 'px';
      bgGradient.style.height = lerp(FULL_BG_HEIGHT, COMPACT_HEIGHT, progress) + 'px';

      // Score: полностью явный top (абсолютная локальная координата).
      const scoreTop = lerp(fullScoreViewport, compact.scoreTop, progress) - heroTop;
      healthScore.style.top = scoreTop + 'px';
      // Внутренний padding-top у .health-score (в развёрнутом виде — отступ
      // под calendar-row) тоже схлопываем, иначе даже при верном top текст
      // "95%" всё равно съезжал бы вниз на эти же 48px.
      healthScore.style.paddingTop = lerp(full.scorePaddingTop, 0, progress) + 'px';
      scoreNum.style.fontSize = lerp(full.scoreNumSize, compact.scoreNumSize, progress) + 'px';
      scorePercent.style.fontSize = lerp(full.scorePercentSize, compact.scorePercentSize, progress) + 'px';
      scoreTitle.style.fontSize = lerp(full.scoreTitleSize, compact.scoreTitleSize, progress) + 'px';
      // "Updated just now" — только прозрачность, без схлопывания высоты.
      scoreSub.style.opacity = String(1 - Math.min(progress / 0.6, 1));

      // Все второстепенные блоки ниже пропадают ТОЛЬКО через прозрачность —
      // их собственные высота/padding остаются исходными, без деформации
      // (по явному запросу). Порядок — по очереди: сначала дата, потом
      // совет, затем Stress/Energy (см. окна stagger() выше).
      calendarRow.style.opacity = String(1 - calendarProgress);
      calendarRow.style.pointerEvents = calendarProgress >= 1 ? 'none' : '';

      // Summary (Stress/Energy + совет): блок идёт сразу под текущим низом
      // score (даже когда тот меняет высоту из-за уменьшения шрифта), сам
      // не схлопывается — а раз к концу скролла он весь прозрачный и может
      // визуально перекрывать CTA/Pinned под собой, отключаем ему клики.
      summary.style.top = (scoreTop + healthScore.offsetHeight) + 'px';
      summary.style.pointerEvents = progress >= 1 ? 'none' : '';

      advice.style.opacity = String(1 - adviceProgress);
      advice.style.pointerEvents = adviceProgress >= 1 ? 'none' : '';
      adviceChildren.forEach((el) => { el.style.opacity = String(1 - adviceProgress); });

      metricCards.forEach((card) => {
        card.style.opacity = String(1 - cardsProgress);
        card.style.pointerEvents = cardsProgress >= 1 ? 'none' : '';
      });
      metricCardChildren.forEach((children) => {
        children.forEach((el) => { el.style.opacity = String(1 - cardsProgress); });
      });

      // Кнопка "Log Glucose": в естественном потоке она стоит всего в 32px
      // под советом, так что при обычном 1:1-скролле она наезжала бы на
      // совет/карточки задолго до того, как те успевали погаснуть. Вместо
      // изменения их геометрии (это как раз то, чего просили избежать)
      // "придерживаем" саму кнопку — кубическая ease-in кривая по её
      // VIEWPORT-позиции: почти не двигается в начале скролла (пока контент
      // ещё виден) и быстро доезжает до места к моменту полного сжатия шапки.
      // .cta-button — position:absolute внутри обычного (не sticky) #app,
      // поэтому чтобы получить конкретную viewport-позицию, достаточно
      // прибавить текущий scrollTop обратно к цели — при рендере браузер
      // вычтет его снова (как для любого абсолютного потомка скроллящегося
      // контейнера).
      // progress уже зажат в [0;1], поэтому ease тоже останавливается на 1 —
      // extraScroll докручивает кнопку дальше нормально (1:1), когда скролл
      // продолжается уже ПОСЛЕ полного сжатия шапки (иначе кнопка застряла
      // бы на месте вместо того, чтобы уезжать под шапку вместе с Pinned).
      const ctaEase = progress * progress * progress * progress * progress;
      const extraScroll = Math.max(scrollTop - collapseDistance, 0);
      const ctaViewportTarget = lerp(full.ctaDocTop, COMPACT_HEIGHT + 32, ctaEase) - extraScroll;
      ctaButton.style.top = (ctaViewportTarget + scrollTop) + 'px';
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);

    // Шрифт Inter грузится асинхронно и может чуть изменить размеры —
    // пересчитываем после его загрузки, чтобы измерения не оказались неточными.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(measure);
    }
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
