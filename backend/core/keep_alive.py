"""Self-ping so a free Render instance never goes to sleep.

Render sleeps free web services after 15 minutes without inbound requests. Calling our own
*public* URL goes out through the internet and back in through Render's proxy, so it counts
as inbound traffic. Runs only when a public URL is known (Render sets RENDER_EXTERNAL_URL),
so it never runs locally.
"""
from __future__ import annotations

import asyncio
import logging
import urllib.request

logger = logging.getLogger(__name__)


def _ping(url: str) -> int:
    with urllib.request.urlopen(url, timeout=30) as res:  # noqa: S310 (fixed https URL from config)
        return res.status


async def keep_alive(url: str, interval_s: int) -> None:
    logger.info("Keep-alive enabled: pinging %s every %ds", url, interval_s)
    while True:
        await asyncio.sleep(interval_s)
        try:
            status = await asyncio.to_thread(_ping, url)
            logger.debug("Keep-alive ping -> %s", status)
        except Exception as e:  # never let a failed ping crash the app
            logger.warning("Keep-alive ping failed: %s", e)
