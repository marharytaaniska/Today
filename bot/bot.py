"""
Telegram-бот для приложения "My Health".

Что делает:
- /start — приветствие + кнопка, открывающая Mini App (визуал из Figma)
- /help  — короткая справка

Как запустить:
    pip install -r requirements.txt
    cp .env.example .env      # и вписать туда свои значения
    python bot.py
"""

import asyncio
import logging

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import CommandStart, Command
from aiogram.types import (
    Message,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    WebAppInfo,
)

from config import BOT_TOKEN, MINI_APP_URL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = Router()


def main_menu_keyboard() -> InlineKeyboardMarkup:
    """Кнопка, открывающая Mini App поверх чата."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📊 Открыть My Health",
                    web_app=WebAppInfo(url=MINI_APP_URL),
                )
            ]
        ]
    )


@router.message(CommandStart())
async def on_start(message: Message) -> None:
    await message.answer(
        f"Привет, {message.from_user.first_name}! 👋\n\n"
        "Я — бот приложения <b>My Health</b>. "
        "Нажми на кнопку ниже, чтобы открыть свой экран здоровья.",
        reply_markup=main_menu_keyboard(),
        parse_mode="HTML",
    )


@router.message(Command("help"))
async def on_help(message: Message) -> None:
    await message.answer(
        "Доступные команды:\n"
        "/start — открыть главное меню и приложение\n"
        "/help — эта справка"
    )


@router.message(F.web_app_data)
async def on_web_app_data(message: Message) -> None:
    """
    Сюда прилетают данные, которые Mini App отправит через
    Telegram.WebApp.sendData(...) — например, когда пользователь
    заполнит форму "Записать глюкозу" внутри приложения.
    Пока просто логируем и отвечаем — логику подключим позже.
    """
    data = message.web_app_data.data
    logger.info("Получены данные из Mini App: %s", data)
    await message.answer(f"Принято из приложения: {data}")


async def main() -> None:
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()
    dp.include_router(router)

    logger.info("Бот запущен. Mini App URL: %s", MINI_APP_URL)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
