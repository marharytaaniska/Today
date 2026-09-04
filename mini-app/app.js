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

  if (scroller && heroFull && bgGradient && calendarRow && mascot && healthScore
      && scoreNum && scorePercent && scoreTitle && scoreSub && summary
      && metricCards.length && advice) {
    const COMPACT_HEIGHT = 168; // высота свёрнутой зелёной плашки (макет Good-short)
    const FULL_BG_HEIGHT = 350; // высота полотна градиента в развёрнутом виде

    // Свёрнутые значения — из макета Good-short в Figma (координаты внутри .hero-full).
    // В самом макете Good-short сверху есть мокап системного статус-бара
    // (~62px), которого в реальном приложении нет — вместо него используется
    // настоящий safe-area-inset устройства. Поэтому scoreTop/mascotTop не
    // берём буквально из макета (78/84), а отсчитываем от реального отступа
    // safe-area: раз строки с датой больше нет, маскот и score поднимаются
    // и встают сразу под чёлкой/статус-баром, а не оставляют пустое место.
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
      mascot.style.top = mascot.style.left = mascot.style.width = mascot.style.height = '';
      bgGradient.style.top = bgGradient.style.height = '';
      heroFull.style.height = heroFull.style.top = '';
      scoreNum.style.fontSize = scorePercent.style.fontSize = scoreTitle.style.fontSize = '';
      scoreSub.style.maxHeight = scoreSub.style.opacity = '';
      calendarRow.style.height = calendarRow.style.paddingTop = calendarRow.style.opacity = '';
      calendarRow.style.pointerEvents = '';
      summary.style.paddingTop = summary.style.gap = '';
      metricCards.forEach((card) => { card.style.height = card.style.padding = card.style.opacity = ''; });
      metricCardChildren.forEach((children) => children.forEach((el) => { el.style.opacity = ''; }));
      advice.style.height = advice.style.paddingTop = advice.style.paddingBottom = advice.style.opacity = '';
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
        scoreSubHeight: scoreSub.offsetHeight,
        calendarRowHeight: calendarRow.offsetHeight,
        summaryPaddingTop: parseFloat(getComputedStyle(summary).paddingTop),
        summaryGap: parseFloat(getComputedStyle(summary).rowGap || getComputedStyle(summary).gap) || 0,
        metricCardHeight: metricCards[0].offsetHeight,
        metricCardPadding: parseFloat(getComputedStyle(metricCards[0]).paddingTop),
        adviceHeight: advice.offsetHeight,
        advicePaddingTop: parseFloat(getComputedStyle(advice).paddingTop),
        advicePaddingBottom: parseFloat(getComputedStyle(advice).paddingBottom),
      };

      // Свёрнутые top для маскота/score — от реального safe-area, а не из
      // макета (см. комментарий у объявления compact выше).
      const safeAreaTop = getSafeAreaTop();
      compact.mascotTop = 22 + safeAreaTop;
      compact.scoreTop = 16 + safeAreaTop;

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
      scoreSub.style.overflow = 'hidden';
      calendarRow.style.overflow = 'hidden';

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
      // очереди: сначала дата, потом совет, затем Stress/Energy.
      const stagger = (start, end) => Math.min(Math.max((progress - start) / (end - start), 0), 1);
      const calendarProgress = stagger(0, 0.25);
      const adviceProgress = stagger(0.2, 0.6);
      const cardsProgress = stagger(0.55, 1);

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
      // "Updated just now" в свёрнутом виде отсутствует — гасим и схлопываем чуть быстрее прогресса.
      const subProgress = Math.min(progress / 0.6, 1);
      scoreSub.style.opacity = String(1 - subProgress);
      scoreSub.style.maxHeight = lerp(full.scoreSubHeight, 0, subProgress) + 'px';

      // Дата уходит первой — гаснет через прозрачность и одновременно
      // схлопывается по высоте (иначе после её исчезновения осталась бы
      // пустая "дыра", т.к. score/summary теперь позиционируются явно).
      calendarRow.style.opacity = String(1 - calendarProgress);
      calendarRow.style.height = lerp(full.calendarRowHeight, 0, calendarProgress) + 'px';
      calendarRow.style.paddingTop = lerp(8, 0, calendarProgress) + 'px';
      calendarRow.style.pointerEvents = calendarProgress > 0.5 ? 'none' : '';

      // Summary (Stress/Energy + совет): весь блок идёт сразу под текущим
      // низом score (даже когда тот меняет высоту из-за уменьшения шрифта).
      summary.style.top = (scoreTop + healthScore.offsetHeight) + 'px';

      // Совет пропадает вторым.
      advice.style.opacity = String(1 - adviceProgress);
      advice.style.height = lerp(full.adviceHeight, 0, adviceProgress) + 'px';
      advice.style.paddingTop = lerp(full.advicePaddingTop, 0, adviceProgress) + 'px';
      advice.style.paddingBottom = lerp(full.advicePaddingBottom, 0, adviceProgress) + 'px';
      adviceChildren.forEach((el) => { el.style.opacity = String(1 - adviceProgress); });

      // Карточки Stress/Energy пропадают последними.
      metricCards.forEach((card) => {
        card.style.opacity = String(1 - cardsProgress);
        card.style.height = lerp(full.metricCardHeight, 0, cardsProgress) + 'px';
        card.style.padding = lerp(full.metricCardPadding, 0, cardsProgress) + 'px';
      });
      metricCardChildren.forEach((children) => {
        children.forEach((el) => { el.style.opacity = String(1 - cardsProgress); });
      });

      // paddingTop/gap самого summary схлопываем по общему progress — к моменту,
      // когда все три блока внутри уже погасли, они не оставляют зазора.
      summary.style.paddingTop = lerp(full.summaryPaddingTop, 0, progress) + 'px';
      summary.style.gap = lerp(full.summaryGap, 0, progress) + 'px';
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
