#!/usr/bin/env python3
"""Download large Telegram files via Pyrogram MTProto (up to 2GB).

Usage: python3 download-large.py <chat_id> <message_id> <output_path>

Requires env: TELEGRAM_BOT_TOKEN, TELEGRAM_API_ID, TELEGRAM_API_HASH
"""
import sys
import os
import asyncio
from pyrogram import Client

async def main():
    if len(sys.argv) != 4:
        print("Usage: download-large.py <chat_id> <message_id> <output_path>", file=sys.stderr)
        sys.exit(1)

    chat_id = int(sys.argv[1])
    message_id = int(sys.argv[2])
    output_path = sys.argv[3]

    api_id = int(os.environ["TELEGRAM_API_ID"])
    api_hash = os.environ["TELEGRAM_API_HASH"]
    bot_token = os.environ["TELEGRAM_BOT_TOKEN"]

    async with Client(
        "collector_downloader",
        api_id=api_id,
        api_hash=api_hash,
        bot_token=bot_token,
        workdir="/tmp",
        no_updates=True,
    ) as app:
        msg = await app.get_messages(chat_id, message_id)
        await app.download_media(msg, file_name=output_path)
        print(output_path)

asyncio.run(main())
