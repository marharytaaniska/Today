import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise RuntimeError(
        "BOT_TOKEN не задан. Скопируй .env.example в .env и впиши туда токен от @BotFather."
    )

# Публичный https-адрес твоего Mini App (index.html из health-mini-app).
# Пока не задеплоен — оставь заглушку, бот запустится, но кнопка не откроется в Telegram.
MINI_APP_URL = os.getenv("MINI_APP_URL", "https://example.com")
