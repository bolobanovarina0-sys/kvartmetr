# КвартМетр: Платформа умного ЖКХ

Запуск:

    pip install -r requirements.txt
    python app.py          # http://127.0.0.1:5000

База `app.db` создаётся при первом запуске. Переменная окружения `SECRET_KEY` — для продакшена.

## Структура

    app.py                    сервер Flask: маршруты, SQLite, API, расчёт расходов, имитация датчиков и RSSI LoRa
    requirements.txt          Flask, requests (для симулятора шлюза)
    templates/
      base.html               шапка и подвал
      landing.html            главная: hero, «Как работают датчики», миссия, каталог, шаги, контакты
      calculator.html         конструктор планировки и калькулятор стоимости
      dashboard.html          личный кабинет
      login.html, register.html
      terms.html, privacy.html   демонстрационные юридические документы
    static/
      css/style.css
      js/app.js               кабинет: план, Drag-and-Drop, графики, RSSI
      js/calculator.js        редактор (Konva.js) и калькулятор
      img/demo_plan.svg
      uploads/                загруженные планы

Chart.js, Konva.js и шрифт Inter подключаются из интернета.
