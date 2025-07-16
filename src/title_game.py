import json
import sys
from psnawp_api import PSNAWP
from psnawp_api.core import psnawp_exceptions, psnawp_exceptions as ex

try:
    PSNAWP(sys.argv[1])
except psnawp_exceptions.PSNAWPAuthenticationError:
    psnawp = False
    psnawp_code = "Your npsso code has expired or is incorrect. Please generate a new code!"
else:
    psnawp = PSNAWP(sys.argv[1])
    client = psnawp.me()


def user_status():
    sys_argvs = sys.argv
    del sys_argvs[0:2]
    accounts_id = sys_argvs[0].replace('["', '').replace('"]', '').replace('"', '')
    accounts_ids = accounts_id.split(',')

    game_title = "Console offline"

    if psnawp:
        for user in accounts_ids:
            try:
                user_obj = psnawp.user(account_id=user)
                user_info = user_obj.get_presence()

                if user_info["basicPresence"]["primaryPlatformInfo"]["onlineStatus"] != "online":
                    continue  # Пропускаємо, якщо не онлайн

                if "gameTitleInfoList" in user_info["basicPresence"]:
                    game_title = user_info["basicPresence"]["gameTitleInfoList"][0]["titleName"]
                else:
                    game_title = "Not playing"

                break  # зупиняємось після першого активного
            except ex.PSNAWPTooManyRequests:
                game_title = "Too many requests — slowing down"
                break
            except Exception as e:
                game_title = f"Error: {str(e)}"
                break
    else:
        if psnawp_code:
            game_title = psnawp_code
        else:
            game_title = "Authentication error"

    return game_title


print(user_status())
